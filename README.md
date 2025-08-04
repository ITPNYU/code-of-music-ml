# Code of Music - ML Examples

This repository contains easy-to-host AI/ML models for musical purposes, each with a Python backend and a simple p5.js to demonstrate how these models could be used for creative purposes. These are just a few examples of many models that are out there that can be used in a similar way, you will find that the most challenging thing about them is setting up the right environment for them considering the specific dependencies they might have. Once the environment is set up properly, you can access the model through your protocol of choice, in our case http requests, to use them in your projects.

## Projects

MPC1000 and similar samplers have been the source of inspiration for musicians for decades. These examples explore how we can build on top of a familiar idea, but utilize AI models to explore alternative ways to use this interface.

### MusicGen

This example uses Meta's MusicGen model to generate audio samples from text prompts. Think of each pad  

- **Backend**: FastAPI server that hosts the MusicGen model
- **Frontend**: p5.js MPC-style sampler with 12 pads

### Spleeter

This example explores Deezer's Spleeter, an audio splitting model. Upload audio files and split them into separate stems (vocals, drums, bass, etc.).

- **Backend**: FastAPI server that processes audio with Spleeter
- **Frontend**: Simple p5.js interface to upload audio and play back separated stems

**note** this example also uses an external tool called jszip to receive audio stems from the backend

## Getting Started

Each project has its own README with specific setup instructions. The projects follow a similar structure:

1. Set up and run the Python backend (in this case a Jupyter notebook for ease of learning but could also be a python script)
2. Open the frontend sketch in a web browser
3. Connect the frontend to the backend via ngrok URL. Note that this step may or may not be needed, depending on your setup. 

   **What is ngrok?** Think of ngrok like a magic tunnel that lets your computer talk to other computers on the internet. Normally, your computer is like a house with no address - other computers can't find it. Ngrok gives your computer a special internet address (like a street address) so that the web page in your browser can find and talk to the Python program running on your computer.

   **When do you need ngrok?** You only need this magic tunnel if you're running the AI models on your own computer and want to access them from anywhere (like your phone or another computer), or if you're running them on a server that's hidden away from the internet. 