class Spleeter {
    constructor() {
      this.NGROK_URL = "YOUR_NGROK_URL";
      this.stems = [];
      this.statusText = "Ready to split audio";
      this.padPressTime = new Array(8).fill(0);
      this.currentSound = null;
      
      // UI elements
      this.fileInput = null;
      this.uploadBtn = null;
      this.modelSelect = null;
    }
    
    createUI() {
      let container = createDiv('');
      container.position(20, height + 20);
      container.style('display', 'flex');
      container.style('gap', '12px');
      container.style('align-items', 'center');
      container.style('background', 'white');
      container.style('padding', '16px 20px');
      container.style('border-radius', '8px');
      container.style('box-shadow', '0 2px 8px rgba(0,0,0,0.1)');
      container.style('font-family', 'system-ui, -apple-system, sans-serif');
      
      let fileLabel = createDiv('File:');
      fileLabel.parent(container);
      fileLabel.style('font-size', '14px');
      fileLabel.style('color', '#666');
      fileLabel.style('font-weight', '500');
      
      this.fileInput = createFileInput((file) => this.handleFile(file));
      this.fileInput.parent(container);
      this.fileInput.attribute('accept', '.mp3,.wav,.flac,.m4a,.aac');
      
      let modelLabel = createDiv('Model:');
      modelLabel.parent(container);
      modelLabel.style('font-size', '14px');
      modelLabel.style('color', '#666');
      modelLabel.style('font-weight', '500');
      
      this.modelSelect = createSelect();
      this.modelSelect.parent(container);
      this.modelSelect.option('2stems-16kHz');
      this.modelSelect.option('4stems-16kHz');  
      this.modelSelect.option('5stems-16kHz');
      this.modelSelect.style('padding', '6px 12px');
      this.modelSelect.style('border-radius', '4px');
      this.modelSelect.style('border', '1px solid #ddd');
      this.modelSelect.style('background', 'white');
      
      this.uploadBtn = createButton("Split Audio");
      this.uploadBtn.parent(container);
      this.uploadBtn.mousePressed(() => this.splitAudio());
      this.uploadBtn.style('background', '#6c5ce7');
      this.uploadBtn.style('color', 'white');
      this.uploadBtn.style('border', 'none');
      this.uploadBtn.style('padding', '8px 16px');
      this.uploadBtn.style('border-radius', '4px');
      this.uploadBtn.style('font-weight', '500');
      this.uploadBtn.style('cursor', 'pointer');
    }
    
    handleFile(file) {
      if (file.type === 'audio') {
        this.statusText = `File: ${file.name}`;
      } else {
        this.statusText = "Please select an audio file";
      }
    }
    
