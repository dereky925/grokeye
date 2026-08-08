# Grokathon 2026

Local Grok-themed video player with a “Hey Grok” voice overlay (Carina).

## Setup

```bash
cp .env.example .env
# put your XAI_API_KEY in .env

npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Usage

1. Pick a video from the dashboard (Sushi for now).
2. **Space** toggles play/pause.
3. Say **“Hey Grok”** (Chrome/Edge), press **G**, or tap the mic chip — the glass orb appears.
4. Ask about what’s on screen; Grok gets the current frame(s) + timestamp and answers with **Carina**.

Video audio is ducked while the mic is armed so speaker bleed doesn’t wreck wake-word detection. Headphones help further.

## How wake word works

Browser **Web Speech API** (Chrome’s cloud speech) runs one continuous recognition session. Modes:

- `wake` — listen for “hey grok” (fuzzy matches allowed)
- `command` — same session captures the question, ends on ~1.4s silence

No abort/restart between wake and question (that’s what made v1 flaky).

## Add videos

Drop files under `public/videos/` and append an entry to `public/videos/manifest.json`.

## Note

Keep `XAI_API_KEY` in `.env` only — never commit it.
