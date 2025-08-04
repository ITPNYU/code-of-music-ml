// AI MPC Sampler with audiocraft musicgen
let pads = [];
let samples = [];
let apiUrl = "YOUR_NGROK_URL";
let isGenerating = false;
let currentGeneratingPad = -1;
let generationProgress = 0;
let promptInputs = [];
let generateButton;
let testButton;
let statusText = "Ready to generate samples";
let connectionStatus = "Not Connected";
let padPressTime = [];

let padSize = 80;
let gridCols = 4;
let gridRows = 3;

function setup() {
  createCanvas(800, 900);
  colorMode(HSB, 360, 100, 100, 100);

  initializePads();
  createUI();
  setupSamplePads();
}

function draw() {
  drawBackground();
  drawSamplerPads();
  drawStatusPanel();

  // Handle pad press animations
  for (let i = 0; i < padPressTime.length; i++) {
    if (padPressTime[i] > 0) {
      padPressTime[i] -= 3;
    }
  }
}

function drawBackground() {
  background(210, 15, 96);

  // grid pattern
  noStroke();
  fill(210, 10, 94);
  for (let x = 0; x < width; x += 40) {
    rect(x, 0, 1, height);
  }
  for (let y = 0; y < height; y += 40) {
    rect(0, y, width, 1);
  }
}

function drawSamplerPads() {
  push();
  translate(
    width / 2 - (gridCols * (padSize + 12)) / 2 + 6,
    height / 2 - (gridRows * (padSize + 80)) / 2 + 20
  );

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      let index = row * gridCols + col;
      let x = col * (padSize + 12);
      let y = row * (padSize + 80);

      drawPad(x, y, index);
    }
  }
  pop();
}

function drawPad(x, y, index) {
  push();
  translate(x + padSize / 2, y + padSize / 2);

  let isPlaying =
    samples[index] && samples[index].isPlaying && samples[index].isPlaying();
  let isPressed = padPressTime[index] > 0;
  let isLoaded = pads[index].isLoaded;
  let isGenerating = pads[index].isGenerating;

  // Pad colors
  let padColors = [
    color(350, 25, 88), // soft pink
    color(20, 30, 90), // soft peach
    color(45, 35, 92), // soft yellow
    color(120, 28, 85), // soft mint
    color(180, 30, 88), // soft cyan
    color(240, 25, 90), // soft blue
  ];

  let padColor = padColors[index % padColors.length];

  // Pad background with state-based coloring
  if (isPressed || isPlaying) {
    fill(hue(padColor), saturation(padColor) + 10, brightness(padColor) - 5);
  } else {
    fill(padColor);
  }

  noStroke();
  rect(-padSize / 2, -padSize / 2, padSize, padSize, 4);

  // shadow
  fill(0, 0, 0, 10);
  rect(-padSize / 2, -padSize / 2 + padSize - 8, padSize, 8, 0, 0, 4, 4);

  // Pad content
  if (isLoaded) {
    fill(0, 0, 30);
    textAlign(CENTER, CENTER);
    textSize(10);
    textStyle(BOLD);
    text("SAMPLE", 0, -8);

    fill(0, 0, 40);
    textSize(16);
    text(index + 1, 0, 8);

    if (isGenerating) {
      stroke(0, 0, 50);
      strokeWeight(2);
      noFill();
      let angle = map(millis() % 2000, 0, 2000, 0, TWO_PI);
      arc(0, 18, 12, 12, 0, angle);
    }
  } else if (isGenerating) {
    fill(0, 0, 30);
    textAlign(CENTER, CENTER);
    textSize(8);
    textStyle(BOLD);
    text("GENERATING", 0, -8);

    fill(0, 0, 40);
    textSize(16);
    text(index + 1, 0, 4);

    stroke(0, 0, 50);
    strokeWeight(2);
    noFill();
    let angle = map(millis() % 2000, 0, 2000, 0, TWO_PI);
    arc(0, 16, 12, 12, 0, angle);
  } else {
    fill(0, 0, 60);
    textAlign(CENTER, CENTER);
    textSize(8);
    text("EMPTY", 0, -4);

    fill(0, 0, 50);
    textSize(14);
    text(index + 1, 0, 8);
  }

  pop();
}

