import type { ManualDoc, ManualOverlayState } from "../types";

export type OverlaySnap =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** Which floating panel a move command is aimed at. */
export type OverlayTarget = "manual" | "tools";

export type ManualAction =
  | { type: "open_manual"; topic?: string }
  | { type: "close_manual" }
  | { type: "next_step" }
  | { type: "prev_step" }
  | { type: "goto_step"; step: number }
  | { type: "move_overlay"; snap: OverlaySnap; target: OverlayTarget }
  | { type: "read_step" }
  | null;

const NUM_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function parseStepNum(raw: string): number | null {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return NUM_WORDS[raw.toLowerCase()] ?? null;
}

/**
 * Screen coordinates for a snap target, sized to the panel being moved so it
 * lands flush against the edge. Falls back to the current position for axes the
 * snap doesn't constrain.
 */
export function snapPosition(
  snap: OverlaySnap,
  currentX: number,
  currentY: number,
  panelWidth: number,
  panelHeight: number,
): { x: number; y: number } {
  const pad = 16;
  const panelW = Math.min(panelWidth, window.innerWidth - 24);
  const maxX = Math.max(pad, window.innerWidth - panelW - pad);
  const maxY = Math.max(pad, window.innerHeight - panelHeight - pad);
  const midX = Math.round((pad + maxX) / 2);

  switch (snap) {
    case "left":
    case "top-left":
      return { x: pad, y: pad };
    case "right":
    case "top-right":
      return { x: maxX, y: pad };
    case "bottom-left":
      return { x: pad, y: maxY };
    case "bottom-right":
      return { x: maxX, y: maxY };
    case "top":
      return { x: midX, y: pad };
    case "bottom":
      return { x: midX, y: maxY };
    default:
      return { x: currentX, y: currentY };
  }
}

/**
 * Snap-to-edge parsing for "move the tools panel to the right" style commands.
 * Resolves which panel is meant so one panel's move never drags the other.
 */
function parseMoveAction(
  t: string,
  manualOpen: boolean,
  toolsOpen: boolean,
): ManualAction {
  const wantsMove =
    /\b(move|slide|shift|drag|nudge|push|snap|put|place)\b/.test(t) ||
    /\b(to the |go )(left|right|top|bottom|up|down)\b/.test(t) ||
    (/\b(manual|guide|overlay|panel|pane|window|it)\b/.test(t) &&
      /\b(left|right|top|bottom|up|down)\b/.test(t));
  if (!wantsMove) return null;

  const wantsBottom = /\b(bottom|lower)\b/.test(t);
  const wantsTop = /\b(top|upper)\b/.test(t);
  const wantsLeft = /\bleft\b/.test(t);
  const wantsRight = /\bright\b/.test(t);
  const wantsUp = /\b(up|upwards?)\b/.test(t);
  const wantsDown = /\b(down|downwards?)\b/.test(t);

  let snap: OverlaySnap | null = null;
  if (wantsLeft && wantsBottom) snap = "bottom-left";
  else if (wantsRight && wantsBottom) snap = "bottom-right";
  else if (wantsLeft && wantsTop) snap = "top-left";
  else if (wantsRight && wantsTop) snap = "top-right";
  else if (wantsLeft) snap = "left"; // top-left by default
  else if (wantsRight) snap = "right"; // top-right by default
  else if (wantsUp || (wantsTop && !wantsBottom)) snap = "top";
  else if (wantsDown || wantsBottom) snap = "bottom";
  if (!snap) return null;

  const saysTools = /\b(tools?|equipment)\b/.test(t);
  const saysManual = /\b(manual|guide|instructions?|recipe|steps?)\b/.test(t);

  // Explicitly named panel wins; if it isn't open, do nothing rather than
  // yanking the other one around.
  if (saysTools && !saysManual) {
    return toolsOpen ? { type: "move_overlay", snap, target: "tools" } : null;
  }
  if (saysManual && !saysTools) {
    return manualOpen ? { type: "move_overlay", snap, target: "manual" } : null;
  }

  // Unqualified ("move it left") — aim at whichever panel is open, manual first.
  const target: OverlayTarget = manualOpen ? "manual" : "tools";
  return { type: "move_overlay", snap, target };
}

/**
 * Fast local router for manual overlay voice control.
 * Returns null when the utterance should fall through to normal Grok Q&A.
 */
