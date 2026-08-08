import "dotenv/config";
import cors from "cors";
import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

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
app.use(cors());
app.use(express.json({ limit: "12mb" }));

const manifestPath = path.join(root, "public", "videos", "manifest.json");
const detectBase = process.env.DETECT_URL || "http://127.0.0.1:8790";
let detectChild = null;
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Replies feed TTS + the caption chip directly — markdown reads aloud as garbage.
function stripSpokenMarkdown(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_#`]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
  res.json({ ok: true, voice: "carina", detector });
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
    const lowDetail = Boolean(req.body?.lowDetail);
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
      "You are Grok, built by xAI. Your reply is spoken aloud over a video — be blunt and to the point.",
      "Answer in 1–2 short sentences by default; use a 3rd only if the answer truly needs it.",
      "No preamble, no filler, no restating the question, no hedging, no wrap-up pleasantries. Lead with the answer itself.",
      "Your output goes straight to text-to-speech: plain spoken prose only. Never use markdown, asterisks, bold, headings, bullet points, numbered lists, or emoji — formatting characters get read aloud as garbage.",
      "The user is watching a video in GrokEye and talking through a voice overlay.",
      hasFrames
        ? "The user asked something about the video/screen. Frame(s) and playback timing are attached — commit to your best read of the frame and answer decisively. Never lead with what you can't see or can't tell. If a detail genuinely isn't in frame, coach the best expert move anyway and tuck any caveat into a few trailing words — it is never the headline."
        : "No video frame is attached for this turn. Answer decisively from general knowledge and the video title/description. Don't claim to see the screen, but don't dwell on that either — just answer.",
      "Be supremely confident — a master tradesman who has seen this a thousand times. Banned openers: 'I can't tell', 'I can't see', 'I don't know', 'it's hard to say', 'it depends'. Make the call and own it; when you're inferring rather than seeing, phrase it as direct coaching ('keep the flame on the fitting') instead of an assessment you couldn't make.",
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
              '{"reply":"blunt spoken answer, 1-2 short sentences","labels":[{"text":"short label","kind":"box","x":0,"y":0,"w":0,"h":0}]}',
              "Box fields are normalized 0–1 with origin at the top-left of the image (x,y = top-left of the box; w,h = size).",
              'kind is "box" for a discrete object or "zone" for a region/area.',
              "Use at most 2 labels. Tight boxes around the referenced subject(s). Empty labels array if nothing clear to highlight.",
              "reply is what will be spoken aloud — keep it natural and do not mention coordinates.",
            ].join(" ")
          : "Go longer than 2 sentences only when the user explicitly asks for more detail.",
      "A dry quip is fine when it costs zero extra words; never pad.",
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
            image_url: { url, detail: labelMode || lowDetail ? "low" : "high" },
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
      reply: stripSpokenMarkdown(reply) || reply,
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