function drawStatusPanel() {
  push();

  // Main status panel
  fill(0, 0, 100);
  noStroke();
  rect(20, 20, width - 40, 100, 8);

  // Bottom border
  fill(0, 0, 90);
  rect(20, 20 + 100 - 2, width - 40, 2, 0, 0, 8, 8);

  // Title
  fill(200, 20, 60);
  textAlign(LEFT, TOP);
  textSize(18);
  textStyle(BOLD);
  text("AI MPC Sampler", 35, 35);

  // Status text
  fill(0, 0, 50);
  textSize(12);
  textStyle(NORMAL);
  text(statusText, 35, 55);

  // Connection status
  fill(connectionStatus.includes("✓") ? color(120, 60, 70) : color(0, 60, 70));
  textSize(11);
  text("Connection: " + connectionStatus, 35, 75);

  // Instructions
  if (samples.some((s) => s !== null)) {
    fill(0, 0, 70);
    textSize(10);
    text("Press 1-9, 0, -, = to play • Hold for sustain", 35, 95);
  }

  // Generation progress
  if (isGenerating) {
    fill(45, 80, 90);
    textAlign(RIGHT, TOP);
    textSize(12);
    text(`Generating ${generationProgress}/12`, width - 35, 55);

    // Progress bar
    let barWidth = 120;
    let barHeight = 4;
    let barX = width - 35 - barWidth;
    let barY = 75;

    fill(0, 0, 85);
    rect(barX, barY, barWidth, barHeight, 2);

    fill(45, 80, 90);
    rect(barX, barY, (generationProgress / 12) * barWidth, barHeight, 2);
  }

  pop();
}

function initializePads() {
  padPressTime = new Array(12).fill(0);

  // Initialize pads array
  for (let i = 0; i < 12; i++) {
    pads.push({
      id: i,
      isActive: false,
      isLoaded: false,
      isGenerating: false,
    });
    samples.push(null);
  }
}

function createUI() {
  let container = createDiv("");
  container.position(20, height + 20);
  container.style("display", "flex");
  container.style("gap", "12px");
  container.style("align-items", "center");
  container.style("background", "white");
  container.style("padding", "16px 20px");
  container.style("border-radius", "8px");
  container.style("box-shadow", "0 2px 8px rgba(0,0,0,0.1)");
  container.style("font-family", "system-ui, -apple-system, sans-serif");

  testButton = createButton("Test Connection");
  testButton.parent(container);
  testButton.mousePressed(testConnection);
  testButton.style("background", "#00b894");
  testButton.style("color", "white");
  testButton.style("border", "none");
  testButton.style("padding", "6px 12px");
  testButton.style("border-radius", "4px");
  testButton.style("font-weight", "500");
  testButton.style("cursor", "pointer");

  generateButton = createButton("Generate All");
  generateButton.parent(container);
  generateButton.mousePressed(generateAllSamples);
  generateButton.style("background", "#e17055");
  generateButton.style("color", "white");
  generateButton.style("border", "none");
  generateButton.style("padding", "8px 16px");
  generateButton.style("border-radius", "4px");
  generateButton.style("font-weight", "500");
  generateButton.style("cursor", "pointer");
}

function setupSamplePads() {
  let padStartX = width / 2 - (gridCols * (padSize + 12)) / 2 + 6;
  let padStartY = height / 2 - (gridRows * (padSize + 80)) / 2 + 20;
  
  let defaultPrompts = [
    "single kick drum hit, one shot, punchy, no music",
    "snare drum hit, one shot, crisp, no reverb",
    "hi-hat closed, one shot, tight, metallic",
    "vinyl scratch, one shot, hip hop, turntable",
    "808 bass drum, one shot, deep, electronic",
    "clap sound, one shot, sharp, percussive",
    "crash cymbal hit, one shot, bright, explosive",
    "reverse cymbal, one shot, atmospheric, build up",
    "piano chord, C major, warm, melodic, no drums",
    "synth lead, arpeggio, electronic, melodic, no drums",
    "bass line, funky, melodic, groovy, no drums",
    "pad chord, ambient, ethereal, cinematic, no drums",
  ];

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      let index = row * gridCols + col;
      let padX = padStartX + col * (padSize + 12);
      let padY = padStartY + row * (padSize + 80);
      
      let promptX = padX;
      let promptY = padY + padSize + 25;
      
      let inputContainer = createDiv("");
      inputContainer.position(promptX, promptY);
      inputContainer.style("display", "flex");
      inputContainer.style("flex-direction", "column");
      inputContainer.style("gap", "4px");
      inputContainer.style("width", padSize + "px");

      let label = createDiv(`Pad ${index + 1}:`);
      label.parent(inputContainer);
      label.style("font-size", "10px");
      label.style("color", "#666");
      label.style("font-weight", "500");
      label.style("font-family", "system-ui, -apple-system, sans-serif");
      label.style("text-align", "center");

      let input = createInput(defaultPrompts[index]);
      input.parent(inputContainer);
      input.style("width", "100%");
      input.style("padding", "6px 8px");
      input.style("border-radius", "4px");
      input.style("border", "1px solid #ddd");
      input.style("font-size", "10px");
      input.style("font-family", "system-ui, -apple-system, sans-serif");
      input.style("box-sizing", "border-box");

      promptInputs.push(input);
    }
  }
}

