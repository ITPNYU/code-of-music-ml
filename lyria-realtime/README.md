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
3. Edit the four corner prompt boxes on the XY pad. Use comma-separated prompt ideas in each box.
4. Move the XY pad to blend those corner prompts while streaming.
5. Use the sliders and toggles to steer BPM, chaos, guidance, key, drums, and bass.
6. (Optional) click **Sample Voice 6s** and sing a short phrase. The sketch estimates the phrase's major/minor key and selects the closest Lyria scale.

## Troubleshooting

- **Nothing happens after Connect**: ensure your key is valid and you’re online.
- **Mic scale sampling doesn’t work**: the browser will prompt for microphone permission—allow it, then try again. Sing a steady, monophonic phrase for best results.
- **It worked once, then stopped**: reload the page (websocket sessions can time out).

