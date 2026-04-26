/**
 * Magenta RT Holly — mic loop (push-to-record → one chunk → loop)
 *
 * Hold the button (or Space) to record; on release we send the clip to
 * `/api/snippet-chunk` and loop the returned PCM until the next recording.
 */

const YOUR_NGROK_URL = 'YOUR_NGROK_URL';
let useSharedGateway = true;

function magentartApiBase(hostRoot) {
  let u = hostRoot.trim();
  if (u.endsWith('/')) u = u.slice(0, -1);
  return useSharedGateway ? `${u}/magentart` : u;
}

const NGROK_HEADERS_GET = {
  'ngrok-skip-browser-warning': 'true',
  'bypass-tunnel-reminder': 'true',
};

const COL = {
  bg: [246, 246, 247],
  panel: [255, 255, 255],
  stroke: [0, 0, 0, 20],
  text: [0, 0, 0, 210],
  muted: [0, 0, 0, 140],
  accent: [0, 184, 148, 255],
  warn: [225, 112, 85, 255],
};

let statusLine = 'Set URL → Warm tunnel → hold to record.';
let audioCtx = null;
let wetOut = null;
let rawOut = null;
let monitorMixSlider = null;

let sessionId = null; // kept for compatibility if backend sets it elsewhere

// Recording
let recActive = false;
let recStream = null;
let recSource = null;
let recWorkletNode = null;
let recChunks = [];
let recWrite = 0;
let recRate = 0;
const REC_MAX_SEC = 2.0;
const LOOP_FADE_SAMPLES = 256;
const LOOP_XFADE_SAMPLES = 1024;

// Looping: raw (recorded) vs wet (model)
let rawLoopSrc = null;
let wetLoopSrc = null;
let rawLoopBuf = null;
let wetLoopBuf = null;
let loopDurSec = 0;

