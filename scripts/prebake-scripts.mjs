#!/usr/bin/env node
/**
 * Pre-bake one step script per catalog video: server/scripts/<videoId>.json.
 *
 * Every video in the manifest gets a JSON file whose `steps` are the ordered
 * actions in the clip, each with `start`/`end` timestamp bounds that tile the
 * whole runtime with no gaps. Steps are ground truth for what the person did,
 * so the app never has to generate them at request time.
 *
 * Bounds come from the footage, not from prose: the baker samples frames
 * across the clip with ffmpeg and has the model assign boundaries to what it
 * sees. Scenario markdown (when a section exists) rides along as context, but
 * it is advisory — several docs predate re-cuts and describe the wrong runtime.
 *
 *   npm run scripts:bake                 # bake anything missing
 *   npm run scripts:bake -- --force all  # rebake every generated script
 *   npm run scripts:bake -- --force sushi
 *   npm run scripts:bake -- --check      # validate only, no API calls
 *
 * Hand-authored scripts (no "generated": true) are never overwritten.
 */
import "dotenv/config";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = path.join(root, "server", "scripts");
const videosDir = path.join(root, "public", "videos");

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");
const force = argv.includes("--force") ? argv[argv.indexOf("--force") + 1] : null;

const apiKey = process.env.XAI_API_KEY;
if (!apiKey && !checkOnly) {
  console.error("Missing XAI_API_KEY in .env");
  process.exit(1);
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(videosDir, "manifest.json"), "utf8"),
);

/** Scenario markdown sections for a video, across all catalog docs. */
function markdownFor(videoId) {
  const parts = [];
  for (const name of ["SCRIPTS.md", "CHOREOGRAPHY.md", "WATCH-WINDOWS.md"]) {
    let text;
    try {
      text = fs.readFileSync(path.join(videosDir, name), "utf8");
    } catch {
      continue;
    }
    const m = new RegExp("^## `" + videoId + "`.*$", "m").exec(text);
    if (!m) continue;
    const rest = text.slice(m.index);
    const next = rest.slice(2).search(/^## /m);
    parts.push(
      `--- ${name} ---\n${(next === -1 ? rest : rest.slice(0, next + 2)).trim()}`,
    );
  }
  return parts.join("\n\n");
}

/** True clip runtime — the manifest's durationSeconds is a rounded label. */
async function probeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    file,
  ]);
  return Number(String(stdout).trim());
}

/**
 * Evenly spaced frames across the clip, each tagged with its timestamp. One
 * ffmpeg pass with an fps filter — far faster than N seeks.
 */
async function sampleFrames(file, duration) {
  const count = Math.max(12, Math.min(40, Math.round(duration / 4)));
  const interval = duration / count;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokeye-bake-"));
  await run("ffmpeg", [
    "-v", "error",
    "-i", file,
    "-vf", `fps=1/${interval.toFixed(4)},scale=640:-1`,
    "-frames:v", String(count),
    path.join(dir, "f%03d.jpg"),
  ]);
  const frames = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f, i) => ({
      t: Number((i * interval).toFixed(1)),
      url:
        "data:image/jpeg;base64," +
        fs.readFileSync(path.join(dir, f)).toString("base64"),
    }));
  fs.rmSync(dir, { recursive: true, force: true });
  return frames;
}

/**
 * Structural contract every script must satisfy: ordered steps whose bounds
 * tile [0, duration] exactly, so any playhead position maps to exactly one
 * step. Throws with a specific reason; callers treat that as "do not write".
 */
export function validateScript(doc, video, duration) {
  const bad = (why) => {
    throw new Error(why);
  };
  if (doc?.videoId !== video.id) bad("videoId mismatch");
  if (!doc.title || !doc.task) bad("missing title/task");

  const steps = Array.isArray(doc.steps) ? doc.steps : bad("no steps");
  if (steps.length < 3) bad(`only ${steps.length} steps`);
  if (steps.length > 14) bad(`${steps.length} steps is too many`);

  const tol = 0.75;
  steps.forEach((s, i) => {
    s.n = i + 1;
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) {
      bad(`step ${i + 1} missing bounds`);
    }
    if (s.end <= s.start) bad(`step ${i + 1} has an empty range`);
    if (!s.text) bad(`step ${i + 1} missing text`);
    if (!s.detail) bad(`step ${i + 1} missing detail`);
    s.flags = Array.isArray(s.flags) ? s.flags.map(String) : [];
    // Contiguous: each step starts where the previous ended.
    const prevEnd = i === 0 ? 0 : steps[i - 1].end;
    if (Math.abs(s.start - prevEnd) > tol) {
      bad(`step ${i + 1} starts at ${s.start}, previous ended ${prevEnd}`);
    }
    s.start = i === 0 ? 0 : steps[i - 1].end;
  });

  const last = steps[steps.length - 1];
  if (Math.abs(last.end - duration) > Math.max(tol, duration * 0.04)) {
    bad(`last step ends at ${last.end}, clip runs ${duration.toFixed(1)}s`);
  }
  last.end = Number(duration.toFixed(1));
  if (!doc.source?.url) {
    doc.source = {
      title: video.title,
      url: video.src,
      siteName: "GrokEye catalog",
    };
  }
  doc.durationSeconds = Number(duration.toFixed(1));
  return doc;
}

