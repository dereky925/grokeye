# Grokathon 2026

Local Grok-themed video player with a “Hey Grok” voice overlay (Carina).

## Setup

```bash
cp .env.example .env
# put your XAI_API_KEY in .env

npm install
npm run detect:setup   # once — creates the Python venv
npm run dev            # API auto-starts the detector if needed
```

Open [http://localhost:5173](http://localhost:5173).

## Usage

1. Pick a video from the dashboard (Sushi for now).
2. **Space** toggles play/pause.
3. Just talk (Chrome/Edge) or tap the mic chip.
4. Ask about what’s on screen, open the sushi manual, or say **“highlight the knife”** / **“highlight the person”**.
5. Highlights: client **color blob** for salmon (instant), else **YOLOv8n** (COCO), else **yolov8n-worldv2** fallback. Your existing tracker keeps the box glued after that.
6. Say **“play Bowie”** / **“play Spotify”** for hands-free music (Spotify Premium + one-time Connect/Enable). **“stop music”** pauses.

## Spotify (optional)

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Add redirect URI: `http://127.0.0.1:5173/api/spotify/callback`
3. Put `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env` (see `.env.example`).
4. Restart `npm run dev`, say “play Bowie”, Connect + Enable once — then voice is hands-free.
   Browsers still require that single Enable tap to unlock audio (not a Spotify limitation we can remove).

## Detector packs

Weights download under Ultralytics cache / cwd (`*.pt` gitignored).
Packs are JSON in `detector/packs/` (`kind`: `"yolo"` or `"world"`). Manifest videos can set `"detectorPack": "sushi"`.
Set `AUTO_DETECT=0` to disable auto-spawn (if you manage the detector yourself).

## Add videos

Drop files under `public/videos/` and append an entry to `public/videos/manifest.json`.

## Note

Keep `XAI_API_KEY` in `.env` only — never commit it.