// Labels-only sidecar for highlight turns. Runs in parallel with /api/chat so
// boxes paint while the spoken reply is still generating (~1.4s vs ~2s+ combined).
app.post("/api/labels", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const videoTitle = req.body?.videoTitle
      ? String(req.body.videoTitle)
      : null;
    const frames = Array.isArray(req.body?.frames)
      ? req.body.frames.filter((f) => typeof f === "string" && f.startsWith("data:image"))
      : [];

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }
    if (!frames.length) {
      return res.status(400).json({ error: "a frame is required" });
    }

    const model = "grok-4.5";
    const t0 = performance.now();

    const system = [
      "You locate objects in a video frame for AR-style visual callouts.",
      'Respond with ONLY valid JSON (no markdown): {"labels":[{"text":"short label","kind":"box","x":0,"y":0,"w":0,"h":0}],"link":null}',
      "Box fields are normalized 0–1 with origin at the top-left of the image (x,y = top-left of the box; w,h = size).",
      'kind is "box" for a discrete object (reticle) or "zone" for a region/area/surface (soft fill), e.g. a work area, a spill, empty counter space.',
      'When the question asks where something goes, connects, plugs in, or leads (a route between two things), return BOTH endpoints as labels and set "link":{"from":0,"to":1} using label indices — from = the thing in hand / the source, to = the destination. Otherwise "link":null.',
      "Use at most 2 labels. Tight boxes around the referenced subject(s). Empty labels array if nothing clear to highlight.",
      videoTitle ? `Video title: ${videoTitle}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const body = JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: `Locate: ${message}` },
            {
              type: "image_url",
              image_url: { url: frames[frames.length - 1], detail: "low" },
            },
          ],
        },
      ],
    });

    // Upstream vision latency is a per-request lottery (~1.5s fast path,
    // 5–9s slow path). Hedge with two identical calls; first result wins.
    const controllers = [new AbortController(), new AbortController()];
    const attempt = (i) =>
      fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controllers[i].signal,
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || "Labels request failed");
        }
        return data;
      });

    let data;
    try {
      data = await Promise.any(controllers.map((_, i) => attempt(i)));
    } catch (err) {
      console.error("Labels error:", err.errors?.[0] || err);
      return res.status(502).json({
        error: err.errors?.[0]?.message || "Labels request failed",
      });
    } finally {
      for (const c of controllers) c.abort();
    }

    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    let labels = [];
    let link = null;
    try {
      const parsed = parseManualJson(raw);
      labels = Array.isArray(parsed.labels) ? parsed.labels : [];
      link =
        parsed.link && typeof parsed.link === "object" ? parsed.link : null;
    } catch {
      labels = [];
    }

    console.log(`[labels] upstream ${Math.round(performance.now() - t0)}ms`);
    res.json({ labels, link, model });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Labels failed" });
  }
});

// Geometry-only sidecar for visible hand/tool motion. Runs beside /api/chat;
// it never delays the spoken answer and never invents an animation when the
// requested action or required tool is absent from the frame.
app.post("/api/guide", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const frame = String(req.body?.frame || "");
    const videoTitle = String(req.body?.videoTitle || "").trim();
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }
    if (!frame.startsWith("data:image")) {
      return res.status(400).json({ error: "a frame is required" });
    }

    const model = "grok-4.5";
    const system = [
      "You ground a short AR motion demonstration onto one real worker-view frame.",
      "Return ONLY valid JSON with no markdown matching:",
      '{"status":"ready|wrong_tool|not_visible|unsafe_to_show","note":"short HUD text","labels":[{"text":"Pivot","kind":"box","x":0,"y":0,"w":0,"h":0},{"text":"Move this","kind":"box","x":0,"y":0,"w":0,"h":0}],"motion":{"type":"arc|rotate|line","pivot":0,"moving":1,"direction":"clockwise|counterclockwise|toward|away|up|down|left|right","sweep":75,"label":"Pull steadily"}}',
      "All label coordinates are normalized 0–1 from the image top-left. Use tight boxes.",
      "ready requires exactly two clearly visible labels: index 0 is the stationary pivot/reference and index 1 is the hand, handle, or part that moves.",
      "For arc/rotate use clockwise or counterclockwise. For line use toward, away, up, down, left, or right. sweep is 25–150 degrees and applies to arc/rotate.",
      "The motion must describe the physically useful visible gesture, not camera movement.",
      "If the request names an action but the visible tool performs a different action, return wrong_tool, motion null, and one tight label on the actual tool whose text explains the mismatch.",
      "Example: a tubing cutter is not a pipe bender. A bend request over a cutter frame is wrong_tool, never ready.",
      "If the needed tool, hand, workpiece, or pivot is not clearly visible, return not_visible with motion null. Do not guess off-screen geometry.",
      "If showing the motion from this frame could be unsafe or correctness depends on hidden state, return unsafe_to_show with motion null.",
      "For every non-ready status, labels may contain at most one visible attention box and motion must be null.",
      "Keep note and motion.label imperative, specific, and under 7 words.",
      videoTitle ? `Video title: ${videoTitle}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const body = JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            { type: "text", text: `Show the visible motion for: ${message}` },
            {
              type: "image_url",
              image_url: { url: frame, detail: "low" },
            },
          ],
        },
      ],
    });

    const parseGuide = (data) => {
      const raw = data?.choices?.[0]?.message?.content?.trim() || "";
      const parsed = parseManualJson(raw);
      const statuses = new Set([
        "ready",
        "wrong_tool",
        "not_visible",
        "unsafe_to_show",
      ]);
      const status = String(parsed.status || "");
      const note = String(parsed.note || "").trim().slice(0, 80);
      const labels = Array.isArray(parsed.labels) ? parsed.labels.slice(0, 2) : [];
      const motion = parsed.motion && typeof parsed.motion === "object"
        ? parsed.motion
        : null;
      if (!statuses.has(status) || !note) {
        throw new Error("Invalid guide contract");
      }
      if (status === "ready" && (labels.length !== 2 || !motion)) {
        throw new Error("Ready guide lacks grounded motion");
      }
      return {
        status,
        note,
        labels: status === "ready" ? labels : labels.slice(0, 1),
        motion: status === "ready" ? motion : null,
      };
    };

    // Motion needs to land while it is useful. Hedge the same way as labels,
    // but accept only a response that also passes the strict guide contract.
    const controllers = [new AbortController(), new AbortController()];
    const attempt = (index) =>
      fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: controllers[index].signal,
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || "Motion guide request failed");
        }
        return parseGuide(data);
      });

    try {
      const guide = await Promise.any(controllers.map((_, i) => attempt(i)));
      return res.json({ ...guide, model });
    } catch (err) {
      console.error("Motion guide error:", err.errors?.[0] || err);
      return res.status(502).json({ error: "unusable_guidance" });
    } finally {
      for (const controller of controllers) controller.abort();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Motion guidance failed" });
  }
});

