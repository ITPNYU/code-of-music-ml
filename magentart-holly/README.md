# Magenta RT — Holly Herndon

Real-time Magenta RT with the Holly Herndon finetuned checkpoint: a FastAPI server and a p5.js client for streaming PCM chunks and style controls.

## Overview

- **Backend**: `backend/magentart_holly.ipynb` — clones/patches `magenta-realtime` + `t5x`, installs GPU deps, runs the API on port **8103** by default (`MAGENTART_PORT`).
- **Frontend**: `sketch/` — open `index.html` locally or paste `magentart.js` into the [p5.js Web Editor](https://editor.p5js.org/).

## Getting Started

### Backend Setup

**Note:** For JupyterLab on a shared machine, you can upload only `backend/magentart_holly.ipynb` and `backend/requirements.txt` into a project folder if you prefer not to clone the whole repo.

1. **Start Jupyter Lab and open a terminal** (same flow as MusicGen / Spleeter in this repo).

2. **Create a project directory** and copy or upload `magentart_holly.ipynb` and `requirements.txt` from `magentart-holly/backend/`.

3. **Create a Conda environment** (Python **3.11** recommended; JAX / `match` need a recent interpreter):

   ```bash
   conda create -n magenta-rt-holly python=3.11
   conda activate magenta-rt-holly
   ```

4. **Install requirements** (HTTP stack; the notebook still runs the larger editable installs for Magenta RT). Use **`python -m pip`** so packages go into the same interpreter Jupyter will use (on shared hosts, plain `pip` often targets another env):

   ```bash
   python -m pip install -r requirements.txt
   ```

5. **Register a Jupyter kernel** (only after the line above succeeds with the env still activated):

   ```bash
   python -m ipykernel install --user --name magenta-rt-holly --display-name "Magenta RT Holly"
   ```

   **Still “No module named ipykernel”?** Your shell’s `python` is not the conda env you think. Check `which python` — it must be under `.../envs/magenta-rt-holly/`. Then install with that binary explicitly (replace the username if yours differs):

   ```bash
   ~/.conda/envs/magenta-rt-holly/bin/python -m pip install -U ipykernel
   ~/.conda/envs/magenta-rt-holly/bin/python -m ipykernel install --user --name magenta-rt-holly --display-name "Magenta RT Holly"
   ```

   Or from any shell: `conda run -n magenta-rt-holly python -m pip install -U ipykernel` then the same `conda run ... python -m ipykernel install ...`.

6. **Open** `magentart_holly.ipynb`, select the **Magenta RT Holly** kernel, and **run all cells** from the top on a first-time machine. Start Jupyter from the folder where `magenta-realtime` and `t5x` should live (the setup cell clones them into the current working directory).

7. **Shared gateway**: do **not** rely on ngrok in this notebook. Keep the last API cell running, then run `gateway/gateway.ipynb` in a small env so one ngrok URL serves `/musicgen`, `/spleeter`, and **`/magentart`**. Set the sketch’s `YOUR_NGROK_URL` to that tunnel root and leave `useSharedGateway` as `true`.

### Frontend Setup

**Local:** from `magentart-holly/sketch/` run `python -m http.server 8000` and open `http://localhost:8000`.

**p5 Web Editor:** create a sketch, paste `magentart.js` as your main script (or split as you prefer). Set `YOUR_NGROK_URL` to the gateway’s public URL. With the gateway, paths are under `/magentart/...`.

**CORS:** if the editor is blocked, set `MAGENTA_CORS_ORIGINS` before starting the API (see the Holly notebook intro).

## Sketches

- **Mic loop** (`sketch/mic-loop.html`): hold to record, send one audio prompt, then loop the returned model chunk with a raw/model mix control.
- **Realtime stream** (`sketch/realtime.html`): opens a WebSocket to `/ws/stream` and receives continuous model chunks while you edit four prompt boxes, blend them with the XY pad, change sampling params, and paint centroid weights.

**Bandwidth warning:** the realtime stream requests chunks continuously. If you run it through ngrok, it can use bandwidth very quickly. Stop the stream when you are not actively demoing it.
