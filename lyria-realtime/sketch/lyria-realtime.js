// ═══════════════════════════════════════════════════════════════
//  LYRIA REALTIME — FIXED CONTROL INTERFACE (temp)
//  Bug fixes vs original:
//   1. CONNECT button disabled-logic was inverted (could never be clicked).
//   2. PLAY/STOP layout math (`ry -= 34`) overlapped/mispositioned STOP.
//   3. Scale grid + pitch button used hardcoded y coords that didn't
//      match the dynamic `ry` accumulator → clicks always missed.
//   4. Click handling was split between `mousePressed` and inline
//      `mouseIsPressed` checks inside `draw()`. Now centralized:
//      widgets register hit-rects each frame; clicks resolved in
//      `mousePressed` / `mouseDragged` / `mouseReleased`.
// ═══════════════════════════════════════════════════════════════

// IMPORTANT: do not commit real API keys.
// Provide via `?key=...` in the URL, or you will be prompted on connect.
let API_KEY = '';

function getApiKey() {
  if (API_KEY && API_KEY.trim()) return API_KEY.trim();
  try {
    const u = new URL(window.location.href);
    const k = u.searchParams.get('key');
    if (k && k.trim()) return k.trim();
  } catch (_) {}
  const k = window.prompt('Enter Generative Language API key');
  return (k || '').trim();
}

// Minimal, flat UI theme (inspired by musicgen sketch aesthetics)
const UI = {
  font: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  bg: '#f6f6f7',
  panel: '#ffffff',
  border: 'rgba(0,0,0,0.10)',
  borderSoft: 'rgba(0,0,0,0.06)',
  text: 'rgba(0,0,0,0.82)',
  textMuted: 'rgba(0,0,0,0.55)',
  accent: '#111111',
  good: '#00b894',
  warn: '#e17055',
  radius: 10,
};

const TOP_CARD_Y = 20;
const TOP_CARD_H = 72;
const GUTTER = 24;

const SCALES = [
  { name: 'C maj',  api: 'C_MAJOR_A_MINOR'            },
  { name: 'Db maj', api: 'D_FLAT_MAJOR_B_FLAT_MINOR'  },
  { name: 'D maj',  api: 'D_MAJOR_B_MINOR'            },
  { name: 'Eb maj', api: 'E_FLAT_MAJOR_C_MINOR'       },
  { name: 'E maj',  api: 'E_MAJOR_D_FLAT_MINOR'       },
  { name: 'F maj',  api: 'F_MAJOR_D_MINOR'            },
  { name: 'Gb maj', api: 'G_FLAT_MAJOR_E_FLAT_MINOR'  },
  { name: 'G maj',  api: 'G_MAJOR_E_MINOR'            },
  { name: 'Ab maj', api: 'A_FLAT_MAJOR_F_MINOR'       },
  { name: 'A maj',  api: 'A_MAJOR_G_FLAT_MINOR'       },
  { name: 'Bb maj', api: 'B_FLAT_MAJOR_G_MINOR'       },
  { name: 'B maj',  api: 'B_MAJOR_A_FLAT_MINOR'       },
];

