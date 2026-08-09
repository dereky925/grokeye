import type { StepReview } from "../types";
/**
 * Step-correctness review: "how did I do on that step?"
 *
 * The evidence is not the live frame — it is a strip of equispaced frames
 * sampled across ONE step's authored time range (see server/scripts/*.json),
 * compared against that step's own instruction text.
 */

export type ScriptStep = {
  n: number;
  start: number;
  end: number;
  text: string;
  detail: string;
  flags?: string[];
};

export type VideoScript = {
  videoId: string;
  title: string;
  task: string;
  setting?: string;
  durationSeconds: number;
  steps: ScriptStep[];
  afterClip?: string;
};

/** Frames sampled per review — also the strip shown in the panel. */
export const REVIEW_FRAME_COUNT = 5;
/** Downscale width for review frames — legibility over fidelity. */
export const REVIEW_FRAME_WIDTH = 512;

/**
 * "How did I do on that step?" and close variants. Deliberately fuzzy — any
 * self-assessment ask claims the turn.
 */
export function wantsStepReview(message: string): boolean {
  const t = message.toLowerCase().replace(/[’]/g, "'").trim();

  if (/\bhow('d| did| have| do you think) i (do|done|doing)\b/.test(t)) return true;
  if (/\bhow did (that|it|this) (go|look|turn out)\b/.test(t)) return true;
  if (/\bhow'?s? (that|it|this|my) (look|going)\b/.test(t)) return true;
  if (
    /\bdid i (do|perform|complete|finish|nail|get|mess up|screw up) (that|this|the|my|it)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(grade|rate|review|score|judge|critique|assess|evaluate|check) (my|that|this|the) (last |previous )?(step|work|attempt|technique|form|job)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\bwas that (right|correct|ok|okay|good)\b/.test(t)) return true;
  return false;
}

const scriptCache = new Map<string, VideoScript | null>();

/** Pre-baked step script for a clip, or null when the video has none. */
export async function fetchVideoScript(
  videoId: string,
): Promise<VideoScript | null> {
  if (scriptCache.has(videoId)) return scriptCache.get(videoId) ?? null;
  try {
    const res = await fetch(`/api/script/${encodeURIComponent(videoId)}`);
    if (!res.ok) {
      scriptCache.set(videoId, null);
      return null;
    }
    const data = await res.json();
    const script = (data?.script ?? null) as VideoScript | null;
    scriptCache.set(videoId, script);
    return script;
  } catch {
    // Transient — don't cache, let the next ask retry.
    return null;
  }
}

/**
 * Which single step "how did I do?" is about.
 *
 * Asking in the FIRST half of a step means the work being judged is the step
 * that just finished — the current one has barely started. Asking in the
 * SECOND half means the current step. (First half of step 1 has no predecessor,
 * so it reviews step 1.)
 */
export function selectReviewStep(
  script: VideoScript,
  currentTime: number,
): ScriptStep {
  const steps = script.steps;
  const t = Number.isFinite(currentTime) ? currentTime : 0;

  let idx = steps.findIndex((s) => t >= s.start && t < s.end);
  if (idx === -1) idx = t >= steps[steps.length - 1].end ? steps.length - 1 : 0;

  const step = steps[idx];
  const midpoint = step.start + (step.end - step.start) / 2;
  if (t < midpoint && idx > 0) return steps[idx - 1];
  return step;
}

/**
 * `count` equispaced frames across [start, end], sampled from an offscreen
 * video element so the visible player never scrubs. Oldest first.
 */
export async function captureStepFrames(
  src: string,
  start: number,
  end: number,
  count = REVIEW_FRAME_COUNT,
  maxW = REVIEW_FRAME_WIDTH,
): Promise<string[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = src;

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Could not load the clip for review")),
      8000,
    );
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Could not load the clip for review"));
    };
  });

  const scale = Math.min(1, maxW / (video.videoWidth || maxW));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw review frames");

  // Inset from the bounds so the strip shows the step's own action rather than
  // the transition frames on either side.
  const span = Math.max(0.001, end - start);
  const inset = Math.min(0.25, span * 0.05);
  const from = start + inset;
  const to = Math.max(from + 0.001, end - inset);

  const frames: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * i) / Math.max(1, count - 1);
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Seek timed out")),
        4000,
      );
      video.onseeked = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05));
    });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push(canvas.toDataURL("image/jpeg", 0.6));
  }
  video.removeAttribute("src");
  video.load();
  return frames;
}

export async function fetchStepReview(input: {
  videoId: string;
  stepNumber: number;
  question: string;
  frames: string[];
}): Promise<StepReview> {
  const res = await fetch("/api/step-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Step review failed");
  return data as StepReview;
}
