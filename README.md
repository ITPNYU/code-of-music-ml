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

### Magenta RT (Holly Herndon)

This example uses Google’s Magenta RealTime with a Holly Herndon–style finetuned checkpoint: stream short audio chunks from a text/style prompt and centroid controls in the browser. It includes both a mic-loop sketch and a realtime streaming sketch with editable prompt boxes and live parameter controls.

- **Backend**: Jupyter notebook under `magentart-holly/backend/` (GPU + FastAPI on port **8103** by default)
- **Frontend**: p5.js sketch in `magentart-holly/sketch/`
- **Note**: the realtime streaming sketch requests chunks continuously and can use ngrok bandwidth quickly

### Lyria Realtime

This example connects directly from the browser to Google’s Generative Language realtime music endpoint. It includes editable XY-pad prompt blending, realtime generation controls, and a mic scale interpreter that estimates the key of a sung phrase.

- **Backend**: none in this repo; the browser connects to Google with a Generative Language API key
- **Frontend**: p5.js sketch in `lyria-realtime/sketch/`

## Getting Started

Each project has its own README with specific setup instructions. The projects follow a similar structure:

1. Set up and run the Python backend (in this case a Jupyter notebook for ease of learning but could also be a python script)
2. Open the frontend sketch in a web browser
3. Connect the frontend to the backend via ngrok URL. Note that this step may or may not be needed, depending on your setup. 

The Lyria Realtime sketch is the exception: it does not use the local Python backend or shared gateway. Open `lyria-realtime/sketch/` and provide a Google Generative Language API key as described in `lyria-realtime/README.md`.

   **What is ngrok?** Think of ngrok like a magic tunnel that lets your computer talk to other computers on the internet. Normally, your computer is like a house with no address - other computers can't find it. Ngrok gives your computer a special internet address (like a street address) so that the web page in your browser can find and talk to the Python program running on your computer.

   **When do you need ngrok?** You only need this magic tunnel if you're running the AI models on your own computer and want to access them from anywhere (like your phone or another computer), or if you're running them on a server that's hidden away from the internet.

### One ngrok URL for MusicGen, Spleeter, and Magenta RT Holly

Each backend can use its own Conda env. To expose all of them behind a single public URL:

1. Keep **`musicgen/backend/musicgen.ipynb`**, **`spleeter/backend/spleeter.ipynb`**, and **`magentart-holly/backend/magentart_holly.ipynb`** running (each in its own kernel / env). Default ports: **8101** (MusicGen), **8102** (Spleeter), **8103** (Magenta RT Holly); override with `MUSICGEN_PORT`, `SPLEETER_PORT`, and `MAGENTART_PORT`. These notebooks do **not** start ngrok unless you set `USE_NGROK=1` on a given service.
2. In a **small separate** environment, open **`gateway/gateway.ipynb`**, install `gateway/requirements.txt`, run the code cell once, and leave the notebook running. It starts a local proxy on **8080** (via `PORT`) and, by default, an **ngrok tunnel** to that port so you get one public URL. Set `USE_NGROK=0` to skip ngrok (local-only); set `NGROK_AUTHTOKEN` in the environment on a server so you are not prompted.
3. Set the sketches’ `YOUR_NGROK_URL` / `apiUrl` to the printed ngrok URL (no path). With shared gateway mode on (defaults in the JS), calls go to `/musicgen/...`, `/spleeter/...`, and **`/magentart/...`** on that host. Set `useSharedGateway` to `false` if the public URL points directly at one backend.

Override the gateway with `PORT`, `MUSICGEN_UPSTREAM`, `SPLEETER_UPSTREAM`, `MAGENTART_UPSTREAM`, and ngrok vars; see `gateway/.env.example`.