import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI ||
  "http://127.0.0.1:5173/api/spotify/callback";
const SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

// Starman — 2012 Remaster (Ziggy Stardust). Default when user asks for Bowie.
const DEFAULT_BOWIE_URI = "spotify:track:5i5eA8a5orfvH4QqmhyiG1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = path.join(__dirname, "..", ".data");
const SESSION_FILE = path.join(SESSION_DIR, "spotify-sessions.json");

/** @type {Map<string, { accessToken: string, refreshToken: string, expiresAt: number }>} */
const sessions = new Map();

function loadSessions() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    if (!raw || typeof raw !== "object") return;
    for (const [sid, sess] of Object.entries(raw)) {
      if (
        sess &&
        typeof sess.accessToken === "string" &&
        typeof sess.refreshToken === "string" &&
        typeof sess.expiresAt === "number"
      ) {
        sessions.set(sid, sess);
      }
    }
    console.log(`[spotify] restored ${sessions.size} session(s) from disk`);
  } catch (err) {
    console.warn("[spotify] could not load sessions", err);
  }
}

function persistSessions() {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    /** @type {Record<string, { accessToken: string, refreshToken: string, expiresAt: number }>} */
    const out = {};
    for (const [sid, sess] of sessions.entries()) {
      out[sid] = sess;
    }
    fs.writeFileSync(SESSION_FILE, JSON.stringify(out, null, 2));
  } catch (err) {
    console.warn("[spotify] could not persist sessions", err);
  }
}

loadSessions();
export function spotifyConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function getBowieContextUri() {
  return DEFAULT_BOWIE_URI;
}

