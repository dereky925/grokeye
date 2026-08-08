import "dotenv/config";
import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { mountSpotifyRoutes, spotifyConfigured } from "./spotify.js";
import { mountTwitterRoutes, twitterConfigured } from "./twitter.js";
import { mountYoutubeRoutes, youtubeConfigured } from "./youtube.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 8787);
const apiKey = process.env.XAI_API_KEY;
const autoDetect = process.env.AUTO_DETECT !== "0";

if (!apiKey) {
  console.error("Missing XAI_API_KEY in .env");
  process.exit(1);
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "12mb" }));
mountSpotifyRoutes(app);
mountTwitterRoutes(app);
mountYoutubeRoutes(app);

const manifestPath = path.join(root, "public", "videos", "manifest.json");
const detectBase = process.env.DETECT_URL || "http://127.0.0.1:8790";
let detectChild = null;
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function runLocalDetect({ image, pack, query }) {
  if (!(await detectorHealthy())) {
    await ensureDetector();
  }
  const response = await fetch(`${detectBase}/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image,
      pack: pack || "sushi",
      query: query || "",
      max_detections: 2,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.detail || data?.error || "Detector request failed");
  }
  return data;
}

app.get("/api/health", async (_req, res) => {
  let detector = { ok: false };
  try {
    const r = await fetch(`${detectBase}/health`);
    detector = await r.json();
  } catch {
    detector = { ok: false, error: "unreachable" };
  }
  res.json({
    ok: true,
    voice: "carina",
    detector,
    spotify: { configured: spotifyConfigured() },
    twitter: { configured: twitterConfigured() },
    youtube: { configured: true, hasApiKey: youtubeConfigured() },
  });
});

app.post("/api/detect", async (req, res) => {
  try {
    const image = String(req.body?.image || "");
    if (!image.startsWith("data:image")) {
      return res.status(400).json({ error: "image data URL required" });
    }
    const data = await runLocalDetect({
      image,
      pack: req.body?.pack || "sushi",
      query: req.body?.query || "",
    });
    res.json(data);
  } catch (err) {
    console.error("Detect proxy error:", err);
    res.status(502).json({
      error: err instanceof Error ? err.message : "Detector unavailable",
    });
  }
});

app.get("/api/videos", (_req, res) => {
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    res.json(JSON.parse(raw));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load video catalog" });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const videoTitle = req.body?.videoTitle
      ? String(req.body.videoTitle)
      : null;
    const videoDescription = req.body?.videoDescription
      ? String(req.body.videoDescription)
      : null;
    const currentTime = Number(req.body?.currentTime);
    const duration = Number(req.body?.duration);
    const wantLabels = Boolean(req.body?.wantLabels);
    const detectorPack = req.body?.detectorPack
      ? String(req.body.detectorPack)
      : "sushi";
    const frames = Array.isArray(req.body?.frames)
      ? req.body.frames.filter((f) => typeof f === "string" && f.startsWith("data:image"))
      : [];
    const precomputed = Array.isArray(req.body?.detections)
      ? req.body.detections
      : null;

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const timeLabel = formatTime(currentTime);
    const durationLabel = formatTime(duration);

    const hasFrames = frames.length > 0;
    const labelMode = Boolean(wantLabels && hasFrames) || Boolean(precomputed?.length);

    // Prefer client-precomputed boxes (painted already). Else run local detect.
    let labels = [];
    let detectorMeta = null;
    if (precomputed?.length) {
      labels = precomputed
        .map((l) => ({
          text: String(l.text || "").trim().slice(0, 40),
          x: Number(l.x),
          y: Number(l.y),
          w: Number(l.w),
          h: Number(l.h),
          score: Number(l.score) || undefined,
        }))
        .filter((l) => l.text && [l.x, l.y, l.w, l.h].every(Number.isFinite));
      detectorMeta = { source: "client", count: labels.length };
    } else if (wantLabels && hasFrames) {
      try {
        const detected = await runLocalDetect({
          image: frames[frames.length - 1],
          pack: detectorPack,
          query: message,
        });
        labels = Array.isArray(detected.labels) ? detected.labels : [];
        detectorMeta = {
          pack: detected.pack,
          model: detected.model,
          classes: detected.classes,
          count: detected.count,
          source: "server",
        };
        console.log(
          `[detect] pack=${detectorPack} hits=${labels.length}`,
          labels.map((l) => `${l.text}:${l.score}`).join(", ") || "(none)",
        );
      } catch (err) {
        console.warn("[detect] failed, falling back to Grok boxes:", err);
      }
    }

    const usedLocalBoxes = labels.length > 0;

    const system = [
      "You are Grok, built by xAI. Speak in short, clear spoken answers.",
      "The user is watching a video in GrokEye and talking through a voice overlay.",
      hasFrames
        ? "The user asked something about the video/screen. Frame(s) and playback timing are attached — ground your answer in what is visible. If something isn't visible, say so briefly."
        : "No video frame is attached for this turn. Answer from general knowledge and the video title/description if useful. Do not pretend you can see the screen unless frames are provided.",
      labelMode && usedLocalBoxes
        ? [
            "A local open-vocab detector already found object boxes for this frame.",
            "Treat those detections as authoritative for where things are.",
            "Respond with ONLY a short spoken reply (plain text, no JSON, no coordinates).",
            "Mention the main detected object naturally if it matches the question.",
          ].join(" ")
        : labelMode
          ? [
              "Also return visual callouts for the most relevant object(s) in the frame.",
              "Respond with ONLY valid JSON (no markdown) matching:",
              '{"reply":"spoken answer under 3 sentences","labels":[{"text":"short label","x":0,"y":0,"w":0,"h":0}]}',
              "Box fields are normalized 0–1 with origin at the top-left of the image (x,y = top-left of the box; w,h = size).",
              "Use at most 2 labels. Tight boxes around the referenced subject(s). Empty labels array if nothing clear to highlight.",
              "reply is what will be spoken aloud — keep it natural and do not mention coordinates.",
            ].join(" ")
          : "Keep replies under about 3 sentences unless asked for more detail.",
      "Be helpful, a bit witty, and direct.",
      videoTitle ? `Video title: ${videoTitle}.` : "",
      videoDescription ? `Video description: ${videoDescription}.` : "",
      hasFrames && Number.isFinite(currentTime)
        ? `Playback position: ${timeLabel}${Number.isFinite(duration) ? ` of ${durationLabel}` : ""}.`
        : "",
      usedLocalBoxes
        ? `Local detector results (normalized boxes): ${JSON.stringify(labels)}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    const userContent = hasFrames
      ? [
          {
            type: "text",
            text: labelMode
              ? usedLocalBoxes
                ? `Viewer question: ${message}\nReply in spoken prose using the detector results.`
                : `Viewer question: ${message}\nReturn JSON with reply + labels for the attached frame(s).`
              : `Viewer question: ${message}\nAttached: ${frames.length} frame(s) from the current playback position.`,
          },
          ...frames.slice(-3).map((url) => ({
            type: "image_url",
            image_url: { url, detail: labelMode ? "low" : "high" },
          })),
        ]
      : [{ type: "text", text: message }];

    const model = "grok-4.5";

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: labelMode ? 0.2 : 0.5,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Chat error:", data);
      return res.status(response.status).json({
        error: data?.error?.message || "Chat request failed",
      });
    }

    const raw =
      data?.choices?.[0]?.message?.content?.trim() ||
      "I didn't catch that.";

    let reply = raw;

    if (labelMode && !usedLocalBoxes) {
      try {
        const parsed = parseManualJson(raw);
        reply = String(parsed.reply || parsed.answer || "").trim() || raw;
        labels = Array.isArray(parsed.labels) ? parsed.labels : [];
      } catch {
        reply = raw.replace(/```[\s\S]*?```/g, "").trim() || raw;
        labels = [];
      }
    } else if (labelMode && usedLocalBoxes) {
      // Detector owns geometry; strip accidental JSON wrappers from reply.
      try {
        const parsed = parseManualJson(raw);
        if (parsed.reply) reply = String(parsed.reply).trim();
      } catch {
        reply = raw.replace(/```[\s\S]*?```/g, "").trim() || raw;
      }
    }

    res.json({
      reply,
      labels,
      model,
      frameCount: frames.length,
      detector: detectorMeta,
      labelSource: usedLocalBoxes ? "yolo-world" : labelMode ? "grok" : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Chat failed" });
  }
});

