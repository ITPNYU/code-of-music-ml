/**
 * Magenta RT Holly — p5.js (local `sketch/` or Web Editor paste)
 *
 * With the shared gateway, set YOUR_NGROK_URL to the tunnel root (no path);
 * requests go to /magentart/... . Set useSharedGateway false if the URL is the API host only.
 *
 * Backend: GET /ngrok-free-warm, GET /, POST /api/next-chunk, etc.
 */

const YOUR_NGROK_URL = 'YOUR_NGROK_URL';
let useSharedGateway = true;

function magentartApiBase(hostRoot) {
  let u = hostRoot.trim();
  if (u.endsWith('/')) u = u.slice(0, -1);
  return useSharedGateway ? `${u}/magentart` : u;
}

const NGROK_HEADERS = {
  'ngrok-skip-browser-warning': 'true',
  'bypass-tunnel-reminder': 'true',
  'Content-Type': 'application/json',
};

const NGROK_HEADERS_GET = {
  'ngrok-skip-browser-warning': 'true',
  'bypass-tunnel-reminder': 'true',
};

// Flat UI palette (inspired by musicgen sketch aesthetics)
const COL = {
  bg: [246, 246, 247],
  panel: [255, 255, 255],
  stroke: [0, 0, 0, 20],
  strokeSoft: [0, 0, 0, 12],
  text: [0, 0, 0, 210],
  muted: [0, 0, 0, 140],
  accent: [0, 184, 148, 255],
  warn: [225, 112, 85, 255],
};

const MAX_CENTROID_SLIDERS = 64;
const INITIAL_LOOKAHEAD_SEC = 0.22;
const SCHEDULE_MIN_LEAD_SEC = 0.004;
const FADE_IN_SAMPLES = 80;

let lastChunkDurSec = 1;
let sessionId = null;
let audioCtx;
let nextPlayTime = 0;
let statusLine = 'Set URL → Warm tunnel loads centroid sliders from GET /.';
let autoPumpActive = false;
let chunkEpoch = 0;
let inFlightFetches = new Set();
let activeSources = new Set();
let vuLevel = 0;
let tAnim = 0;
let wetOut = null;
let rawOut = null;
let monitorMixSlider = null; // 0 = raw, 100 = wet
let mixCtx = null;
let serverCentroidCount = 32;
let centroidWeights = [];
let centroidUiCount = 32;
let activeCentroidIdx = -1;
let lastCentroidPaint = null; // { idx, v }

// XY macro pad
let padX01 = 0.35;
let padY01 = 0.35;
let padDragging = false;

// On-canvas chord keyboard
const KEYBOARD_LOW_MIDI = 48; // C3
const MAX_HELD = 3;
let heldKeys = new Map(); // midi -> { osc, gain }
let keyboardDraggedNote = null;
let micActive = false;
let micStatus = '';
let micPromptWeightSlider = null;
let tonePromptWeightSlider = null;
let micStream = null;
let micAudioCtx = null;
let micSource = null;
let micProc = null;
let micRing = null;
let micRingWrite = 0;
let micSendTimer = null;
let micLastSendMs = 0;

let toneActive = false;
let toneStatus = '';
let toneSynth = null;
let toneTapProc = null;
let toneTapZ = null;
let toneTapGain = null;
let toneRing = null;
let toneRingWrite = 0;
let toneSendTimer = null;
let toneLastSendMs = 0;
let toneStepIdx = 0;
let toneLastMidi = 60;
let toneCtx = null;
let toneSeqTimer = null;
let toneNextTime = 0;
let toneOsc = null;
let toneOscGain = null;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function ensureOutputMix(ctx) {
  if (mixCtx && mixCtx !== ctx) {
    try { wetOut && wetOut.disconnect(); } catch (e) {}
    try { rawOut && rawOut.disconnect(); } catch (e) {}
    wetOut = null;
    rawOut = null;
  }
  mixCtx = ctx;
  if (wetOut && rawOut) return;
  wetOut = ctx.createGain();
  rawOut = ctx.createGain();
  wetOut.gain.value = 1.0;
  rawOut.gain.value = 0.0;
  wetOut.connect(ctx.destination);
  rawOut.connect(ctx.destination);
}

function updateMonitorMix() {
  if (!monitorMixSlider || !wetOut || !rawOut) return;
  const mix = clamp(parseFloat(monitorMixSlider.value()) / 100, 0, 1);
  const wet = Math.sin(mix * Math.PI * 0.5);
  const raw = Math.cos(mix * Math.PI * 0.5);
  wetOut.gain.value = wet;
  rawOut.gain.value = raw;
}
let snippetRecActive = false;
let snippetRecMs = 0;
let snippetStream = null;
let snippetAudioCtx = null;
let snippetSource = null;
let snippetProc = null;
let snippetBuf = null;
let snippetBufWrite = 0;
let snippetRaw = null;
let snippetRawRate = 0;
let snippetUi = {
  section: null,
  status: null,
  recBtn: null,
  playBtn: null,
  sendBtn: null,
};
let layout = {
  W: 720,
  x0: 24,
  sliderW: 420,
  valW: 56,
  valX: 0,
  centroidRowH: 34,
  promptRowH: 44,
  numPromptRows: 4,
  footerPad: 100,
  promptLabs: [],
  promptWeights: [],
  promptTexts: [],
  promptSectionLab: null,
  // Canvas UI blocks
  perfY0: 0,
  padRect: null,
  centroidRect: null,
  keyboardRect: null,
};