// "Phillips screwdriver" counts as in view when the sight pass saw
// "screwdriver": containment either way, or any shared word of 4+ letters.
function toolMatchesVisible(name, visibleNames) {
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const n = norm(name);
  if (!n) return false;
  const nWords = new Set(n.split(" ").filter((w) => w.length >= 4));
  return visibleNames.some((v) => {
    const s = norm(v);
    if (!s) return false;
    if (s.includes(n) || n.includes(s)) return true;
    return s.split(" ").some((w) => w.length >= 4 && nWords.has(w));
  });
}

// Tool checklist for the glassy dropdown ("what tools do I need?").
// One combined call made grok-4.5 reason for 25-40s (per-tool grounding
// against the frame), so the turn is split: a hedged text-only checklist
// call (reasoning_effort low — it gates the spoken reply) races a small
// "what tools are visible" frame call, and statuses are merged locally:
// visible → in_view, essential-but-not-visible → missing, else unknown.
// No frame / failed sight pass → all unknown, never a guessed status.
app.post("/api/tools", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const frame = String(req.body?.frame || "");
    const videoTitle = String(req.body?.videoTitle || "").trim();
    const videoDescription = String(req.body?.videoDescription || "").trim();
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }
    const hasFrame = frame.startsWith("data:image");

    const model = "grok-4.5";
    const t0 = performance.now();
    const xaiHeaders = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    // The checklist is per-job, not per-frame — cache it like manuals so a
    // repeat ask only pays the sight pass. Statuses always merge live.
    const cacheKey = (videoTitle || message).toLowerCase().replace(/\s+/g, " ");
    const cached = toolsChecklistCache.get(cacheKey);
    const cacheFresh = cached && Date.now() - cached.at < 10 * 60_000;

    // The example-driven prompt keeps reasoning burn low; extra rules make
    // the model deliberate (measured: hundreds of reasoning tokens).
    const checklistSystem = [
      "You name the tools a worker needs for the job they are doing. Output ONLY JSON shaped like this example, nothing else:",
      '{"task":"Bike tire swap","spoken":"Grab tire levers and a pump. The rest can wait.","tools":[{"name":"Tire levers","purpose":"pop the bead","essential":true},{"name":"Pump","purpose":"reinflate","essential":true},{"name":"Patch kit","purpose":"fix punctures","essential":false}]}',
      "3-6 tools in the order they get used, short names, purpose under 6 words, essential true only when the job cannot be done without it.",
      "spoken is 1-2 plain spoken sentences naming the essentials to have ready — it goes straight to text-to-speech, so no formatting characters and no claims about what you can see.",
      videoTitle ? `Video title: ${videoTitle}.` : "",
      videoDescription ? `Video description: ${videoDescription}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const checklistBody = JSON.stringify({
      model,
      temperature: 0.2,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: checklistSystem },
        { role: "user", content: `Job question: ${message}` },
      ],
    });

    const parseChecklist = (data) => {
      const raw = data?.choices?.[0]?.message?.content?.trim() || "";
      const parsed = parseManualJson(raw);
      const seen = new Set();
      const tools = (Array.isArray(parsed.tools) ? parsed.tools : [])
        .map((t) => ({
          name: String(t?.name || "").trim().slice(0, 40),
          purpose: String(t?.purpose || "").trim().slice(0, 60),
          essential: Boolean(t?.essential),
        }))
        .filter((t) => {
          const key = t.name.toLowerCase();
          if (!t.name || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 8);
      const spoken = stripSpokenMarkdown(parsed.spoken || "");
      if (!tools.length || !spoken) {
        throw new Error("Invalid toolkit contract");
      }
      return {
        task: String(parsed.task || "This job").trim().slice(0, 60),
        tools,
        spoken,
      };
    };

    // Checklist latency is a lottery even at low effort — hedge like /api/labels.
    const controllers = [new AbortController(), new AbortController()];
    const checklistAttempt = (index) =>
      fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: xaiHeaders,
        body: checklistBody,
        signal: controllers[index].signal,
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error?.message || "Toolkit request failed");
        }
        return parseChecklist(data);
      });
    const checklistJob = cacheFresh
      ? Promise.resolve(cached.checklist)
      : Promise.any(controllers.map((_, i) => checklistAttempt(i)));

    // Sight pass: labels-style "name what you can see" — cheap, but the same
    // latency lottery, so it's hedged too; a slow draw would otherwise cost
    // every status.
    const sightBody = JSON.stringify({
      model,
      temperature: 0.1,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content:
            'You list tools, parts, and equipment clearly visible in a worker point-of-view image. Respond with ONLY valid JSON (no markdown): {"visible":["short name"]} Name every distinct item you can clearly see, up to 12, including whatever is held in hand or being worked on. Empty array if none.',
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "List the tools, parts, and equipment visible in this frame.",
            },
            { type: "image_url", image_url: { url: frame, detail: "low" } },
          ],
        },
      ],
    });
    const sightControllers = hasFrame
      ? [new AbortController(), new AbortController()]
      : [];
    const sightAttempt = (index) =>
      fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: xaiHeaders,
        body: sightBody,
        signal: sightControllers[index].signal,
      }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error("Sight pass failed");
        const raw = data?.choices?.[0]?.message?.content?.trim() || "";
        const parsed = parseManualJson(raw);
        return (Array.isArray(parsed.visible) ? parsed.visible : []).map((v) =>
          String(v),
        );
      });
    const sightJob = hasFrame
      ? Promise.any(sightControllers.map((_, i) => sightAttempt(i))).catch(
          () => null,
        )
      : Promise.resolve(null);

    let checklist;
    try {
      checklist = await checklistJob;
    } catch (err) {
      console.error("Toolkit error:", err.errors?.[0] || err);
      return res.status(502).json({ error: "unusable_toolkit" });
    } finally {
      for (const controller of controllers) controller.abort();
    }
    if (!cacheFresh) {
      toolsChecklistCache.set(cacheKey, { checklist, at: Date.now() });
    }

    // The sight pass runs beside the checklist. Give it a total budget from
    // request start (a cached checklist resolves instantly and must not
    // starve it), then fall back to honest unknowns.
    const sightBudgetMs = Math.max(500, 8000 - (performance.now() - t0));
    const visible = await Promise.race([
      sightJob,
      new Promise((resolve) => setTimeout(resolve, sightBudgetMs, null)),
    ]);
    for (const controller of sightControllers) controller.abort();

    const tools = checklist.tools.map((t) => ({
      ...t,
      status: !visible
        ? "unknown"
        : toolMatchesVisible(t.name, visible)
          ? "in_view"
          : t.essential
            ? "missing"
            : "unknown",
    }));

    console.log(
      `[tools] total ${Math.round(performance.now() - t0)}ms sight=${visible ? visible.length : "none"}`,
    );
    res.json({
      toolkit: { task: checklist.task, tools, spoken: checklist.spoken },
      model,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Tool checklist failed" });
  }
});

app.post("/api/verify", async (req, res) => {
  try {
    const goal = String(req.body?.goal || "").trim();
    const instruction = String(req.body?.instruction || "").trim();
    const beforeFrame = String(req.body?.beforeFrame || "");
    const afterFrame = String(req.body?.afterFrame || "");
    const videoTitle = String(req.body?.videoTitle || "").trim();
    const manualStepText = String(req.body?.manualStepText || "").trim();

    if (!goal || !instruction) {
      return res.status(400).json({ error: "goal and instruction are required" });
    }
    if (!beforeFrame.startsWith("data:image") || !afterFrame.startsWith("data:image")) {
      return res.status(400).json({ error: "before and after frames are required" });
    }

    const model = "grok-4.5";
    const system = [
      "You verify whether a worker completed a guided physical task by comparing two real video frames.",
      "Be conservative and truthful. Output ONLY valid JSON with no markdown matching:",
      '{"verdict":"complete|not_complete|not_visible|unsafe_to_judge","spoken":"at most 2 short spoken sentences","attention":{"text":"short label","kind":"zone","x":0,"y":0,"w":0,"h":0}|null}',
      "BEFORE is the frame captured when guidance was given. AFTER is the frame captured when the worker asked for verification.",
      'If the relevant target is not clearly identifiable in either frame, verdict must be "not_visible".',
      'If correctness depends on something the frames cannot establish — including torque, seating depth, energized state, pressure, hidden fit, or any safety-critical condition — verdict must be "unsafe_to_judge".',
      'Under uncertainty, choose "not_visible" or "unsafe_to_judge"; never lean toward "complete".',
      'Use "complete" only when the visible evidence clearly demonstrates the requested result.',
      'Use "not_complete" only when the frames visibly show a specific correctable problem.',
      'attention is allowed only for "not_complete". It must be one normalized 0–1 zone around the exact problem; otherwise return null.',
      "The spoken field must state the verdict naturally without coordinates and without claiming access to anything outside these frames.",
      "The spoken field goes straight to text-to-speech: plain prose only, no markdown, asterisks, or formatting characters.",
      "Whatever the verdict, the spoken line is confident and forward-moving: lead with the call or the one thing to do or show next. Never apologize, never dwell on what you cannot see — for not_visible, just tell the worker what to point the camera at.",
    ].join(" ");

    const context = [
      `Worker goal: ${goal}`,
      `Guidance that was spoken: ${instruction}`,
      videoTitle ? `Video title: ${videoTitle}` : "",
      manualStepText ? `Current manual step: ${manualStepText}` : "",
      "The first attached image is BEFORE, captured when the guidance was given.",
      "The second attached image is AFTER, captured when the worker asked to verify.",
      "Compare BEFORE with AFTER and return the verification JSON.",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: [
              { type: "text", text: context },
              {
                type: "image_url",
                image_url: { url: beforeFrame, detail: "low" },
              },
              {
                type: "image_url",
                image_url: { url: afterFrame, detail: "low" },
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Verify error:", data);
      return res.status(response.status).json({
        error: data?.error?.message || "Verification request failed",
      });
    }

    try {
      const raw = data?.choices?.[0]?.message?.content?.trim() || "";
      const parsed = parseManualJson(raw);
      const verdicts = new Set([
        "complete",
        "not_complete",
        "not_visible",
        "unsafe_to_judge",
      ]);
      const verdict = String(parsed.verdict || "");
      const spoken = stripSpokenMarkdown(parsed.spoken || "");
      if (!verdicts.has(verdict) || !spoken) {
        throw new Error("Invalid verification contract");
      }
      const attention =
        verdict === "not_complete" &&
        parsed.attention &&
        typeof parsed.attention === "object"
          ? parsed.attention
          : null;
      return res.json({ verdict, spoken, attention, model });
    } catch (err) {
      console.error("Verify response parse error:", err);
      return res.status(502).json({ error: "unverifiable_response" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Verification failed" });
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

/** Job checklists for /api/tools, 10-min TTL — statuses always merge live. */
const toolsChecklistCache = new Map();

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
      "Use web search once to find ONE reputable public guide/recipe page.",
      "Prefer Just One Cookbook, Serious Eats, BBC Good Food, or NYT Cooking.",
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
      "Rules: exactly 6 short steps, one sentence each, no markdown, real https source URL.",
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

/** Web-answer cache so a repeated question skips the search round-trip. */
const webCache = new Map();
const webInflight = new Map();
const WEB_CACHE_TTL_MS = 10 * 60 * 1000;

app.post("/api/websearch", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const videoTitle = String(req.body?.videoTitle || "").trim();
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const cacheKey = message.toLowerCase().replace(/\s+/g, " ");
    const hit = webCache.get(cacheKey);
    if (hit && Date.now() - hit.at < WEB_CACHE_TTL_MS) {
      return res.json({ reply: hit.reply, cached: true });
    }

    // Reuse in-flight request so double-asks don't double-pay latency
    if (webInflight.has(cacheKey)) {
      const reply = await webInflight.get(cacheKey);
      return res.json({ reply, cached: true });
    }

    const system = [
      "You are Grok, built by xAI. Your reply is spoken aloud — plain spoken prose only. Never use markdown, lists, or emoji.",
      "Answer in 1–2 short sentences. Lead with the answer itself; no preamble, no filler.",
      "Use web search to ground the answer in current facts. Name the source site in passing only when it adds trust.",
      videoTitle ? `The user is watching a video titled "${videoTitle}".` : "",
    ]
      .filter(Boolean)
      .join(" ");

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
            { role: "system", content: system },
            { role: "user", content: message },
          ],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        console.error("Websearch error:", data);
        throw new Error(data?.error || data?.message || "Web search failed");
      }

      const reply = stripSpokenMarkdown(extractResponseText(data));
      if (!reply) throw new Error("Empty web answer");
      webCache.set(cacheKey, { reply, at: Date.now() });
      return reply;
    })();

    webInflight.set(cacheKey, job);
    try {
      const reply = await job;
      res.json({ reply, cached: false });
    } finally {
      webInflight.delete(cacheKey);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Web search failed",
    });
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
