# Spleeter

An audio source separation tool based on Deezer's Spleeter model, allowing you to split audio files into separate stems.

## Overview

This example uses the same familiar grid interface, but instead of using AI to generate samples for us, we load a music track of our choice and we split the audio based on the model we choose to load the separated stems into the pads. Models you can choose from are:

- 2stems-16kHz: vocals and accompaniment
- 4stems-16kHz: vocals, drums, bass, and other
- 5stems-16kHz: vocals, drums, bass, piano, and other

## Structure

- `backend/`: Contains the Python server using FastAPI and Spleeter
- `sketch/`: Contains the p5.js frontend interface

## Getting Started

### Backend Setup

1. Navigate to the `backend` directory
2. Install requirements: `pip install -r requirements.txt`
3. Open and run `Spleeter.ipynb` in Jupyter
4. Enter your ngrok auth token when prompted
5. Note the public URL provided by ngrok

### Frontend Setup

1. Open `sketch/index.html` in a web browser
2. Update the `NGROK_URL` variable in `spleeter.js` with your ngrok URL
3. Upload an audio file, select a model, and click "Split Audio"
4. After processing, play back individual stems using number keys 1-8