const PROMPT_CORNERS = [
  { label: 'AMBIENT',   color: [200, 80, 90], prompts: ['warm ambient pads', 'soft analog synth pad', 'airy soundscape'] },
  { label: 'TEXTURE',   color: [300, 80, 90], prompts: ['neon synthwave arpeggios', 'retro analog synth shimmer', 'wide cinematic 80s texture'] },
  { label: 'HARMONY',   color: [40,  80, 90], prompts: ['slow piano chords', 'rhodes chords', 'warm sustained chords'] },
  { label: 'DRONE',     color: [120, 80, 90], prompts: ['deep drone', 'subtle low drone', 'evolving ambient drone'] },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY_PROFILES = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
const SCALE_SAMPLE_MS = 6000;
const PITCH_ANALYSIS_INTERVAL_MS = 90;

let ws = null, setupDone = false, isPlaying = false;
let audioCtx = null, scheduledTime = 0;
const SR = 48000;

let padX = 0.5, padY = 0.5;
let dragging = false;

let bpm = 85, density = 0.35, brightness = 0.55, temperature = 0.7, guidance = 4.5;
let muteDrums = false, muteBass = false;
let selScale = 0;

let scaleMicStream = null, scaleMicSource = null, scaleAnalyser = null, scaleBuffer = null;
let scaleSampling = false, scaleSampleUntil = 0, scaleNextAnalysis = 0;
let scalePitchClasses = new Array(12).fill(0);
let scaleSampleCount = 0;
let scaleSampleStatus = 'ready';
let uiLastClick = '';
let uiLastClickTtl = 0;

let configDirty = false, promptDirty = false;
let sendTimer = 0;
const SEND_INTERVAL = 90;

let PAD_X, PAD_Y, PAD_W, PAD_H;
let PANEL_X, PANEL_W;

// Hit-test registry rebuilt every frame.
// Each entry: { kind, x, y, w, h, ...payload }
let hitRects = [];
let activeSlider = null; // id of slider currently being dragged
let apiKeyInput = null;
let promptInputs = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(RGB, 255, 255, 255, 255);
  textFont(UI.font);
  noStroke();
  computeLayout();

  // API key UI (don’t hardcode keys; this input is optional).
  apiKeyInput = createInput('', 'password');
  apiKeyInput.attribute('placeholder', 'API key (AIza...)');
  apiKeyInput.style('font-family', UI.font);
  apiKeyInput.style('font-size', '12px');
  apiKeyInput.style('padding', '8px 10px');
  apiKeyInput.style('border-radius', UI.radius + 'px');
  apiKeyInput.style('border', '1px solid rgba(0,0,0,0.18)');
  apiKeyInput.style('background', '#fff');
  apiKeyInput.style('width', '220px');
  apiKeyInput.input(() => {
    API_KEY = apiKeyInput.value().trim();
  });

  promptInputs = PROMPT_CORNERS.map((corner, idx) => {
    const promptInput = createInput(corner.prompts.join(', '));
    promptInput.attribute('aria-label', corner.label + ' corner prompts');
    promptInput.attribute('placeholder', corner.label.toLowerCase() + ' prompts');
    promptInput.style('font-family', UI.font);
    promptInput.style('font-size', '12px');
    promptInput.style('padding', '8px 10px');
    promptInput.style('border-radius', UI.radius + 'px');
    promptInput.style('border', '1px solid rgba(0,0,0,0.18)');
    promptInput.style('background', 'rgba(255,255,255,0.92)');
    promptInput.style('box-shadow', '0 4px 14px rgba(0,0,0,0.08)');
    promptInput.input(() => {
      PROMPT_CORNERS[idx].prompts = parsePromptInput(promptInput.value());
      promptDirty = true;
      sendTimer = SEND_INTERVAL;
    });
    return promptInput;
  });

  positionPromptInputs();
}

function computeLayout() {
  PANEL_W = min(300, width * 0.3);
  PANEL_X = width - PANEL_W;
  PAD_X = 24;
  PAD_Y = TOP_CARD_Y + TOP_CARD_H + GUTTER;
  PAD_W = PANEL_X - 48;
  PAD_H = max(180, height - PAD_Y - 64);

  if (apiKeyInput) {
    // Place inside the top card, right-aligned.
    apiKeyInput.position(PANEL_X - 220, TOP_CARD_Y + 18);
  }
  positionPromptInputs();
}

function positionPromptInputs() {
  if (!promptInputs.length) return;

  const inputW = constrain(min(240, PAD_W * 0.38), 130, max(130, PAD_W - 24));
  const inputH = 34;
  const inset = 12;
  const positions = [
    [PAD_X + inset, PAD_Y + inset],
    [PAD_X + PAD_W - inputW - inset, PAD_Y + inset],
    [PAD_X + inset, PAD_Y + PAD_H - inputH - inset],
    [PAD_X + PAD_W - inputW - inset, PAD_Y + PAD_H - inputH - inset],
  ];

  for (let i = 0; i < promptInputs.length; i++) {
    promptInputs[i].position(positions[i][0], positions[i][1]);
    promptInputs[i].style('width', inputW + 'px');
  }
}

function parsePromptInput(value) {
  return value.split(',').map(p => p.trim()).filter(Boolean);
}