function injectMrtStyles() {
  if (document.getElementById('mrt-sketch-styles')) return;
  const s = document.createElement('style');
  s.id = 'mrt-sketch-styles';
  s.textContent = `
    .mrt-input {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 13px;
      border-radius: 8px;
      border: 1px solid rgba(0,0,0,.12);
      background: #ffffff;
      color: rgba(0,0,0,.85);
      box-sizing: border-box;
    }
    .mrt-input:focus {
      outline: none;
      border-color: rgba(0,0,0,.25);
      box-shadow: 0 0 0 3px rgba(0,0,0,.06);
    }
    .mrt-btn {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      border-radius: 8px;
      padding: 9px 14px;
      cursor: pointer;
      border: 1px solid rgba(0,0,0,.12);
      color: rgba(0,0,0,.85);
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,.08);
      transition: background .12s ease, border-color .12s ease, box-shadow .12s ease;
    }
    .mrt-btn:hover {
      background: rgba(0,0,0,.03);
      border-color: rgba(0,0,0,.18);
    }
    .mrt-btn:active { background: rgba(0,0,0,.05); }
    .mrt-btn-ghost {
      background: rgba(0,0,0,.02);
      color: rgba(0,0,0,.72);
    }
    .mrt-label {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(0,0,0,.55);
    }
    .mrt-section {
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: rgba(0,0,0,.65);
    }
    .mrt-val {
      font-family: ui-mono, monospace;
      font-size: 12px;
      color: rgba(0,0,0,.65);
      width: 56px;
      display: inline-block;
      text-align: right;
    }
    input[type=range].mrt-slider {
      -webkit-appearance: none;
      appearance: none;
      height: 8px;
      border-radius: 999px;
      background: rgba(0,0,0,.10);
      border: 1px solid rgba(0,0,0,.10);
    }
    input[type=range].mrt-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,.22);
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,.16);
    }
    input[type=range].mrt-slider::-moz-range-thumb {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #ffffff;
      border: 1px solid rgba(0,0,0,.22);
      cursor: pointer;
    }
  `;
  document.head.appendChild(s);
}

function setStep(sl, step) {
  if (sl && sl.elt) sl.elt.step = String(step);
}