app.post("/api/tts", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }

    const response = await fetch("https://api.x.ai/v1/tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_id: "carina",
        language: "en",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("TTS error:", errText);
      return res.status(response.status).json({
        error: "TTS request failed",
        detail: errText,
      });
    }

    const contentType = response.headers.get("content-type") || "audio/mpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "TTS failed" });
  }
});

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const chunks = [];
  for (const item of data?.output || []) {
    if (item?.type === "message") {
      for (const part of item.content || []) {
        if (part?.type === "output_text" && part.text) chunks.push(part.text);
        if (part?.type === "text" && part.text) chunks.push(part.text);
      }
    }
  }
  if (chunks.length) return chunks.join("\n").trim();
  return data?.choices?.[0]?.message?.content?.trim() || "";
}

function parseManualJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model output");
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizeManual(parsed, fallbackTopic) {
  const stepsIn = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps = stepsIn
    .map((s, i) => ({
      n: Number(s.n) || i + 1,
      text: String(s.text || s.instruction || "").trim(),
    }))
    .filter((s) => s.text)
    .slice(0, 12);

  if (steps.length < 3) {
    throw new Error("Manual needs at least 3 steps");
  }

  const source = parsed.source || {};
  const url = String(source.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Manual source URL missing");
  }

  let siteName = String(source.siteName || "").trim();
  if (!siteName) {
    try {
      siteName = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      siteName = "Source";
    }
  }

  return {
    title: String(parsed.title || `${fallbackTopic} Manual`).trim(),
    topic: String(parsed.topic || fallbackTopic).trim(),
    source: {
      title: String(source.title || siteName).trim(),
      url,
      siteName,
    },
    steps: steps.map((s, i) => ({ n: i + 1, text: s.text })),
  };
}

