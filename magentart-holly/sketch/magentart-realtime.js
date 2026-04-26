/**
 * Magenta RT Holly — realtime chunk streamer
 *
 * Continuously requests `/api/next-chunk` and schedules returned PCM chunks.
 * This can burn through ngrok bandwidth quickly.
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

const RT_COL = {
  bg: [246, 246, 247],
  panel: [255, 255, 255],
  stroke: [0, 0, 0, 20],
  text: [0, 0, 0, 210],
  muted: [0, 0, 0, 140],
  accent: [0, 184, 148, 255],
  warn: [225, 112, 85, 255],
};

const STREAM_PROMPTS = [
  { label: 'RITUAL', text: 'cathedral AI choir, breathy human voices, sacred digital ritual, luminous harmonies' },
  { label: 'STATIC', text: 'glitched vocal shards, modem noise, broken radio choir, crackling cybernetic texture' },
  { label: 'ORGANIC', text: 'warm mouth sounds, intimate humming, soft body percussion, close fragile voices' },
  { label: 'MACHINE', text: 'industrial vocal engine, chopped consonants, metallic pulse, synthetic crowd rhythm' },
];

const START_PREBUFFER_SEC = 10.0;
const TARGET_BUFFER_SEC = 14.0;
const MIN_START_LEAD_SEC = 0.08;
const CHUNK_CROSSFADE_SEC = 0.75;
const EDGE_FADE_SEC = 0.002;
const CONTROL_SEND_INTERVAL_MS = 250;

let statusLine = 'Set URL → Warm tunnel → Start stream.';
let audioCtx = null;
let sessionId = null;
let isStreaming = false;
let requestInFlight = false;
let streamSocket = null;
let scheduledTime = 0;
let activeSources = [];
let chunksReceived = 0;
let lastChunkLevel = 0;
let lastError = '';
let lastBufferLead = 0;
let lastControlSend = 0;
let smoothedChunkGain = 1.0;

let padX01 = 0.5;
let padY01 = 0.5;
let padDragging = false;
let paramX01 = 0.35;
let paramY01 = 0.35;
let paramDragging = false;
let hitRects = [];

let serverCentroidCount = 5;
let centroidUiCount = 5;
let centroidWeights = new Array(5).fill(0);
let activeCentroidIdx = -1;

let layout = {
  W: 820,
  x0: 24,
  sliderW: 420,
  valW: 56,
  valX: 0,
  perfY0: 0,
  padRect: null,
  paramRect: null,
  centroidRect: null,
};

let ui = {
  url: null,
  promptInputs: [],
  temp: null,
  topk: null,
  guid: null,
  mean: null,
  audioWeight: null,
  startBtn: null,
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getBase() {
  const host = ui.url && ui.url.value ? ui.url.value().trim() : YOUR_NGROK_URL;
  return magentartApiBase(host);
}

function getStreamUrl() {
  const base = getBase().replace(/\/$/, '');
  if (base.startsWith('https://')) return 'wss://' + base.slice('https://'.length) + '/ws/stream';
  if (base.startsWith('http://')) return 'ws://' + base.slice('http://'.length) + '/ws/stream';
  return base + '/ws/stream';
}

function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
    .mrt-label, .mrt-section, .mrt-val, .mrt-note {
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      color: rgba(0,0,0,.64);
      font-size: 12px;
    }
    .mrt-section { color: rgba(0,0,0,.82); font-weight: 700; letter-spacing: .02em; }
    .mrt-val { text-align: right; }
    .mrt-input {
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      font-size: 12px;
      padding: 8px 10px;
      border-radius: 10px;
      border: 1px solid rgba(0,0,0,.16);
      background: #fff;
      box-sizing: border-box;
    }
    .mrt-btn {
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      border: 1px solid rgba(0,0,0,.12);
      border-radius: 10px;
      background: #fff;
      padding: 9px 12px;
      cursor: pointer;
      font-weight: 700;
    }
    .mrt-btn-primary {
      background: rgba(0,184,148,.12);
      border-color: rgba(0,184,148,.28);
    }
    .mrt-btn-danger {
      background: rgba(225,112,85,.12);
      border-color: rgba(225,112,85,.28);
    }
    .mrt-slider { accent-color: #111; }
  `;
  document.head.appendChild(s);
}

function makeSliderRow(label, x, y, minV, maxV, start, step, formatVal) {
  const sp = createSpan(label);
  sp.addClass('mrt-label');
  sp.position(x, y + 4);

  const sl = createSlider(minV, maxV, start);
  sl.addClass('mrt-slider');
  if (sl && sl.elt) sl.elt.step = String(step);
  sl.position(x + 112, y);
  sl.style('width', layout.sliderW + 'px');

  const val = createSpan(formatVal(start));
  val.addClass('mrt-val');
  val.position(layout.valX, y + 4);
  val.style('width', layout.valW + 'px');

  const upd = () => val.html(formatVal(sl.value()));
  sl.input(upd);
  sl.changed(upd);
  return sl;
}

function setup() {
  injectStyles();
  const W = layout.W;
  layout.x0 = 24;
  layout.valW = 58;
  layout.valX = W - layout.x0 - layout.valW;
  layout.sliderW = layout.valX - (layout.x0 + 112) - 10;

  createCanvas(W, 840);
  textFont('system-ui, -apple-system, Segoe UI, sans-serif');

  let y = 176;
  const x0 = layout.x0;
  const lab = (t, yy, cls) => {
    const sp = createSpan(t);
    sp.addClass(cls || 'mrt-label');
    sp.position(x0, yy + 3);
    return sp;
  };

  lab('Server URL', y, 'mrt-label');
  ui.url = createInput(YOUR_NGROK_URL);
  ui.url.addClass('mrt-input');
  ui.url.position(x0, y + 22);
  ui.url.size(W - 48, 38);
  y += 82;

  const warm = createButton('Warm tunnel');
  warm.addClass('mrt-btn');
  warm.position(x0, y);
  warm.mousePressed(() => warmTunnel(getBase()));

  ui.startBtn = createButton('Start stream');
  ui.startBtn.addClass('mrt-btn');
  ui.startBtn.addClass('mrt-btn-primary');
  ui.startBtn.position(x0 + 116, y);
  ui.startBtn.mousePressed(() => toggleStream());
  y += 62;

  lab('Prompt corners', y, 'mrt-section');
  y += 28;
  for (let i = 0; i < STREAM_PROMPTS.length; i++) {
    const promptInput = createInput(STREAM_PROMPTS[i].text);
    promptInput.addClass('mrt-input');
    promptInput.attribute('aria-label', STREAM_PROMPTS[i].label + ' prompt');
    promptInput.position(x0, y);
    promptInput.size(W - 48, 34);
    ui.promptInputs.push(promptInput);
    y += 42;
  }

  layout.perfY0 = y + 8;
  y += 378;

  lab('Generation params', y, 'mrt-section');
  y += 28;
  ui.temp = makeSliderRow('temperature', x0, y, 0, 4, 0.85, 0.01, (v) => nf(v, 1, 2));
  y += 38;
  ui.topk = makeSliderRow('top-k', x0, y, 0, 1024, 64, 1, (v) => str(round(v)));
  y += 38;
  ui.guid = makeSliderRow('guidance', x0, y, 0, 10, 6.0, 0.01, (v) => nf(v, 1, 2));
  y += 38;
  ui.mean = makeSliderRow('mean', x0, y, 0, 2, 0.85, 0.01, (v) => nf(v, 1, 2));
  y += 38;
  ui.audioWeight = makeSliderRow('audio weight', x0, y, 0, 2, 0, 0.01, (v) => nf(v, 1, 2));
  y += 48;

  rebuildCentroidSliders(5);
  resizeCanvas(W, max(820, y + 120));
}

function draw() {
  background(RT_COL.bg[0], RT_COL.bg[1], RT_COL.bg[2]);
  hitRects = [];

  drawHeader();
  drawPerformanceSurface();
  drawStatusFooter();
  maintainWebSocketStream();
}

function drawHeader() {
  noStroke();
  fill(RT_COL.panel[0], RT_COL.panel[1], RT_COL.panel[2]);
  rect(12, 12, width - 24, 120, 12);
  stroke(RT_COL.stroke[0], RT_COL.stroke[1], RT_COL.stroke[2], RT_COL.stroke[3]);
  noFill();
  rect(12, 12, width - 24, 120, 12);
  noStroke();

  fill(RT_COL.text[0], RT_COL.text[1], RT_COL.text[2], RT_COL.text[3]);
  textStyle(BOLD);
  textSize(18);
  textAlign(LEFT, TOP);
  text('Magenta RT — Holly (realtime stream)', 24, 22);
  textStyle(NORMAL);
  textSize(11);
  fill(RT_COL.muted[0], RT_COL.muted[1], RT_COL.muted[2], RT_COL.muted[3]);
  text('Continuously requests model chunks so prompt and parameter changes are audible on the next generated chunk.', 24, 50, width - 48, 28);

  fill(RT_COL.warn[0], RT_COL.warn[1], RT_COL.warn[2], 230);
  textStyle(BOLD);
  text('Warning: this streams fast and can use ngrok bandwidth quickly.', 24, 86);
  textStyle(NORMAL);
}

function drawStatusFooter() {
  const barY = height - 58;
  noStroke();
  fill(RT_COL.panel[0], RT_COL.panel[1], RT_COL.panel[2]);
  rect(12, barY, width - 24, 46, 12);
  stroke(RT_COL.stroke[0], RT_COL.stroke[1], RT_COL.stroke[2], RT_COL.stroke[3]);
  noFill();
  rect(12, barY, width - 24, 46, 12);
  noStroke();

  fill(RT_COL.muted[0], RT_COL.muted[1], RT_COL.muted[2], RT_COL.muted[3]);
  textSize(10);
  textAlign(LEFT, TOP);
  const msg = statusLine + ' · chunks=' + chunksReceived + ' · buffer=' + nf(lastBufferLead, 1, 1) + 's · level=' + nf(lastChunkLevel, 1, 2);
  text(msg, 24, barY + 16, width - 48, 24);
}

function drawPerformanceSurface() {
  const perfY = layout.perfY0 || 420;
  layout.padRect = { x: 24, y: perfY, w: 250, h: 170 };
  layout.paramRect = { x: 24, y: perfY + 188, w: 250, h: 170 };
  layout.centroidRect = { x: 292, y: perfY, w: width - 316, h: 358 };
  drawXyPad();
  drawParamMacroPad();
  drawCentroidEq();
}

function drawXyPad() {
  const r = layout.padRect;
  noStroke();
  fill(RT_COL.panel[0], RT_COL.panel[1], RT_COL.panel[2]);
  rect(r.x, r.y, r.w, r.h, 12);
  stroke(RT_COL.stroke[0], RT_COL.stroke[1], RT_COL.stroke[2], RT_COL.stroke[3]);
  noFill();
  rect(r.x, r.y, r.w, r.h, 12);
  noStroke();

  fill(RT_COL.muted[0], RT_COL.muted[1], RT_COL.muted[2], RT_COL.muted[3]);
  textAlign(LEFT, TOP);
  textSize(10);
  text('PROMPT MIX PAD', r.x + 12, r.y + 10);

  const innerX = r.x + 18;
  const innerY = r.y + 42;
  const innerW = r.w - 36;
  const innerH = r.h - 62;
  stroke(0, 0, 0, 12);
  line(innerX + innerW / 2, innerY, innerX + innerW / 2, innerY + innerH);
  line(innerX, innerY + innerH / 2, innerX + innerW, innerY + innerH / 2);
  noStroke();

  textSize(8);
  fill(RT_COL.muted[0], RT_COL.muted[1], RT_COL.muted[2], 190);
  textAlign(LEFT, TOP);
  text('PROMPT 1', innerX, innerY - 14);
  textAlign(RIGHT, TOP);
  text('PROMPT 2', innerX + innerW, innerY - 14);
  textAlign(LEFT, BOTTOM);
  text('PROMPT 3', innerX, innerY + innerH + 14);
  textAlign(RIGHT, BOTTOM);
  text('PROMPT 4', innerX + innerW, innerY + innerH + 14);

  const cx = innerX + padX01 * innerW;
  const cy = innerY + padY01 * innerH;
  fill(RT_COL.accent[0], RT_COL.accent[1], RT_COL.accent[2], 38);
  ellipse(cx, cy, 34, 34);
  fill(RT_COL.accent[0], RT_COL.accent[1], RT_COL.accent[2], 255);
  ellipse(cx, cy, 11, 11);

  hitRects.push({ kind: 'xy', x: innerX, y: innerY, w: innerW, h: innerH });
}

function drawParamMacroPad() {
  const r = layout.paramRect;
  noStroke();
  fill(RT_COL.panel[0], RT_COL.panel[1], RT_COL.panel[2]);
  rect(r.x, r.y, r.w, r.h, 12);
  stroke(RT_COL.stroke[0], RT_COL.stroke[1], RT_COL.stroke[2], RT_COL.stroke[3]);
  noFill();
  rect(r.x, r.y, r.w, r.h, 12);
  noStroke();

  fill(RT_COL.muted[0], RT_COL.muted[1], RT_COL.muted[2], RT_COL.muted[3]);
  textAlign(LEFT, TOP);
  textSize(10);
  text('PARAM MACRO PAD', r.x + 12, r.y + 10);

  const innerX = r.x + 18;
  const innerY = r.y + 42;
  const innerW = r.w - 36;
  const innerH = r.h - 62;
  stroke(0, 0, 0, 12);
  line(innerX + innerW / 2, innerY, innerX + innerW / 2, innerY + innerH);
  line(innerX, innerY + innerH / 2, innerX + innerW, innerY + innerH / 2);
  noStroke();

  textSize(8);
  fill(RT_COL.muted[0], RT_COL.muted[1], RT_COL.muted[2], 190);
  textAlign(LEFT, TOP);
  text('tuned', innerX, innerY - 14);
  textAlign(RIGHT, TOP);
  text('chaotic', innerX + innerW, innerY - 14);
  textAlign(LEFT, BOTTOM);
  text('loose', innerX, innerY + innerH + 14);
  textAlign(RIGHT, BOTTOM);
  text('locked', innerX + innerW, innerY + innerH + 14);

  const cx = innerX + paramX01 * innerW;
  const cy = innerY + paramY01 * innerH;
  fill(RT_COL.warn[0], RT_COL.warn[1], RT_COL.warn[2], 36);
  ellipse(cx, cy, 34, 34);
  fill(RT_COL.warn[0], RT_COL.warn[1], RT_COL.warn[2], 255);
  ellipse(cx, cy, 11, 11);

  hitRects.push({ kind: 'paramMacro', x: innerX, y: innerY, w: innerW, h: innerH });
}

function drawCentroidEq() {
  const r = layout.centroidRect;
  noStroke();
  fill(RT_COL.panel[0], RT_COL.panel[1], RT_COL.panel[2]);
  rect(r.x, r.y, r.w, r.h, 12);
  stroke(RT_COL.stroke[0], RT_COL.stroke[1], RT_COL.stroke[2], RT_COL.stroke[3]);
  noFill();
  rect(r.x, r.y, r.w, r.h, 12);
  noStroke();

  fill(RT_COL.muted[0], RT_COL.muted[1], RT_COL.muted[2], RT_COL.muted[3]);
  textAlign(LEFT, TOP);
  textSize(10);
  text('CENTROID MIX (drag bars)', r.x + 12, r.y + 10);

  const chartX = r.x + 14;
  const chartY = r.y + 36;
  const chartW = r.w - 28;
  const chartH = r.h - 52;
  const n = centroidUiCount;
  const gap = 2;
  const bw = max(2, (chartW - gap * (n - 1)) / n);
  for (let i = 0; i < n; i++) {
    const v = clamp(centroidWeights[i] || 0, 0, 1);
    const x = chartX + i * (bw + gap);
    const h = max(2, v * chartH);
    fill(0, 0, 0, 18);
    rect(x, chartY, bw, chartH, 4);
    fill(RT_COL.accent[0], RT_COL.accent[1], RT_COL.accent[2], 220);
    rect(x, chartY + chartH - h, bw, h, 4);
    hitRects.push({ kind: 'centroid', idx: i, x, y: chartY, w: bw, h: chartH });
  }
}

function rebuildCentroidSliders(nServer) {
  const nShow = Math.min(nServer, 64);
  serverCentroidCount = nServer;
  centroidUiCount = nShow;
  centroidWeights = new Array(nShow).fill(0);
  activeCentroidIdx = -1;
}

function mousePressed(event) {
  if (isTextInputEvent(event)) return;
  const hit = findHit(mouseX, mouseY);
  if (!hit) return;
  if (hit.kind === 'xy') {
    padDragging = true;
    updateXyPad(hit);
  } else if (hit.kind === 'paramMacro') {
    paramDragging = true;
    updateParamMacro(hit);
  } else if (hit.kind === 'centroid') {
    activeCentroidIdx = hit.idx;
    updateCentroid(hit);
  }
}

function mouseDragged(event) {
  if (isTextInputEvent(event)) return;
  if (padDragging && layout.padRect) {
    const r = hitRects.find(h => h.kind === 'xy');
    if (r) updateXyPad(r);
  }
  if (paramDragging && layout.paramRect) {
    const r = hitRects.find(h => h.kind === 'paramMacro');
    if (r) updateParamMacro(r);
  }
  if (activeCentroidIdx >= 0) {
    const r = hitRects.find(h => h.kind === 'centroid' && h.idx === activeCentroidIdx);
    if (r) updateCentroid(r);
  }
}

function mouseReleased() {
  padDragging = false;
  paramDragging = false;
  activeCentroidIdx = -1;
}

function isTextInputEvent(event) {
  const target = event?.target;
  if (!target) return false;
  const els = [ui.url, ...ui.promptInputs].filter(Boolean).map(el => el.elt);
  return els.some(el => target === el || el.contains(target));
}

function findHit(mx, my) {
  for (let i = hitRects.length - 1; i >= 0; i--) {
    const r = hitRects[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
  }
  return null;
}

function updateXyPad(r) {
  padX01 = clamp((mouseX - r.x) / r.w, 0, 1);
  padY01 = clamp((mouseY - r.y) / r.h, 0, 1);
}

function updateParamMacro(r) {
  paramX01 = clamp((mouseX - r.x) / r.w, 0, 1);
  paramY01 = clamp((mouseY - r.y) / r.h, 0, 1);
  applyParamMacro();
}

function applyParamMacro() {
  const chaos = paramX01;
  const locked = 1 - paramY01;
  setSliderValue(ui.temp, 0.2 + chaos * (2.4 - 0.2));
  setSliderValue(ui.topk, round(16 + chaos * (256 - 16)));
  setSliderValue(ui.guid, 2.0 + locked * (9.0 - 2.0));
  setSliderValue(ui.mean, 0.4 + locked * (1.3 - 0.4));
}

function setSliderValue(slider, value) {
  if (!slider) return;
  slider.value(value);
  if (slider.elt) slider.elt.dispatchEvent(new Event('input', { bubbles: true }));
}

function updateCentroid(r) {
  centroidWeights[r.idx] = clamp(1 - (mouseY - r.y) / r.h, 0, 1);
}

async function warmTunnel(base) {
  statusLine = 'Warming tunnel...';
  try {
    const r = await fetch(base + '/ngrok-free-warm', {
      method: 'GET',
      headers: NGROK_HEADERS_GET,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await fetchCentroidCount(base);
    statusLine = 'Tunnel warm · centroids=' + serverCentroidCount + ' · ready.';
  } catch (err) {
    statusLine = 'Warm failed: ' + err;
  }
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

async function toggleStream() {
  if (isStreaming) {
    stopStream();
    return;
  }
  await startStream();
}

async function startStream() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    scheduledTime = ctx.currentTime + START_PREBUFFER_SEC;
    chunksReceived = 0;
    lastBufferLead = START_PREBUFFER_SEC;
    lastError = '';
    isStreaming = true;
    requestInFlight = false;
    statusLine = 'Connecting WebSocket stream...';
    ui.startBtn.html('Stop stream');
    ui.startBtn.removeClass('mrt-btn-primary');
    ui.startBtn.addClass('mrt-btn-danger');

    streamSocket = new WebSocket(getStreamUrl());
    streamSocket.binaryType = 'arraybuffer';
    streamSocket.onopen = () => {
      statusLine = 'Prebuffering WebSocket stream...';
      sendControlMessage(true);
    };
    streamSocket.onmessage = (evt) => handleStreamMessage(evt.data);
    streamSocket.onerror = () => {
      lastError = 'WebSocket error';
    };
    streamSocket.onclose = () => {
      if (isStreaming) {
        lastError = lastError || 'WebSocket closed';
        stopStream();
      }
    };
  } catch (err) {
    statusLine = 'Audio start failed: ' + err;
  }
}

function stopStream() {
  isStreaming = false;
  requestInFlight = false;
  sessionId = null;
  if (streamSocket) {
    try {
      if (streamSocket.readyState === WebSocket.OPEN) {
        streamSocket.send(JSON.stringify({ type: 'stop' }));
      }
      streamSocket.close();
    } catch (e) {}
  }
  streamSocket = null;
  stopActiveSources();
  statusLine = lastError ? 'Stopped after error: ' + lastError : 'Stopped.';
  if (ui.startBtn) {
    ui.startBtn.html('Start stream');
    ui.startBtn.removeClass('mrt-btn-danger');
    ui.startBtn.addClass('mrt-btn-primary');
  }
}

function maintainWebSocketStream() {
  if (!isStreaming) return;
  const ctx = getAudioContext();
  lastBufferLead = Math.max(0, scheduledTime - ctx.currentTime);
  sendControlMessage(false);
}

function sendControlMessage(force) {
  if (!streamSocket || streamSocket.readyState !== WebSocket.OPEN) return;
  const now = millis();
  if (!force && now - lastControlSend < CONTROL_SEND_INTERVAL_MS) return;
  lastControlSend = now;
  streamSocket.send(JSON.stringify({ type: 'params', params: buildChunkRequestBody() }));
}

function handleStreamMessage(data) {
  if (typeof data === 'string') {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'ready' && msg.centroid_count) {
        rebuildCentroidSliders(parseInt(msg.centroid_count, 10));
        statusLine = 'WebSocket ready · centroids=' + serverCentroidCount + ' · prebuffering...';
      } else if (msg.type === 'error') {
        lastError = msg.detail || 'backend stream error';
        stopStream();
      }
    } catch (e) {}
    return;
  }

  if (data instanceof Blob) {
    data.arrayBuffer().then(buf => {
      if (isStreaming) handlePcmChunk(buf);
    });
    return;
  }
  handlePcmChunk(data);
}

function handlePcmChunk(arrayBuffer) {
  if (!isStreaming || !(arrayBuffer instanceof ArrayBuffer)) return;
  schedulePcmChunk(arrayBuffer);
  chunksReceived++;
  statusLine = lastBufferLead > 1.0
    ? 'Streaming WebSocket... latest style: ' + buildStyleText().slice(0, 74)
    : 'Streaming WebSocket, buffer low... latest style: ' + buildStyleText().slice(0, 58);
}

function buildChunkRequestBody() {
  const body = {
    style_text: buildStyleText(),
    temperature: parseFloat(ui.temp.value()),
    topk: parseInt(ui.topk.value(), 10),
    guidance_weight: parseFloat(ui.guid.value()),
    mean_weight: parseFloat(ui.mean.value()),
    audio_prompt_weight: parseFloat(ui.audioWeight.value()),
    centroid_weights: buildCentroidWeightsBody(),
  };
  if (sessionId) body.session_id = sessionId;
  return body;
}

function buildStyleText() {
  const weights = [
    (1 - padX01) * (1 - padY01),
    padX01 * (1 - padY01),
    (1 - padX01) * padY01,
    padX01 * padY01,
  ];
  const parts = [];
  for (let i = 0; i < ui.promptInputs.length; i++) {
    const prompt = ui.promptInputs[i].value().trim();
    if (!prompt || weights[i] < 0.08) continue;
    parts.push(prompt + ' (' + Math.round(weights[i] * 100) + '%)');
  }
  return parts.join(', ') || 'Holly Herndon inspired experimental vocal electronics';
}

function buildCentroidWeightsBody() {
  const cw = [];
  for (let i = 0; i < serverCentroidCount; i++) {
    cw.push(i < centroidWeights.length ? parseFloat(centroidWeights[i] || 0) : 0);
  }
  return cw;
}

function parseMrtPcm(arrayBuffer) {
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

function schedulePcmChunk(arrayBuffer) {
  const ctx = getAudioContext();
  const { rate, frames, ch, f32 } = parseMrtPcm(arrayBuffer);
  const mono = new Float32Array(frames);
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += f32[i * ch + c];
    mono[i] = s / ch;
    peak = Math.max(peak, Math.abs(mono[i]));
  }
  lastChunkLevel = peak;

  const res = resampleLinear(mono, rate, ctx.sampleRate);
  const buf = ctx.createBuffer(1, res.length, ctx.sampleRate);
  const chd = buf.getChannelData(0);
  const targetGain = peak && peak > 1e-6 ? Math.min(1.0, 0.85 / peak) : smoothedChunkGain;
  smoothedChunkGain = smoothedChunkGain * 0.82 + targetGain * 0.18;
  for (let i = 0; i < res.length; i++) chd[i] = res[i] * smoothedChunkGain;
  applyEdgeFade(chd, ctx.sampleRate);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  src.connect(gain);
  gain.connect(ctx.destination);

  const hasPreviousChunk = activeSources.length > 0;
  const xfade = Math.min(CHUNK_CROSSFADE_SEC, buf.duration * 0.35);
  const startAt = hasPreviousChunk
    ? Math.max(ctx.currentTime + MIN_START_LEAD_SEC, scheduledTime - xfade)
    : Math.max(ctx.currentTime + MIN_START_LEAD_SEC, scheduledTime);
  const endAt = startAt + buf.duration;

  applyEqualPowerEnvelope(gain.gain, startAt, endAt, xfade, hasPreviousChunk);

  activeSources.push({ src, gain });
  src.onended = () => {
    try { gain.disconnect(); } catch (e) {}
    activeSources = activeSources.filter(item => item.src !== src);
  };
  src.start(startAt);
  scheduledTime = endAt;
  lastBufferLead = Math.max(0, scheduledTime - ctx.currentTime);
}

function applyEdgeFade(samples, sampleRate) {
  const n = Math.min(samples.length >> 1, Math.max(1, Math.floor(sampleRate * EDGE_FADE_SEC)));
  for (let i = 0; i < n; i++) {
    const fadeIn = i / n;
    const fadeOut = (n - i) / n;
    samples[i] *= fadeIn;
    samples[samples.length - 1 - i] *= fadeOut;
  }
}

function applyEqualPowerEnvelope(param, startAt, endAt, fadeSec, fadeIn) {
  const curveSize = 64;
  const fadeInCurve = new Float32Array(curveSize);
  const fadeOutCurve = new Float32Array(curveSize);
  for (let i = 0; i < curveSize; i++) {
    const t = i / (curveSize - 1);
    fadeInCurve[i] = Math.sin(t * Math.PI * 0.5);
    fadeOutCurve[i] = Math.cos(t * Math.PI * 0.5);
  }

  param.cancelScheduledValues(startAt);
  if (fadeIn) {
    param.setValueAtTime(0, startAt);
    param.setValueCurveAtTime(fadeInCurve, startAt, fadeSec);
  } else {
    param.setValueAtTime(1, startAt);
  }
  const fadeOutStart = Math.max(startAt, endAt - fadeSec);
  param.setValueAtTime(1, fadeOutStart);
  param.setValueCurveAtTime(fadeOutCurve, fadeOutStart, fadeSec);
}

function stopActiveSources() {
  for (const item of activeSources) {
    try { item.src.onended = null; } catch (e) {}
    try { item.src.stop(0); } catch (e) {}
    try { item.src.disconnect(); } catch (e) {}
    try { item.gain.disconnect(); } catch (e) {}
  }
  activeSources = [];
  if (audioCtx) scheduledTime = audioCtx.currentTime;
}

function resampleLinear(input, inRate, outRate) {
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
