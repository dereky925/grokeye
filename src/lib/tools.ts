import type { Tool, ToolkitDoc, ToolkitItem, ToolStatus } from "../types";

export type ToolsAction =
  | { type: "open_tools" }
  | { type: "close_tools" }
  | null;

const TOOL_WORDS =
  /\b(tools?|equipment|gear|supplies|toolkit|tool\s*(?:list|kit)|checklist)\b/;

const STATUSES = new Set<ToolStatus>(["in_view", "missing", "unknown"]);

/**
 * Fast local router for the tool-checklist dropdown.
 * Returns null when the utterance should fall through to the next router.
 */
export function parseToolsAction(
  message: string,
  toolsOpen: boolean,
): ToolsAction {
  const t = message.toLowerCase().replace(/[’”]/g, "'").trim();
  if (!t) return null;

  if (/\b(close|dismiss|hide|put away)\b/.test(t) && TOOL_WORDS.test(t)) {
    return { type: "close_tools" };
  }
  if (toolsOpen && /^(close|dismiss|hide)( it)?\.?$/.test(t)) {
    return { type: "close_tools" };
  }

  // "what/which tools do I need", "what equipment should I use"
  if (
    /\b(what|which)\b/.test(t) &&
    TOOL_WORDS.test(t) &&
    /\b(need|needed|needs|use|using|grab|get|require[sd]?|should|missing)\b/.test(t)
  ) {
    return { type: "open_tools" };
  }
  // "what do I need for this job" — but not "what do I need to do/know/say"
  if (/\bwhat\s+(?:do|will|would)\s+i\s+need\b(?!\s+to\s+(?:do|know|say))/.test(t)) {
    return { type: "open_tools" };
  }
  // "am I missing anything", "what am I missing", "do I have everything"
  if (/\bam\s+i\s+missing\b/.test(t)) return { type: "open_tools" };
  if (/\bwhat(?:'s| is)\s+missing\b/.test(t)) return { type: "open_tools" };
  if (/\bdo\s+i\s+have\s+everything\b/.test(t)) return { type: "open_tools" };
  if (/\bwhat(?:'s| is)\s+in\s+(?:my|the)\s+(?:kit|toolkit|bag)\b/.test(t)) {
    return { type: "open_tools" };
  }
  // "show me the tool list", "pull up the tools"
  if (
    /\b(show|open|pull up|bring up|give me|list)\b/.test(t) &&
    TOOL_WORDS.test(t)
  ) {
    return { type: "open_tools" };
  }

  return null;
}

function normalizeToolkit(raw: unknown): ToolkitDoc {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const tools: ToolkitItem[] = (Array.isArray(o.tools) ? o.tools : [])
    .map((item) => {
      const t = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const status = String(t.status || "");
      return {
        name: String(t.name || "").trim().slice(0, 40),
        purpose: String(t.purpose || "").trim().slice(0, 60),
        status: (STATUSES.has(status as ToolStatus) ? status : "unknown") as ToolStatus,
        essential: Boolean(t.essential),
      };
    })
    // Duplicate names would also collide as React keys in the dropdown.
    .filter((t) => {
      const key = t.name.toLowerCase();
      if (!t.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);

  if (!tools.length) throw new Error("Toolkit has no tools");

  // Missing tools are the reason the user asked — surface them first.
  const rank = (t: ToolkitItem) => (t.status === "missing" ? 0 : 1);
  tools.sort((a, b) => rank(a) - rank(b));

  return {
    task: String(o.task || "This job").trim().slice(0, 60),
    tools,
    spoken: String(o.spoken || "").trim(),
  };
}

export async function fetchToolkit(input: {
  message: string;
  frame?: string;
  videoTitle?: string;
  videoDescription?: string;
}): Promise<ToolkitDoc> {
  const res = await fetch("/api/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Tool checklist failed");
  }
  return normalizeToolkit(data.toolkit);
}

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

/** Per-manual-step tools with reference images (manual steps tools overlay). */
export async function fetchTools(input: {
  topic?: string;
  stepText?: string;
  stepNumber?: number | null;
  videoTitle?: string;
}): Promise<Tool[]> {
  const res = await fetch("/api/step-tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Tool lookup failed");
  return (Array.isArray(data.tools) ? data.tools : []) as Tool[];
}