function draw() {
  background(UI.bg);
  hitRects = [];

  drawXYPad();
  drawRightPanel();
  drawTopBar();
  processScaleSampler();

  sendTimer++;
  if (sendTimer >= SEND_INTERVAL && isPlaying) {
    sendTimer = 0;
    if (promptDirty) { sendCurrentPrompts(); promptDirty = false; }
    if (configDirty) { sendCurrentConfig(); configDirty = false; }
  }
}

// ── XY Pad ───────────────────────────────────────────────────────
function drawXYPad() {
  const x = PAD_X, y = PAD_Y, w = PAD_W, h = PAD_H;

  // Flat pad surface.
  push();
  drawingContext.shadowColor = 'rgba(0,0,0,0.10)';
  drawingContext.shadowBlur = 18;
  drawingContext.shadowOffsetY = 6;
  fill(UI.panel);
  rect(x, y, w, h, UI.radius);
  drawingContext.shadowColor = 'transparent';
  drawingContext.shadowBlur = 0;
  drawingContext.shadowOffsetY = 0;

  noFill();
  stroke(UI.border);
  strokeWeight(1);
  rect(x, y, w, h, UI.radius);
  noStroke();
  pop();

  stroke(UI.borderSoft);
  strokeWeight(1);
  line(x + w / 2, y, x + w / 2, y + h);
  line(x, y + h / 2, x + w, y + h / 2);
  noStroke();

  const cx = x + padX * w;
  const cy = y + padY * h;
  fill('rgba(0,0,0,0.10)');
  ellipse(cx, cy + 2, 22, 22);
  fill(UI.accent);
  ellipse(cx, cy, 10, 10);
  fill(UI.panel);
  ellipse(cx, cy, 4, 4);

  textAlign(CENTER, CENTER);
  textSize(9);
  fill(UI.textMuted);
  text('DENSITY', x + w / 2, y + h + 18);
  push();
  translate(x - 18, y + h / 2);
  rotate(-HALF_PI);
  text('BRIGHTNESS', 0, 0);
  pop();

  hitRects.push({ kind: 'pad', x, y, w, h });
}

function bilinear(tl, tr, bl, br, nx, ny) {
  return tl * (1 - nx) * (1 - ny) + tr * nx * (1 - ny) +
         bl * (1 - nx) *      ny  + br * nx *      ny;
}

