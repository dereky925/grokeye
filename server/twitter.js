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
    const externalUrls = ((t.entities || {}).urls || [])
      .map((u) => u.expanded_url || u.url)
      .filter(Boolean);
    let youtubeId = null;
    let streamUrl = null;
    for (const u of externalUrls) {
      const id = youtubeIdFromUrl(u);
      if (id) {
        youtubeId = id;
        streamUrl = `https://www.youtube.com/embed/${id}?autoplay=1`;
        break;
      }
      if (/spacex\.com|x\.com\/i\/broadcasts|twitter\.com\/i\/broadcasts/i.test(String(u))) {
        streamUrl = String(u);
      }
    }
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
      externalUrls,
      youtubeId,
      streamUrl,
    };
  });
}

function youtubeIdFromUrl(raw) {
  try {
    const url = new URL(String(raw));
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      return url.pathname.replace(/^\//, "").split("/")[0] || null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "live" || parts[0] === "embed" || parts[0] === "shorts") {
        return parts[1] || null;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

const TWEET_FIELDS =
  "created_at,text,attachments,author_id,public_metrics,entities";
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

  /** Official @SpaceX Starship launch webcast (YouTube link or native video). */
  app.get("/api/twitter/starship", async (req, res) => {
    try {
      if (!twitterConfigured()) {
        return res.status(503).json({ error: "Twitter is not configured" });
      }

      function isSpaceX(tweet) {
        return (tweet.author?.username || "").toLowerCase() === "spacex";
      }

      function hasPlayable(tweet) {
        return Boolean(tweet?.video?.videoUrl || tweet?.youtubeId || tweet?.streamUrl);
      }

      function scoreWebcast(tweet) {
        if (!isSpaceX(tweet) || !hasPlayable(tweet)) return -Infinity;
        const text = String(tweet.text || "").toLowerCase();
        let score = 0;

        // Official webcast / stream posts win
        if (/\b(webcast|live\s*stream|livestream)\b/.test(text)) score += 30;
        if (tweet.youtubeId && /\b(webcast|starship|flight|launch|watch)\b/.test(text))
          score += 28;
        if (/\b(watch\s+(live|now|here)|tune\s*in|happening\s+now)\b/.test(text))
          score += 18;
        if (/\bwatch\b/.test(text) && /\b(starship|flight|launch)\b/.test(text))
          score += 12;

        // Launch-day official clips (e.g. “Liftoff!”)
        if (/^\s*liftoff[!,. ]*$/i.test(String(tweet.text || "").trim()) || /\bliftoff\b/.test(text))
          score += 22;
        if (/\b(launch|lift[\s-]?off|ascent)\b/.test(text)) score += 10;
        if (/\b(flight\s*\d+|ifft\s*\d+)\b/.test(text)) score += 10;
        if (/\bstarship\b/.test(text)) score += 8;

        if (tweet.youtubeId) score += 8;
        if (tweet.video?.videoUrl) score += 4;

        const dur = Number(tweet.video?.durationMs || 0);
        if (dur >= 180_000) score += 10;
        else if (dur >= 60_000) score += 5;

        // Hard negatives — not the launch webcast
        if (
          /\b(landing|splashdown|recover|recovery|ocean|debris|earnings|financial|quarter|revenue|starlink|crew-\d+|terafab|starmind|moonlight)\b/.test(
            text,
          )
        ) {
          score -= 30;
        }
        return score;
      }

      const queries = [
        // Webcast posts may link YouTube without attaching video
        'from:SpaceX (webcast OR livestream OR "live stream" OR "watch live") (Starship OR Flight OR launch) -is:retweet',
        'from:SpaceX (Starship) (webcast OR livestream OR "watch live" OR watch OR Flight OR launch OR Liftoff) -is:retweet',
        "from:SpaceX (Liftoff OR Starship) has:videos -is:retweet",
      ];

      /** @type {any[]} */
      let tweets = [];
      let lastErr = null;

      for (const query of queries) {
        try {
          const data = await twitterGet("/tweets/search/recent", {
            query,
            max_results: "20",
            "tweet.fields": TWEET_FIELDS,
            expansions: "attachments.media_keys,author_id",
            "media.fields": MEDIA_FIELDS,
            "user.fields": USER_FIELDS,
          });
          const batch = normalizeTweets(data).filter(
            (t) => isSpaceX(t) && hasPlayable(t),
          );
          tweets = tweets.concat(batch);
          if (batch.some((t) => scoreWebcast(t) >= 25)) break;
        } catch (err) {
          lastErr = err;
        }
      }

      // Timeline catch-all for SpaceX Liftoff / Flight posts
      if (!tweets.some((t) => scoreWebcast(t) >= 20)) {
        try {
          const userData = await twitterGet("/users/by/username/SpaceX", {
            "user.fields": USER_FIELDS,
          });
          const user = userData.data;
          if (user?.id) {
            const timeline = await twitterGet(`/users/${user.id}/tweets`, {
              max_results: "50",
              exclude: "replies,retweets",
              "tweet.fields": TWEET_FIELDS,
              expansions: "attachments.media_keys,author_id",
              "media.fields": MEDIA_FIELDS,
              "user.fields": USER_FIELDS,
            });
            if (!timeline.includes) timeline.includes = {};
            if (!timeline.includes.users) timeline.includes.users = [user];
            tweets = tweets.concat(
              normalizeTweets(timeline).filter((t) => hasPlayable(t)),
            );
          }
        } catch (err) {
          lastErr = err;
        }
      }

      const byId = new Map();
      for (const t of tweets) {
        if (!byId.has(t.id)) byId.set(t.id, t);
      }
      const ranked = [...byId.values()]
        .map((t) => ({ t, score: scoreWebcast(t) }))
        .filter((x) => x.score >= 15)
        .sort(
          (a, b) =>
            b.score - a.score ||
            String(b.t.createdAt || "").localeCompare(String(a.t.createdAt || "")),
        );

      const best = ranked[0]?.t;
      if (!best) {
        return res.status(404).json({
          error:
            lastErr?.message ||
            "No official @SpaceX Starship webcast/launch video found recently. SpaceX may only have highlight clips posted right now.",
          tweets: [...byId.values()].slice(0, 8),
        });
      }

      res.json({
        ok: true,
        tweet: best,
        score: ranked[0].score,
        tweets: ranked.map((x) => x.t),
      });
    } catch (err) {
      res.status(err.status || 500).json({
        error: err instanceof Error ? err.message : "Starship search failed",
        details: err.details,
      });
    }
  });
}
