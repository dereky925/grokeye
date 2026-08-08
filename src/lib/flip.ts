import type { BufferedFrame } from "../hooks/useFrameBuffer";
import type { FlipReview } from "../types";

/**
 * Did the user ask for a review of the attempt they just made? Only consulted
 * in flip mode, so this can be generous without stealing normal commands.
 */
export function wantsFlipReview(message: string): boolean {
  const t = message.toLowerCase().replace(/[’”']/g, "'").trim();
  if (!t) return false;

  return (
    /\bhow(?:'d| did)\s+(?:i|that|it)\b/.test(t) ||
    /\bhow was (?:that|it|my)\b/.test(t) ||
    /\bdid (?:it|that|i)\s+(?:land|stick|make it)\b/.test(t) ||
    /\bwhy (?:did|didn't|does|doesn't)\s+(?:it|that)\b/.test(t) ||
    /\bwhat (?:did i do wrong|went wrong|should i (?:do|have done))\b/.test(t) ||
    /\b(review|analyze|analyse|grade|rate|critique)\b.*\b(that|it|me|my|flip|attempt|throw)\b/.test(
      t,
    ) ||
    /\b(?:my|the|that)\s+flip\b/.test(t)
  );
}

/** Evenly spaced pick, always keeping the first and last item. */
function evenSample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const out: T[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(items[Math.round((i * (items.length - 1)) / (count - 1))]);
  }
  return out;
}

/**
 * Find the attempt inside the rolling buffer. Most of the buffer is a still
 * desk, so sending evenly spaced frames from all of it would spend most of the
 * model's attention on nothing. Instead, grow a window outward from the motion
 * peak and sample that.
 *
 * Padding matters in both directions: the release happens just before motion
 * crosses the threshold, and the bottle settles just after it drops back.
 */
export function selectAttemptFrames(
  frames: BufferedFrame[],
  count = 6,
): BufferedFrame[] {
  const usable = frames.filter((f) => f.url);
  if (usable.length <= count) return usable;

  let peak = 0;
  for (let i = 1; i < usable.length; i += 1) {
    if (usable[i].motion > usable[peak].motion) peak = i;
  }

  // Nothing moved — the user is probably asking about a bottle already at rest.
  if (usable[peak].motion < 1) return evenSample(usable.slice(-count * 2), count);

  const threshold = Math.max(1.5, usable[peak].motion * 0.3);
  let start = peak;
  let end = peak;
  while (start > 0 && usable[start - 1].motion >= threshold) start -= 1;
  while (end < usable.length - 1 && usable[end + 1].motion >= threshold) end += 1;

  const pad = 3;
  start = Math.max(0, start - pad);
  end = Math.min(usable.length - 1, end + pad);

  return evenSample(usable.slice(start, end + 1), count);
}

export async function fetchFlipReview(input: {
  question: string;
  frames: string[];
}): Promise<FlipReview> {
  const res = await fetch("/api/flip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Flip analysis failed");
  return data.review as FlipReview;
}