// ── Right Panel ──────────────────────────────────────────────────
function drawRightPanel() {
  const px = PANEL_X, pw = PANEL_W, ph = height;

  push();
  // Flat "card" panel with subtle shadow.
  drawingContext.shadowColor = 'rgba(0,0,0,0.10)';
  drawingContext.shadowBlur = 18;
  drawingContext.shadowOffsetY = 6;
  fill(UI.panel);
  rect(px + 8, 12, pw - 16, ph - 24, UI.radius);
  drawingContext.shadowColor = 'transparent';
  drawingContext.shadowBlur = 0;
  drawingContext.shadowOffsetY = 0;
  noFill();
  stroke(UI.border);
  strokeWeight(1);
  rect(px + 8, 12, pw - 16, ph - 24, UI.radius);
  noStroke();
  pop();

  let ry = 32;
  const lx = px + 24;
  const rw = pw - 48;

  textAlign(LEFT, TOP);
  textSize(10);
  fill(UI.text);
  text('Lyria', lx, ry);
  ry += 18;
  textSize(9);
  fill(UI.textMuted);
  text('realtime controller', lx, ry);
  ry += 18;

  // CONNECT — disabled only when *already* connected.
  const connected = ws && ws.readyState === 1 && setupDone;
  ry = drawButton('CONNECT', lx, ry, rw, connected, 'connect');
  ry += 6;

  // PLAY / STOP side-by-side. Capture row top, draw both, advance once.
  const rowTop = ry;
  const halfW = rw / 2 - 4;
  drawButton('▶  PLAY', lx,                  rowTop, halfW, !setupDone || isPlaying,  'play', [120, 70, 80]);
  drawButton('■  STOP', lx + rw / 2 + 4,     rowTop, halfW, !setupDone || !isPlaying, 'stop', [0,   60, 75]);
  ry = rowTop + 28 + 10;

  textAlign(LEFT, TOP);
  textSize(10);
  fill(UI.textMuted);
  text(getStatusText(), lx, ry);
  ry += 22;

  divider(lx, ry, lx + rw); ry += 14;

  textAlign(LEFT, TOP);
  textSize(9);
  fill(UI.textMuted);
  text('BPM', lx, ry); ry += 12;
  drawSlider('bpm', lx, ry, rw, bpm, 60, 200, 1);
  ry += 32;

  textAlign(LEFT, TOP);
  text('CHAOS', lx, ry); ry += 12;
  drawSlider('temp', lx, ry, rw, temperature, 0.1, 3.0, 0.01);
  ry += 32;

  textAlign(LEFT, TOP);
  text('GUIDANCE', lx, ry); ry += 12;
  drawSlider('guid', lx, ry, rw, guidance, 0.0, 6.0, 0.01);
  ry += 32;

  divider(lx, ry, lx + rw); ry += 14;

  textAlign(LEFT, TOP);
  textSize(9);
  fill(UI.textMuted);
  text('SCALE / KEY', lx, ry); ry += 14;
  ry = drawScaleGrid(lx, ry, rw);
  ry += 10;

  divider(lx, ry, lx + rw); ry += 14;

  textAlign(LEFT, TOP);
  textSize(9);
  fill(UI.textMuted);
  text('MUTE', lx, ry); ry += 14;
  drawToggle('DRUMS', lx,                 ry, halfW, muteDrums, 'muteDrums');
  drawToggle('BASS',  lx + rw / 2 + 4,    ry, halfW, muteBass,  'muteBass');
  ry += 34;

  divider(lx, ry, lx + rw); ry += 14;

  textAlign(LEFT, TOP);
  textSize(9);
  fill(UI.textMuted);
  text('MIC SCALE INTERPRETER', lx, ry); ry += 14;
  ry = drawMicScaleInterpreter(lx, ry, rw);
}

function drawScaleGrid(x, y, w) {
  push();
  const cols = 4, rows = 3;
  const bw = floor(w / cols), bh = 22;
  for (let i = 0; i < SCALES.length; i++) {
    const col = i % cols, row = floor(i / cols);
    const bx = x + col * bw, by = y + row * bh;
    const active = selScale === i;
    fill(active ? UI.accent : UI.panel);
    rect(bx, by, bw - 6, bh - 6, 6);
    noFill();
    stroke(active ? 'rgba(0,0,0,0.35)' : UI.border);
    strokeWeight(1);
    rect(bx, by, bw - 6, bh - 6, 6);
    noStroke();
    fill(active ? UI.panel : UI.textMuted);
    textAlign(CENTER, CENTER);
    textSize(9);
    text(SCALES[i].name, bx + (bw - 6) / 2, by + (bh - 6) / 2);
    hitRects.push({ kind: 'scale', x: bx, y: by, w: bw - 6, h: bh - 6, idx: i });
  }
  pop();
  return y + rows * bh;
}

function drawMicScaleInterpreter(x, y, w) {
  push();
  const buttonLabel = scaleSampling ? 'LISTENING...' : 'SAMPLE VOICE 6S';
  drawButton(buttonLabel, x, y, w, scaleSampling, 'scaleListen', [120, 70, 80]);
  y += 34;

  textAlign(LEFT, TOP);
  textSize(9);
  fill(UI.text);
  text(scaleSampleStatus, x, y);
  y += 16;

  textSize(8);
  fill(UI.textMuted);
  text('sings phrase → pitch histogram → best major/minor key', x, y);
  y += 14;
  pop();
  return y;
}