/** In-memory cache so the second "open sushi manual" is instant. */
const manualCache = new Map();
const manualInflight = new Map();

app.post("/api/manual", async (req, res) => {
  try {
    const videoTitle = String(req.body?.videoTitle || "").trim();
    const videoDescription = String(req.body?.videoDescription || "").trim();
    const topic = String(req.body?.topic || videoTitle || "sushi").trim();
    const cacheKey = topic.toLowerCase().replace(/\s+/g, " ");

    if (manualCache.has(cacheKey)) {
      return res.json({ manual: manualCache.get(cacheKey), cached: true });
    }

    // Reuse in-flight request so double-opens don't double-pay latency
    if (manualInflight.has(cacheKey)) {
      const manual = await manualInflight.get(cacheKey);
      return res.json({ manual, cached: true });
    }

    const prompt = [
      `Create a concise step-by-step how-to manual for: ${topic}.`,
      videoTitle ? `The viewer is watching a video titled "${videoTitle}".` : "",
      videoDescription ? `Video description: ${videoDescription}.` : "",
      "Use web search once to find ONE reputable public how-to guide for THIS exact topic.",
      "Pick the most authoritative source for the subject: for repairs/DIY prefer iFixit, manufacturer service docs, or a well-known enthusiast guide; for cooking prefer Serious Eats, Just One Cookbook, BBC Good Food, or NYT Cooking; otherwise use an official or widely-trusted tutorial.",
      "Return ONLY valid JSON matching this schema:",
      JSON.stringify({
        title: "string",
        topic: "string",
        source: {
          title: "page title",
          url: "https://...",
          siteName: "example.com",
        },
        steps: [{ n: 1, text: "short imperative step" }],
      }),
      "Rules: exactly 6 short imperative steps, one sentence each, no markdown, real https source URL relevant to the topic.",
    ]
      .filter(Boolean)
      .join("\n");

    const job = (async () => {
      const response = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-4.5",
          tools: [{ type: "web_search" }],
          temperature: 0.2,
          input: [
            {
              role: "system",
              content:
                "You research and produce grounded how-to manuals with real citations. Output JSON only. Be fast and concise.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error("Manual error:", data);
        throw new Error(data?.error || data?.message || "Manual generation failed");
      }

      const raw = extractResponseText(data);
      const parsed = parseManualJson(raw);
      const manual = normalizeManual(parsed, topic);
      manualCache.set(cacheKey, manual);
      return manual;
    })();

    manualInflight.set(cacheKey, job);
    try {
      const manual = await job;
      res.json({ manual, cached: false });
    } finally {
      manualInflight.delete(cacheKey);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Manual generation failed",
    });
  }
});

