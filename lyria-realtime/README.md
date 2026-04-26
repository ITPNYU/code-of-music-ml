# Lyria Realtime (browser)

This sketch is a browser UI for Google’s Generative Language realtime websocket endpoint (`BidiGenerateMusic`). It does **not** include any backend server—your browser connects directly to Google.

## 1) Get an API key

1. Go to Google AI Studio and sign in.
2. Open **API keys** and click **Create API key**.
3. Copy the key (it looks like `AIza...`).

You can find AI Studio at `https://aistudio.google.com/` (API keys live under the top-left menu → **Get API key** / **API keys**).

## 2) Run the sketch locally

1. In a terminal, from the repo root:

```bash
cd lyria-realtime/sketch
python -m http.server 8000
```

2. Open `http://localhost:8000`.

## 3) Provide the API key (don’t paste into code)

You have two options:

- **Option A (recommended)**: add it as a URL param:
  - Open: `http://localhost:8000/?key=YOUR_KEY_HERE`
- **Option B**: click **Connect** and paste the key when prompted.

Do **not** commit keys into the repo.

## 4) Use it

1. Click **Connect**.
2. Click **Play**.
3. Move the XY pad and sliders to steer the output.
4. (Optional) enable pitch tracking if you want the sketch to send detected pitch as control input.

## Troubleshooting

- **Nothing happens after Connect**: ensure your key is valid and you’re online.
- **Mic/pitch features don’t work**: the browser will prompt for microphone permission—allow it, then try again.
- **It worked once, then stopped**: reload the page (websocket sessions can time out).