// ── Widgets (draw + register hit-rect, no inline click handling) ─
function drawSlider(id, x, y, w, val, lo, hi, step) {
  push();
  const h = 22, knobR = 8;
  const frac = constrain((val - lo) / (hi - lo), 0, 1);
  const kx = x + frac * w;

  fill('rgba(0,0,0,0.10)');
  rect(x, y + h / 2 - 2, w, 4, 3);
  fill('rgba(0,0,0,0.30)');
  rect(x, y + h / 2 - 2, frac * w, 4, 3);

  const isActive = activeSlider === id;
  fill(UI.panel);
  ellipse(kx, y + h / 2, knobR * 2, knobR * 2);
  noFill();
  stroke(isActive ? 'rgba(0,0,0,0.45)' : UI.border);
  strokeWeight(1);
  ellipse(kx, y + h / 2, knobR * 2, knobR * 2);
  noStroke();

  textAlign(RIGHT); textSize(9);
  fill(UI.textMuted);
  text(nf(val, 1, step < 1 ? 2 : 0), x + w, y - 1);

  // Whole track is hit-target so user can click anywhere on it.
  hitRects.push({ kind: 'slider', x, y, w, h, id, lo, hi, step });
  pop();
}

function drawButton(label, x, y, w, disabled, action, col = [220, 50, 65]) {
  push();
  const h = 28;
  const hov = !disabled && mouseX > x && mouseX < x + w && mouseY > y && mouseY < y + h;
  const isPrimary = label.includes('CONNECT');
  const isPlay = label.includes('PLAY');
  const isStop = label.includes('STOP');

  let bg = UI.panel;
  let fg = UI.text;
  let brd = UI.border;

  if (disabled) {
    bg = 'rgba(0,0,0,0.03)';
    fg = 'rgba(0,0,0,0.35)';
    brd = 'rgba(0,0,0,0.05)';
  } else if (isPlay) {
    bg = hov ? 'rgba(0,184,148,0.16)' : 'rgba(0,184,148,0.10)';
    brd = 'rgba(0,184,148,0.28)';
  } else if (isStop) {
    bg = hov ? 'rgba(225,112,85,0.16)' : 'rgba(225,112,85,0.10)';
    brd = 'rgba(225,112,85,0.28)';
  } else if (isPrimary && hov) {
    bg = 'rgba(0,0,0,0.05)';
  } else if (hov) {
    bg = 'rgba(0,0,0,0.04)';
  }

  fill(bg);
  rect(x, y, w, h, 8);
  noFill();
  stroke(brd);
  strokeWeight(1);
  rect(x, y, w, h, 8);
  noStroke();
  fill(fg);
  textAlign(CENTER, CENTER); textSize(10);
  text(label, x + w / 2, y + h / 2);
  if (!disabled) hitRects.push({ kind: 'button', x, y, w, h, action });
  pop();
  return y + h;
}

function drawToggle(label, x, y, w, val, id) {
  push();
  const h = 26;
  fill(val ? UI.accent : UI.panel);
  rect(x, y, w, h, 8);
  noFill();
  stroke(val ? 'rgba(0,0,0,0.35)' : UI.border);
  strokeWeight(1);
  rect(x, y, w, h, 8);
  noStroke();
  fill(val ? UI.panel : UI.textMuted);
  textAlign(CENTER, CENTER); textSize(10);
  text(label, x + w / 2, y + h / 2);
  hitRects.push({ kind: 'toggle', x, y, w, h, id });
  pop();
}

function divider(x, y, w) {
  // Back-compat signature: divider(x1, y, x2)
  const x1 = x;
  const x2 = w;
  stroke(UI.borderSoft); strokeWeight(1);
  line(x1, y, x2, y);
  noStroke();
}

// ── Top Bar ──────────────────────────────────────────────────────
function drawTopBar() {
  const x = 24, y = TOP_CARD_Y;
  const w = max(240, PANEL_X - 48);
  const h = TOP_CARD_H;

  push();
  drawingContext.shadowColor = 'rgba(0,0,0,0.10)';
  drawingContext.shadowBlur = 18;
  drawingContext.shadowOffsetY = 6;
  fill(UI.panel);
  rect(x, y, w, h, UI.radius);
  drawingContext.shadowColor = 'transparent';
  drawingContext.shadowBlur = 0;
  drawingContext.shadowOffsetY = 0;
  noFill();
  stroke(UI.border);
  strokeWeight(1);
  rect(x, y, w, h, UI.radius);
  noStroke();

  textAlign(LEFT, TOP);
  fill(UI.text);
  textSize(15);
  text('LYRIA', x + 16, y + 14);

  textSize(10);
  fill(UI.textMuted);
  text(getStatusText(), x + 16, y + 38);
  if (uiLastClickTtl > 0 && uiLastClick) {
    textSize(9);
    fill(UI.textMuted);
    text('last: ' + uiLastClick, x + 16, y + 54);
    uiLastClickTtl--;
  }

  // Label for the API key input (the input itself is a DOM element).
  textAlign(RIGHT, TOP);
  fill(UI.textMuted);
  textSize(9);
  text('API key', x + w - 16, y + 12);
  pop();
}

