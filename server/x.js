import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// X posting (OAuth 2.0 user context). Separate from twitter.js on purpose:
// that module is app-only-Bearer READ plumbing, and mixing a write-capable
// user token into it invites posting with the wrong credential. One fixed
// demo account; last completed login wins.
const CLIENT_ID = process.env.X_CLIENT_ID || "";
const CLIENT_SECRET = process.env.X_CLIENT_SECRET || "";
const REDIRECT_URI =
  process.env.X_REDIRECT_URI || "http://127.0.0.1:5173/api/x/auth/callback";
// media.write is required by /2/media/upload; the v1.1 upload host is sunset.
const SCOPES = "tweet.read tweet.write users.read media.write offline.access";

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const API_BASE = "https://api.x.com/2";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, "..", ".data");
const AUTH_FILE = path.join(AUTH_DIR, "x-auth.json");

/** @type {{ accessToken: string, refreshToken: string, expiresAt: number, username: string, userId: string } | null} */
let grant = null;

function loadGrant() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
    if (
      raw &&
      typeof raw.accessToken === "string" &&
      typeof raw.refreshToken === "string" &&
      typeof raw.expiresAt === "number"
    ) {
      grant = {
        accessToken: raw.accessToken,
        refreshToken: raw.refreshToken,
        expiresAt: raw.expiresAt,
        username: String(raw.username || ""),
        userId: String(raw.userId || ""),
      };
      console.log(`[x] restored posting grant for @${grant.username || "?"}`);
    }
  } catch (err) {
    console.warn("[x] could not load auth", err);
  }
}

function persistGrant() {
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    if (grant) {
      fs.writeFileSync(AUTH_FILE, JSON.stringify(grant, null, 2));
    } else if (fs.existsSync(AUTH_FILE)) {
      fs.unlinkSync(AUTH_FILE);
    }
  } catch (err) {
    console.warn("[x] could not persist auth", err);
  }
}

loadGrant();

export function xConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function xAuthState() {
  return {
    configured: xConfigured(),
    authenticated: Boolean(grant?.refreshToken),
    username: grant?.username || null,
  };
}

function basicAuth() {
  return `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
}

/** @type {Map<string, { verifier: string, at: number }>} */
const pendingLogins = new Map();
const LOGIN_TTL_MS = 10 * 60_000;

function prunePendingLogins() {
  const cutoff = Date.now() - LOGIN_TTL_MS;
  for (const [state, entry] of pendingLogins) {
    if (entry.at < cutoff) pendingLogins.delete(state);
  }
}

async function exchangeToken(params) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(
      data.error_description || data.error || "X token request failed",
    );
    err.status = r.status;
    throw err;
  }
  return data;
}

// X refresh tokens rotate (single-use), so concurrent posts must share one
// refresh — racing two would burn the grant. Persist before resolving.
/** @type {Promise<string> | null} */
let refreshing = null;

async function freshAccessToken() {
  if (!grant?.refreshToken) {
    const err = new Error("Not connected to X");
    err.code = "reauth";
    throw err;
  }
  if (Date.now() < grant.expiresAt - 60_000) return grant.accessToken;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const data = await exchangeToken({
          grant_type: "refresh_token",
          refresh_token: grant.refreshToken,
          client_id: CLIENT_ID,
        });
        grant = {
          ...grant,
          accessToken: data.access_token,
          refreshToken: data.refresh_token || grant.refreshToken,
          expiresAt: Date.now() + Number(data.expires_in || 7200) * 1000,
        };
        persistGrant();
        return grant.accessToken;
      } catch (err) {
        // Only a rejected refresh means the grant is dead; a network blip
        // should not delete a working token file.
        if (err?.status === 400 || err?.status === 401) {
          grant = null;
          persistGrant();
          err.code = "reauth";
        }
        throw err;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

const URL_IN_TEXT_RE = /https?:\/\/|www\.[^\s]|[a-z0-9-]+\.(?:com|net|org|io|ai|dev|co|x)\/[^\s]/i;

/** Posts with a URL cost ~13× more and surprise-link a live demo. Never. */
function stripUrlsAndMentions(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/(^|\s)@(\w)/g, "$1$2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** @type {Map<string, { at: number, job: Promise<{ ok: boolean, id: string, url: string }> }>} */
const postJobs = new Map();
const POST_JOB_TTL_MS = 10 * 60_000;

/** @type {Map<string, { at: number, mediaId: string }>} */
const mediaCache = new Map();
// X media ids are valid for a while after upload (expires_after_secs); a
// tweet-step retry should not pay for a second upload.
const MEDIA_CACHE_TTL_MS = 20 * 60_000;

function pruneMap(map, ttl) {
  const cutoff = Date.now() - ttl;
  for (const [key, entry] of map) {
    if (entry.at < cutoff) map.delete(key);
  }
}

async function uploadMedia(token, imageDataUrl) {
  const key = crypto.createHash("sha256").update(imageDataUrl).digest("hex");
  pruneMap(mediaCache, MEDIA_CACHE_TTL_MS);
  const cached = mediaCache.get(key);
  if (cached) return cached.mediaId;

  const base64 = imageDataUrl.slice(imageDataUrl.indexOf(",") + 1);
  let r = await fetch(`${API_BASE}/media/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ media: base64, media_category: "tweet_image" }),
  });
  if (r.status === 400 || r.status === 415) {
    // Some deployments only take multipart; Node 18+ FormData covers it.
    const mime = imageDataUrl.slice(5, imageDataUrl.indexOf(";"));
    const form = new FormData();
    form.append(
      "media",
      new Blob([Buffer.from(base64, "base64")], { type: mime }),
      "collage.jpg",
    );
    form.append("media_category", "tweet_image");
    r = await fetch(`${API_BASE}/media/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(
      data.error?.message ||
        data.errors?.[0]?.message ||
        data.detail ||
        "Media upload failed",
    );
    err.status = r.status;
    err.code = "media_rejected";
    throw err;
  }
  const mediaId = String(data.data?.id || data.media_id_string || "");
  if (!mediaId) {
    const err = new Error("Media upload returned no id");
    err.code = "media_rejected";
    throw err;
  }
  mediaCache.set(key, { at: Date.now(), mediaId });
  return mediaId;
}

async function createPost(token, text, mediaId) {
  const r = await fetch(`${API_BASE}/tweets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail =
      data.detail || data.errors?.[0]?.message || data.title || "Post failed";
    const err = new Error(detail);
    err.status = r.status;
    if (r.status === 403 && /duplicate/i.test(String(detail))) {
      err.code = "duplicate";
    }
    if (r.status === 429) {
      err.code = "rate_limited";
      err.retryAfter = Number(r.headers.get("x-rate-limit-reset")) || null;
    }
    throw err;
  }
  const id = String(data.data?.id || "");
  if (!id) throw new Error("Post created without an id");
  return id;
}

