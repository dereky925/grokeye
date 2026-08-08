import type { Tool } from "../types";

/** True when the user is asking what tools/equipment a step needs (to LIST them). */
export function wantsTools(message: string): boolean {
  const t = message.toLowerCase().replace(/[’']/g, "'");
  if (!/\b(tools?|equipment|gear|supplies)\b/.test(t)) return false;
  // Not a "what tool is he using / holding on screen" vision question.
  if (/\b(he|she|they|is (he|she)|using|holding|on screen|that (tool|one))\b/.test(t)) {
    return false;
  }
  return /\b(need|needed|require|required|do i need|which|what|list|for (this|the|each|current)|to do (this|it))\b/.test(
    t,
  );
}

/** "a, b and c" for a natural spoken summary. */
export function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export async function fetchTools(input: {
  topic?: string;
  stepText?: string;
  stepNumber?: number | null;
  videoTitle?: string;
}): Promise<Tool[]> {
  const res = await fetch("/api/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Tool lookup failed");
  return (Array.isArray(data.tools) ? data.tools : []) as Tool[];
}
