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
    .replace(/[’]/g, "'")
    .replace(/[.!?]+$/g, "")
    .trim();

  if (text === "check my work") return "verify";
  if (/^verify\s+(?:this|that|it)$/.test(text)) return "verify";
  if (/^did i do (?:that|it) right$/.test(text)) return "verify";
  return null;
}

export async function fetchVerify(input: {
  goal: string;
  instruction: string;
  beforeFrame: string;
  afterFrame: string;
  videoTitle?: string;
  manualStepText?: string;
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
