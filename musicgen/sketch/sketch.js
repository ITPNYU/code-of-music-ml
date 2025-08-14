let musicGen;

function setup() {
  createCanvas(800, 900);
  colorMode(HSB, 360, 100, 100, 100);
  
  musicGen = new MusicGen();
  musicGen.initialize();
}

function draw() {
  drawBackground();
  musicGen.update();
  musicGen.draw();
}

function drawBackground() {
  background(210, 15, 96);
  
  noStroke();
  fill(210, 10, 94);
  for (let x = 0; x < width; x += 40) {
    rect(x, 0, 1, height);
  }
  for (let y = 0; y < height; y += 40) {
    rect(0, y, width, 1);
  }
}

function keyPressed() {
  musicGen.handleKeyPress(key);
}

function keyReleased() {
  musicGen.handleKeyRelease(key);
}
