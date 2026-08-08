const API_KEY = process.env.TWITTER_API_KEY || "";
const API_SECRET = process.env.TWITTER_API_SECRET || "";
const BEARER = process.env.TWITTER_BEARER_TOKEN || "";

export function twitterConfigured() {
  return Boolean(BEARER || (API_KEY && API_SECRET));
}

/** Keep bearer as provided — Twitter tokens often include %2B/%3D encoding. */
function bearerFromEnv() {
  return BEARER.trim();
}

let cachedToken = bearerFromEnv();

async function ensureBearer() {
  if (cachedToken) return cachedToken;
  if (!API_KEY || !API_SECRET) {
    throw new Error("Missing TWITTER_BEARER_TOKEN (or API key/secret)");
  }
  const basic = Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");
  const r = await fetch("https://api.twitter.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: "grant_type=client_credentials",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Twitter auth failed");
  }
  cachedToken = String(data.access_token);
  return cachedToken;
}

async function twitterGet(path, params = {}) {
  const token = await ensureBearer();
  const url = new URL(`https://api.twitter.com/2${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      data.detail ||
      data.title ||
      data.errors?.[0]?.message ||
      data.error ||
      `Twitter API ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.details = data;
    throw err;
  }
  return data;
}

function bestVideoUrl(media) {
  const variants = (media?.variants || []).filter(
    (v) => v.content_type === "video/mp4" && v.url,
  );
  if (!variants.length) {
    const hls = (media?.variants || []).find((v) =>
      String(v.content_type || "").includes("mpegURL"),
    );
    return hls?.url || null;
  }
  variants.sort((a, b) => Number(b.bit_rate || 0) - Number(a.bit_rate || 0));
  // Prefer ~720p-ish over huge 4K for in-widget playback.
  const mid = variants.find((v) => Number(v.bit_rate || 0) <= 2_500_000);
  return (mid || variants[variants.length - 1]).url;
}

function normalizeTweets(payload) {
  const users = Object.fromEntries(
    ((payload.includes || {}).users || []).map((u) => [u.id, u]),
  );
  const media = Object.fromEntries(
    ((payload.includes || {}).media || []).map((m) => [m.media_key, m]),
  );

  return (payload.data || []).map((t) => {
    const author = users[t.author_id] || null;
    const keys = t.attachments?.media_keys || [];
    const mediaItems = keys
      .map((k) => media[k])
      .filter(Boolean)
      .map((m) => ({
        key: m.media_key,
        type: m.type,
        url: m.url || null,
        preview: m.preview_image_url || m.url || null,
        videoUrl: m.type === "video" || m.type === "animated_gif" ? bestVideoUrl(m) : null,
        width: m.width || null,
        height: m.height || null,
        durationMs: m.duration_ms || null,
      }));
    const video = mediaItems.find((m) => m.videoUrl) || null;
    return {
      id: t.id,
      text: t.text || "",
      createdAt: t.created_at || null,
      url: author
        ? `https://x.com/${author.username}/status/${t.id}`
        : `https://x.com/i/web/status/${t.id}`,
      author: author
        ? {
            id: author.id,
            name: author.name,
            username: author.username,
            avatar: (author.profile_image_url || "").replace("_normal", "_bigger"),
          }
        : null,
      media: mediaItems,
      video,
    };
  });
}

const TWEET_FIELDS = "created_at,text,attachments,author_id,public_metrics";
const USER_FIELDS = "name,username,profile_image_url,description,public_metrics";
const MEDIA_FIELDS =
  "type,url,preview_image_url,variants,duration_ms,height,width,alt_text";