function sendPostError(res, err) {
  const message = err instanceof Error ? err.message : "Post failed";
  if (err?.code === "reauth") {
    return res.status(401).json({
      error: "X login expired — open /api/x/auth/login to reconnect.",
      code: "reauth",
    });
  }
  if (err?.code === "duplicate") {
    return res.status(409).json({ error: message, code: "duplicate" });
  }
  if (err?.code === "rate_limited") {
    return res.status(429).json({
      error: message,
      code: "rate_limited",
      retryAfter: err.retryAfter ?? null,
    });
  }
  if (err?.code === "media_rejected") {
    return res.status(422).json({ error: message, code: "media_rejected" });
  }
  res.status(502).json({ error: message });
}

/**
 * @param {import('express').Express} app
 * @param {{ xaiApiKey: string }} options
 */
export function mountXRoutes(app, { xaiApiKey }) {
  app.get("/api/x/auth/status", (_req, res) => {
    res.json(xAuthState());
  });

  app.get("/api/x/auth/login", (_req, res) => {
    if (!xConfigured()) {
      return res
        .status(503)
        .send("X posting is not configured (set X_CLIENT_ID/X_CLIENT_SECRET).");
    }
    prunePendingLogins();
    const state = crypto.randomBytes(16).toString("hex");
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
    pendingLogins.set(state, { verifier, at: Date.now() });
    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    res.redirect(`${AUTHORIZE_URL}?${params}`);
  });

  app.get("/api/x/auth/callback", async (req, res) => {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const pending = pendingLogins.get(state);
    pendingLogins.delete(state);
    if (!code || !pending) {
      return res.status(400).send("X login expired — try again.");
    }
    try {
      const data = await exchangeToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: pending.verifier,
      });
      const me = await fetch(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      const meData = await me.json().catch(() => ({}));
      grant = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || "",
        expiresAt: Date.now() + Number(data.expires_in || 7200) * 1000,
        username: String(meData.data?.username || ""),
        userId: String(meData.data?.id || ""),
      };
      persistGrant();
      res.redirect("/?x=connected");
    } catch (err) {
      console.error("[x] callback", err);
      res.status(500).send("X login failed");
    }
  });

  // Generic posting plumbing — "Clip it" reuses this unchanged.
  app.post("/api/x/post", async (req, res) => {
    const imageDataUrl = String(req.body?.imageDataUrl || "");
    const text = String(req.body?.text || "").trim();
    const clientToken = String(req.body?.clientToken || "").slice(0, 64);

    if (!/^data:image\/(jpeg|png);base64,/.test(imageDataUrl)) {
      return res.status(400).json({ error: "imageDataUrl must be a JPEG/PNG data URL" });
    }
    const bytes = Math.floor((imageDataUrl.length * 3) / 4);
    if (bytes > 4 * 1024 * 1024) {
      return res.status(400).json({ error: "Image too large (4MB max)" });
    }
    if (!text || text.length > 280) {
      return res.status(400).json({ error: "text required, 280 chars max" });
    }
    if (URL_IN_TEXT_RE.test(text)) {
      return res.status(400).json({ error: "Links are not allowed in posts" });
    }

    // Replays of the same clientToken (tap + voice double-fire, client retry
    // after a network drop) return the original result without re-posting.
    pruneMap(postJobs, POST_JOB_TTL_MS);
    const existing = clientToken ? postJobs.get(clientToken) : null;
    if (existing) {
      try {
        return res.json(await existing.job);
      } catch {
        postJobs.delete(clientToken);
      }
    }

    const job = (async () => {
      const token = await freshAccessToken();
      const mediaId = await uploadMedia(token, imageDataUrl);
      const id = await createPost(token, text, mediaId);
      const username = grant?.username || "i";
      return { ok: true, id, url: `https://x.com/${username}/status/${id}` };
    })();
    if (clientToken) postJobs.set(clientToken, { at: Date.now(), job });

    try {
      res.json(await job);
    } catch (err) {
      if (clientToken) postJobs.delete(clientToken);
      console.error("[x] post", err);
      sendPostError(res, err);
    }
  });

  // Cleanup path for the preflight smoke test.
  app.delete("/api/x/post/:id", async (req, res) => {
    try {
      const token = await freshAccessToken();
      const r = await fetch(`${API_BASE}/tweets/${encodeURIComponent(req.params.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: data.detail || "Delete failed" });
      }
      res.json({ ok: true, deleted: Boolean(data.data?.deleted) });
    } catch (err) {
      sendPostError(res, err);
    }
  });

  // Caption for an unverified-action escalation. Text-only and decoupled from
  // the audit so a slow caption can never block the approval card.
  app.post("/api/x/caption", async (req, res) => {
    try {
      const question = String(req.body?.question || "").trim().slice(0, 300);
      const instructionText = String(req.body?.instructionText || "").trim().slice(0, 400);
      const videoTitle = String(req.body?.videoTitle || "").trim().slice(0, 120);
      const mediaTime = Number(req.body?.mediaTime);
      if (!question) return res.status(400).json({ error: "question required" });

      const minutes = Number.isFinite(mediaTime)
        ? `${Math.floor(mediaTime / 60)}:${String(Math.floor(mediaTime % 60)).padStart(2, "0")}`
        : null;

      const system = [
        "You write a single short post for X asking the community to sanity-check a moment Grok could not verify from video frames.",
        "The attached collage (you cannot see it) shows before/during/after frames of the action.",
        "Be honest: Grok could not confirm the result from what it saw — never claim it looks right or wrong.",
        "At most 240 characters. End with the concrete question, then the hashtag #Grokathon.",
        "Wit only when it is free. Absolutely no links, no URLs, no @mentions, no emoji spam (one emoji max).",
        'Return JSON only: {"caption":"..."}',
      ].join(" ");

      const context = [
        videoTitle ? `Task video: ${videoTitle}.` : "",
        minutes ? `Moment: ${minutes}.` : "",
        `The user asked: "${question}"`,
        instructionText ? `Grok's instruction was: "${instructionText}"` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const model = "grok-4.5";
      const response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${xaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0.6,
          messages: [
            { role: "system", content: system },
            { role: "user", content: context },
          ],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        console.error("[x] caption", data);
        return res.status(response.status).json({
          error: data?.error?.message || "Caption request failed",
        });
      }
      const raw = data?.choices?.[0]?.message?.content?.trim() || "";
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = (fenced ? fenced[1] : raw).trim();
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      let caption = "";
      if (start !== -1 && end !== -1) {
        try {
          caption = String(JSON.parse(candidate.slice(start, end + 1)).caption || "");
        } catch {
          caption = "";
        }
      }
      caption = stripUrlsAndMentions(caption).slice(0, 270);
      if (!caption) {
        return res.status(502).json({ error: "unusable_caption" });
      }
      res.json({ caption, model });
    } catch (err) {
      console.error("[x] caption", err);
      res.status(500).json({ error: "Caption failed" });
    }
  });
}