/**
 * Wikimedia now 403s anonymous hotlinks to upload.wikimedia.org, but the
 * Special:FilePath endpoint on commons.wikimedia.org serves fine (302 → image).
 * Rewrite any upload.* URL the model returns into that form.
 */
function toDisplayableImageUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "upload.wikimedia.org") return url;
    const parts = u.pathname.split("/").filter(Boolean);
    const thumbIdx = parts.indexOf("thumb");
    const filename = thumbIdx !== -1 ? parts[thumbIdx + 3] : parts[parts.length - 1];
    if (!filename) return url;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=320`;
  } catch {
    return url;
  }
}

const IMG_UA = "GrokEye/1.0 (hackathon demo; +https://x.ai)";

/** Confirm a URL actually serves an image (short timeout, body discarded). */
async function imageWorks(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": IMG_UA, Accept: "image/*" },
    });
    const ct = r.headers.get("content-type") || "";
    const ok = r.ok && ct.startsWith("image/");
    try {
      await r.body?.cancel();
    } catch {
      /* ignore */
    }
    return ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The noun that decides relevance — "transmission jack" -> "jack". Without this
 * check Commons happily returns a power-line photo for "transmission jack".
 */
function keyNoun(query) {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words[words.length - 1] || "";
}

/** Find a reliable, hotlink-safe image for a tool via Wikimedia Commons search. */
async function commonsImageUrl(query, requiredWord = "") {
  try {
    const api = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query,
    )}&srnamespace=6&srlimit=12&format=json`;
    const r = await fetch(api, { headers: { "User-Agent": IMG_UA } });
    const data = await r.json();
    const need = (requiredWord || keyNoun(query)).toLowerCase();

    for (const hit of data?.query?.search || []) {
      const file = String(hit?.title || "")
        .replace(/^File:/, "")
        .trim();
      if (!file || !/\.(png|jpe?g|webp)$/i.test(file)) continue;
      if (need && !file.toLowerCase().includes(need)) continue;
      return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
        file,
      )}?width=320`;
    }
    return "";
  } catch {
    return "";
  }
}

/** Openverse (no API key) as a second image source. */
async function openverseImageUrl(query, requiredWord = "") {
  try {
    const api = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(
      query,
    )}&page_size=8`;
    const r = await fetch(api, { headers: { "User-Agent": IMG_UA } });
    if (!r.ok) return "";
    const data = await r.json();
    const need = (requiredWord || keyNoun(query)).toLowerCase();

    for (const item of data?.results || []) {
      if (typeof item?.url !== "string" || !/^https:\/\//i.test(item.url)) {
        continue;
      }
      const label = `${item?.title || ""} ${item?.url}`.toLowerCase();
      if (need && !label.includes(need)) continue;
      return item.url;
    }
    return "";
  } catch {
    return "";
  }
}

/** "hose clamp pliers" -> "clamp pliers" / "pliers" for broader image search. */
function shortenQuery(name) {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return [words.slice(-2).join(" "), words.slice(-1).join(" ")].filter(Boolean);
}