    async splitAudio() {
      if (!this.fileInput.elt.files[0]) {
        this.statusText = "Select a file first";
        return;
      }
      
      this.statusText = "Processing...";
      this.stems = [];
      
      try {
        const formData = new FormData();
        formData.append('file', this.fileInput.elt.files[0]);
        formData.append('model_name', this.modelSelect.value());
        
        const cleanUrl = this.NGROK_URL.replace(/\/$/, '');
        
        const response = await fetch(`${cleanUrl}/separate-zip`, {
          method: 'POST',
          body: formData,
          headers: {
            'ngrok-skip-browser-warning': 'true',
            'User-Agent': 'p5js-sampler/1.0'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        this.statusText = "Loading samples...";
        
        const blob = await response.blob();
        const zip = await JSZip.loadAsync(blob);
        
        let loadedCount = 0;
        let totalStems = 0;
        
        for (const [filename, file] of Object.entries(zip.files)) {
          if (!file.dir && filename.endsWith('.wav')) {
            totalStems++;
          }
        }
        
        for (const [filename, file] of Object.entries(zip.files)) {
          if (!file.dir && filename.endsWith('.wav')) {
            const audioBlob = await file.async('blob');
            const audioUrl = URL.createObjectURL(audioBlob);
            
            let stemIndex = this.stems.length;
            this.stems.push({
              name: filename.replace('.wav', '').replace(/[-_]/g, ' '),
              sound: null,
              url: audioUrl,
              loading: true
            });
            
            loadSound(audioUrl, (sound) => {
              this.stems[stemIndex].sound = sound;
              this.stems[stemIndex].loading = false;
              loadedCount++;
              
              this.statusText = `Loading ${loadedCount}/${totalStems}`;
              
              if (loadedCount === totalStems) {
                this.statusText = `${totalStems} samples ready`;
              }
            }, (error) => {
              console.error(`Failed to load ${filename}:`, error);
              this.stems[stemIndex].loading = false;
            });
          }
        }
        
      } catch (error) {
        this.statusText = `Error: ${error.message}`;
        console.error(error);
      }
    }
    
    playPad(padIndex) {
      if (padIndex >= 0 && padIndex < this.stems.length && this.stems[padIndex].sound) {
        this.padPressTime[padIndex] = 30;
        
        if (this.stems[padIndex].sound.isPlaying()) {
          this.stems[padIndex].sound.stop();
        } else {
          this.stems[padIndex].sound.play();
          this.currentSound = this.stems[padIndex].sound;
          this.statusText = `Playing: ${this.stems[padIndex].name}`;
        }
      }
    }
    
    stopAll() {
      for (let stem of this.stems) {
        if (stem.sound && stem.sound.isPlaying()) {
          stem.sound.stop();
        }
      }
      this.currentSound = null;
      this.statusText = "Stopped";
    }
    
    handleKeyPress(key) {
      if (key === ' ') {
        this.stopAll();
        return;
      }
      
      const num = parseInt(key);
      if (num >= 1 && num <= 8) {
        this.playPad(num - 1);
      }
    }
    
    update() {
      // Update pad press animations
      for (let i = 0; i < this.padPressTime.length; i++) {
        if (this.padPressTime[i] > 0) {
          this.padPressTime[i] -= 3;
        }
      }
    }
    
    drawStatusPanel() {
      push();
      
      fill(0, 0, 100);
      noStroke();
      rect(20, 20, width - 40, 80, 8);
      
      fill(0, 0, 90);
      rect(20, 20 + 80 - 2, width - 40, 2, 0, 0, 8, 8);
      
      fill(200, 20, 60);
      textAlign(LEFT, TOP);
      textSize(18);
      textStyle(BOLD);
      text("Audio Sampler", 35, 35);
      
      fill(0, 0, 50);
      textSize(12);
      textStyle(NORMAL);
      text(this.statusText, 35, 55);
      
      if (this.stems.length > 0) {
        fill(0, 0, 70);
        textSize(10);
        text("Press 1-8 to play • Space to stop all", 35, 75);
      }
      
      pop();
    }
    
    drawPads() {
      let padSize = 80;
      let gridCols = 4;
      let gridRows = 2;
      
      push();
      translate(width/2 - (gridCols * (padSize + 12))/2 + 6, height/2 - (gridRows * (padSize + 12))/2);
      
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          let index = row * gridCols + col;
          let x = col * (padSize + 12);
          let y = row * (padSize + 12);
          
          this.drawSinglePad(x, y, index, padSize);
        }
      }
      pop();
    }
    
    drawSinglePad(x, y, index, padSize) {
      push();
      translate(x + padSize/2, y + padSize/2);
      
      let isPlaying = this.stems[index] && this.stems[index].sound && this.stems[index].sound.isPlaying();
      let isPressed = this.padPressTime[index] > 0;
      
      let padColors = [
        color(350, 25, 88), color(20, 30, 90), color(45, 35, 92), color(120, 28, 85),
        color(180, 30, 88), color(240, 25, 90), color(280, 30, 87), color(320, 25, 89)
      ];
      
      let padColor = padColors[index % padColors.length];
      
      if (isPressed || isPlaying) {
        fill(hue(padColor), saturation(padColor) + 10, brightness(padColor) - 5);
      } else {
        fill(padColor);
      }
      
      noStroke();
      rect(-padSize/2, -padSize/2, padSize, padSize, 4);
      
      fill(0, 0, 0, 10);
      rect(-padSize/2, -padSize/2 + padSize - 8, padSize, 8, 0, 0, 4, 4);
      
      if (this.stems[index]) {
        fill(0, 0, 30);
        textAlign(CENTER, CENTER);
        textSize(10);
        textStyle(BOLD);
        let displayName = this.stems[index].name.substring(0, 8);
        text(displayName.toUpperCase(), 0, -8);
        
        fill(0, 0, 40);
        textSize(16);
        text(index + 1, 0, 8);
        
        if (this.stems[index].loading) {
          stroke(0, 0, 50);
          strokeWeight(2);
          noFill();
          let angle = map(millis() % 2000, 0, 2000, 0, TWO_PI);
          arc(0, 18, 12, 12, 0, angle);
        }
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
  }