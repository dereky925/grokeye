import type { HighlightKind, TaskVerdict } from "../types";

export type VerifyAction = "verify" | null;

export type VerifyAttention = {
  text: string;
  kind: HighlightKind;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type VerifyResult = {
  verdict: TaskVerdict;
  spoken: string;
  attention: VerifyAttention | null;
};

/** Narrow local grammar for an explicit request to judge the active task. */
export function parseVerifyAction(message: string): VerifyAction {
  const text = message
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[.!?]+$/g, "")
    .replace(/^(?:wait[,.\s]+)+/g, "")
    .trim();

  if (text === "check my work") return "verify";
  if (/^verify\s+(?:this|that|it)$/.test(text)) return "verify";
  if (/^did i do (?:that|it|this) right$/.test(text)) return "verify";
  if (/^did i miss (?:a |any |the )?steps?$/.test(text)) return "verify";
  if (/^what(?:'s| is) missing$/.test(text)) return "verify";
  return null;
}

export async function fetchVerify(input: {
  goal: string;
  instruction: string;
  /** Required for sealed-task verify; omit for catalog checklist + single frame. */
  beforeFrame?: string;
  afterFrame: string;
  videoTitle?: string;
  manualStepText?: string;
  /** Catalog process checklist (from WATCH-WINDOWS rubrics). */
  processSteps?: string[];
  /** Known visual failure modes for that checklist. */
  watchFor?: string[];
  /** Layout orientation for POV scenes (not a verdict). */
  sceneHint?: string;
  currentTime?: number;
}): Promise<VerifyResult> {
  const response = await fetch("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Verification failed");
  }
  return data as VerifyResult;
}