/**
 * Guarantee each tool has a working image. Tries, in order: the model's URL,
 * Commons search on the full name, Commons on a shortened query, then
 * Openverse. Each candidate is fetch-verified before being accepted.
 */
async function resolveToolImages(tools) {
  await Promise.all(
    tools.map(async (tool) => {
      const [twoWord, oneWord] = shortenQuery(tool.name);

      // Look candidates up concurrently, then accept the first that actually
      // serves an image, in priority order.
      const need = keyNoun(tool.name);

      // Commons nearly always wins, so only pay for Openverse if it doesn't.
      const tiers = [
        [
          tool.imageUrl ? Promise.resolve(tool.imageUrl) : Promise.resolve(""),
          commonsImageUrl(tool.name, need),
          twoWord ? commonsImageUrl(twoWord, need) : Promise.resolve(""),
          oneWord
            ? commonsImageUrl(`${oneWord} tool`, need)
            : Promise.resolve(""),
        ],
        [
          () => openverseImageUrl(tool.name, need),
          () => (oneWord ? openverseImageUrl(`${oneWord} tool`, need) : ""),
        ],
      ];

      for (const tier of tiers) {
        const lookups = tier.map((entry) =>
          typeof entry === "function" ? entry() : entry,
        );
        const candidates = (await Promise.all(lookups)).filter(Boolean);
        const verified = await Promise.all(
          candidates.map((url) => imageWorks(url).then((ok) => (ok ? url : ""))),
        );
        const winner = verified.find(Boolean);
        if (winner) {
          tool.imageUrl = winner;
          return;
        }
      }
      tool.imageUrl = "";
    }),
  );

  console.log(
    "[tools] images:",
    tools.map((t) => `${t.name}=${t.imageUrl ? "ok" : "NONE"}`).join(", "),
  );
  return tools;
}

function normalizeTools(parsed) {
  const listIn = Array.isArray(parsed.tools) ? parsed.tools : [];
  const tools = listIn
    .map((t) => {
      const name = String(t.name || t.tool || "").trim();
      const note = String(t.note || t.why || t.use || "").trim();
      let imageUrl = String(t.imageUrl || t.image || t.url || "").trim();
      // Only keep direct, hotlink-friendly image URLs; else drop to a UI fallback.
      if (!/^https:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(imageUrl)) {
        imageUrl = "";
      } else {
        imageUrl = toDisplayableImageUrl(imageUrl);
      }
      return { name, note, imageUrl };
    })
    .filter((t) => t.name)
    .slice(0, 5);

  if (!tools.length) throw new Error("No tools found");
  return tools;
}

/** Cache tools per (topic + step) so repeats are instant. */
const toolsCache = new Map();
const toolsInflight = new Map();

