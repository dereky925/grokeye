/** SpaceX official YouTube channel */
const SPACEX_CHANNEL_ID = "UCtI0Hodo5o5dUb67FeUjDeA";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";

export function youtubeConfigured() {
  return Boolean(YOUTUBE_API_KEY);
}

function flightNumber(title = "") {
  const t = String(title).toLowerCase();
  const digit = t.match(/\bflight\s*(?:test\s*)?#?\s*(\d+)\b/) || t.match(/\b(\d+)(?:th|st|nd|rd)\s+flight\b/);
  if (digit) return Number(digit[1]);
  const words = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12,
    thirteenth: 13,
    fourteenth: 14,
    fifteenth: 15,
  };
  for (const [word, n] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`).test(t) && /\bflight\b/.test(t)) return n;
  }
  return 0;
}

function scoreStarshipTitle(title = "", description = "") {
  const titleL = String(title).toLowerCase();
  const descL = String(description).toLowerCase().slice(0, 400);
  const text = `${titleL} ${descL}`;

  // Must be a Starship video — ignore Crew/Polaris/Starlink etc.
  if (!/\bstarship\b/.test(titleL)) return -1;

  let score = 10; // base for Starship-in-title

  if (/\b(webcast|full\s+launch|official\s+livestream|live\s+broadcast)\b/.test(titleL))
    score += 28;
  else if (/\b(webcast|livestream|live\s+stream)\b/.test(text)) score += 16;

  if (/\b(flight\s*\d+|ifft\s*\d+)\b/.test(titleL)) score += 18;
  else if (/\b(flight\s*\d+|ifft\s*\d+)\b/.test(text)) score += 8;

  if (/\b(launch|liftoff|lift[\s-]?off)\b/.test(titleL)) score += 12;
  if (/\b(full\s+)?(flight\s+test|integrated\s+flight)\b/.test(titleL)) score += 10;
  if (/\breplay\b/.test(titleL)) score += 6;

  // Negatives in title
  if (
    /\b(landing|splashdown|recovery|raptor|engine test|static fire|construction|factory|critical path|test like you fly|highlights?|shorts?|timelapse|time[\s-]?lapse)\b/.test(
      titleL,
    )
  ) {
    score -= 24;
  }
  return score;
}

function toVideo(item, score) {
  const id =
    item.id?.videoId ||
    item.snippet?.resourceId?.videoId ||
    item.videoId ||
    null;
  if (!id) return null;
  const title = decodeXml(item.snippet?.title || item.title || "SpaceX video");
  const description = decodeXml(item.snippet?.description || item.description || "");
  const publishedAt =
    item.snippet?.publishedAt || item.publishedAt || item.updated || null;
  const thumb =
    item.snippet?.thumbnails?.high?.url ||
    item.snippet?.thumbnails?.medium?.url ||
    item.thumbnail ||
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  return {
    id,
    title,
    description,
    publishedAt,
    thumbnail: thumb,
    url: `https://www.youtube.com/watch?v=${id}`,
    embedUrl: `https://www.youtube.com/embed/${id}?autoplay=1`,
    channelTitle: item.snippet?.channelTitle || "SpaceX",
    score,
  };
}

/** YouTube Data API v3 — best when YOUTUBE_API_KEY is set. */
async function searchViaDataApi(maxResults = 15) {
  if (!YOUTUBE_API_KEY) return [];

  const queries = [
    "Starship Flight webcast",
    "Starship launch webcast",
    "Starship Flight official livestream",
  ];

  /** @type {any[]} */
  const all = [];
  for (const q of queries) {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("channelId", SPACEX_CHANNEL_ID);
    url.searchParams.set("q", q);
    url.searchParams.set("type", "video");
    url.searchParams.set("order", "date");
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("key", YOUTUBE_API_KEY);

    const r = await fetch(url);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg =
        data.error?.message || data.error?.errors?.[0]?.message || `YouTube API ${r.status}`;
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    for (const item of data.items || []) {
      const score = scoreStarshipTitle(
        item.snippet?.title,
        item.snippet?.description,
      );
      const video = toVideo(item, score);
      if (video) all.push(video);
    }
  }
  return all;
}

/**
 * Public channel Atom feed — no API key.
 * https://www.youtube.com/feeds/videos.xml?channel_id=…
 */
async function searchViaRss() {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${SPACEX_CHANNEL_ID}`;
  const r = await fetch(url, {
    headers: { Accept: "application/atom+xml,application/xml,text/xml" },
  });
  if (!r.ok) throw new Error(`YouTube feed failed (${r.status})`);
  const xml = await r.text();

  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  return entries
    .map((entry) => {
      const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
      const title = decodeXml(
        entry.match(/<title>([^<]*)<\/title>/)?.[1] || "SpaceX video",
      );
      const publishedAt = entry.match(/<published>([^<]+)<\/published>/)?.[1] || null;
      const description = decodeXml(
        entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ||
          "",
      );
      const thumbnail =
        entry.match(/<media:thumbnail[^>]*url="([^"]+)"/)?.[1] ||
        (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);
      if (!videoId) return null;
      const score = scoreStarshipTitle(title, description);
      return toVideo(
        {
          videoId,
          title,
          description,
          publishedAt,
          thumbnail,
          snippet: { title, description, publishedAt, channelTitle: "SpaceX" },
        },
        score,
      );
    })
    .filter(Boolean);
}

function decodeXml(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

export async function findStarshipWebcast() {
  /** @type {any[]} */
  let videos = [];
  let source = "rss";
  let lastErr = null;

  if (YOUTUBE_API_KEY) {
    try {
      videos = await searchViaDataApi(12);
      source = "youtube-data-api";
    } catch (err) {
      lastErr = err;
    }
  }

  if (!videos.length) {
    try {
      videos = await searchViaRss();
      source = YOUTUBE_API_KEY ? "rss-fallback" : "rss";
    } catch (err) {
      if (!lastErr) lastErr = err;
      else throw lastErr;
    }
  }

  const byId = new Map();
  for (const v of videos) {
    if (!byId.has(v.id) || byId.get(v.id).score < v.score) byId.set(v.id, v);
  }

  const ranked = [...byId.values()]
    .filter((v) => v.score >= 18)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const fb = flightNumber(b.title);
      const fa = flightNumber(a.title);
      if (fb !== fa) return fb - fa;
      return String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""));
    });

  const best = ranked[0] || null;
  if (!best) {
    const err = new Error(
      lastErr?.message ||
        "No Starship launch webcast found on the official SpaceX YouTube channel recently",
    );
    err.status = 404;
    throw err;
  }

  return { video: best, videos: ranked, source };
}

/** @param {import('express').Express} app */
export function mountYoutubeRoutes(app) {
  app.get("/api/youtube/status", (_req, res) => {
    res.json({
      configured: true, // RSS always works; API key unlocks better search
      hasApiKey: youtubeConfigured(),
      channelId: SPACEX_CHANNEL_ID,
    });
  });

  app.get("/api/youtube/starship", async (_req, res) => {
    try {
      const result = await findStarshipWebcast();
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(err.status || 500).json({
        error: err instanceof Error ? err.message : "YouTube search failed",
      });
    }
  });
}
