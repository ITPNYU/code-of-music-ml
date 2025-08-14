class MusicGen {
  constructor() {
    this.apiUrl = "YOUR_NGROK_URL";
    this.isGenerating = false;
    this.currentGeneratingPad = -1;
    this.generationProgress = 0;
    this.promptInputs = [];
    this.generateButton;
    this.testButton;
    this.statusText = "Ready to generate samples";
    this.connectionStatus = "Not Connected";
    this.padPressTime = [];
    
    this.padSize = 80;
    this.gridCols = 4;
    this.gridRows = 3;
    
    this.pads = [];
    this.samples = [];
  }
  
  // Helper method to normalize API URL (remove trailing slash)
  normalizeApiUrl() {
    return this.apiUrl.replace(/\/$/, '');
  }
  
  initialize() {
    this.initializePads();
    this.createUI();
    this.setupSamplePads();
  }
  
  initializePads() {
    this.padPressTime = new Array(12).fill(0);

    for (let i = 0; i < 12; i++) {
      this.pads.push({
        id: i,
        isActive: false,
        isLoaded: false,
        isGenerating: false,
      });
      this.samples.push(null);
    }
  }
  
  createUI() {
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

    this.testButton = createButton("Test Connection");
    this.testButton.parent(container);
    this.testButton.mousePressed(() => this.testConnection());
    this.testButton.style("background", "#00b894");
    this.testButton.style("color", "white");
    this.testButton.style("border", "none");
    this.testButton.style("padding", "6px 12px");
    this.testButton.style("border-radius", "4px");
    this.testButton.style("font-weight", "500");
    this.testButton.style("cursor", "pointer");

    this.generateButton = createButton("Generate All");
    this.generateButton.parent(container);
    this.generateButton.mousePressed(() => this.generateAllSamples());
    this.generateButton.style("background", "#e17055");
    this.generateButton.style("color", "white");
    this.generateButton.style("border", "none");
    this.generateButton.style("padding", "8px 16px");
    this.generateButton.style("border-radius", "4px");
    this.generateButton.style("font-weight", "500");
    this.generateButton.style("cursor", "pointer");
  }
  
  setupSamplePads() {
    let padStartX = width / 2 - (this.gridCols * (this.padSize + 12)) / 2 + 6;
    let padStartY = height / 2 - (this.gridRows * (this.padSize + 80)) / 2 + 20;
    
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

    for (let row = 0; row < this.gridRows; row++) {
      for (let col = 0; col < this.gridCols; col++) {
        let index = row * this.gridCols + col;
        let padX = padStartX + col * (this.padSize + 12);
        let padY = padStartY + row * (this.padSize + 80);
        
        let promptX = padX;
        let promptY = padY + this.padSize + 25;
        
        let inputContainer = createDiv("");
        inputContainer.position(promptX, promptY);
        inputContainer.style("display", "flex");
        inputContainer.style("flex-direction", "column");
        inputContainer.style("gap", "4px");
        inputContainer.style("width", this.padSize + "px");

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

        this.promptInputs.push(input);
      }
    }
  }
  
  update() {
    for (let i = 0; i < this.padPressTime.length; i++) {
      if (this.padPressTime[i] > 0) {
        this.padPressTime[i] -= 3;
      }
    }
  }
  
  draw() {
    this.drawSamplerPads();
    this.drawStatusPanel();
  }
  
  drawSamplerPads() {
    push();
    translate(
      width / 2 - (this.gridCols * (this.padSize + 12)) / 2 + 6,
      height / 2 - (this.gridRows * (this.padSize + 80)) / 2 + 20
    );

    for (let row = 0; row < this.gridRows; row++) {
      for (let col = 0; col < this.gridCols; col++) {
        let index = row * this.gridCols + col;
        let x = col * (this.padSize + 12);
        let y = row * (this.padSize + 80);

        this.drawPad(x, y, index);
      }
    }
    pop();
  }
  
  drawPad(x, y, index) {
    push();
    translate(x + this.padSize / 2, y + this.padSize / 2);

    let isPlaying =
      this.samples[index] && this.samples[index].isPlaying && this.samples[index].isPlaying();
    let isPressed = this.padPressTime[index] > 0;
    let isLoaded = this.pads[index].isLoaded;
    let isGenerating = this.pads[index].isGenerating;

    let padColors = [
      color(350, 25, 88),
      color(20, 30, 90),
      color(45, 35, 92),
      color(120, 28, 85),
      color(180, 30, 88),
      color(240, 25, 90),
    ];

    let padColor = padColors[index % padColors.length];

    if (isPressed || isPlaying) {
      fill(hue(padColor), saturation(padColor) + 10, brightness(padColor) - 5);
    } else {
      fill(padColor);
    }

    noStroke();
    rect(-this.padSize / 2, -this.padSize / 2, this.padSize, this.padSize, 4);

    fill(0, 0, 0, 10);
    rect(-this.padSize / 2, -this.padSize / 2 + this.padSize - 8, this.padSize, 8, 0, 0, 4, 4);

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
  
  drawStatusPanel() {
    push();

    fill(0, 0, 100);
    noStroke();
    rect(20, 20, width - 40, 100, 8);

    fill(0, 0, 90);
    rect(20, 20 + 100 - 2, width - 40, 2, 0, 0, 8, 8);

    fill(200, 20, 60);
    textAlign(LEFT, TOP);
    textSize(18);
    textStyle(BOLD);
    text("AI MPC Sampler", 35, 35);

    fill(0, 0, 50);
    textSize(12);
    textStyle(NORMAL);
    text(this.statusText, 35, 55);

    fill(this.connectionStatus.includes("✓") ? color(120, 60, 70) : color(0, 60, 70));
    textSize(11);
    text("Connection: " + this.connectionStatus, 35, 75);

    if (this.samples.some((s) => s !== null)) {
      fill(0, 0, 70);
      textSize(10);
      text("Press 1-9, 0, -, = to play • Hold for sustain", 35, 95);
    }

    if (this.isGenerating) {
      fill(45, 80, 90);
      textAlign(RIGHT, TOP);
      textSize(12);
      text(`Generating ${this.generationProgress}/12`, width - 35, 55);

      let barWidth = 120;
      let barHeight = 4;
      let barX = width - 35 - barWidth;
      let barY = 75;

      fill(0, 0, 85);
      rect(barX, barY, barWidth, barHeight, 2);

      fill(45, 80, 90);
      rect(barX, barY, (this.generationProgress / 12) * barWidth, barHeight, 2);
    }

    pop();
  }
  
  handleKeyPress(key) {
    if (key >= "1" && key <= "9") {
      let padIndex = parseInt(key) - 1;
      this.padPressTime[padIndex] = 30;
      this.playSample(padIndex);
    } else if (key === "0") {
      let padIndex = 9;
      this.padPressTime[padIndex] = 30;
      this.playSample(padIndex);
    } else if (key === "-" || key === "_") {
      let padIndex = 10;
      this.padPressTime[padIndex] = 30;
      this.playSample(padIndex);
    } else if (key === "=" || key === "+") {
      let padIndex = 11;
      this.padPressTime[padIndex] = 30;
      this.playSample(padIndex);
    }
  }
  
  handleKeyRelease(key) {
    if (key >= "1" && key <= "9") {
      let padIndex = parseInt(key) - 1;
      this.stopSample(padIndex);
    } else if (key === "0") {
      let padIndex = 9;
      this.stopSample(padIndex);
    } else if (key === "-" || key === "_") {
      let padIndex = 10;
      this.stopSample(padIndex);
    } else if (key === "=" || key === "+") {
      let padIndex = 11;
      this.stopSample(padIndex);
    }
  }
  
  playSample(padIndex) {
    if (this.samples[padIndex] && this.samples[padIndex].isLoaded()) {
      this.pads[padIndex].isActive = true;
      this.samples[padIndex].play();
      this.statusText = `Playing pad ${padIndex + 1}`;
    }
  }
  
  stopSample(padIndex) {
    if (this.samples[padIndex] && this.samples[padIndex].isLoaded()) {
      this.pads[padIndex].isActive = false;
      this.samples[padIndex].stop();
    }
  }
  
  async testConnection() {
    if (!this.apiUrl || this.apiUrl === "YOUR_NGROK_URL") {
      this.statusText = "Please update the apiUrl variable with your ngrok endpoint";
      return;
    }

    try {
      let response = await fetch(this.normalizeApiUrl() + "/health");
      if (response.ok) {
        this.connectionStatus = "Connected";
        this.statusText = "Connection successful";
      } else {
        this.connectionStatus = "Connection failed";
        this.statusText = "Connection test failed";
      }
    } catch (error) {
      this.connectionStatus = "Connection failed";
      this.statusText = "Connection error: " + error.message;
    }
  }
  
  async generateAllSamples() {
    if (!this.apiUrl || this.apiUrl === "YOUR_NGROK_URL") {
      this.statusText = "Please update the apiUrl variable with your ngrok endpoint";
      return;
    }

    if (this.isGenerating) {
      this.statusText = "Already generating...";
      return;
    }

    this.isGenerating = true;
    this.generationProgress = 0;
    this.statusText = "Starting generation...";

    for (let i = 0; i < 12; i++) {
      let prompt = this.promptInputs[i].value().trim();

      if (prompt) {
        this.currentGeneratingPad = i;
        this.pads[i].isGenerating = true;

        try {
          await this.generateSample(i, prompt);
          this.pads[i].isGenerating = false;
          this.pads[i].isLoaded = true;
          this.generationProgress++;

          if (i < 11) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (error) {
          this.pads[i].isGenerating = false;
          this.statusText = `Error generating pad ${i + 1}: ${error.message}`;
        }
      } else {
        this.generationProgress++;
      }
    }

    this.isGenerating = false;
    this.currentGeneratingPad = -1;
    this.statusText = "All samples generated!";
  }
  
  async generateSample(padIndex, prompt) {
    try {
      let response = await fetch(this.normalizeApiUrl() + "/generate", {
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

      this.samples[padIndex] = loadSound(
        audioUrl,
        () => {
          this.statusText = `Sample ${padIndex + 1} ready`;
        },
        (error) => {
          this.statusText = `Error loading sample ${padIndex + 1}`;
        }
      );
    } catch (error) {
      throw new Error(`Failed to generate sample: ${error.message}`);
    }
  }
}