async function bake(video, duration) {
  const file = path.join(root, "public", video.src.replace(/^\//, ""));
  const frames = await sampleFrames(file, duration);
  const md = markdownFor(video.id);

  const system = [
    "You break a how-to video into its ordered steps, from evenly spaced frames of the clip.",
    "Each frame is labelled with its timestamp. Work out where one action ends and the next begins, and assign timestamp bounds accordingly.",
    "Return ONLY valid JSON (no markdown fences) matching:",
    JSON.stringify({
      videoId: video.id,
      title: "short script title",
      task: "what the person is doing overall, as a phrase",
      setting: "one-paragraph description of the scene, tools, and parts",
      steps: [
        {
          n: 1,
          start: 0,
          end: 0,
          text: "short imperative instruction for this step",
          detail: "one sentence on what the frames actually show",
          flags: ["a technique mistake visible in this step, if any"],
        },
      ],
      afterClip: "what comes next in the task after the clip ends",
    }),
    "HARD RULES on bounds:",
    `- The steps must tile the entire clip: step 1 starts at 0, the last step ends at ${duration.toFixed(1)}, and every step starts exactly where the previous one ended. No gaps, no overlaps.`,
    "- Bounds are seconds with at most one decimal, strictly increasing.",
    "- Between 3 and 14 steps. Split where the ACTION changes, not on a fixed interval — a step may be short or long.",
    "- Camera-only moments (a cutaway, a walk across the room) belong to the surrounding step; never invent a step with no action.",
    "`text` is the instruction a viewer would follow. `detail` is what is visibly happening. `flags` lists technique mistakes VISIBLE in that step's frames — empty when the work looks correct. Never invent flags.",
    md ? "Scenario notes follow as context. Trust the FRAMES over the notes: some notes describe an older cut with a different runtime." : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userText = [
    `Video: "${video.title}" — ${video.description}`,
    `True runtime: ${duration.toFixed(1)}s. ${frames.length} frames follow, evenly spaced, labelled with timestamps.`,
    md ? `\nScenario notes:\n${md}` : "",
  ].join("\n");

  const content = [{ type: "text", text: userText }];
  for (const f of frames) {
    content.push({ type: "text", text: `t=${f.t}s` });
    content.push({ type: "image_url", image_url: { url: f.url, detail: "low" } });
  }

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || "upstream error");
  }
  const raw = (data?.choices?.[0]?.message?.content || "")
    .replace(/^\s*```(?:json)?/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  const doc = validateScript(JSON.parse(raw), video, duration);
  doc.generated = true;
  doc.frameCount = frames.length;
  fs.writeFileSync(
    path.join(scriptsDir, `${video.id}.json`),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
  return doc;
}

fs.mkdirSync(scriptsDir, { recursive: true });
let failures = 0;

for (const video of manifest) {
  const file = path.join(scriptsDir, `${video.id}.json`);
  const exists = fs.existsSync(file);
  const existing = exists ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  let duration;
  try {
    duration = await probeDuration(path.join(root, "public", video.src.replace(/^\//, "")));
  } catch {
    console.error(`! ${video.id}: could not probe the clip`);
    failures += 1;
    continue;
  }

  if (checkOnly) {
    if (!existing) {
      console.error(`! ${video.id}: NO SCRIPT`);
      failures += 1;
      continue;
    }
    try {
      validateScript(existing, video, duration);
      const last = existing.steps[existing.steps.length - 1];
      console.log(
        `✓ ${video.id}: ${existing.steps.length} steps, 0-${last.end}s of ${duration.toFixed(1)}s`,
      );
    } catch (err) {
      console.error(`! ${video.id}: ${err.message}`);
      failures += 1;
    }
    continue;
  }

  if (existing && !existing.generated) {
    console.log(`- ${video.id}: hand-authored, kept`);
    continue;
  }
  if (existing && force !== video.id && force !== "all") {
    console.log(`- ${video.id}: already baked, kept`);
    continue;
  }

  try {
    const doc = await bake(video, duration);
    console.log(
      `+ ${video.id}: ${doc.steps.length} steps tiling 0-${doc.durationSeconds}s (${doc.frameCount} frames)`,
    );
  } catch (err) {
    failures += 1;
    console.error(`! ${video.id}: ${err.message}`);
  }
}

process.exit(failures ? 1 : 0);
