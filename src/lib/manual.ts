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
  | { type: "current_step" }
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

const PRONOUN_ONLY_RE = /^(?:it|this|that|these|those|them|one|thing)$/;

// Verbs that say nothing on their own: "open this" leaves "open", which is not
// a topic worth searching for. Live mode looks at the frame instead.
const BARE_VERB_RE =
  /^(?:do|use|open|close|make|fix|repair|install|remove|replace|hold|handle|start|stop|operate|unlock|attach|detach|build|work|turn|pull|push|lift)$/;

/**
 * Pull the subject out of the utterance: "steps for opening this water bottle"
 * becomes "opening a water bottle". Without this the manual topic falls back to
 * the video title, which is meaningless on a live camera feed.
 *
 * Returns undefined when the user named no subject ("open the manual", "how do
 * I do this") so the caller can decide how to fill it in.
 */
export function extractTopic(message: string): string | undefined {
  let s = message
    .toLowerCase()
    .replace(/[’”]/g, "'")
    .replace(/[.?!,]+$/g, "")
    .trim();

  // "the manual for X" / "a guide on X" — the subject follows the preposition.
  const scoped = s.match(
    /\b(?:manual|guide|instructions?|recipe|steps?)\b.*?\b(?:for|on|about)\s+(.+)$/,
  );
  if (scoped) {
    s = scoped[1];
  } else {
    s = s
      .replace(/^(?:hey|ok|okay)\s+\w+[\s,]*/, "")
      .replace(/\b(?:can|could|would)\s+you\s+/g, "")
      .replace(
        /^.*?\b(?:how\s+(?:do|does|can|would)\s+(?:i|you|we|one|it)|how\s+to|walk\s+me\s+through|talk\s+me\s+through|teach\s+me(?:\s+how)?(?:\s+to)?|guide\s+me(?:\s+through)?|show\s+me\s+how(?:\s+to)?|help\s+me|steps?\s+(?:for|to)|instructions?\s+(?:for|to))\s+/,
        "",
      );

    // Peel off the command shell around a named document: "show me the sushi
    // manual" -> "sushi". Guarded so it can't eat the verb in a real request
    // like "open this water bottle".
    if (/\b(?:manual|guide|instructions?|recipe|steps?)\b/.test(s)) {
      s = s
        .replace(
          /^(?:open|show|pull\s+up|start|bring\s+up|get|give\s+me|read)\s+(?:me\s+)?/,
          "",
        )
        .replace(/\s*\b(?:manual|guide|instructions?|recipe|steps?)\b\s*$/, "");
    }
  }

  s = s
    .replace(/\bplease\b/g, "")
    .replace(/^(?:i\s+)?(?:want|need)\s+to\s+/, "")
    // A demonstrative is useless as a search term, but the noun after it isn't.
    .replace(/\b(?:this|that|these|those)\s+(?=\w)/g, "a ")
    .replace(/\b(?:right now|on camera|in the video|in this video|here)\b/g, "")
    // Nothing left to point at: "open this" / "use it".
    .replace(/\s+(?:this|that|these|those|it|them|one|thing)$/, "")
    .replace(/^(?:the|a|an|my)(?:\s+|$)/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (s.length < 3) return undefined;
  if (PRONOUN_ONLY_RE.test(s)) return undefined;
  if (BARE_VERB_RE.test(s)) return undefined;
  if (!/[a-z]/.test(s)) return undefined;
  return s.slice(0, 90);
}

/**
 * Ask Grok to name what the camera is pointed at, for when the user says "how
 * do I open this" with no noun. Reuses the vision path in /api/chat and skips
 * TTS, since this answer is only used as a search topic.
 */
export async function identifyTopicFromFrame(
  frame: string,
  heard: string,
): Promise<string | undefined> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `The user asked: "${heard}". Name the specific object they mean in 2 to 5 words, as a search phrase describing the task (for example "opening a water bottle"). Reply with the phrase only, no punctuation.`,
        frames: [frame],
      }),
    });
    const data = await res.json();
    if (!res.ok) return undefined;
    const phrase = String(data.reply || "")
      .replace(/["'.]/g, "")
      .trim();
    if (phrase.length < 3 || phrase.length > 90) return undefined;
    return phrase.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Topic for a manual request. The named guides come first because they must map
 * to an exact string the pamphlet lookup recognizes; anything else falls back to
 * whatever subject the user actually named.
 */
function topicFromUtterance(t: string): string | undefined {
  if (/\bsushi\b/.test(t)) return "sushi";
  if (/\bmicke\b/.test(t)) return "IKEA MICKE desk";
  if (/\bikea\b/.test(t) && /\bdesk\b/.test(t)) return "IKEA MICKE desk";
  if (/\bikea\b/.test(t)) return "IKEA MICKE desk";
  if (
    /\bdesk\b/.test(t) &&
    /\b(manual|guide|instructions?|assembly|assemble)\b/.test(t)
  ) {
    return "IKEA MICKE desk";
  }
  return extractTopic(t);
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
  const t = message.toLowerCase().replace(/[’”']/g, "'").trim();
  if (!t) return null;

  if (
    /\b(close|dismiss|hide|put away)\b/.test(t) &&
    /\b(manual|guide|instructions?|recipe|overlay|steps?|pages?)\b/.test(t)
  ) {
    return { type: "close_manual" };
  }
  if (manualOpen && /^(close|dismiss|hide)( it)?\.?$/.test(t)) {
    return { type: "close_manual" };
  }

  if (
    /\b(open|show|pull up|start|bring up|get|give me|read)\b/.test(t) &&
    /\b(manual|guide|instructions?|recipe|steps?|assembly)\b/.test(t) &&
    !/\b(next|previous|prev|continue|go on|proceed|flip)\b/.test(t)
  ) {
    return { type: "open_manual", topic: topicFromUtterance(t) };
  }
  // Bare "sushi manual" / "ikea manual" / "desk manual"
  if (
    /\b(sushi|ikea|desk)\b/.test(t) &&
    /\b(manual|guide|recipe|instructions?|assembly)\b/.test(t)
  ) {
    return {
      type: "open_manual",
      topic: topicFromUtterance(t) || "IKEA MICKE desk",
    };
  }
  if (
    /^(the\s+)?manual\.?$/.test(t) ||
    /^(show|open)\s+(the\s+)?manual\.?$/.test(t)
  ) {
    return { type: "open_manual" };
  }
  if (
    /\b(how (do (i|you|we)|to|does (one|it))\b|walk me through|talk me through|teach me|guide me|show me how|help me (make|build|fix|repair|do|replace|install|assemble)|steps? (for|to)|instructions? (for|to)|assemble (the|this|an?)?\s*(desk|ikea)|assembly (guide|manual|instructions?))\b/.test(
      t,
    )
  ) {
    return { type: "open_manual", topic: topicFromUtterance(t) };
  }

  // Snap a panel to a screen edge / corner. Parsed before the manual-open gate
  // so the tools panel can be moved on its own.
  if (manualOpen || toolsOpen) {
    const move = parseMoveAction(t, manualOpen, toolsOpen);
    if (move) return move;
  }

  if (!manualOpen) return null;

  if (
    /\b(next(?:\s+(step|page))?|continue|go on|proceed|keep going|what'?s next|what is next|next one|skip ahead|flip(?:\s+(the\s+)?page)?|turn(?:\s+(the\s+)?page)?)\b/.test(
      t,
    ) ||
    /^(next|flip)[.!?]?$/.test(t)
  ) {
    return { type: "next_step" };
  }

  if (
    /\b(previous(?:\s+(step|one|page))?|prev(?:\s+(step|page))?|go back|back(?:\s+(a\s+step|up|one|a\s+page))?|last step|flip\s+back)\b/.test(
      t,
    ) ||
    /^(previous|back)[.!?]?$/.test(t)
  ) {
    return { type: "prev_step" };
  }

  // Snap the panel to whatever step the playhead is on (timestamped manuals).
  // Parsed before goto/read so "switch to my current step" never falls through.
  if (
    /\b(switch|go|jump|skip|sync|catch|take|bring|match|snap)\b[^.?!]*\b(current|actual|present) (step|page|one)\b/.test(
      t,
    ) ||
    /\bsync (the )?(steps?|manual|guide|pages?)\b/.test(t) ||
    /\b(what|which) (step|page) (am i|are we) (on|at)\b/.test(t) ||
    /\b(step|page) (for|at) (this|the current) (point|time|moment|part)\b/.test(t)
  ) {
    return { type: "current_step" };
  }

  const goto = t.match(
    /\b(?:go to|goto|jump to|skip to|show(?: me)?|read|flip to)?\s*(?:step|page)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/,
  );
  if (goto) {
    const step = parseStepNum(goto[1]);
    if (step) return { type: "goto_step", step };
  }

  if (
    /\b(read(?:\s+it)?|repeat|say(?:\s+it)?\s+again|what(?:'s| is) (?:this|the) (?:step|page)|current step)\b/.test(
      t,
    )
  ) {
    return { type: "read_step" };
  }

  return null;
}

/**
 * Index of the step the playhead is inside: the last step whose `at` timestamp
 * has been reached. Null when the doc's steps carry no timestamps.
 */
export function stepIndexAtTime(
  doc: ManualDoc,
  currentTime: number,
): number | null {
  if (!Number.isFinite(currentTime)) return null;
  let idx: number | null = null;
  for (let i = 0; i < doc.steps.length; i++) {
    const at = doc.steps[i].at;
    if (typeof at !== "number") continue;
    if (at <= currentTime + 0.001) idx = i;
    else break;
  }
  // Before the first timestamped step still counts as being on it.
  if (idx == null && doc.steps.some((s) => typeof s.at === "number")) return 0;
  return idx;
}

export function applyManualAction(
  state: ManualOverlayState | null,
  action: Exclude<ManualAction, null>,
  doc?: ManualDoc,
  currentTime?: number,
): { state: ManualOverlayState | null; speak: string } {
  const pageWord = (d: ManualDoc | undefined) =>
    d?.mode === "pdf" ? "Page" : "Step";

  switch (action.type) {
    case "open_manual": {
      if (!doc) {
        return { state, speak: "I couldn't load a manual." };
      }
      // Timestamped (authored) manuals open on the step the playhead is in —
      // mid-video "pull up the steps" lands where the viewer actually is.
      const syncedIndex =
        currentTime != null ? stepIndexAtTime(doc, currentTime) : null;
      const next: ManualOverlayState = {
        doc,
        stepIndex: syncedIndex ?? 0,
        x: state?.x ?? 24,
        y: state?.y ?? 96,
      };
      const step = doc.steps[0];
      const label = pageWord(doc);
      return {
        state: next,
        speak:
          doc.mode === "pdf"
            ? `${doc.title}. Opening the official assembly pamphlet, ${label.toLowerCase()} 1 of ${doc.steps.length}.`
            : `${doc.title}. ${label} 1 of ${doc.steps.length}: ${step?.text ?? ""}`.trim(),
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
          speak: `You're on the last ${pageWord(state.doc).toLowerCase()}, ${state.doc.steps.length}.`,
        };
      }
      const stepIndex = state.stepIndex + 1;
      const step = state.doc.steps[stepIndex];
      const label = pageWord(state.doc);
      return {
        state: { ...state, stepIndex, loading: false },
        speak:
          state.doc.mode === "pdf"
            ? `${label} ${stepIndex + 1} of ${state.doc.steps.length}.`
            : `${label} ${stepIndex + 1}: ${step.text}`,
      };
    }
    case "prev_step": {
      if (!state) return { state, speak: "No manual is open." };
      if (state.stepIndex <= 0) {
        return {
          state,
          speak: `You're already on ${pageWord(state.doc).toLowerCase()} 1.`,
        };
      }
      const stepIndex = state.stepIndex - 1;
      const step = state.doc.steps[stepIndex];
      const label = pageWord(state.doc);
      return {
        state: { ...state, stepIndex },
        speak:
          state.doc.mode === "pdf"
            ? `${label} ${stepIndex + 1} of ${state.doc.steps.length}.`
            : `${label} ${stepIndex + 1}: ${step.text}`,
      };
    }
    case "goto_step": {
      if (!state) return { state, speak: "No manual is open." };
      const idx = action.step - 1;
      if (idx < 0 || idx >= state.doc.steps.length) {
        return {
          state,
          speak: `That guide only has ${state.doc.steps.length} ${state.doc.mode === "pdf" ? "pages" : "steps"}.`,
        };
      }
      const step = state.doc.steps[idx];
      const label = pageWord(state.doc);
      return {
        state: { ...state, stepIndex: idx },
        speak:
          state.doc.mode === "pdf"
            ? `${label} ${action.step} of ${state.doc.steps.length}.`
            : `${label} ${action.step}: ${step.text}`,
      };
    }
    case "move_overlay": {
      if (!state) return { state, speak: "No manual is open." };
      const panelW = state.doc.mode === "pdf" ? 420 : 280;
      const panelH = state.doc.mode === "pdf" ? 520 : 220;
      const { x, y } = snapPosition(action.snap, state.x, state.y, panelW, panelH);

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
      const label = pageWord(state.doc);
      return {
        state,
        speak:
          state.doc.mode === "pdf"
            ? `${label} ${state.stepIndex + 1} of ${state.doc.steps.length}.`
            : `${label} ${state.stepIndex + 1} of ${state.doc.steps.length}: ${step.text}`,
      };
    }
    case "current_step": {
      if (!state) return { state, speak: "No manual is open." };
      if (state.loading) {
        return { state, speak: "Still loading the guide — one sec." };
      }
      const idx = stepIndexAtTime(state.doc, currentTime ?? NaN);
      if (idx == null) {
        return { state, speak: "This guide isn't synced to the video." };
      }
      const step = state.doc.steps[idx];
      const label = pageWord(state.doc);
      return {
        state: { ...state, stepIndex: idx },
        speak: `${label} ${idx + 1} of ${state.doc.steps.length}: ${step?.text ?? ""}`.trim(),
      };
    }
    default:
      return { state, speak: "" };
  }
}

function buildPdfManual(input: {
  topic: string;
  pdfUrl: string;
  pages: number;
  title?: string;
  sourceUrl?: string;
}): ManualDoc {
  const pages = Math.max(1, Math.min(80, Math.floor(input.pages)));
  return {
    title: input.title || "IKEA MICKE desk — assembly pamphlet",
    topic: input.topic,
    mode: "pdf",
    pdfUrl: input.pdfUrl,
    source: {
      title: "Official IKEA assembly instructions",
      url:
        input.sourceUrl ||
        "https://www.ikea.com/us/en/assembly_instructions/micke-desk-black-brown__AA-476633-15-100.pdf",
      siteName: "ikea.com",
    },
    steps: Array.from({ length: pages }, (_, i) => ({
      n: i + 1,
      text: `Assembly diagram page ${i + 1}`,
    })),
  };
}

const MICKE_PDF = {
  pdfUrl: "/manuals/micke-desk.pdf",
  pages: 28,
  title: "MICKE desk — official IKEA manual",
  sourceUrl:
    "https://www.ikea.com/us/en/assembly_instructions/micke-desk-black-brown__AA-476633-15-100.pdf",
};

function wantsIkeaPamphlet(
  topic: string,
  input: { manualPdf?: string; videoId?: string },
): boolean {
  if (input.manualPdf) return true;
  if (input.videoId === "ikea") return true;
  const t = topic.toLowerCase();
  return (
    /\b(ikea|micke)\b/.test(t) ||
    (/\bdesk\b/.test(t) &&
      /\b(manual|assembly|assemble|instructions?)\b/.test(t))
  );
}

function clearStaleTextManualCache(topic: string) {
  try {
    const keys = new Set([
      `grokeye-manual:${topic.toLowerCase()}`,
      "grokeye-manual:ikea desk assembly instructions",
      "grokeye-manual:ikea micke desk",
      "grokeye-manual:ikea furniture",
      "grokeye-manual:ikea",
      "grokeye-manual:desk",
    ]);
    // Sweep any cached word-summary manuals that mention IKEA / MICKE / desk.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("grokeye-manual:")) keys.add(key);
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as ManualDoc;
        const looksIkea =
          /\b(ikea|micke|desk)\b/i.test(key) ||
          /\b(ikea|micke)\b/i.test(parsed?.topic || "") ||
          /\b(ikea|micke)\b/i.test(parsed?.title || "");
        if (looksIkea && parsed?.mode !== "pdf") localStorage.removeItem(key);
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* private mode */
  }
}

export async function fetchManual(input: {
  topic?: string;
  videoTitle?: string;
  videoDescription?: string;
  manualPdf?: string;
  manualPdfPages?: number;
  videoId?: string;
}): Promise<ManualDoc> {
  const topic = (input.topic || input.videoTitle || "sushi").trim();
  // Always serve the official IKEA pamphlet for desk / MICKE / ikea video — never LLM summaries.
  if (wantsIkeaPamphlet(topic, input)) {
    clearStaleTextManualCache(topic);
    return buildPdfManual({
      topic,
      pdfUrl: input.manualPdf || MICKE_PDF.pdfUrl,
      pages: input.manualPdfPages || MICKE_PDF.pages,
      title: MICKE_PDF.title,
      sourceUrl: MICKE_PDF.sourceUrl,
    });
  }

  // v2 drops manuals cached back when every guide was padded to 6 steps.
  // videoId in the key keeps authored per-clip scripts from colliding with a
  // web manual cached under the same topic.
  const cacheKey = `grokeye-manual:v2:${input.videoId || ""}:${topic.toLowerCase()}`;

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