/** @param {import('express').Express} app */
export function mountTwitterRoutes(app) {
  app.get("/api/twitter/status", (_req, res) => {
    res.json({ configured: twitterConfigured() });
  });

  app.get("/api/twitter/user", async (req, res) => {
    try {
      if (!twitterConfigured()) {
        return res.status(503).json({ error: "Twitter is not configured" });
      }
      const username = String(req.query.username || "")
        .replace(/^@/, "")
        .trim();
      if (!username) return res.status(400).json({ error: "username required" });
      const data = await twitterGet(`/users/by/username/${encodeURIComponent(username)}`, {
        "user.fields": USER_FIELDS,
      });
      const u = data.data;
      if (!u) return res.status(404).json({ error: `User @${username} not found` });
      res.json({
        ok: true,
        user: {
          id: u.id,
          name: u.name,
          username: u.username,
          avatar: (u.profile_image_url || "").replace("_normal", "_bigger"),
          bio: u.description || "",
          metrics: u.public_metrics || null,
        },
      });
    } catch (err) {
      res.status(err.status || 500).json({
        error: err instanceof Error ? err.message : "User lookup failed",
        details: err.details,
      });
    }
  });

  app.get("/api/twitter/timeline", async (req, res) => {
    try {
      if (!twitterConfigured()) {
        return res.status(503).json({ error: "Twitter is not configured" });
      }
      const username = String(req.query.username || "")
        .replace(/^@/, "")
        .trim();
      if (!username) return res.status(400).json({ error: "username required" });

      const userData = await twitterGet(
        `/users/by/username/${encodeURIComponent(username)}`,
        { "user.fields": USER_FIELDS },
      );
      const user = userData.data;
      if (!user) return res.status(404).json({ error: `User @${username} not found` });

      const params = {
        max_results: String(Math.min(20, Math.max(5, Number(req.query.limit) || 12))),
        exclude: "replies",
        "tweet.fields": TWEET_FIELDS,
        expansions: "attachments.media_keys,author_id",
        "media.fields": MEDIA_FIELDS,
        "user.fields": USER_FIELDS,
      };
      if (req.query.pagination_token) {
        params.pagination_token = String(req.query.pagination_token);
      }

      const timeline = await twitterGet(`/users/${user.id}/tweets`, params);
      // Ensure author is present for normalization.
      if (!timeline.includes) timeline.includes = {};
      if (!timeline.includes.users) timeline.includes.users = [user];
      else if (!timeline.includes.users.some((u) => u.id === user.id)) {
        timeline.includes.users.push(user);
      }

      res.json({
        ok: true,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          avatar: (user.profile_image_url || "").replace("_normal", "_bigger"),
          bio: user.description || "",
        },
        tweets: normalizeTweets(timeline),
        nextToken: timeline.meta?.next_token || null,
      });
    } catch (err) {
      res.status(err.status || 500).json({
        error: err instanceof Error ? err.message : "Timeline failed",
        details: err.details,
      });
    }
  });

  app.get("/api/twitter/search", async (req, res) => {
    try {
      if (!twitterConfigured()) {
        return res.status(503).json({ error: "Twitter is not configured" });
      }
      const q = String(req.query.q || "").trim();
      if (!q) return res.status(400).json({ error: "q required" });

      const data = await twitterGet("/tweets/search/recent", {
        query: q,
        max_results: String(Math.min(20, Math.max(10, Number(req.query.limit) || 10))),
        "tweet.fields": TWEET_FIELDS,
        expansions: "attachments.media_keys,author_id",
        "media.fields": MEDIA_FIELDS,
        "user.fields": USER_FIELDS,
      });
      res.json({
        ok: true,
        query: q,
        tweets: normalizeTweets(data),
        nextToken: data.meta?.next_token || null,
      });
    } catch (err) {
      res.status(err.status || 500).json({
        error: err instanceof Error ? err.message : "Search failed",
        details: err.details,
      });
    }
  });

  /** Latest Starship-related video from SpaceX (or Starship-focused accounts). */
  app.get("/api/twitter/starship", async (req, res) => {
    try {
      if (!twitterConfigured()) {
        return res.status(503).json({ error: "Twitter is not configured" });
      }

      const queries = [
        '(from:SpaceX OR from:SpaceXOfficial OR from:NASASpaceflight) (Starship OR "Flight" OR launch OR webcast OR livestream) (has:videos OR has:media) -is:retweet',
        "Starship (launch OR flight OR livestream OR webcast) has:videos -is:retweet",
      ];

      let tweets = [];
      let lastErr = null;
      for (const query of queries) {
        try {
          const data = await twitterGet("/tweets/search/recent", {
            query,
            max_results: "15",
            "tweet.fields": TWEET_FIELDS,
            expansions: "attachments.media_keys,author_id",
            "media.fields": MEDIA_FIELDS,
            "user.fields": USER_FIELDS,
          });
          tweets = normalizeTweets(data);
          if (tweets.some((t) => t.video?.videoUrl)) break;
        } catch (err) {
          lastErr = err;
        }
      }

      const withVideo = tweets.find((t) => t.video?.videoUrl);
      if (!withVideo) {
        return res.status(404).json({
          error:
            lastErr?.message ||
            "No recent Starship video found in the last ~7 days (Twitter recent search window)",
          tweets,
        });
      }

      res.json({ ok: true, tweet: withVideo, tweets });
    } catch (err) {
      res.status(err.status || 500).json({
        error: err instanceof Error ? err.message : "Starship search failed",
        details: err.details,
      });
    }
  });
}