function getBlendDescription() {
  const tl = (1 - padX) * (1 - padY), tr = padX * (1 - padY);
  const bl = (1 - padX) * padY,       br = padX * padY;
  const weights = [tl, tr, bl, br];
  const sorted = [0, 1, 2, 3].sort((a, b) => weights[b] - weights[a]);
  const a = PROMPT_CORNERS[sorted[0]], b = PROMPT_CORNERS[sorted[1]];
  const pct = round(weights[sorted[0]] * 100);
  return `${a.label} ${pct}%  ·  ${b.label} ${100 - pct}%`;
}

function getStatusText() {
  if (!ws || ws.readyState !== 1) return '○  disconnected — press CONNECT';
  if (!setupDone) return '◌  connecting…';
  if (isPlaying) return '●  streaming ♪';
  return '◉  connected — press PLAY';
}

// ── Centralized mouse handling ───────────────────────────────────
function pointInRect(mx, my, r) {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}

// Iterate top-most last (drawn later = visually on top), so reverse.
function findHit(mx, my, kindFilter) {
  for (let i = hitRects.length - 1; i >= 0; i--) {
    const r = hitRects[i];
    if (kindFilter && !kindFilter.includes(r.kind)) continue;
    if (pointInRect(mx, my, r)) return r;
  }
  return null;
}

function mousePressed(event) {
  if (isPromptInputEvent(event)) return;

  // Sliders take priority on the right panel.
  const slider = findHit(mouseX, mouseY, ['slider']);
  if (slider) {
    uiLastClick = 'slider ' + slider.id;
    uiLastClickTtl = 90;
    activeSlider = slider.id;
    applySliderValue(slider, mouseX);
    return;
  }

  const hit = findHit(mouseX, mouseY,
    ['button', 'toggle', 'scale', 'pad']);
  if (!hit) return;

  switch (hit.kind) {
    case 'button':
      uiLastClick = 'button ' + hit.action;
      uiLastClickTtl = 90;
      handleButtonAction(hit.action);
      break;
    case 'toggle':
      uiLastClick = 'toggle ' + hit.id;
      uiLastClickTtl = 90;
      if (hit.id === 'muteDrums') muteDrums = !muteDrums;
      if (hit.id === 'muteBass')  muteBass  = !muteBass;
      configDirty = true;
      break;
    case 'scale':
      uiLastClick = 'scale ' + SCALES[hit.idx]?.name;
      uiLastClickTtl = 90;
      selScale = hit.idx;
      configDirty = true;
      sendTimer = SEND_INTERVAL;
      break;
    case 'pad':
      uiLastClick = 'xy pad';
      uiLastClickTtl = 90;
      dragging = true;
      updatePad();
      break;
  }
}

function mouseDragged(event) {
  if (isPromptInputEvent(event)) return;

  if (activeSlider) {
    const r = hitRects.find(h => h.kind === 'slider' && h.id === activeSlider);
    if (r) applySliderValue(r, mouseX);
    return;
  }
  if (dragging) updatePad();
}

function mouseReleased() {
  dragging = false;
  activeSlider = null;
}

function isPromptInputEvent(event) {
  const target = event?.target;
  return !!target && promptInputs.some(promptInput => {
    const el = promptInput.elt;
    return target === el || el.contains(target);
  });
}

function applySliderValue(r, mx) {
  const newFrac = constrain((mx - r.x) / r.w, 0, 1);
  const raw = r.lo + newFrac * (r.hi - r.lo);
  const snapped = r.lo + round((raw - r.lo) / r.step) * r.step;
  switch (r.id) {
    case 'bpm':  bpm = snapped; break;
    case 'temp': temperature = snapped; break;
    case 'guid': guidance = snapped; break;
  }
  configDirty = true;
}

