/**
 * Short-lived memory for resolving purely deictic visual questions.
 *
 * This intentionally remembers only a grounded subject and lightweight
 * provenance. It never retains boxes, paths, or authored cue geometry: callers
 * must ground any animation again against the current video and playhead.
 */

export const VISUAL_MEMORY_TTL_MS = 10_000;

export type GroundedReferentSource =
  | "catalog"
  | "guidance"
  | "highlight"
  | "frame";

/** Metadata from a result that was actually grounded in a frame or cue. */
export type GroundedReferentMetadata = Readonly<{
  videoId: string;
  subject: string;
  source: GroundedReferentSource;
  /** Provenance only. Never use this to replay an old cue's geometry. */
  cueId?: string;
  /** Playhead provenance only; current-time routing still owns cue selection. */
  videoTimeSeconds?: number;
}>;

export type VisualReferentMemory = Readonly<{
  videoId: string;
  subject: string;
  rememberedAtMs: number;
  expiresAtMs: number;
  provenance: Readonly<{
    source: GroundedReferentSource;
    cueId?: string;
    videoTimeSeconds?: number;
  }>;
}>;

export type ResolveVisualSubjectInput = Readonly<{
  message: string;
  videoId: string;
  nowMs?: number;
  /**
   * Optional result from a caller's richer noun parser. A named subject always
   * wins over memory, so its presence suppresses the remembered hint.
   */
  explicitSubject?: string | null;
}>;

const DEICTIC_PRONOUN_RE =
  /\b(?:it(?!['’]s)|this|that|these|those)\b/i;

const ACTION_RE =
  /\b(?:put|place|position|attach|fit|install|mount|build|assemble|connect|seat|move|bend|turn|rotate|lower|raise|press|pull|push|insert)\s+(?:(?:the|a|an|my|our|your|this|that|these|those)\s+)?([a-z][\w-]*)/gi;

const GENERIC_REFERENT_WORDS = new Set([
  "it",
  "this",
  "that",
  "these",
  "those",
  "one",
  "ones",
  "thing",
  "things",
  "object",
  "objects",
  "part",
  "parts",
  "piece",
  "pieces",
  "stuff",
  "way",
  "go",
  "fit",
  "sit",
  "around",
  "over",
  "under",
  "up",
  "down",
  "left",
  "right",
  "in",
  "out",
  "into",
  "onto",
  "away",
  "here",
  "there",
  "with",
  "without",
  "from",
  "through",
  "toward",
  "towards",
  "clockwise",
  "counterclockwise",
  "straight",
  "flat",
  "gently",
  "slowly",
  "carefully",
  "first",
  "next",
  "now",
]);

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function finiteNow(nowMs: number): number {
  return Number.isFinite(nowMs) ? nowMs : Date.now();
}

/** Create a fresh snapshot from a genuinely grounded subject. */
export function createVisualMemory(
  grounding: GroundedReferentMetadata,
  nowMs = Date.now(),
): VisualReferentMemory | null {
  const videoId = cleanText(grounding?.videoId, 160);
  const subject = cleanText(grounding?.subject, 96);
  if (!videoId || !subject) return null;

  const rememberedAtMs = finiteNow(nowMs);
  const cueId = cleanText(grounding.cueId, 160);
  const videoTimeSeconds = Number.isFinite(grounding.videoTimeSeconds)
    ? Math.max(0, grounding.videoTimeSeconds as number)
    : undefined;
  const provenance = Object.freeze({
    source: grounding.source,
    ...(cueId ? { cueId } : {}),
    ...(videoTimeSeconds !== undefined ? { videoTimeSeconds } : {}),
  });

  return Object.freeze({
    videoId,
    subject,
    rememberedAtMs,
    expiresAtMs: rememberedAtMs + VISUAL_MEMORY_TTL_MS,
    provenance,
  });
}

/** True only inside the short, forward-moving wall-clock window. */
export function isVisualMemoryFresh(
  memory: VisualReferentMemory | null | undefined,
  nowMs = Date.now(),
): memory is VisualReferentMemory {
  if (!memory) return false;
  const now = finiteNow(nowMs);
  return now >= memory.rememberedAtMs && now < memory.expiresAtMs;
}

/**
 * Replace memory after a new grounding result. A missing/invalid update keeps a
 * still-fresh subject but also opportunistically drops an expired one.
 */
export function updateVisualMemory(
  current: VisualReferentMemory | null | undefined,
  grounding: GroundedReferentMetadata | null | undefined,
  nowMs = Date.now(),
): VisualReferentMemory | null {
  if (grounding) {
    const next = createVisualMemory(grounding, nowMs);
    if (next) return next;
  }
  return isVisualMemoryFresh(current, nowMs) ? current : null;
}

/** Does the utterance contain a pronoun that can refer to a visible subject? */
export function hasDeicticVisualReferent(message: string): boolean {
  return DEICTIC_PRONOUN_RE.test(cleanText(message, 500));
}

/**
 * Conservative local check for a subject the user named in the utterance.
 * Targets named after a deictic object ("put it in the socket") do not suppress
 * memory; the object itself remains "it". Callers with a richer parse can pass
 * `explicitSubject` to `resolveVisualSubjectHint`.
 */
export function hasExplicitVisualSubject(message: string): boolean {
  const text = cleanText(message, 500).toLowerCase();
  if (!text) return false;

  const demonstrative =
    /\b(?:this|that|these|those)\s+([a-z][\w-]*)/gi;
  for (const match of text.matchAll(demonstrative)) {
    if (!GENERIC_REFERENT_WORDS.has(match[1])) return true;
  }

  const appositive =
    /\bit\s*[,;:—-]+\s*(?:(?:the|a|an|my|our|your)\s+)?([a-z][\w-]*)/gi;
  for (const match of text.matchAll(appositive)) {
    if (!GENERIC_REFERENT_WORDS.has(match[1])) return true;
  }

  ACTION_RE.lastIndex = 0;
  for (const match of text.matchAll(ACTION_RE)) {
    if (!GENERIC_REFERENT_WORDS.has(match[1])) return true;
  }
  return false;
}

/**
 * Return only a recent subject string. Current clip/time routing must select
 * fresh animation geometry after this hint is applied.
 */
export function resolveVisualSubjectHint(
  memory: VisualReferentMemory | null | undefined,
  {
    message,
    videoId,
    nowMs = Date.now(),
    explicitSubject,
  }: ResolveVisualSubjectInput,
): string | null {
  if (!isVisualMemoryFresh(memory, nowMs)) return null;
  if (cleanText(videoId, 160) !== memory.videoId) return null;
  if (cleanText(explicitSubject, 96)) return null;
  if (!hasDeicticVisualReferent(message)) return null;
  if (hasExplicitVisualSubject(message)) return null;
  return memory.subject;
}