let layout = {
  W: 720,
  x0: 24,
  sliderW: 420,
  valW: 56,
  valX: 0,
  perfY0: 0,
  padRect: null,
  centroidRect: null,
  footerPad: 100,
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// XY macro pad
let padX01 = 0.35;
let padY01 = 0.35;
let padDragging = false;

// Centroid EQ (visual + drag)
const MAX_CENTROID_SLIDERS = 64;
let serverCentroidCount = 32;
let centroidUiCount = 32;
let centroidWeights = new Array(32).fill(0);
let activeCentroidIdx = -1;
let lastCentroidPaint = null; // { idx, v }

function applyMacroToSliders() {
  // X: tuned(0) → chaotic(1) : temperature 0.2 → 2.0, top-k 16 → 256
  // Y: loose(0) → locked(1)  : guidance 2.0 → 9.0, mean 0.4 → 1.3
  const temp = 0.2 + padX01 * (2.0 - 0.2);
  const topk = Math.round(16 + padX01 * (256 - 16));
  const guid = 2.0 + padY01 * (9.0 - 2.0);
  const mean = 0.4 + padY01 * (1.3 - 0.4);
  if (ui.temp) ui.temp.value(temp);
  if (ui.topk) ui.topk.value(topk);
  if (ui.guid) ui.guid.value(guid);
  if (ui.mean) ui.mean.value(mean);
  [ui.temp, ui.topk, ui.guid, ui.mean].forEach((sl) => {
    if (sl && sl.elt) sl.elt.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function ensureOutputMix(ctx) {
  if (wetOut && rawOut) return;
  wetOut = ctx.createGain();
  rawOut = ctx.createGain();
  wetOut.gain.value = 1.0;
  rawOut.gain.value = 0.0;
  wetOut.connect(ctx.destination);
  rawOut.connect(ctx.destination);
}

function stopAllLoops() {
  const stopSrc = (src) => {
    if (!src) return;
    try { src.onended = null; } catch (e) {}
    try { src.stop(0); } catch (e) {}
    try { src.disconnect(); } catch (e) {}
  };
  stopSrc(rawLoopSrc);
  stopSrc(wetLoopSrc);
  rawLoopSrc = null;
  wetLoopSrc = null;
}

function updateMonitorMix() {
  if (!monitorMixSlider || !wetOut || !rawOut) return;
  const mix = clamp(parseFloat(monitorMixSlider.value()) / 100, 0, 1);
  const wet = Math.sin(mix * Math.PI * 0.5);
  const raw = Math.cos(mix * Math.PI * 0.5);
  wetOut.gain.value = wet;
  rawOut.gain.value = raw;
}

function getBase() {
  const el = document.getElementById('magenta_base_url');
  const host = (el && el.value) ? el.value.trim() : YOUR_NGROK_URL;
  return magentartApiBase(host);
}

async function warmTunnel(base) {
  const r = await fetch(base + '/ngrok-free-warm', {
    method: 'GET',
    headers: NGROK_HEADERS_GET,
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}

async function fetchCentroidCount(base) {
  const r = await fetch(base + '/', {
    method: 'GET',
    headers: NGROK_HEADERS_GET,
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('GET / HTTP ' + r.status);
  const j = await r.json();
  const n = parseInt(j.centroid_count, 10);
  if (!isNaN(n) && n > 0) rebuildCentroidSliders(n);
}

function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  ensureOutputMix(audioCtx);
  updateMonitorMix();
  return audioCtx;
}

let _workletLoaded = false;
async function ensureRecorderWorklet(ctx) {
  if (_workletLoaded) return;
  // First try a simple relative path (works when served over HTTP).
  try {
    await ctx.audioWorklet.addModule('./worklets/mic-recorder-worklet.js');
    _workletLoaded = true;
    return;
  } catch (e1) {
    // Fallback: resolve relative to this script URL.
    try {
      let scriptUrl = null;
      const cs = document.currentScript;
      if (cs) {
        if (cs.src && /^https?:/i.test(cs.src)) {
          scriptUrl = cs.src;
        } else {
          const attr = cs.getAttribute && cs.getAttribute('src');
          if (attr) scriptUrl = new URL(attr, window.location.href).toString();
        }
      }
      if (!scriptUrl) scriptUrl = window.location.href;
      const url = new URL('./worklets/mic-recorder-worklet.js', scriptUrl).toString();
      await ctx.audioWorklet.addModule(url);
      _workletLoaded = true;
      return;
    } catch (e2) {
      // Surface the original error if the fallback was just URL parsing.
      throw e1;
    }
  }
  _workletLoaded = true;
}

function makeSliderRow(label, x, y, minV, maxV, start, step, formatVal) {
  const sp = createSpan(label);
  sp.addClass('mrt-label');
  sp.position(x, y + 4);
  const sl = createSlider(minV, maxV, start);
  sl.addClass('mrt-slider');
  if (sl && sl.elt) sl.elt.step = String(step);
  sl.position(x + 108, y);
  sl.style('width', layout.sliderW + 'px');
  const val = createSpan(formatVal(start));
  val.addClass('mrt-val');
  val.position(layout.valX, y + 4);
  const upd = () => val.html(formatVal(sl.value()));
  sl.input(upd);
  sl.changed(upd);
  return sl;
}

function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    .mrt-label{ font: 12px system-ui; color: rgba(0,0,0,.65); }
    .mrt-section{ font: 12px system-ui; font-weight: 650; color: rgba(0,0,0,.75); }
    .mrt-input{ font: 14px system-ui; padding: 8px 10px; border-radius: 10px;
      border: 1px solid rgba(0,0,0,.12); background: #fff; outline: none; }
    .mrt-btn{ font: 13px system-ui; padding: 10px 12px; border-radius: 10px;
      border: 1px solid rgba(0,0,0,.12); background: #111; color: #fff; cursor: pointer; }
    .mrt-btn-ghost{ background: #fff; color: #111; }
    .mrt-val{ font: 12px system-ui; color: rgba(0,0,0,.65); width: 56px; display: inline-block; text-align: right; }
    input[type=range].mrt-slider{ -webkit-appearance:none; appearance:none; height:8px; border-radius:999px;
      background: rgba(0,0,0,.10); border: 1px solid rgba(0,0,0,.10); }
    input[type=range].mrt-slider::-webkit-slider-thumb{ -webkit-appearance:none; width:18px; height:18px; border-radius:50%;
      background:#fff; border:1px solid rgba(0,0,0,.22); box-shadow:0 1px 3px rgba(0,0,0,.16); }
  `;
  document.head.appendChild(s);
}

function rebuildCentroidSliders(nServer) {
  const nShow = Math.min(nServer, MAX_CENTROID_SLIDERS);
  serverCentroidCount = nServer;
  centroidUiCount = nShow;
  centroidWeights = new Array(nShow).fill(0);
  activeCentroidIdx = -1;
  lastCentroidPaint = null;
}

function resizeCanvasToLayout(domLastY) {
  const perfLastY = (layout.perfY0 || 0) + 160 + 80;
  const lastY = Math.max(domLastY, perfLastY);
  const H = constrain(lastY, 760, 2200);
  resizeCanvas(layout.W, H);
}

let ui = {
  temp: null,
  topk: null,
  guid: null,
  mean: null,
  monitor: null,
  recBtn: null,
};

function setup() {
  injectStyles();
  const W = layout.W;
  layout.x0 = 24;
  layout.valW = 56;
  layout.valX = W - layout.x0 - layout.valW;
  layout.sliderW = layout.valX - (layout.x0 + 108) - 10;

  const c = createCanvas(W, 720);
  if (c.elt) {
    c.elt.id = 'mrt_p5_canvas';
    if (c.elt.parentElement) c.elt.parentElement.id = 'mrt-magenta-client';
  }
  textFont('system-ui, -apple-system, Segoe UI, sans-serif');

  // Reserve top area for canvas header + instruction card.
  let y = 160;
  const x0 = layout.x0;
  const lab = (t, yy, cls) => {
    const sp = createSpan(t);
    sp.addClass(cls || 'mrt-label');
    sp.position(x0, yy + 3);
    return sp;
  };

  lab('Server URL', y, 'mrt-label');
  const urlInput = createInput(YOUR_NGROK_URL);
  urlInput.addClass('mrt-input');
  urlInput.position(x0, y + 22);
  urlInput.size(W - 48, 38);
  urlInput.id('magenta_base_url');

  y += 88;
  const warm = createButton('Warm tunnel');
  warm.addClass('mrt-btn');
  warm.addClass('mrt-btn-ghost');
  warm.position(x0, y);
  warm.mousePressed(() => {
    const base = getBase();
    warmTunnel(base)
      .then(() => fetchCentroidCount(base))
      .then(() => {
        statusLine = 'Tunnel warm · centroids=' + serverCentroidCount + ' · hold to record.';
      })
      .catch((e) => {
        statusLine = 'Warm failed: ' + e;
      });
  });

  y += 56;
  layout.perfY0 = y;
  y += 160 + 28;

  lab('Sampling', y, 'mrt-section');
  y += 28;
  ui.temp = makeSliderRow('temperature', x0, y, 0, 4, 0.85, 0.01, (v) => nf(v, 1, 2));
  y += 40;
  ui.topk = makeSliderRow('top-k', x0, y, 0, 1024, 64, 1, (v) => str(round(v)));
  y += 40;
  ui.guid = makeSliderRow('guidance', x0, y, 0, 10, 6.0, 0.01, (v) => nf(v, 1, 2));
  y += 40;
  ui.mean = makeSliderRow('mean', x0, y, 0, 2, 0.85, 0.01, (v) => nf(v, 1, 2));
  y += 40;
  monitorMixSlider = makeSliderRow('monitor wet %', x0, y, 0, 100, 60, 1, (v) => str(round(v)));
  monitorMixSlider.input(updateMonitorMix);

  y += 62;
  ui.recBtn = createButton('HOLD TO RECORD');
  ui.recBtn.addClass('mrt-btn');
  ui.recBtn.position(x0, y);
  ui.recBtn.size(W - 48, 52);
  ui.recBtn.mousePressed(() => startHoldRecord());
  ui.recBtn.mouseReleased(() => stopHoldRecord());

  // Spacebar push-to-talk
  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    if (ev.code === 'Space') {
      startHoldRecord();
      ev.preventDefault();
    }
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') {
      stopHoldRecord();
      ev.preventDefault();
    }
  });
  window.addEventListener('blur', () => {
    if (recActive) stopHoldRecord();
  });

  rebuildCentroidSliders(32);
  resizeCanvasToLayout(y + 160);
}

function draw() {
  background(COL.bg[0], COL.bg[1], COL.bg[2]);

  // Header
  noStroke();
  fill(COL.panel[0], COL.panel[1], COL.panel[2]);
  rect(12, 12, width - 24, 72, 12);
  stroke(COL.stroke[0], COL.stroke[1], COL.stroke[2], COL.stroke[3]);
  noFill();
  rect(12, 12, width - 24, 72, 12);
  noStroke();
  textAlign(LEFT, TOP);
  fill(COL.text[0], COL.text[1], COL.text[2], COL.text[3]);
  textStyle(BOLD);
  textSize(18);
  text('Magenta RT — Holly (mic loop)', 24, 22);
  textStyle(NORMAL);
  textSize(10);
  fill(COL.muted[0], COL.muted[1], COL.muted[2], COL.muted[3]);
  text('Mic loop A/B: record once, then morph raw ↔ model.', 24, 46);

  // Instruction section under the header card
  noStroke();
  fill(COL.panel[0], COL.panel[1], COL.panel[2]);
  rect(12, 96, width - 24, 44, 12);
  stroke(COL.stroke[0], COL.stroke[1], COL.stroke[2], COL.stroke[3]);
  noFill();
  rect(12, 96, width - 24, 44, 12);
  noStroke();
  fill(COL.text[0], COL.text[1], COL.text[2], 200);
  textStyle(BOLD);
  textSize(12);
  text('Hold button (or Space) to record', 24, 106);
  textStyle(NORMAL);
  textSize(10);
  fill(COL.muted[0], COL.muted[1], COL.muted[2], 200);
  text('Release to generate one chunk, then use “monitor wet %” to morph raw ↔ model.', 24, 124);

  // Footer status
  const barY = height - 54;
  noStroke();
  fill(COL.panel[0], COL.panel[1], COL.panel[2]);
  rect(12, barY, width - 24, 42, 12);
  stroke(COL.stroke[0], COL.stroke[1], COL.stroke[2], COL.stroke[3]);
  noFill();
  rect(12, barY, width - 24, 42, 12);
  noStroke();
  fill(COL.muted[0], COL.muted[1], COL.muted[2], COL.muted[3]);
  textSize(10);
  textAlign(LEFT, TOP);
  text(statusLine, 24, barY + 18, width - 48, 20);

  // Performance surface (XY pad + centroid EQ), matching the older sketches.
  const perfY = layout.perfY0 || 220;
  layout.padRect = { x: 24, y: perfY, w: 240, h: 160 };
  layout.centroidRect = { x: 280, y: perfY, w: width - 304, h: 160 };
  drawXyPad();
  drawCentroidEq();

  // No extra in-canvas hint here (keep centroid panel clean).
}

function drawXyPad() {
  const r = layout.padRect;
  if (!r) return;
  noStroke();
  fill(COL.panel[0], COL.panel[1], COL.panel[2]);
  rect(r.x, r.y, r.w, r.h, 12);
  stroke(COL.stroke[0], COL.stroke[1], COL.stroke[2], COL.stroke[3]);
  noFill();
  rect(r.x, r.y, r.w, r.h, 12);

  noStroke();
  fill(COL.muted[0], COL.muted[1], COL.muted[2], COL.muted[3]);
  textAlign(LEFT, TOP);
  textSize(10);
  text('MACRO PAD (drag)', r.x + 12, r.y + 10);

  textSize(9);
  fill(COL.muted[0], COL.muted[1], COL.muted[2], 200);
  textAlign(LEFT, TOP);
  text('tuned', r.x + 12, r.y + 28);
  textAlign(RIGHT, TOP);
  text('chaotic', r.x + r.w - 12, r.y + 28);
  textAlign(LEFT, BOTTOM);
  text('loose', r.x + 12, r.y + r.h - 10);
  textAlign(RIGHT, BOTTOM);
  text('locked', r.x + r.w - 12, r.y + r.h - 10);

  const innerX = r.x + 18;
  const innerY = r.y + 44;
  const innerW = r.w - 36;
  const innerH = r.h - 62;
  stroke(0, 0, 0, 12);
  line(innerX + innerW / 2, innerY, innerX + innerW / 2, innerY + innerH);
  line(innerX, innerY + innerH / 2, innerX + innerW, innerY + innerH / 2);
  noStroke();

  const cx = innerX + padX01 * innerW;
  const cy = innerY + padY01 * innerH;
  fill(COL.accent[0], COL.accent[1], COL.accent[2], 220);
  circle(cx, cy, 16);
  fill(255);
  circle(cx, cy, 5);
}

function xyPadHit(mx, my) {
  const r = layout.padRect;
  if (!r) return false;
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}

function setXyFromMouse(mx, my) {
  const r = layout.padRect;
  if (!r) return;
  const innerX = r.x + 18;
  const innerY = r.y + 44;
  const innerW = r.w - 36;
  const innerH = r.h - 62;
  padX01 = clamp((mx - innerX) / innerW, 0, 1);
  padY01 = clamp((my - innerY) / innerH, 0, 1);
  applyMacroToSliders();
}

function drawCentroidEq() {
  const r = layout.centroidRect;
  if (!r) return;

  noStroke();
  fill(COL.panel[0], COL.panel[1], COL.panel[2]);
  rect(r.x, r.y, r.w, r.h, 12);
  stroke(COL.stroke[0], COL.stroke[1], COL.stroke[2], COL.stroke[3]);
  noFill();
  rect(r.x, r.y, r.w, r.h, 12);

  noStroke();
  fill(COL.muted[0], COL.muted[1], COL.muted[2], COL.muted[3]);
  textAlign(LEFT, TOP);
  textSize(10);
  text('CENTROIDS (drag bars)', r.x + 12, r.y + 10);

  const n = Math.max(1, centroidUiCount || centroidWeights.length || 1);
  const padX = 12;
  const padY = 30;
  const iw = r.w - padX * 2;
  const ih = r.h - padY - 12;
  const bw = iw / n;

  for (let i = 0; i < n; i++) {
    const v = clamp(centroidWeights[i] || 0, 0, 2);
    const h = (v / 2) * ih;
    const x = r.x + padX + i * bw;
    const y = r.y + padY + (ih - h);
    fill(COL.accent[0], COL.accent[1], COL.accent[2], 120);
    rect(x + 1, y, Math.max(2, bw - 2), h, 4);
  }
}

function centroidIdxAt(mx, my) {
  const r = layout.centroidRect;
  if (!r) return -1;
  const n = Math.max(1, centroidUiCount || centroidWeights.length || 1);
  const padX = 12;
  const padY = 30;
  const iw = r.w - padX * 2;
  const ih = r.h - padY - 12;
  const bx = r.x + padX;
  const by = r.y + padY;
  if (mx < bx || mx > bx + iw || my < by || my > by + ih) return -1;
  const bw = iw / n;
  const idx = Math.floor((mx - bx) / bw);
  return clamp(idx, 0, n - 1);
}

function centroidValueAtY(my) {
  const r = layout.centroidRect;
  const padY = 30;
  const ih = r.h - padY - 12;
  const by = r.y + padY;
  const t = clamp(1 - (my - by) / ih, 0, 1);
  return 2 * t;
}

function mousePressed() {
  if (xyPadHit(mouseX, mouseY)) {
    padDragging = true;
    setXyFromMouse(mouseX, mouseY);
    return;
  }
  const idx = centroidIdxAt(mouseX, mouseY);
  if (idx >= 0) {
    activeCentroidIdx = idx;
    const v = centroidValueAtY(mouseY);
    centroidWeights[idx] = v;
    lastCentroidPaint = { idx, v };
  }
}

function mouseDragged() {
  if (padDragging) {
    setXyFromMouse(mouseX, mouseY);
    return;
  }
  if (activeCentroidIdx < 0) return;
  const idx = centroidIdxAt(mouseX, mouseY);
  if (idx < 0) return;
  const v = centroidValueAtY(mouseY);
  if (lastCentroidPaint) {
    const a = lastCentroidPaint.idx;
    const b = idx;
    const v0 = lastCentroidPaint.v;
    const v1 = v;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const span = Math.max(1, hi - lo);
    for (let i = lo; i <= hi; i++) {
      const t = (i - lo) / span;
      centroidWeights[i] = clamp(v0 + (v1 - v0) * t, 0, 2);
    }
  } else {
    centroidWeights[idx] = v;
  }
  activeCentroidIdx = idx;
  lastCentroidPaint = { idx, v };
}

function mouseReleased() {
  activeCentroidIdx = -1;
  lastCentroidPaint = null;
  padDragging = false;
}

async function startHoldRecord() {
  if (recActive) return;
  const ctx = getAudioContext();
  ctx.resume();
  // Defensive: ensure monitor nodes exist before connecting mic.
  ensureOutputMix(ctx);
  if (!rawOut) {
    rawOut = ctx.createGain();
    rawOut.gain.value = 0.0;
    rawOut.connect(ctx.destination);
  }
  // Stop any ongoing loop playback so recording is clean.
  stopAllLoops();
  recActive = true;
  statusLine = 'Recording…';
  ui.recBtn && ui.recBtn.html('RECORDING…');

  // For short loop capture, browser processing (AEC/NS/AGC) can introduce audible artifacts.
  recStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  // Use the *main* AudioContext so raw monitoring works via `rawOut`.
  recRate = ctx.sampleRate;
  recSource = ctx.createMediaStreamSource(recStream);

  try {
    await ensureRecorderWorklet(ctx);
  } catch (e) {
    statusLine =
      'Worklet load failed. Serve this folder over HTTP (not file://). ' +
      'If using p5 Web Editor, worklets must be hosted as separate files. ' +
      'Error: ' +
      e;
    recActive = false;
    ui.recBtn && ui.recBtn.html('HOLD TO RECORD');
    throw e;
  }
  recChunks = [];
  recWrite = 0;
  recWorkletNode = new AudioWorkletNode(ctx, 'mic-recorder', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
  recWorkletNode.port.onmessage = (ev) => {
    const d = ev && ev.data ? ev.data : {};
    if (d.type !== 'chunk' || !d.samples) return;
    if (!recActive) return;
    // d.samples is a Float32Array (transferable buffer)
    recChunks.push(d.samples);
    recWrite += d.samples.length;
    if (recWrite >= Math.floor(recRate * REC_MAX_SEC)) {
      stopHoldRecord();
    }
  };
  recWorkletNode.port.postMessage({ type: 'start' });
  recSource.connect(recWorkletNode);

  // Route mic to raw monitor output.
  recSource.connect(rawOut);
}

async function stopHoldRecord() {
  if (!recActive) return;
  recActive = false;
  ui.recBtn && ui.recBtn.html('HOLD TO RECORD');

  let raw = null;
  if (recChunks && recChunks.length) {
    const total = recChunks.reduce((a, c) => a + (c ? c.length : 0), 0);
    if (total > 0) {
      const out = new Float32Array(total);
      let off = 0;
      for (const c of recChunks) {
        if (!c) continue;
        out.set(c, off);
        off += c.length;
      }
      raw = out;
    }
  }
  const rawRate = recRate;

  // teardown first so mic is released even if network fails
  try { recSource && recSource.disconnect(); } catch (e) {}
  recSource = null;
  try { recWorkletNode && recWorkletNode.port && recWorkletNode.port.postMessage({ type: 'stop' }); } catch (e) {}
  try { recWorkletNode && recWorkletNode.disconnect(); } catch (e) {}
  recWorkletNode = null;
  recChunks = [];
  if (recStream) {
    for (const t of recStream.getTracks()) t.stop();
  }
  recStream = null;
  recWrite = 0;
  recRate = 0;

  if (!raw || !raw.length || !rawRate) {
    statusLine = 'No audio captured.';
    return;
  }

  // Start looping the raw capture immediately (A/B reference).
  const ctx = getAudioContext();
  const rawLoop = _buildLoopBufferFromMono(raw, rawRate, ctx);
  rawLoopBuf = rawLoop.buf;
  loopDurSec = rawLoop.durSec;
  _startRawLoop();

  statusLine = 'Captured ' + nf(raw.length / rawRate, 1, 2) + 's · sending prompt…';
  try {
    const base = getBase();
    await sendAudioPromptWeighted(base, raw, rawRate, 1.25);
    statusLine = 'Generating chunk…';
    const buf = await requestOneChunk(base);
    statusLine = 'Received chunk (Holly-weighted). Looping…';
    playWetLoopFromPcm(buf);
  } catch (e) {
    statusLine = 'Send failed: ' + e;
  }
}

function _buildLoopBufferFromMono(input, inRate, ctx) {
  const mono = _normalizeToPeak(input, 0.85);
  const out = _resampleLinear(mono, inRate, ctx.sampleRate);
  // Keep loop length reasonable (avoid ultra-short taps).
  const minSec = 0.35;
  const maxSec = 2.00;
  const durSec = clamp(out.length / ctx.sampleRate, minSec, maxSec);
  const frames = Math.max(1, Math.floor(durSec * ctx.sampleRate));
  const cropped = out.length >= frames ? out.subarray(0, frames) : out;
  // Try to trim to a near zero-crossing at the end for a cleaner loop seam.
  const trimmed = _trimLoopToZeroCrossing(cropped, ctx.sampleRate);

  const buf = ctx.createBuffer(1, trimmed.length, ctx.sampleRate);
  const chd = buf.getChannelData(0);
  chd.set(trimmed);

  _applyLoopSeamCrossfadeInPlace(chd);
  return { buf, durSec: buf.duration };
}

function _trimLoopToZeroCrossing(x, rate) {
  if (!x || x.length < 64) return x;
  const searchSec = 0.03;
  const win = Math.min(x.length - 2, Math.max(32, Math.floor(rate * searchSec)));
  // Find best end index near end with minimal |sample| (proxy for zero-crossing).
  let best = x.length - 1;
  let bestAbs = Math.abs(x[best]);
  const start = Math.max(1, x.length - 1 - win);
  for (let i = start; i < x.length - 1; i++) {
    const a = Math.abs(x[i]);
    if (a < bestAbs) {
      bestAbs = a;
      best = i;
    }
  }
  const endLen = Math.max(64, best);
  return x.subarray(0, endLen);
}

function _applyLoopSeamCrossfadeInPlace(chd) {
  const n = chd.length;
  const fadeN = Math.min(LOOP_FADE_SAMPLES, Math.floor(n / 8));
  for (let i = 0; i < fadeN; i++) {
    const a = (i + 1) / (fadeN + 1);
    chd[i] *= a;
    chd[n - 1 - i] *= a;
  }

  // Crossfade tail into head to reduce seam artifacts.
  const xN = Math.min(LOOP_XFADE_SAMPLES, Math.floor(n / 4));
  if (xN < 32) return;
  for (let i = 0; i < xN; i++) {
    const t = i / (xN - 1);
    const aIn = Math.sin(t * Math.PI * 0.5);
    const aOut = Math.cos(t * Math.PI * 0.5);
    const head = chd[i];
    const tail = chd[n - xN + i];
    chd[i] = head * aIn + tail * aOut;
  }
}

function _resampleLinear(input, inRate, outRate) {
  if (!input || !input.length) return new Float32Array(0);
  if (inRate === outRate) return new Float32Array(input);
  const ratio = inRate / outRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const t = i * ratio;
    const i0 = Math.floor(t);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const a = t - i0;
    out[i] = input[i0] * (1 - a) + input[i1] * a;
  }
  return out;
}

function _startRawLoop() {
  const ctx = getAudioContext();
  ensureOutputMix(ctx);
  updateMonitorMix();
  if (!rawLoopBuf) return;
  if (rawLoopSrc) {
    try { rawLoopSrc.stop(0); } catch (e) {}
    try { rawLoopSrc.disconnect(); } catch (e) {}
  }
  const src = ctx.createBufferSource();
  src.buffer = rawLoopBuf;
  src.loop = true;
  src.loopStart = 0;
  src.loopEnd = rawLoopBuf.duration;
  src.connect(rawOut);
  src.start(ctx.currentTime + 0.02);
  rawLoopSrc = src;
}

function _startWetLoop() {
  const ctx = getAudioContext();
  ensureOutputMix(ctx);
  updateMonitorMix();
  if (!wetLoopBuf) return;
  if (wetLoopSrc) {
    try { wetLoopSrc.stop(0); } catch (e) {}
    try { wetLoopSrc.disconnect(); } catch (e) {}
  }
  const src = ctx.createBufferSource();
  src.buffer = wetLoopBuf;
  src.loop = true;
  src.loopStart = 0;
  src.loopEnd = wetLoopBuf.duration;
  src.connect(wetOut);
  src.start(ctx.currentTime + 0.02);
  wetLoopSrc = src;
}

function _normalizeToPeak(x, targetPeak) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (!peak || peak < 1e-6) return x;
  const g = targetPeak / peak;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

function resampleTo16kMono(input, inRate) {
  if (!input || !input.length) return new Float32Array(0);
  const outRate = 16000;
  if (inRate === outRate) return new Float32Array(input);
  const ratio = inRate / outRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const t = i * ratio;
    const i0 = Math.floor(t);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const a = t - i0;
    out[i] = input[i0] * (1 - a) + input[i1] * a;
  }
  return out;
}

function _buildCentroidWeightsBody() {
  const cw = [];
  for (let i = 0; i < serverCentroidCount; i++) {
    if (i < centroidWeights.length) cw.push(parseFloat(centroidWeights[i] || 0));
    else cw.push(0);
  }
  return cw;
}

async function sendAudioPromptWeighted(base, raw, rawRate, weight) {
  // Normalize so quiet captures still have enough energy.
  const mono = _normalizeToPeak(raw, 0.85);
  const f16 = resampleTo16kMono(mono, rawRate);

  const hdr = new ArrayBuffer(16);
  const dv = new DataView(hdr);
  // MRTA header (matches backend parser)
  dv.setUint8(0, 0x4d);
  dv.setUint8(1, 0x52);
  dv.setUint8(2, 0x54);
  dv.setUint8(3, 0x41);
  dv.setUint32(4, 16000, true);
  dv.setUint32(8, f16.length, true);
  dv.setUint16(12, 1, true);
  dv.setUint16(14, 0, true);

  const payload = new Uint8Array(16 + f16.length * 4);
  payload.set(new Uint8Array(hdr), 0);
  payload.set(new Uint8Array(f16.buffer), 16);

  const headers = {
    ...NGROK_HEADERS_GET,
    'Content-Type': 'application/octet-stream',
    'X-Audio-Weight': String(weight || 0),
  };
  if (sessionId) headers['X-Magenta-Session'] = sessionId;

  const r = await fetch(base + '/api/audio-prompt', {
    method: 'POST',
    headers,
    body: payload,
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  });
  const sid = r.headers.get('X-Magenta-Session');
  if (sid) sessionId = sid;
  if (!r.ok) {
    const t = await r.text();
    throw new Error('HTTP ' + r.status + ' ' + t);
  }
}

async function requestOneChunk(base) {
  const body = {
    style_text: 'a tree falls in the forest',
    temperature: parseFloat(ui.temp.value()),
    topk: parseInt(ui.topk.value(), 10),
    guidance_weight: parseFloat(ui.guid.value()),
    mean_weight: parseFloat(ui.mean.value()),
    audio_prompt_weight: 1.25,
    centroid_weights: _buildCentroidWeightsBody(),
  };
  if (sessionId) body.session_id = sessionId;

  const r = await fetch(base + '/api/next-chunk', {
    method: 'POST',
    headers: { ...NGROK_HEADERS_GET, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    mode: 'cors',
    credentials: 'omit',
  });
  const sid = r.headers.get('X-Magenta-Session');
  if (sid) sessionId = sid;
  if (!r.ok) {
    const t = await r.text();
    throw new Error('HTTP ' + r.status + ' ' + t);
  }
  return await r.arrayBuffer();
}

function _parseMrtPcm(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  if (u8.length < 16) throw new Error('truncated PCM');
  if (u8[0] !== 0x4d || u8[1] !== 0x52 || u8[2] !== 0x54 || u8[3] !== 0x01) {
    throw new Error('bad PCM magic');
  }
  const dv = new DataView(arrayBuffer);
  const rate = dv.getUint32(4, true);
  const frames = dv.getUint32(8, true);
  const ch = dv.getUint16(12, true);
  const f32 = new Float32Array(arrayBuffer, 16, frames * ch);
  return { rate, frames, ch, f32 };
}

function playWetLoopFromPcm(arrayBuffer) {
  const ctx = getAudioContext();
  ensureOutputMix(ctx);
  updateMonitorMix();

  const { rate, frames, ch, f32 } = _parseMrtPcm(arrayBuffer);
  // Downmix to mono and resample to ctx rate for stable looping.
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += f32[i * ch + c];
    mono[i] = s / ch;
  }
  const res = _resampleLinear(mono, rate, ctx.sampleRate);
  const targetFrames =
    rawLoopBuf && rawLoopBuf.length ? rawLoopBuf.length : Math.max(1, Math.floor(res.length));
  const useFrames = Math.min(res.length, targetFrames);
  const buf = ctx.createBuffer(1, useFrames, ctx.sampleRate);
  // Normalize returned chunk (helps if model output is quiet).
  let peak = 0;
  for (let i = 0; i < useFrames; i += Math.max(1, Math.floor(useFrames / 12000))) {
    peak = Math.max(peak, Math.abs(res[i]));
  }
  const g = (peak && peak > 1e-6) ? Math.min(1.0, 0.9 / peak) : 1.0;
  const chd = buf.getChannelData(0);
  for (let i = 0; i < useFrames; i++) chd[i] = res[i] * g;
  _applyLoopSeamCrossfadeInPlace(chd);
  wetLoopBuf = buf;
  _startWetLoop();
}

