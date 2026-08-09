import type {
  GuidanceCue,
  GuidanceDirection,
  GuidanceMotionType,
  GuidanceStatus,
  HighlightLabel,
} from "../types";

const STATUSES = new Set<GuidanceStatus>([
  "ready",
  "wrong_tool",
  "not_visible",
  "unsafe_to_show",
]);
const MOTION_TYPES = new Set<GuidanceMotionType>(["arc", "rotate", "line"]);
const DIRECTIONS = new Set<GuidanceDirection>([
  "clockwise",
  "counterclockwise",
  "toward",
  "away",
  "up",
  "down",
  "left",
  "right",
]);

/** Explicit requests for a visible hand/tool motion demonstration. */
export function wantsMotionGuidance(message: string): boolean {
  const text = message.toLowerCase().replace(/[’]/g, "'").trim();
  const placementQuestion =
    // The object is optional — a hands-busy worker often just says "where to
    // put" / "where do I put it" while the thing is literally in frame. The
    // subject includes "you"/"one" because live speech often comes out as
    // "where do you put this".
    /\bwhere\s+(?:(?:(?:do|does|should|can|would)\s+(?:i|we|you|one))|to)\s+(?:put|place|position|attach|fit|install|mount|build|assemble|connect|seat)\b/.test(
      text,
    ) ||
    /\bwhere\s+(?:does|do|should)\s+(?:this|that|the|it|these|those|my|our)\b(?:\s+\w+){0,3}\s+(?:go|fit|attach|connect|mount|sit)\b/.test(
      text,
    );
  if (placementQuestion) return true;

  const visibleReferent = /\b(this|that|it|these|those|here)\b/.test(text);
  if (!visibleReferent) return false;

  return (
    /\bhow\s+(?:(?:do|should|can|would)\s+i|to)\b/.test(text) ||
    /\bhow\s+should\s+(?:this|that|it|these|those)\b/.test(text) ||
    /\b(?:show|teach|tell)\s+(?:me\s+)?how\s+to\b/.test(text) ||
    /\bwhich\s+way\b/.test(text) ||
    /\bwhat\s+(?:motion|movement|direction)\b/.test(text)
  );
}

export type GuidanceResponse = {
  status: GuidanceStatus;
  note: string;
  labels: unknown[];
  motion: unknown;
};

export async function fetchGuidance(input: {
  message: string;
  frame: string;
  videoTitle?: string;
  /** Recent grounded subject for resolving a pronoun; current frame still wins. */
  subjectHint?: string | null;
}): Promise<GuidanceResponse> {
  const response = await fetch("/api/guide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Motion guidance failed");
  }
  return {
    status: STATUSES.has(data.status) ? data.status : "not_visible",
    note: String(data.note || "Motion guide unavailable").slice(0, 80),
    labels: Array.isArray(data.labels) ? data.labels : [],
    motion: data.motion ?? null,
  };
}

/** Resolve raw label indices only after the boxes have passed client sanitation. */
export function normalizeGuidance(
  raw: GuidanceResponse,
  labels: HighlightLabel[],
): GuidanceCue {
  if (raw.status !== "ready") {
    return { status: raw.status, note: raw.note, motion: null };
  }
  if (!raw.motion || typeof raw.motion !== "object") {
    return {
      status: "not_visible",
      note: "I couldn't ground a safe motion path in this view.",
      motion: null,
    };
  }

  const motion = raw.motion as Record<string, unknown>;
  const type = String(motion.type || "") as GuidanceMotionType;
  const direction = String(motion.direction || "") as GuidanceDirection;
  const pivot = Number(motion.pivot);
  const moving = Number(motion.moving);
  const pivotLabel = labels[pivot];
  const movingLabel = labels[moving];
  if (
    !MOTION_TYPES.has(type) ||
    !DIRECTIONS.has(direction) ||
    !Number.isInteger(pivot) ||
    !Number.isInteger(moving) ||
    pivot === moving ||
    !pivotLabel ||
    !movingLabel
  ) {
    return {
      status: "not_visible",
      note: "I couldn't ground a safe motion path in this view.",
      motion: null,
    };
  }

  return {
    status: "ready",
    note: raw.note,
    motion: {
      type,
      pivotId: pivotLabel.id,
      movingId: movingLabel.id,
      direction,
      sweep: Math.min(150, Math.max(25, Number(motion.sweep) || 75)),
      label: String(motion.label || raw.note || "Move steadily")
        .trim()
        .slice(0, 48),
    },
  };
}