app.post("/api/tools", async (req, res) => {
  try {
    const topic = String(req.body?.topic || req.body?.videoTitle || "").trim();
    const stepText = String(req.body?.stepText || "").trim();
    const stepNumber = Number(req.body?.stepNumber) || null;
    const videoTitle = String(req.body?.videoTitle || "").trim();

    const focus = stepText || topic || videoTitle;
    if (!focus) {
      return res.status(400).json({ error: "topic or stepText is required" });
    }

    const cacheKey = `${topic}::${stepText}`.toLowerCase().replace(/\s+/g, " ");
    if (toolsCache.has(cacheKey)) {
      return res.json({ tools: toolsCache.get(cacheKey), cached: true });
    }
    if (toolsInflight.has(cacheKey)) {
      const tools = await toolsInflight.get(cacheKey);
      return res.json({ tools, cached: true });
    }

    const prompt = [
      topic ? `Task: ${topic}.` : "",
      stepText
        ? `The user is on this step${stepNumber ? ` (step ${stepNumber})` : ""}: "${stepText}".`
        : "",
      "List the physical tools/equipment needed to do this specific step.",
      "Use the common, generic name for each tool (e.g. 'socket wrench', not a brand or part number) so it is easy to picture.",
      "Return ONLY valid JSON matching this schema:",
      JSON.stringify({
        tools: [{ name: "tool name", note: "why it's needed (<=6 words)" }],
      }),
      "Rules: 2 to 4 tools, most relevant first, no markdown, no image URLs.",
    ]
      .filter(Boolean)
      .join("\n");

    const job = (async () => {
      const startedAt = Date.now();
      const response = await fetch("https://api.x.ai/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-4.5",
          temperature: 0.2,
          input: [
            {
              role: "system",
              content:
                "You name the physical tools needed for a hands-on step. Output JSON only. Be fast and concise.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error("Tools error:", data);
        throw new Error(data?.error || data?.message || "Tool lookup failed");
      }

      const modelMs = Date.now() - startedAt;
      const raw = extractResponseText(data);
      const parsed = parseManualJson(raw);
      const tools = normalizeTools(parsed);
      const imagesAt = Date.now();
      await resolveToolImages(tools);
      console.log(
        `[tools] model ${modelMs}ms, images ${Date.now() - imagesAt}ms`,
      );
      toolsCache.set(cacheKey, tools);
      return tools;
    })();

    toolsInflight.set(cacheKey, job);
    try {
      const tools = await job;
      res.json({ tools, cached: false });
    } finally {
      toolsInflight.delete(cacheKey);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Tool lookup failed",
    });
  }
});

/**
 * Image proxy — fetch remote tool images server-side with a descriptive
 * User-Agent so hosts like Wikimedia (which 403 anonymous hotlinks) serve them,
 * and to sidestep browser CORS.
 */
app.get("/api/img", async (req, res) => {
  try {
    const url = String(req.query.url || "");
    if (!/^https?:\/\/\S+$/i.test(url)) {
      return res.status(400).json({ error: "valid image url required" });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let upstream;
    try {
      upstream = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "GrokEye/1.0 (hackathon demo; +https://x.ai)",
          Accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !contentType.startsWith("image/")) {
      console.warn(
        `[img] ${upstream.status} ${contentType || "no-type"} <- ${url.slice(0, 120)}`,
      );
      return res.status(upstream.ok ? 415 : upstream.status).end();
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    console.log(`[img] 200 ${contentType} ${buffer.length}b <- ${url.slice(0, 90)}`);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (err) {
    console.error("Image proxy error:", err);
    res.status(502).end();
  }
});

app.use(express.static(path.join(root, "public")));

if (isProd) {
  const dist = path.join(root, "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Grokathon API on http://localhost:${port}`);
  if (autoDetect) {
    void ensureDetector();
  }
});

async function detectorHealthy() {
  try {
    const r = await fetch(`${detectBase}/health`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!r.ok) return false;
    const data = await r.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

async function ensureDetector() {
  if (await detectorHealthy()) {
    console.log(`[detect] already running at ${detectBase}`);
    return;
  }

  const venvPython = path.join(root, "detector", ".venv", "bin", "python");
  const script = path.join(root, "detector", "server.py");
  if (!fs.existsSync(venvPython) || !fs.existsSync(script)) {
    console.warn(
      "[detect] venv missing — run `npm run detect:setup` once, then restart",
    );
    return;
  }

  console.log("[detect] starting local YOLO-World service…");
  detectChild = spawn(venvPython, [script], {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env },
  });
  detectChild.on("exit", (code, signal) => {
    console.warn(
      `[detect] exited code=${code} signal=${signal ?? ""}`.trim(),
    );
    detectChild = null;
  });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await detectorHealthy()) {
      console.log(`[detect] ready at ${detectBase}`);
      return;
    }
  }
  console.warn("[detect] still warming up — first highlight may be slow");
}

function shutdownDetector() {
  if (detectChild && !detectChild.killed) {
    detectChild.kill("SIGTERM");
    detectChild = null;
  }
}

process.on("exit", shutdownDetector);
process.on("SIGINT", () => {
  shutdownDetector();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdownDetector();
  process.exit(0);
});