export function parseManualAction(
  message: string,
  manualOpen: boolean,
  toolsOpen = false,
): ManualAction {
  const t = message.toLowerCase().replace(/[’”]/g, "'").trim();
  if (!t) return null;

  if (
    /\b(close|dismiss|hide|put away)\b/.test(t) &&
    /\b(manual|guide|instructions?|recipe|overlay|steps?)\b/.test(t)
  ) {
    return { type: "close_manual" };
  }
  if (manualOpen && /^(close|dismiss|hide)( it)?\.?$/.test(t)) {
    return { type: "close_manual" };
  }

  if (
    /\b(open|show|pull up|start|bring up)\b/.test(t) &&
    /\b(manual|guide|instructions?|recipe|steps?)\b/.test(t) &&
    !/\b(next|previous|prev|continue|go on|proceed)\b/.test(t)
  ) {
    return { type: "open_manual" };
  }
  if (
    /\b(how (do (i|you|we)|to|does (one|it))\b|walk me through|talk me through|teach me|guide me|show me how|help me (make|build|fix|repair|do|replace|install)|steps? (for|to)|instructions? (for|to))\b/.test(
      t,
    )
  ) {
    return { type: "open_manual" };
  }

  // Snap a panel to a screen edge / corner. Parsed before the manual-open gate
  // so the tools panel can be moved on its own.
  if (manualOpen || toolsOpen) {
    const move = parseMoveAction(t, manualOpen, toolsOpen);
    if (move) return move;
  }

  if (!manualOpen) return null;

  if (
    /\b(next(?:\s+step)?|continue|go on|proceed|keep going|what'?s next|what is next|next one|skip ahead)\b/.test(
      t,
    ) ||
    /^next[.!?]?$/.test(t)
  ) {
    return { type: "next_step" };
  }

  if (
    /\b(previous(?:\s+(step|one))?|prev(?:\s+step)?|go back|back(?:\s+(a\s+step|up|one))?|last step)\b/.test(
      t,
    ) ||
    /^(previous|back)[.!?]?$/.test(t)
  ) {
    return { type: "prev_step" };
  }

  const goto = t.match(
    /\b(?:go to|goto|jump to|skip to|show(?: me)?|read)?\s*step\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/,
  );
  if (goto) {
    const step = parseStepNum(goto[1]);
    if (step) return { type: "goto_step", step };
  }

  if (
    /\b(read(?:\s+it)?|repeat|say(?:\s+it)?\s+again|what(?:'s| is) (?:this|the) step|current step)\b/.test(
      t,
    )
  ) {
    return { type: "read_step" };
  }

  return null;
}

export function applyManualAction(
  state: ManualOverlayState | null,
  action: Exclude<ManualAction, null>,
  doc?: ManualDoc,
): { state: ManualOverlayState | null; speak: string } {
  switch (action.type) {
    case "open_manual": {
      if (!doc) {
        return { state, speak: "I couldn't load a manual." };
      }
      const next: ManualOverlayState = {
        doc,
        stepIndex: 0,
        x: state?.x ?? 24,
        y: state?.y ?? 96,
      };
      const step = doc.steps[0];
      return {
        state: next,
        speak: `${doc.title}. Step 1 of ${doc.steps.length}: ${step?.text ?? ""}`.trim(),
      };
    }
    case "close_manual":
      return { state: null, speak: "Manual closed." };
    case "next_step": {
      if (!state) return { state, speak: "No manual is open." };
      if (state.loading) {
        return { state, speak: "Still loading the guide — one sec." };
      }
      if (state.stepIndex >= state.doc.steps.length - 1) {
        return {
          state,
          speak: `You're on the last step, step ${state.doc.steps.length}.`,
        };
      }
      const stepIndex = state.stepIndex + 1;
      const step = state.doc.steps[stepIndex];
      return {
        state: { ...state, stepIndex, loading: false },
        speak: `Step ${stepIndex + 1}: ${step.text}`,
      };
    }
    case "prev_step": {
      if (!state) return { state, speak: "No manual is open." };
      if (state.stepIndex <= 0) {
        return { state, speak: "You're already on step 1." };
      }
      const stepIndex = state.stepIndex - 1;
      const step = state.doc.steps[stepIndex];
      return {
        state: { ...state, stepIndex },
        speak: `Step ${stepIndex + 1}: ${step.text}`,
      };
    }
    case "goto_step": {
      if (!state) return { state, speak: "No manual is open." };
      const idx = action.step - 1;
      if (idx < 0 || idx >= state.doc.steps.length) {
        return {
          state,
          speak: `That guide only has ${state.doc.steps.length} steps.`,
        };
      }
      const step = state.doc.steps[idx];
      return {
        state: { ...state, stepIndex: idx },
        speak: `Step ${action.step}: ${step.text}`,
      };
    }
    case "move_overlay": {
      if (!state) return { state, speak: "No manual is open." };
      const { x, y } = snapPosition(action.snap, state.x, state.y, 280, 220);

      const label =
        action.snap === "left"
          ? "top left"
          : action.snap === "right"
            ? "top right"
            : action.snap.replace("-", " ");
      return {
        state: { ...state, x, y },
        speak: `Okay, ${label}.`,
      };
    }
    case "read_step": {
      if (!state) return { state, speak: "No manual is open." };
      const step = state.doc.steps[state.stepIndex];
      return {
        state,
        speak: `Step ${state.stepIndex + 1} of ${state.doc.steps.length}: ${step.text}`,
      };
    }
    default:
      return { state, speak: "" };
  }
}

export async function fetchManual(input: {
  topic?: string;
  videoTitle?: string;
  videoDescription?: string;
}): Promise<ManualDoc> {
  const topic = (input.topic || input.videoTitle || "sushi").trim();
  const cacheKey = `grokeye-manual:${topic.toLowerCase()}`;

  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ManualDoc;
      if (parsed?.steps?.length && parsed?.source?.url) return parsed;
    }
  } catch {
    /* ignore bad cache */
  }

  const res = await fetch("/api/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to generate manual");
  const manual = data.manual as ManualDoc;

  try {
    localStorage.setItem(cacheKey, JSON.stringify(manual));
  } catch {
    /* quota / private mode */
  }

  return manual;
}

export async function speakText(text: string): Promise<string> {
  const ttsRes = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!ttsRes.ok) {
    const err = await ttsRes.json().catch(() => ({}));
    throw new Error(err.error || "TTS failed");
  }
  const blob = await ttsRes.blob();
  return URL.createObjectURL(blob);
}
