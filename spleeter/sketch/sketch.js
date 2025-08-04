let sampler;

function setup() {
  createCanvas(800, 600);
  colorMode(HSB, 360, 100, 100, 100);
  
  // Create our audio sampler
  sampler = new Spleeter();
  sampler.createUI();
}

function draw() {
  // Draw background
  drawBackground();
  
  // Update and draw the sampler
  sampler.update();
  sampler.drawStatusPanel();
  sampler.drawPads();
}

function drawBackground() {
  background(210, 15, 96);
  
  // Draw grid
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
  sampler.handleKeyPress(key);
}