function newSid() {
  return crypto.randomBytes(24).toString("hex");
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

function setSidCookie(res, sid) {
  res.setHeader(
    "Set-Cookie",
    `spotify_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  );
}

export function getSession(req) {
  const sid = parseCookies(req).spotify_sid;
  if (!sid) return null;
  const sess = sessions.get(sid);
  if (!sess) return null;
  return { sid, ...sess };
}

async function refreshIfNeeded(sid, sess) {
  if (Date.now() < sess.expiresAt - 30_000) return sess;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: sess.refreshToken,
  });
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await r.json();
  if (!r.ok) {
    sessions.delete(sid);
    persistSessions();
    throw new Error(data.error_description || data.error || "Spotify refresh failed");
  }
  const next = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || sess.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  sessions.set(sid, next);
  persistSessions();
  return next;
}

export async function getAccessToken(req) {
  const session = getSession(req);
  if (!session) return null;
  const refreshed = await refreshIfNeeded(session.sid, session);
  return refreshed.accessToken;
}

/** @param {import('express').Express} app */
export function mountSpotifyRoutes(app) {
  app.get("/api/spotify/status", async (req, res) => {
    if (!spotifyConfigured()) {
      return res.json({
        configured: false,
        authenticated: false,
        bowieUri: DEFAULT_BOWIE_URI,
      });
    }
    try {
      const token = await getAccessToken(req);
      res.json({
        configured: true,
        authenticated: Boolean(token),
        bowieUri: DEFAULT_BOWIE_URI,
      });
    } catch {
      res.json({
        configured: true,
        authenticated: false,
        bowieUri: DEFAULT_BOWIE_URI,
      });
    }
  });

  app.get("/api/spotify/login", (req, res) => {
    if (!spotifyConfigured()) {
      return res.status(503).send("Spotify is not configured (set SPOTIFY_CLIENT_ID/SECRET).");
    }
    const state = crypto.randomBytes(12).toString("hex");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      state,
      show_dialog: "false",
    });
    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
  });

  app.get("/api/spotify/callback", async (req, res) => {
    const code = String(req.query.code || "");
    if (!code) {
      return res.status(400).send("Missing code");
    }
    try {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      });
      const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
      const r = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error_description || data.error || "Token exchange failed");
      }
      const sid = newSid();
      sessions.set(sid, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
      });
      persistSessions();
      setSidCookie(res, sid);
      res.redirect("/?spotify=connected");
    } catch (err) {
      console.error("[spotify] callback", err);
      res.status(500).send("Spotify login failed");
    }
  });

  app.get("/api/spotify/token", async (req, res) => {
    try {
      const token = await getAccessToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Spotify" });
      res.json({ access_token: token });
    } catch (err) {
      res.status(401).json({
        error: err instanceof Error ? err.message : "Spotify auth expired",
      });
    }
  });

  app.post("/api/spotify/transfer", async (req, res) => {
    try {
      const token = await getAccessToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Spotify" });
      const deviceId = String(req.body?.device_id || "");
      if (!deviceId) return res.status(400).json({ error: "device_id required" });
      const play = Boolean(req.body?.play);
      const r = await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ device_ids: [deviceId], play }),
      });
      if (r.status === 204 || r.status === 202) {
        return res.json({ ok: true });
      }
      const data = await r.json().catch(() => ({}));
      res.status(r.status).json({
        error: data.error?.message || data.error || "Transfer failed",
        details: data,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Transfer failed",
      });
    }
  });

  app.post("/api/spotify/play", async (req, res) => {
    try {
      const token = await getAccessToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Spotify" });
      const deviceId = req.body?.device_id ? String(req.body.device_id) : "";

      /** @type {Record<string, unknown>} */
      let playBody = {};
      if (Array.isArray(req.body?.uris) && req.body.uris.length) {
        playBody = { uris: req.body.uris.map(String) };
      } else if (
        req.body?.uri &&
        /^spotify:(track|episode):/.test(String(req.body.uri))
      ) {
        playBody = { uris: [String(req.body.uri)] };
      } else if (req.body?.uri) {
        playBody = { context_uri: String(req.body.uri) };
      } else if (req.body?.context_uri) {
        playBody = { context_uri: String(req.body.context_uri) };
      } else {
        playBody = { uris: [DEFAULT_BOWIE_URI] };
      }

      // Transfer first so Spotify actually registers the Web Playback device.
      // Only when needed — transferring every play can briefly glitch audio.
      if (deviceId) {
        let needTransfer = true;
        try {
          const cur = await fetch("https://api.spotify.com/v1/me/player", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (cur.status === 200) {
            const state = await cur.json().catch(() => null);
            if (state?.device?.id === deviceId) needTransfer = false;
          }
        } catch {
          /* transfer below */
        }
        if (needTransfer) {
          for (let attempt = 0; attempt < 3; attempt++) {
            const transfer = await fetch("https://api.spotify.com/v1/me/player", {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ device_ids: [deviceId], play: false }),
            });
            if (
              transfer.status === 204 ||
              transfer.status === 202 ||
              transfer.status === 200
            ) {
              break;
            }
            await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          }
        }
      }

      let lastErr = "Play failed";
      for (let attempt = 0; attempt < 4; attempt++) {
        const url = deviceId
          ? `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`
          : "https://api.spotify.com/v1/me/player/play";
        const r = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(playBody),
        });
        if (r.status === 204 || r.status === 202) {
          return res.json({ ok: true, play: playBody });
        }
        const data = await r.json().catch(() => ({}));
        lastErr = data.error?.message || data.error || "Play failed";
        // Device not found / no active device — wait for SDK to register.
        if (r.status === 404 || r.status === 502 || /device/i.test(String(lastErr))) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          continue;
        }
        return res.status(r.status).json({ error: lastErr, details: data });
      }
      res.status(404).json({ error: lastErr });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Play failed",
      });
    }
  });

  app.get("/api/spotify/search", async (req, res) => {
    try {
      const token = await getAccessToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Spotify" });
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ error: "q required" });

      const qLower = q.toLowerCase();
      const wantPodcast =
        /\b(podcast|pod\b|episode|show|joe\s*rogan|jre|rogan)\b/i.test(q);
      // Guest / topic cues mean we want a specific episode, not the show feed.
      const wantEpisode =
        wantPodcast &&
        (/\b(with|featuring|ft\.?|episode|ep\.?)\b/i.test(q) ||
          /\b(elon|musk|zelensky|putin|trump|obama|bernie|ye|kanye|hamilton)\b/i.test(
            q,
          ) ||
          qLower
            .replace(
              /\b(play|the|a|an|podcast|pod|episode|show|joe|rogan|jre|experience|on|spotify)\b/gi,
              " ",
            )
            .replace(/\s+/g, " ")
            .trim().length >= 3);

      async function spotifySearch(query, type, limit = 8) {
        const params = new URLSearchParams({
          q: query,
          type,
          limit: String(limit),
        });
        const r = await fetch(`https://api.spotify.com/v1/search?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const err = new Error(
            data.error?.message || data.error || "Search failed",
          );
          err.status = r.status;
          throw err;
        }
        return data;
      }

      function scoreText(hay, query) {
        const text = String(hay || "").toLowerCase();
        const words = String(query || "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(
            (w) =>
              w.length > 2 &&
              !/^(the|and|with|podcast|episode|show|play|joe|rogan|jre)$/.test(
                w,
              ),
          );
        if (!words.length) return text.includes(String(query || "").toLowerCase())
          ? 1
          : 0;
        return words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      }

      function pickBestEpisode(items, query) {
        const list = (items || []).filter((e) => e?.uri);
        if (!list.length) return null;
        let best = list[0];
        let bestScore = -1;
        for (const ep of list) {
          const hay = `${ep.name} ${ep.show?.name || ""} ${ep.description || ""}`;
          const score = scoreText(hay, query);
          if (score > bestScore) {
            bestScore = score;
            best = ep;
          }
        }
        // Require at least one meaningful token hit when looking for a guest episode.
        if (wantEpisode && bestScore < 1) return null;
        return best;
      }

      let data;
      try {
        if (wantEpisode) {
          // Episode-first pass for "joe rogan with elon", etc.
          data = await spotifySearch(q, "episode", 10);
          let ep = pickBestEpisode(data.episodes?.items, q);
          if (!ep) {
            // Retry with a tightened query (helps speech-to-text wording).
            const tight = q
              .replace(/\b(podcast|pod|episode|show|experience)\b/gi, " ")
              .replace(/\s+/g, " ")
              .trim();
            if (tight && tight.toLowerCase() !== qLower) {
              data = await spotifySearch(tight, "episode", 10);
              ep = pickBestEpisode(data.episodes?.items, tight);
            }
          }
          if (ep) {
            return res.json({
              ok: true,
              query: q,
              result: {
                kind: "episode",
                uri: ep.uri,
                name: ep.name,
                subtitle: ep.show?.name || "Episode",
                image:
                  ep.images?.[0]?.url || ep.show?.images?.[0]?.url || null,
              },
            });
          }
          // Fall through to mixed search.
        }

        data = await spotifySearch(
          q,
          wantPodcast
            ? "show,episode,track,album,artist,playlist"
            : "track,album,artist,playlist,show,episode",
          5,
        );
      } catch (err) {
        return res.status(err.status || 500).json({
          error: err instanceof Error ? err.message : "Search failed",
        });
      }

      const track = data.tracks?.items?.find((t) => t?.uri);
      const album = data.albums?.items?.find((a) => a?.uri);
      const artist = data.artists?.items?.find((a) => a?.uri);
      const playlist = data.playlists?.items?.find((p) => p?.uri);
      const show = data.shows?.items?.find((s) => s?.uri);
      const episode = pickBestEpisode(data.episodes?.items, q);

      const asTrack = track
        ? {
            kind: "track",
            uri: track.uri,
            name: track.name,
            subtitle: (track.artists || []).map((a) => a.name).join(", "),
            image: track.album?.images?.[0]?.url || null,
          }
        : null;
      const asAlbum = album
        ? {
            kind: "album",
            uri: album.uri,
            name: album.name,
            subtitle: (album.artists || []).map((a) => a.name).join(", "),
            image: album.images?.[0]?.url || null,
          }
        : null;
      const asArtist = artist
        ? {
            kind: "artist",
            uri: artist.uri,
            name: artist.name,
            subtitle: "Artist",
            image: artist.images?.[0]?.url || null,
          }
        : null;
      const asPlaylist = playlist
        ? {
            kind: "playlist",
            uri: playlist.uri,
            name: playlist.name,
            subtitle: playlist.owner?.display_name || "Playlist",
            image: playlist.images?.[0]?.url || null,
          }
        : null;
      const asShow = show
        ? {
            kind: "show",
            uri: show.uri,
            name: show.name,
            subtitle: show.publisher || "Podcast",
            image: show.images?.[0]?.url || null,
          }
        : null;
      const asEpisode = episode
        ? {
            kind: "episode",
            uri: episode.uri,
            name: episode.name,
            subtitle: episode.show?.name || "Episode",
            image:
              episode.images?.[0]?.url ||
              episode.show?.images?.[0]?.url ||
              null,
          }
        : null;

      const best = wantPodcast
        ? wantEpisode
          ? asEpisode || asShow || asTrack || asAlbum || asArtist || asPlaylist
          : asShow || asEpisode || asTrack || asAlbum || asArtist || asPlaylist
        : asTrack || asAlbum || asArtist || asPlaylist || asShow || asEpisode;

      if (!best) {
        return res.status(404).json({ error: `Nothing found for “${q}”` });
      }
      res.json({ ok: true, query: q, result: best });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Search failed",
      });
    }
  });

  app.post("/api/spotify/pause", async (req, res) => {
    try {
      const token = await getAccessToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Spotify" });
      const deviceId = req.body?.device_id ? String(req.body.device_id) : "";
      const url = deviceId
        ? `https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`
        : "https://api.spotify.com/v1/me/player/pause";
      const r = await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 204 || r.status === 202) {
        return res.json({ ok: true });
      }
      const data = await r.json().catch(() => ({}));
      res.status(r.status).json({
        error: data.error?.message || data.error || "Pause failed",
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Pause failed",
      });
    }
  });

  app.post("/api/spotify/next", async (req, res) => {
    try {
      const token = await getAccessToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Spotify" });
      const deviceId = req.body?.device_id ? String(req.body.device_id) : "";
      const url = deviceId
        ? `https://api.spotify.com/v1/me/player/next?device_id=${encodeURIComponent(deviceId)}`
        : "https://api.spotify.com/v1/me/player/next";
      const r = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 204 || r.status === 202) {
        return res.json({ ok: true });
      }
      const data = await r.json().catch(() => ({}));
      res.status(r.status).json({
        error: data.error?.message || data.error || "Skip failed",
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Skip failed",
      });
    }
  });

  app.post("/api/spotify/previous", async (req, res) => {
    try {
      const token = await getAccessToken(req);
      if (!token) return res.status(401).json({ error: "Not connected to Spotify" });
      const deviceId = req.body?.device_id ? String(req.body.device_id) : "";
      const url = deviceId
        ? `https://api.spotify.com/v1/me/player/previous?device_id=${encodeURIComponent(deviceId)}`
        : "https://api.spotify.com/v1/me/player/previous";
      const r = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 204 || r.status === 202) {
        return res.json({ ok: true });
      }
      const data = await r.json().catch(() => ({}));
      res.status(r.status).json({
        error: data.error?.message || data.error || "Previous failed",
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Previous failed",
      });
    }
  });

  app.post("/api/spotify/logout", (req, res) => {
    const sid = parseCookies(req).spotify_sid;
    if (sid) {
      sessions.delete(sid);
      persistSessions();
    }
    res.setHeader(
      "Set-Cookie",
      "spotify_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    res.json({ ok: true });
  });
}