function handleButtonAction(action) {
  if (action === 'connect') connectLyria();
  else if (action === 'play') startPlay();
  else if (action === 'stop') stopPlay();
  else if (action === 'scaleListen') startScaleSample();
}

function updatePad() {
  padX = constrain((mouseX - PAD_X) / PAD_W, 0, 1);
  padY = constrain((mouseY - PAD_Y) / PAD_H, 0, 1);
  density = padX;
  brightness = 1 - padY;
  configDirty = true;
  promptDirty = true;
}

async function startScaleSample() {
  if (scaleSampling) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    scaleSampleStatus = 'mic API unavailable';
    return;
  }

  try {
    ensureAudioCtx();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    scaleMicStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    scaleMicSource = audioCtx.createMediaStreamSource(scaleMicStream);
    scaleAnalyser = audioCtx.createAnalyser();
    scaleAnalyser.fftSize = 4096;
    scaleBuffer = new Float32Array(scaleAnalyser.fftSize);
    scaleMicSource.connect(scaleAnalyser);

    scalePitchClasses = new Array(12).fill(0);
    scaleSampleCount = 0;
    scaleSampling = true;
    scaleSampleUntil = millis() + SCALE_SAMPLE_MS;
    scaleNextAnalysis = 0;
    scaleSampleStatus = 'sing a short phrase...';
  } catch (err) {
    scaleSampling = false;
    scaleSampleStatus = err?.name === 'NotAllowedError' ? 'mic permission denied' : 'mic unavailable';
    stopScaleMic();
  }
}

function processScaleSampler() {
  if (!scaleSampling || !scaleAnalyser || !scaleBuffer) return;

  const now = millis();
  if (now >= scaleSampleUntil) {
    finishScaleSample();
    return;
  }
  if (now < scaleNextAnalysis) return;
  scaleNextAnalysis = now + PITCH_ANALYSIS_INTERVAL_MS;

  scaleAnalyser.getFloatTimeDomainData(scaleBuffer);
  const freq = detectPitch(scaleBuffer, audioCtx.sampleRate);
  if (!freq) return;

  const midi = round(69 + 12 * Math.log2(freq / 440));
  const pitchClass = ((midi % 12) + 12) % 12;
  scalePitchClasses[pitchClass] += 1;
  scaleSampleCount++;
  scaleSampleStatus = 'hearing ' + NOTE_NAMES[pitchClass] + '...';
}

function finishScaleSample() {
  scaleSampling = false;
  stopScaleMic();

  if (scaleSampleCount < 8) {
    scaleSampleStatus = 'not enough stable pitch';
    return;
  }

  const detected = estimateScale(scalePitchClasses);
  const scaleIdx = detected.mode === 'major' ? detected.root : (detected.root + 3) % 12;
  selScale = scaleIdx;
  configDirty = true;
  sendTimer = SEND_INTERVAL;
  scaleSampleStatus = NOTE_NAMES[detected.root] + ' ' + detected.mode + ' → ' + SCALES[scaleIdx].name;

  if (isPlaying) {
    sendCurrentConfig(true);
    configDirty = false;
  }
}

function stopScaleMic() {
  if (scaleMicSource) scaleMicSource.disconnect();
  if (scaleMicStream) scaleMicStream.getTracks().forEach(track => track.stop());
  scaleMicSource = null;
  scaleMicStream = null;
  scaleAnalyser = null;
  scaleBuffer = null;
}

function detectPitch(buffer, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / buffer.length);
  if (rms < 0.012) return null;

  const minLag = floor(sampleRate / 1000);
  const maxLag = floor(sampleRate / 80);
  let bestLag = -1;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const len = buffer.length - lag;
    for (let i = 0; i < len; i++) corr += buffer[i] * buffer[i + lag];
    corr = corr / len / (rms * rms);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestCorr < 0.35) return null;
  return sampleRate / bestLag;
}

function estimateScale(histogram) {
  let best = { root: 0, mode: 'major', score: -Infinity };
  for (const mode of ['major', 'minor']) {
    const profile = KEY_PROFILES[mode];
    for (let root = 0; root < 12; root++) {
      let score = 0;
      for (let pc = 0; pc < 12; pc++) {
        score += histogram[pc] * profile[(pc - root + 12) % 12];
      }
      if (score > best.score) best = { root, mode, score };
    }
  }
  return best;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  computeLayout();
}

