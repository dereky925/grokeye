import type { BufferedFrame } from "../hooks/useFrameBuffer";

export type FrameContextSelectionOptions = {
  /** Historical sample nearest this many seconds before speech onset. */
  lookbackSeconds?: number;
  /** Ignore history older than this relative to speech onset. */
  historySeconds?: number;
};

const DEFAULT_LOOKBACK_SECONDS = 2;
const DEFAULT_HISTORY_SECONDS = 10;
const SAME_MOMENT_EPSILON_SECONDS = 0.001;

/**
 * Only retrospective language earns extra images. Ordinary visible questions
 * and placement requests stay on the single speech-onset frame for speed.
 * Verification asks ("did she do that right?", "did I mess up?") count as
 * retrospective: they judge a completed action whose evidence — the hands-on
 * moment — is often gone from the resting speech-onset frame.
 */
export function wantsRecentVisualHistory(message: string): boolean {
  const text = String(message || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .trim();
  return (
    /\b(?:just|earlier|before|previously|a moment ago|seconds ago)\b/.test(text) ||
    /\bwhat (?:just )?happened\b/.test(text) ||
    /\b(?:how|what) did i (?:do|move|place|put|install|connect|bend|turn)\b/.test(
      text,
    ) ||
    /\b(?:did|have|has|am|was|is)\s+(?:i|she|he|we|they)\b.*\b(?:right|wrong|correct(?:ly)?|properly|mistakes?|mess(?:ed|ing)?\s*up|forg(?:e|o)t(?:ten|ting)?|miss(?:ed|ing)?\s+(?:a\s+|any\s+)?step)\b/.test(
      text,
    )
  );
}

function isUsable(frame: BufferedFrame): boolean {
  return (
    Boolean(frame.url) &&
    Number.isFinite(frame.mediaTime) &&
    Number.isFinite(frame.t) &&
    Number.isFinite(frame.motion)
  );
}

/**
 * Select compact temporal context around a caller-pinned speech-onset frame.
 *
 * The caller owns the current capture so the exact frame that triggered the
 * question is always retained. From the rolling history this adds at most two
 * useful views: the sample nearest roughly two seconds earlier, and the
 * highest-motion sample before speech began. Results are content-deduplicated,
 * never include post-speech history, and are returned oldest first.
 */
export function selectContextFrames(
  history: readonly BufferedFrame[],
  pinned: BufferedFrame,
  options: FrameContextSelectionOptions = {},
): BufferedFrame[] {
  if (!isUsable(pinned)) return [];

  const lookbackSeconds = Math.max(
    0,
    options.lookbackSeconds ?? DEFAULT_LOOKBACK_SECONDS,
  );
  const historySeconds = Math.max(
    lookbackSeconds,
    options.historySeconds ?? DEFAULT_HISTORY_SECONDS,
  );
  const earliestMediaTime = pinned.mediaTime - historySeconds;
  const targetMediaTime = pinned.mediaTime - lookbackSeconds;
  const seenUrls = new Set<string>([pinned.url]);
  const seenMediaTimes: number[] = [];

  const candidates = history
    .filter(
      (frame) =>
        isUsable(frame) &&
        frame.t <= pinned.t &&
        frame.mediaTime >= earliestMediaTime &&
        frame.mediaTime < pinned.mediaTime - SAME_MOMENT_EPSILON_SECONDS,
    )
    .slice()
    .sort((a, b) => a.mediaTime - b.mediaTime || a.t - b.t)
    .filter((frame) => {
      if (seenUrls.has(frame.url)) return false;
      if (
        seenMediaTimes.some(
          (mediaTime) =>
            Math.abs(mediaTime - frame.mediaTime) <=
            SAME_MOMENT_EPSILON_SECONDS,
        )
      ) {
        return false;
      }
      seenUrls.add(frame.url);
      seenMediaTimes.push(frame.mediaTime);
      return true;
    });

  let lookback: BufferedFrame | null = null;
  let motionPeak: BufferedFrame | null = null;
  for (const frame of candidates) {
    if (
      !lookback ||
      Math.abs(frame.mediaTime - targetMediaTime) <
        Math.abs(lookback.mediaTime - targetMediaTime)
    ) {
      lookback = frame;
    }
    if (
      !motionPeak ||
      frame.motion > motionPeak.motion ||
      (frame.motion === motionPeak.motion &&
        frame.mediaTime > motionPeak.mediaTime)
    ) {
      motionPeak = frame;
    }
  }

  const selected = [lookback, motionPeak, pinned].filter(
    (frame): frame is BufferedFrame => frame != null,
  );
  const unique = selected.filter(
    (frame, index) =>
      selected.findIndex(
        (candidate) =>
          candidate.url === frame.url ||
          Math.abs(candidate.mediaTime - frame.mediaTime) <=
            SAME_MOMENT_EPSILON_SECONDS,
      ) === index,
  );

  return unique
    .sort((a, b) => a.mediaTime - b.mediaTime || a.t - b.t)
    .slice(-3);
}