function makeSliderRow(label, x, y, minV, maxV, start, step, formatVal) {
  const sp = createSpan(label);
  sp.addClass('mrt-label');
  sp.position(x, y + 4);
  const sl = createSlider(minV, maxV, start);
  sl.addClass('mrt-slider');
  setStep(sl, step);
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

function resizeCanvasToLayout() {
  const domLastY =
    layout.promptY0 +
    layout.promptRowH * layout.numPromptRows +
    layout.footerPad;
  const perfLastY = (layout.perfY0 || 0) + 176 + 92 + 80;
  const lastY = Math.max(domLastY, perfLastY);
  const H = constrain(lastY, 760, 2600);
  resizeCanvas(layout.W, H);
}

function rebuildCentroidSliders(nServer) {
  // Kept name for compatibility with existing warm/sync code paths.
  const nShow = min(nServer, MAX_CENTROID_SLIDERS);
  serverCentroidCount = nServer;
  centroidUiCount = nShow;
  centroidWeights = new Array(nShow).fill(0);
  activeCentroidIdx = -1;
}

function repositionPromptRows() {
  const x0 = layout.x0;
  const W = layout.W;
  if (layout.promptSectionLab) {
    layout.promptSectionLab.position(x0, layout.promptY0 - 26);
  }
  for (let i = 0; i < layout.numPromptRows; i++) {
    const y = layout.promptY0 + i * layout.promptRowH;
    layout.promptLabs[i].position(x0, y + 2);
    layout.promptWeights[i].position(x0 + 72, y);
    layout.promptWeights[i].style('width', '100px');
    layout.promptTexts[i].position(x0 + 188, y - 2);
    layout.promptTexts[i].size(W - 48 - 188, 32);
  }
}

function setup() {
  injectMrtStyles();
  const W = layout.W;
  layout.x0 = 24;
  layout.valW = 56;
  layout.valX = W - layout.x0 - layout.valW;
  layout.sliderW = layout.valX - (layout.x0 + 108) - 10;
  const c = createCanvas(W, 720);
  if (c.elt) {
    c.elt.id = 'mrt_p5_canvas';
    if (c.elt.parentElement) {
      c.elt.parentElement.id = 'mrt-magenta-client';
    }
  }

  textFont('system-ui, -apple-system, Segoe UI, sans-serif');

  let y = 100;
  const x0 = layout.x0;

  const lab = (t, x, yy, cls) => {
    const sp = createSpan(t);
    sp.addClass(cls || 'mrt-label');
    sp.position(x, yy + 3);
    return sp;
  };

  lab('Server URL', x0, y, 'mrt-label');
  const urlInput = createInput(YOUR_NGROK_URL);
  urlInput.addClass('mrt-input');
  urlInput.position(x0, y + 22);
  urlInput.size(W - 48, 38);
  urlInput.id('magenta_base_url');

  y += 88;
  const btn = (label, x, yy, cls, fn) => {
    const b = createButton(label);
    b.addClass('mrt-btn');
    if (cls) b.addClass(cls);
    b.position(x, yy);
    b.mousePressed(fn);
    return b;
  };

  let bx = x0;
  btn('Warm tunnel', bx, y, 'mrt-btn-ghost', () => {
    const b = getBase();
    warmTunnel(b)
      .then(() => fetchCentroidCount(b))
      .then(() => {
        statusLine = 'Tunnel warm · centroids=' + serverCentroidCount + ' (UI shows up to ' + MAX_CENTROID_SLIDERS + ').';
      })
      .catch((e) => {
        statusLine = 'Warm / sync failed: ' + e;
      });
  });
  bx += 118;
  btn('Next chunk', bx, y, null, () => {
    getAudioContext().resume();
    requestChunk(getBase()).catch((e) => {
      statusLine = 'Chunk failed: ' + e;
    });
  });
  bx += 118;
  btn('Auto chain', bx, y, null, () => {
    getAudioContext().resume();
    if (autoPumpActive) return;
    autoPumpActive = true;
    statusLine = 'Auto: requesting chunks back-to-back (best gapless).';
    const base = getBase();
    function pumpStep() {
      if (!autoPumpActive) return;
      requestChunk(base)
        .then(() => {
          if (autoPumpActive) setTimeout(pumpStep, 0);
        })
        .catch((e) => {
          statusLine = 'Auto: ' + e;
          if (autoPumpActive) setTimeout(pumpStep, 450);
        });
    }
    pumpStep();
  });
  bx += 118;
  btn('Stop', bx, y, 'mrt-btn-ghost', () => {
    autoPumpActive = false;
    chunkEpoch++;
    for (const c of Array.from(inFlightFetches)) {
      try { c.abort(); } catch (e) {}
    }
    inFlightFetches.clear();
    for (const s of Array.from(activeSources)) {
      try { s.onended = null; s.stop(0); } catch (e) {}
      try { s.disconnect(); } catch (e) {}
    }
    activeSources.clear();
    nextPlayTime = 0;
    vuLevel = 0;
    statusLine = 'Stopped · clearing playback and resetting server…';
    resetState(getBase())
      .then(() => { statusLine = 'Stopped · server state reset.'; })
      .catch((e) => { statusLine = 'Stopped · server reset failed: ' + e; });
  });
  bx += 88;
  btn('Reset', bx, y, 'mrt-btn-ghost', () => {
    resetState(getBase()).then(() => {
      nextPlayTime = 0;
      statusLine = 'Model state reset · playback schedule cleared.';
    }).catch((e) => {
      statusLine = 'Reset failed: ' + e;
    });
  });
  bx += 108;
  btn('Mic prompt', bx, y, 'mrt-btn-ghost', () => {
    getAudioContext().resume();
    if (micActive) {
      stopMicPrompt();
      statusLine = 'Mic prompt off';
    } else {
      startMicPrompt(getBase()).then(() => {
        statusLine = 'Mic prompt on (streaming audio prompt)';
      }).catch((e) => {
        statusLine = 'Mic prompt failed: ' + e;
      });
    }
  });
  bx += 116;
  btn('Tone guide', bx, y, 'mrt-btn-ghost', () => {
    getAudioContext().resume();
    if (toneActive) {
      stopToneGuide();
      statusLine = 'Tone guide off';
    } else {
      startToneGuide(getBase()).then(() => {
        statusLine = 'Tone guide on (sequenced audio prompt)';
      }).catch((e) => {
        statusLine = 'Tone guide failed: ' + e;
      });
    }
  });

  y += 56;

  // Reserve canvas performance surface (XY pad + centroid EQ + keyboard) right after buttons.
  layout.perfY0 = y;
  const perfH = 160 + 16 + 92;
  y += perfH + 28;

  lab('Sampling options', x0, y, 'mrt-section');
  y += 28;
  // Defaults biased toward timbre transfer (audio prompt drives outcome).
  window.magentaTemp = makeSliderRow('temperature', x0, y, 0, 4, 0.65, 0.01, (v) => nf(v, 1, 2));
  y += 40;
  window.magentaTopk = makeSliderRow('top-k', x0, y, 0, 1024, 64, 1, (v) => str(round(v)));
  setStep(window.magentaTopk, 1);
  y += 40;
  window.magentaGuid = makeSliderRow('guidance', x0, y, 0, 10, 7.25, 0.01, (v) => nf(v, 1, 2));

  y += 48;
  lab('In-distribution steering', x0, y, 'mrt-section');
  y += 28;
  window.magentaMean = makeSliderRow('mean', x0, y, 0, 2, 0.85, 0.01, (v) => nf(v, 1, 2));

  y += 40;
  micPromptWeightSlider = makeSliderRow('mic weight', x0, y, 0, 2, 1.25, 0.01, (v) => nf(v, 1, 2));
  y += 40;
  tonePromptWeightSlider = makeSliderRow('tone weight', x0, y, 0, 2, 0.45, 0.01, (v) => nf(v, 1, 2));
  y += 40;
  monitorMixSlider = makeSliderRow('monitor wet %', x0, y, 0, 100, 100, 1, (v) => str(round(v)));
  setStep(monitorMixSlider, 1);
  monitorMixSlider.input(updateMonitorMix);

  y += 44;
  const snippetLab = createSpan('Recorded snippet (10s)');
  snippetLab.addClass('mrt-section');
  snippetLab.position(x0, y);
  snippetUi.section = snippetLab;

  y += 20;
  let sx = x0;
  snippetUi.recBtn = createButton('Record 10s');
  snippetUi.recBtn.addClass('mrt-btn');
  snippetUi.recBtn.addClass('mrt-btn-ghost');
  snippetUi.recBtn.position(sx, y);
  snippetUi.recBtn.mousePressed(() => {
    getAudioContext().resume();
    if (snippetRecActive) return;
    startSnippetRecord().catch((e) => {
      statusLine = 'Snippet record failed: ' + e;
    });
  });
  sx += 130;
  snippetUi.playBtn = createButton('Play raw');
  snippetUi.playBtn.addClass('mrt-btn');
  snippetUi.playBtn.addClass('mrt-btn-ghost');
  snippetUi.playBtn.position(sx, y);
  snippetUi.playBtn.mousePressed(() => {
    getAudioContext().resume();
    playSnippetRaw().catch((e) => {
      statusLine = 'Play failed: ' + e;
    });
  });
  sx += 110;
  snippetUi.sendBtn = createButton('Send → chunk');
  snippetUi.sendBtn.addClass('mrt-btn');
  snippetUi.sendBtn.position(sx, y);
  snippetUi.sendBtn.mousePressed(() => {
    getAudioContext().resume();
    sendSnippetForChunk(getBase()).catch((e) => {
      statusLine = 'Snippet send failed: ' + e;
    });
  });
  sx += 140;
  snippetUi.status = createSpan('idle');
  snippetUi.status.addClass('mrt-label');
  snippetUi.status.position(sx, y + 10);

  y += 52;
  // DOM text prompts (kept minimal — audio prompt is the primary driver)
  layout.promptY0 = y + 26;
  const defaultPrompts = ['', '', '', ''];
  const defaultWeights = [0, 0, 0, 0];
  layout.promptLabs.length = 0;
  layout.promptWeights.length = 0;
  layout.promptTexts.length = 0;
  for (let i = 0; i < layout.numPromptRows; i++) {
    const pr = createSpan('Prompt ' + (i + 1));
    pr.addClass('mrt-label');
    layout.promptLabs.push(pr);
    const wsl = createSlider(0, 2, defaultWeights[i]);
    wsl.addClass('mrt-slider');
    setStep(wsl, 0.01);
    layout.promptWeights.push(wsl);
    const inp = createInput(defaultPrompts[i]);
    inp.addClass('mrt-input');
    layout.promptTexts.push(inp);
  }
  layout.promptSectionLab = createSpan('Prompts');
  layout.promptSectionLab.addClass('mrt-section');
  repositionPromptRows();

  rebuildCentroidSliders(32);
  applyMacroToSliders();
  resizeCanvasToLayout();
}

function draw() {
  tAnim += 0.02;
  vuLevel *= 0.88;

  background(COL.bg[0], COL.bg[1], COL.bg[2]);

  // Performance surface rects (position reserved by setup()).
  const perfY = layout.perfY0 || 240;
  layout.padRect = { x: 24, y: perfY, w: 240, h: 160 };
  layout.centroidRect = { x: 280, y: perfY, w: width - 304, h: 160 };
  layout.keyboardRect = { x: 24, y: perfY + 176, w: width - 48, h: 92 };

  // Simple header card
  noStroke();
  fill(COL.panel[0], COL.panel[1], COL.panel[2]);
  rect(12, 12, width - 24, 72, 12);
  stroke(COL.stroke[0], COL.stroke[1], COL.stroke[2], COL.stroke[3]);
  strokeWeight(1);
  noFill();
  rect(12, 12, width - 24, 72, 12);

  noStroke();
  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(18);
  fill(COL.text[0], COL.text[1], COL.text[2], COL.text[3]);
  text('Magenta RT', 24, 22);
  textStyle(NORMAL);
  textSize(10);
  fill(COL.muted[0], COL.muted[1], COL.muted[2], COL.muted[3]);
  text('chunked generation · centroids · mic/snippet prompt', 24, 46);

  // Footer status + simple VU bar
  const barY = height - 54;
  noStroke();
  fill(COL.panel[0], COL.panel[1], COL.panel[2]);
  rect(12, barY, width - 24, 42, 12);
  stroke(COL.stroke[0], COL.stroke[1], COL.stroke[2], COL.stroke[3]);
  noFill();
  rect(12, barY, width - 24, 42, 12);

  const innerW = width - 48;
  const vuW = innerW * constrain(vuLevel * 1.2, 0, 1);
  noStroke();
  fill(COL.accent[0], COL.accent[1], COL.accent[2], 90);
  rect(24, barY + 10, vuW, 4, 999);

  fill(COL.muted[0], COL.muted[1], COL.muted[2], COL.muted[3]);
  textSize(10);
  textAlign(LEFT, TOP);
  text(statusLine, 24, barY + 18, width - 48, 20);

  drawCentroidEq();
  drawXyPad();
  drawKeyboard();
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
  textAlign(LEFT, TOP); textSize(10);
  text('MACRO PAD (drag)', r.x + 12, r.y + 10);

  textSize(9);
  fill(COL.muted[0], COL.muted[1], COL.muted[2], 200);
  textAlign(LEFT, TOP);    text('tuned',   r.x + 12, r.y + 28);
  textAlign(RIGHT, TOP);   text('chaotic', r.x + r.w - 12, r.y + 28);
  textAlign(LEFT, BOTTOM); text('loose',   r.x + 12, r.y + r.h - 10);
  textAlign(RIGHT, BOTTOM);text('locked',  r.x + r.w - 12, r.y + r.h - 10);

  const innerX = r.x + 18, innerY = r.y + 44;
  const innerW = r.w - 36, innerH = r.h - 62;
  stroke(COL.strokeSoft[0], COL.strokeSoft[1], COL.strokeSoft[2], COL.strokeSoft[3]);
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
  const innerX = r.x + 18, innerY = r.y + 44;
  const innerW = r.w - 36, innerH = r.h - 62;
  padX01 = clamp((mx - innerX) / innerW, 0, 1);
  padY01 = clamp((my - innerY) / innerH, 0, 1);
  applyMacroToSliders();
}

function applyMacroToSliders() {
  // X: tuned(0) → chaotic(1) : temperature 0.2 → 2.0, top-k 16 → 256
  // Y: loose(0) → locked(1)  : guidance 2.0 → 9.0, mean 0.4 → 1.3
  const temp = 0.2 + padX01 * (2.0 - 0.2);
  const topk = Math.round(16 + padX01 * (256 - 16));
  const guid = 2.0 + padY01 * (9.0 - 2.0);
  const mean = 0.4 + padY01 * (1.3 - 0.4);
  if (window.magentaTemp) window.magentaTemp.value(temp);
  if (window.magentaTopk) window.magentaTopk.value(topk);
  if (window.magentaGuid) window.magentaGuid.value(guid);
  if (window.magentaMean) window.magentaMean.value(mean);
  [window.magentaTemp, window.magentaTopk, window.magentaGuid, window.magentaMean].forEach((sl) => {
    if (sl && sl.elt) sl.elt.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ─ Chord keyboard ──────────────────────────────────────────────────
function keyboardKeyRects() {
  const r = layout.keyboardRect;
  if (!r) return [];
  const whitePattern = [0, 2, 4, 5, 7, 9, 11];
  const whiteMidi = [];
  for (let oct = 0; oct < 2; oct++) {
    for (let i = 0; i < 7; i++) whiteMidi.push(KEYBOARD_LOW_MIDI + oct * 12 + whitePattern[i]);
  }
  const wKeyW = r.w / whiteMidi.length;
  const wKeyH = r.h;
  const bKeyW = wKeyW * 0.6;
  const bKeyH = wKeyH * 0.62;
  const whiteRects = whiteMidi.map((m, i) => ({ midi: m, x: r.x + i * wKeyW, y: r.y, w: wKeyW, h: wKeyH, black: false }));
  const blackRects = [];
  // black keys sit between whites at inOct ∈ {0(C),1(D),3(F),4(G),5(A)}
  const blackAfter = new Set([0, 1, 3, 4, 5]);
  for (let i = 0; i < whiteMidi.length - 1; i++) {
    const inOct = i % 7;
    if (!blackAfter.has(inOct)) continue;
    const midi = whiteMidi[i] + 1;
    const x = r.x + (i + 1) * wKeyW - bKeyW / 2;
    blackRects.push({ midi, x, y: r.y, w: bKeyW, h: bKeyH, black: true });
  }
  return [...whiteRects, ...blackRects];
}

function drawKeyboard() {
  const r = layout.keyboardRect;
  if (!r) return;
  noStroke();
  fill(COL.panel[0], COL.panel[1], COL.panel[2]);
  rect(r.x, r.y, r.w, r.h, 12);

  const keys = keyboardKeyRects();
  for (const k of keys) {
    if (k.black) continue;
    const held = heldKeys.has(k.midi);
    stroke(COL.stroke[0], COL.stroke[1], COL.stroke[2], COL.stroke[3]);
    strokeWeight(1);
    fill(held ? 220 : 252, held ? 240 : 252, held ? 230 : 252);
    rect(k.x + 1, k.y + 1, k.w - 2, k.h - 12, 6);
  }
  for (const k of keys) {
    if (!k.black) continue;
    const held = heldKeys.has(k.midi);
    noStroke();
    fill(held ? 80 : 30);
    rect(k.x, k.y, k.w, k.h, 4);
  }

  noStroke();
  fill(COL.muted[0], COL.muted[1], COL.muted[2], 200);
  textAlign(LEFT, BOTTOM); textSize(9);
  text('KEYBOARD — click keys (hold up to ' + MAX_HELD + ')', r.x + 12, r.y + r.h - 2);
}

function keyAt(mx, my) {
  const keys = keyboardKeyRects();
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    if (mx >= k.x && mx <= k.x + k.w && my >= k.y && my <= k.y + k.h) return k;
  }
  return null;
}

function ensureGuideTapGraph() {
  const ctx = getAudioContext();
  ensureOutputMix(ctx);
  updateMonitorMix();
  if (toneTapGain) return;
  toneTapGain = ctx.createGain();
  toneTapGain.gain.value = 1.0;
  toneTapGain.connect(rawOut);

  toneRing = new Float32Array(16000);
  toneRingWrite = 0;
  const bufSize = 4096;
  toneTapProc = ctx.createScriptProcessor(bufSize, 1, 1);
  toneTapProc.onaudioprocess = (ev) => {
    if (!toneRing) return;
    const inBuf = ev.inputBuffer.getChannelData(0);
    const res = resampleTo16kMono(inBuf, ctx.sampleRate);
    toneRingWrite = ringWrite(toneRing, toneRingWrite, res);
  };
  toneTapGain.connect(toneTapProc);
  toneTapZ = ctx.createGain();
  toneTapZ.gain.value = 0;
  toneTapProc.connect(toneTapZ);
  toneTapZ.connect(ctx.destination);

  if (!toneSendTimer) {
    toneLastSendMs = 0;
    toneSendTimer = setInterval(() => {
      if (!toneRing) return;
      const nowMs = performance.now();
      if (nowMs - toneLastSendMs < 240) return;
      toneLastSendMs = nowMs;
      const w = tonePromptWeightSlider ? parseFloat(tonePromptWeightSlider.value()) : 0.0;
      if (!w || w <= 0.0001) return;
      const clip = ringReadLatest(toneRing, toneRingWrite);
      sendAudioPromptWeighted(getBase(), clip, w).catch(() => {});
    }, 140);
  }
}

function startHeldNote(midi) {
  if (heldKeys.has(midi)) return;
  if (heldKeys.size >= MAX_HELD) {
    const firstKey = heldKeys.keys().next().value;
    stopHeldNote(firstKey);
  }
  ensureGuideTapGraph();
  const ctx = getAudioContext();
  const hz = 440 * Math.pow(2, (midi - 69) / 12);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(hz, ctx.currentTime);
  const g = ctx.createGain();
  const now = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
  osc.connect(g);
  g.connect(toneTapGain);
  osc.start();
  heldKeys.set(midi, { osc, gain: g });
}

function stopHeldNote(midi) {
  const v = heldKeys.get(midi);
  if (!v) return;
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  try {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    v.osc.stop(now + 0.2);
  } catch (e) {}
  heldKeys.delete(midi);
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

  // Baseline
  stroke(COL.strokeSoft[0], COL.strokeSoft[1], COL.strokeSoft[2], COL.strokeSoft[3]);
  line(r.x + padX, r.y + padY + ih, r.x + padX + iw, r.y + padY + ih);
  noStroke();

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
  const n = Math.max(1, centroidUiCount || centroidWeights.length || 1);
  void n;
  const padY = 30;
  const ih = r.h - padY - 12;
  const by = r.y + padY;
  const t = clamp(1 - (my - by) / ih, 0, 1);
  return 2 * t;
}

function setCentroidFromMouse(idx, my) {
  centroidWeights[idx] = centroidValueAtY(my);
}

function mousePressed() {
  if (xyPadHit(mouseX, mouseY)) {
    padDragging = true;
    setXyFromMouse(mouseX, mouseY);
    return;
  }
  const k = keyAt(mouseX, mouseY);
  if (k) {
    keyboardDraggedNote = k.midi;
    if (heldKeys.has(k.midi)) stopHeldNote(k.midi);
    else startHeldNote(k.midi);
    return;
  }
  const idx = centroidIdxAt(mouseX, mouseY);
  if (idx >= 0) {
    activeCentroidIdx = idx;
    const v = centroidValueAtY(mouseY);
    centroidWeights[idx] = v;
    lastCentroidPaint = { idx, v };
    return;
  }
}

function mouseDragged() {
  if (padDragging) {
    setXyFromMouse(mouseX, mouseY);
    return;
  }
  if (activeCentroidIdx >= 0) {
    const idx = centroidIdxAt(mouseX, mouseY);
    if (idx < 0) return;
    const v = centroidValueAtY(mouseY);

    // Paint a linear shape across all centroid bands between last and current.
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
}

function mouseReleased() {
  activeCentroidIdx = -1;
  lastCentroidPaint = null;
  padDragging = false;
  keyboardDraggedNote = null;
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
  if (!isNaN(n) && n > 0) {
    rebuildCentroidSliders(n);
  }
}

function buildStyleTextFromPrompts() {
  const parts = [];
  for (let i = 0; i < layout.numPromptRows; i++) {
    const t = layout.promptTexts[i].value().trim();
    const w = parseFloat(layout.promptWeights[i].value());
    if (t && w > 0.001) {
      parts.push({ w, t });
    }
  }
  parts.sort((a, b) => b.w - a.w);
  if (!parts.length) return 'a tree falls in the forest';
  return parts.map((p) => p.t).join(' · ');
}

function buildParamsBody() {
  const cw = [];
  for (let i = 0; i < serverCentroidCount; i++) {
    if (i < centroidWeights.length) {
      cw.push(parseFloat(centroidWeights[i] || 0));
    } else {
      cw.push(0);
    }
  }
  const body = {
    style_text: buildStyleTextFromPrompts(),
    temperature: parseFloat(window.magentaTemp.value()),
    topk: parseInt(window.magentaTopk.value(), 10),
    guidance_weight: parseFloat(window.magentaGuid.value()),
    mean_weight: parseFloat(window.magentaMean.value()),
    audio_prompt_weight: micPromptWeightSlider ? parseFloat(micPromptWeightSlider.value()) : 0.0,
    centroid_weights: cw,
  };
  if (sessionId) body.session_id = sessionId;
  return body;
}

async function requestChunk(base) {
  const myEpoch = chunkEpoch;
  const ctrl = new AbortController();
  inFlightFetches.add(ctrl);
  try {
    const r = await fetch(base + '/api/next-chunk', {
      method: 'POST',
      headers: NGROK_HEADERS,
      body: JSON.stringify(buildParamsBody()),
      mode: 'cors',
      credentials: 'omit',
      signal: ctrl.signal,
    });
    if (myEpoch !== chunkEpoch) return; // stopped while in-flight
    const sid = r.headers.get('X-Magenta-Session');
    if (sid) sessionId = sid;
    if (!r.ok) {
      const t = await r.text();
      throw new Error('HTTP ' + r.status + ' ' + t);
    }
    const buf = await r.arrayBuffer();
    if (myEpoch !== chunkEpoch) return; // ignore late payload
    schedulePcm(buf);
  } finally {
    inFlightFetches.delete(ctrl);
  }
}

async function resetState(base) {
  if (!sessionId) return;
  const r = await fetch(base + '/api/reset', {
    method: 'POST',
    headers: NGROK_HEADERS,
    body: JSON.stringify({ session_id: sessionId }),
    mode: 'cors',
    credentials: 'omit',
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}

function schedulePcm(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  if (u8.length < 16) return;
  if (u8[0] !== 0x4d || u8[1] !== 0x52 || u8[2] !== 0x54 || u8[3] !== 0x01) {
    statusLine = 'Bad PCM magic';
    return;
  }
  const dv = new DataView(arrayBuffer);
  const rate = dv.getUint32(4, true);
  const frames = dv.getUint32(8, true);
  const ch = dv.getUint16(12, true);
  const f32 = new Float32Array(arrayBuffer, 16, frames * ch);

  let peak = 0;
  const step = max(1, floor(f32.length / 8000));
  for (let i = 0; i < f32.length; i += step) {
    const a = abs(f32[i]);
    if (a > peak) peak = a;
  }
  vuLevel = max(vuLevel, peak);

  if (!audioCtx) {
    audioCtx = getAudioContext();
  }
  const ctx = audioCtx;
  ensureOutputMix(ctx);
  updateMonitorMix();
  const buf = ctx.createBuffer(ch, frames, rate);
  const fadeN = min(FADE_IN_SAMPLES, frames);
  for (let c = 0; c < ch; c++) {
    const chd = buf.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      let s = f32[i * ch + c];
      if (i < fadeN) {
        s *= (i + 1) / (fadeN + 1);
      }
      chd[i] = s;
    }
  }
  const dur = frames / rate;
  lastChunkDurSec = dur;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(wetOut);
  const now = ctx.currentTime;
  if (nextPlayTime <= 1e-6) {
    nextPlayTime = now + INITIAL_LOOKAHEAD_SEC;
  }
  let startAt = nextPlayTime;
  if (startAt < now + SCHEDULE_MIN_LEAD_SEC) {
    startAt = now + SCHEDULE_MIN_LEAD_SEC;
  }
  activeSources.add(src);
  src.onended = () => activeSources.delete(src);
  src.start(startAt);
  nextPlayTime = startAt + dur;
  statusLine =
    'Queued ' +
    nf(dur, 1, 2) +
    's @ ' +
    rate +
    ' Hz · ' +
    ch +
    'ch · starts +' +
    nf(max(0, startAt - now), 1, 3) +
    's';
}

function stopMicPrompt() {
  micActive = false;
  micStatus = '';
  if (micSendTimer) {
    clearInterval(micSendTimer);
    micSendTimer = null;
  }
  if (micProc) {
    try { micProc.disconnect(); } catch (e) {}
    micProc.onaudioprocess = null;
    micProc = null;
  }
  if (micSource) {
    try { micSource.disconnect(); } catch (e) {}
    micSource = null;
  }
  if (micStream) {
    for (const t of micStream.getTracks()) t.stop();
    micStream = null;
  }
  if (micAudioCtx) {
    try { micAudioCtx.close(); } catch (e) {}
    micAudioCtx = null;
  }
  micRing = null;
  micRingWrite = 0;
}

function resampleTo16kMono(input, inRate) {
  if (!input || !input.length) return new Float32Array(0);
  if (inRate === 16000) return input;
  const ratio = inRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const x0 = Math.floor(x);
    const x1 = Math.min(input.length - 1, x0 + 1);
    const t = x - x0;
    out[i] = input[x0] * (1 - t) + input[x1] * t;
  }
  return out;
}

function resampleToRate(input, inRate, outRate) {
  if (!input || !input.length) return new Float32Array(0);
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const x0 = Math.floor(x);
    const x1 = Math.min(input.length - 1, x0 + 1);
    const t = x - x0;
    out[i] = input[x0] * (1 - t) + input[x1] * t;
  }
  return out;
}

function ringWrite(ring, writeIdx, chunk) {
  const n = ring.length;
  for (let i = 0; i < chunk.length; i++) {
    ring[writeIdx] = chunk[i];
    writeIdx = (writeIdx + 1) % n;
  }
  return writeIdx;
}

function ringReadLatest(ring, writeIdx) {
  const n = ring.length;
  const out = new Float32Array(n);
  const start = writeIdx % n;
  const tail = n - start;
  out.set(ring.subarray(start), 0);
  out.set(ring.subarray(0, start), tail);
  return out;
}

async function startMicPrompt(base) {
  if (micActive) return;
  micActive = true;
  micStatus = 'requesting mic…';

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  micAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const inRate = micAudioCtx.sampleRate;
  micSource = micAudioCtx.createMediaStreamSource(micStream);

  micRing = new Float32Array(16000);
  micRingWrite = 0;

  const bufSize = 4096;
  micProc = micAudioCtx.createScriptProcessor(bufSize, 1, 1);
  micProc.onaudioprocess = (ev) => {
    if (!micActive || !micRing) return;
    const inBuf = ev.inputBuffer.getChannelData(0);
    const res = resampleTo16kMono(inBuf, inRate);
    micRingWrite = ringWrite(micRing, micRingWrite, res);
  };
  micSource.connect(micProc);
  const micZ = micAudioCtx.createGain();
  micZ.gain.value = 0;
  micProc.connect(micZ);
  micZ.connect(micAudioCtx.destination);

  micLastSendMs = 0;
  micSendTimer = setInterval(() => {
    if (!micActive || !micRing) return;
    const nowMs = performance.now();
    if (nowMs - micLastSendMs < 220) return;
    micLastSendMs = nowMs;
    const clip = ringReadLatest(micRing, micRingWrite);
    sendAudioPrompt(base, clip).catch((e) => {
      micStatus = 'send failed: ' + e;
    });
  }, 120);
  micStatus = 'streaming';
}

async function sendAudioPrompt(base, f32_16k) {
  const w = micPromptWeightSlider ? parseFloat(micPromptWeightSlider.value()) : 0.0;
  return await sendAudioPromptWeighted(base, f32_16k, w);
}

async function sendAudioPromptWeighted(base, f32_16k, w) {
  if (!w || w <= 0.0001) return;

  const hdr = new ArrayBuffer(16);
  const dv = new DataView(hdr);
  dv.setUint8(0, 0x4d); // M
  dv.setUint8(1, 0x52); // R
  dv.setUint8(2, 0x54); // T
  dv.setUint8(3, 0x41); // A
  dv.setUint32(4, 16000, true);
  dv.setUint32(8, f32_16k.length, true);
  dv.setUint16(12, 1, true);
  dv.setUint16(14, 0, true);

  const payload = new Uint8Array(16 + f32_16k.length * 4);
  payload.set(new Uint8Array(hdr), 0);
  payload.set(new Uint8Array(f32_16k.buffer), 16);

  const headers = {
    ...NGROK_HEADERS_GET,
    'Content-Type': 'application/octet-stream',
    'X-Audio-Weight': String(w),
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

async function ensureToneJsLoaded() {
  // No-op (kept for compatibility); Tone guide is now pure WebAudio.
  return;
}

function pickNextMidi() {
  // Simple stepwise random walk in a soothing scale.
  const scale = [0, 2, 3, 5, 7, 10]; // minor pentatonic-ish
  const base = 48; // C3
  const oct = 12 * (Math.floor(Math.random() * 2) + 1); // C4..C5 region
  const target = base + oct + scale[Math.floor(Math.random() * scale.length)];
  const step = clamp(target - toneLastMidi, -5, 5);
  toneLastMidi = clamp(toneLastMidi + step, 48, 72);
  return toneLastMidi;
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

async function startToneGuide(base) {
  if (toneActive) return;
  toneActive = true;
  toneStatus = 'starting…';
  ensureGuideTapGraph();
  const ctx = getAudioContext();

  toneStepIdx = 0;
  toneLastMidi = 60;

  // Sustained-note mode: one continuous oscillator, slow pitch glides.
  toneOsc = ctx.createOscillator();
  toneOsc.type = 'sine';
  toneOscGain = ctx.createGain();
  toneOscGain.gain.value = 0.10;
  toneOsc.connect(toneOscGain);
  toneOscGain.connect(toneTapGain);
  const t0 = ctx.currentTime + 0.02;
  toneOsc.frequency.setValueAtTime(midiToHz(toneLastMidi), t0);
  toneOsc.start(t0);

  const stepSec = 3.0;
  const glideSec = 0.45;
  toneNextTime = ctx.currentTime + 0.10;
  toneSeqTimer = setInterval(() => {
    if (!toneActive || !toneOsc) return;
    const now = ctx.currentTime;
    while (toneNextTime < now + 0.50) {
      const t = toneNextTime;
      const midi = pickNextMidi();
      const hz = midiToHz(midi);
      toneOsc.frequency.cancelScheduledValues(t);
      toneOsc.frequency.setValueAtTime(toneOsc.frequency.value, t);
      toneOsc.frequency.linearRampToValueAtTime(hz, t + glideSec);
      toneStepIdx++;
      toneNextTime += stepSec;
    }
  }, 120);

  toneStatus = 'streaming';
}

function stopToneGuide() {
  toneActive = false;
  toneStatus = '';
  if (toneSeqTimer) {
    clearInterval(toneSeqTimer);
    toneSeqTimer = null;
  }
  if (toneOsc) {
    try { toneOsc.stop(); } catch (e) {}
    try { toneOsc.disconnect(); } catch (e) {}
    toneOsc = null;
  }
  if (toneOscGain) {
    try { toneOscGain.disconnect(); } catch (e) {}
    toneOscGain = null;
  }
  // Keep toneTapGain / toneTapProc / toneSendTimer alive so the keyboard
  // can keep streaming its audio prompt independently.
  toneSynth = null;
  toneCtx = null;
}

function stopSnippetRecord() {
  snippetRecActive = false;
  if (snippetProc) {
    try { snippetProc.disconnect(); } catch (e) {}
    snippetProc.onaudioprocess = null;
    snippetProc = null;
  }
  if (snippetSource) {
    try { snippetSource.disconnect(); } catch (e) {}
    snippetSource = null;
  }
  if (snippetStream) {
    for (const t of snippetStream.getTracks()) t.stop();
    snippetStream = null;
  }
  if (snippetAudioCtx) {
    try { snippetAudioCtx.close(); } catch (e) {}
    snippetAudioCtx = null;
  }
}

async function startSnippetRecord() {
  snippetRecActive = true;
  snippetRecMs = performance.now();
  snippetRaw = null;
  snippetRawRate = 0;
  if (snippetUi.status) snippetUi.status.html('recording…');

  snippetStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  snippetAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const inRate = snippetAudioCtx.sampleRate;
  snippetRawRate = inRate;
  snippetSource = snippetAudioCtx.createMediaStreamSource(snippetStream);

  const maxFrames = Math.floor(inRate * 10.0);
  snippetBuf = new Float32Array(maxFrames);
  snippetBufWrite = 0;

  const bufSize = 4096;
  snippetProc = snippetAudioCtx.createScriptProcessor(bufSize, 1, 1);
  snippetProc.onaudioprocess = (ev) => {
    if (!snippetRecActive || !snippetBuf) return;
    const inBuf = ev.inputBuffer.getChannelData(0);
    const remaining = snippetBuf.length - snippetBufWrite;
    const n = Math.min(remaining, inBuf.length);
    snippetBuf.set(inBuf.subarray(0, n), snippetBufWrite);
    snippetBufWrite += n;
    if (snippetUi.status) {
      const sec = snippetBufWrite / snippetRawRate;
      snippetUi.status.html(nf(sec, 1, 1) + 's');
    }
    if (snippetBufWrite >= snippetBuf.length) {
      snippetRaw = snippetBuf.slice(0);
      stopSnippetRecord();
      if (snippetUi.status) snippetUi.status.html('ready');
    }
  };
  snippetSource.connect(snippetProc);
  const snZ = snippetAudioCtx.createGain();
  snZ.gain.value = 0;
  snippetProc.connect(snZ);
  snZ.connect(snippetAudioCtx.destination);
}

async function playSnippetRaw() {
  if (!snippetRaw || !snippetRaw.length || !snippetRawRate) {
    throw new Error('no snippet recorded');
  }
  const ctx = getAudioContext();
  const out = resampleToRate(snippetRaw, snippetRawRate, ctx.sampleRate);
  const buf = ctx.createBuffer(1, out.length, ctx.sampleRate);
  buf.getChannelData(0).set(out);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(ctx.currentTime + 0.01);
}

async function sendSnippetForChunk(base) {
  if (!snippetRaw || !snippetRaw.length || !snippetRawRate) {
    throw new Error('no snippet recorded');
  }
  const f16 = resampleTo16kMono(snippetRaw, snippetRawRate);

  const hdr = new ArrayBuffer(16);
  const dv = new DataView(hdr);
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
    'X-Temperature': String(parseFloat(window.magentaTemp.value())),
    'X-Topk': String(parseInt(window.magentaTopk.value(), 10)),
    'X-Guidance': String(parseFloat(window.magentaGuid.value())),
  };

  if (snippetUi.status) snippetUi.status.html('sending…');
  const r = await fetch(base + '/api/snippet-chunk', {
    method: 'POST',
    headers,
    body: payload,
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!r.ok) {
    const t = await r.text();
    if (snippetUi.status) snippetUi.status.html('error');
    throw new Error('HTTP ' + r.status + ' ' + t);
  }
  const buf = await r.arrayBuffer();
  if (snippetUi.status) snippetUi.status.html('played');
  schedulePcm(buf);
}