// ── Lyria WebSocket ───────────────────────────────────────────────
function connectLyria() {
  if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  setupDone = false;
  API_KEY = getApiKey();
  if (!API_KEY) throw new Error('Missing API key');
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateMusic?key=${API_KEY}`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    ws.send(JSON.stringify({ setup: { model: 'models/lyria-realtime-exp' } }));
  };

  ws.onmessage = async (evt) => {
    let msg;
    try {
      msg = JSON.parse(typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data));
    } catch { return; }
    if (msg.setupComplete !== undefined) { setupDone = true; return; }
    if (msg.serverContent?.audioChunks) {
      for (const chunk of msg.serverContent.audioChunks) {
        if (chunk.data) await scheduleAudioChunk(chunk.data);
      }
    }
  };

  ws.onerror = () => { setupDone = false; };
  ws.onclose = () => { setupDone = false; isPlaying = false; };
}

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

async function scheduleAudioChunk(b64) {
  ensureAudioCtx();
  let bytes;
  try {
    const raw = atob(b64);
    bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  } catch { return; }
  try {
    const decoded = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
    const src = audioCtx.createBufferSource();
    src.buffer = decoded; src.connect(audioCtx.destination);
    const t = Math.max(audioCtx.currentTime, scheduledTime);
    src.start(t); scheduledTime = t + decoded.duration;
  } catch {
    try {
      const i16 = new Int16Array(bytes.buffer);
      const frames = i16.length / 2;
      const buf = audioCtx.createBuffer(2, frames, SR);
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      for (let i = 0; i < frames; i++) { L[i] = i16[i * 2] / 32768; R[i] = i16[i * 2 + 1] / 32768; }
      const src = audioCtx.createBufferSource();
      src.buffer = buf; src.connect(audioCtx.destination);
      const t = Math.max(audioCtx.currentTime, scheduledTime);
      src.start(t); scheduledTime = t + buf.duration;
    } catch {}
  }
}

function sendWeightedPrompts(prompts) {
  if (!ws || ws.readyState !== 1 || !setupDone) return;
  ws.send(JSON.stringify({ client_content: { weightedPrompts: prompts } }));
}
function sendMusicConfig(cfg) {
  if (!ws || ws.readyState !== 1 || !setupDone) return;
  ws.send(JSON.stringify({ music_generation_config: cfg }));
}
function sendPlayback(ctrl) {
  if (!ws || ws.readyState !== 1 || !setupDone) return;
  ws.send(JSON.stringify({ playback_control: ctrl }));
}

function buildPrompts() {
  const weights = [
    (1 - padX) * (1 - padY),
    padX       * (1 - padY),
    (1 - padX) * padY,
    padX       * padY,
  ];
  const map_ = {};
  for (let c = 0; c < 4; c++) {
    if (weights[c] < 0.05) continue;
    for (const p of PROMPT_CORNERS[c].prompts) {
      map_[p] = (map_[p] || 0) + weights[c];
    }
  }
  return Object.entries(map_).map(([text, weight]) => ({ text, weight: parseFloat(weight.toFixed(2)) }));
}

function sendCurrentPrompts() {
  sendWeightedPrompts(buildPrompts());
}

function sendCurrentConfig(resetCtx = false) {
  sendMusicConfig({
    bpm:         round(bpm),
    density:     parseFloat(density.toFixed(2)),
    brightness:  parseFloat(brightness.toFixed(2)),
    temperature: parseFloat(temperature.toFixed(2)),
    guidance:    parseFloat(guidance.toFixed(2)),
    scale:       SCALES[selScale].api,
    muteDrums,
    muteBass,
  });
  if (resetCtx) sendPlayback('RESET_CONTEXT');
}

function startPlay() {
  if (!setupDone) return;
  ensureAudioCtx();
  scheduledTime = audioCtx.currentTime + 0.1;
  sendCurrentPrompts();
  sendCurrentConfig();
  sendPlayback('PLAY');
  isPlaying = true;
}

function stopPlay() {
  sendPlayback('STOP');
  isPlaying = false;
  scheduledTime = 0;
}