function keyPressed() {
  if (key >= "1" && key <= "9") {
    let padIndex = parseInt(key) - 1;
    padPressTime[padIndex] = 30;
    playSample(padIndex);
  } else if (key === "0") {
    let padIndex = 9;
    padPressTime[padIndex] = 30;
    playSample(padIndex);
  } else if (key === "-" || key === "_") {
    let padIndex = 10;
    padPressTime[padIndex] = 30;
    playSample(padIndex);
  } else if (key === "=" || key === "+") {
    let padIndex = 11;
    padPressTime[padIndex] = 30;
    playSample(padIndex);
  }
}

function keyReleased() {
  if (key >= "1" && key <= "9") {
    let padIndex = parseInt(key) - 1;
    stopSample(padIndex);
  } else if (key === "0") {
    let padIndex = 9;
    stopSample(padIndex);
  } else if (key === "-" || key === "_") {
    let padIndex = 10;
    stopSample(padIndex);
  } else if (key === "=" || key === "+") {
    let padIndex = 11;
    stopSample(padIndex);
  }
}

function playSample(padIndex) {
  if (samples[padIndex] && samples[padIndex].isLoaded()) {
    pads[padIndex].isActive = true;
    samples[padIndex].play();
    statusText = `Playing pad ${padIndex + 1}`;
  }
}

function stopSample(padIndex) {
  if (samples[padIndex] && samples[padIndex].isLoaded()) {
    pads[padIndex].isActive = false;
    samples[padIndex].stop();
  }
}

async function testConnection() {
  if (!apiUrl || apiUrl === "YOUR_NGROK_URL") {
    statusText = "Please update the apiUrl variable with your ngrok endpoint";
    return;
  }

  try {
    let response = await fetch(apiUrl + "health");
    if (response.ok) {
      connectionStatus = "Connected";
      statusText = "Connection successful";
    } else {
      connectionStatus = "Connection failed";
      statusText = "Connection test failed";
    }
  } catch (error) {
    connectionStatus = "Connection failed";
    statusText = "Connection error: " + error.message;
  }
}

async function generateAllSamples() {
  if (!apiUrl || apiUrl === "YOUR_NGROK_URL") {
    statusText = "Please update the apiUrl variable with your ngrok endpoint";
    return;
  }

  if (isGenerating) {
    statusText = "Already generating...";
    return;
  }

  isGenerating = true;
  generationProgress = 0;
  statusText = "Starting generation...";

  for (let i = 0; i < 12; i++) {
    let prompt = promptInputs[i].value().trim();

    if (prompt) {
      currentGeneratingPad = i;
      pads[i].isGenerating = true;

      try {
        await generateSample(i, prompt);
        pads[i].isGenerating = false;
        pads[i].isLoaded = true;
        generationProgress++;

        // Wait 1 second between generations to avoid rate limits
        if (i < 11) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        pads[i].isGenerating = false;
        statusText = `Error generating pad ${i + 1}: ${error.message}`;
        console.error("Generation error:", error);
      }
    } else {
      generationProgress++;
    }
  }

  isGenerating = false;
  currentGeneratingPad = -1;
  statusText = "All samples generated!";
}

async function generateSample(padIndex, prompt) {
  try {
    let response = await fetch(apiUrl + "generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: prompt }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    let audioBlob = await response.blob();
    let audioUrl = URL.createObjectURL(audioBlob);

    // Load the audio using p5.js sound library
    samples[padIndex] = loadSound(
      audioUrl,
      () => {
        console.log(`Sample ${padIndex + 1} loaded successfully`);
        statusText = `Sample ${padIndex + 1} ready`;
      },
      (error) => {
        console.error(`Error loading sample ${padIndex + 1}:`, error);
      }
    );
  } catch (error) {
    throw new Error(`Failed to generate sample: ${error.message}`);
  }
}
