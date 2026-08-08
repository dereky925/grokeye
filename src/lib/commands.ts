import type { ManualAction } from "./manual";

/**
 * Command snapping: correct near-miss speech recognition for the fixed
 * control vocabulary (next/prev/open/close/goto step). Runs as a FALLBACK
 * after the exact regex parser in `parseManualAction`, and scores every
 * recognition alternative — so a misheard top guess ("next stop") can still
 * resolve to the right intent ("next step").
 */

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

const SOUNDEX_CODES: Record<string, string> = {
  b: "1", f: "1", p: "1", v: "1",
  c: "2", g: "2", j: "2", k: "2", q: "2", s: "2", x: "2", z: "2",
  d: "3", t: "3",
  l: "4",
  m: "5", n: "5",
  r: "6",
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[n];
}

/** Compact Soundex — catches homophone-ish mishears ("necks" ≈ "next"). */
function soundex(word: string): string {
  const a = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!a) return "";
  let out = a[0].toUpperCase();
  let prev = SOUNDEX_CODES[a[0]] ?? "";
  for (let i = 1; i < a.length && out.length < 4; i += 1) {
    const ch = a[i];
    const code = SOUNDEX_CODES[ch] ?? "";
    if (code && code !== prev) out += code;
    if (ch !== "h" && ch !== "w") prev = code;
  }
  return (out + "000").slice(0, 4);
}

type SnapCommand = { intent: Exclude<ManualAction, null>; phrases: string[] };

const COMMANDS: SnapCommand[] = [
  {
    intent: { type: "next_step" },
    phrases: ["next step", "next", "next one", "continue", "go on", "keep going", "proceed", "forward"],
  },
  {
    intent: { type: "prev_step" },
    phrases: ["previous step", "previous", "previous one", "back", "go back", "back up", "last step", "backward"],
  },
  {
    intent: { type: "close_manual" },
    phrases: ["close manual", "close", "close it", "dismiss", "hide", "hide manual"],
  },
  {
    intent: { type: "open_manual" },
    phrases: ["show steps", "show me the steps", "open manual", "open the manual", "show the manual", "walk me through", "guide me", "instructions"],
  },
];

function extractStep(words: string[]): number | null {
  const idx = words.indexOf("step");
  if (idx === -1) return null;
  const after = words[idx + 1];
  if (!after) return null;
  const n = Number(after);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return NUM_WORDS[after] ?? null;
}

function scorePhrase(heardWords: string[], phrase: string): number {
  const heard = heardWords.join(" ");
  const tokens = phrase.split(" ");
  const lev = 1 - levenshtein(heard, phrase) / Math.max(heard.length, phrase.length, 1);
  const lastPhon =
    soundex(heardWords[heardWords.length - 1] ?? "") === soundex(tokens[tokens.length - 1])
      ? 1
      : 0;

  let bonus = 0;
  if (tokens.length >= 2 && tokens.every((t) => heardWords.includes(t))) {
    bonus = 0.9;
  } else if (tokens.length === 1 && heardWords.length <= 2 && heardWords.includes(tokens[0])) {
    bonus = 0.85;
  }

  return Math.max(lev, 0.55 * lev + 0.45 * lastPhon, bonus);
}

/**
 * Best-effort snap of misheard speech to a known control command.
 * Returns null (fall through to Grok Q&A) when nothing is confidently a command.
 */
export function snapCommand(
  candidates: string[],
  manualOpen: boolean,
  threshold = 0.72,
): ManualAction {
  let best: { action: ManualAction; score: number } = { action: null, score: 0 };

  for (const raw of candidates) {
    const heard = normalize(raw);
    if (!heard) continue;
    const words = heard.split(" ").filter(Boolean);
    // Only snap short, command-like utterances — never long free-form questions.
    if (words.length === 0 || words.length > 5) continue;

    if (manualOpen) {
      const step = extractStep(words);
      if (step != null) return { type: "goto_step", step };
    }

    for (const cmd of COMMANDS) {
      // Context gate: only "open" makes sense when closed; skip re-open when already open.
      if (!manualOpen && cmd.intent.type !== "open_manual") continue;
      if (manualOpen && cmd.intent.type === "open_manual") continue;

      const score = Math.max(...cmd.phrases.map((p) => scorePhrase(words, p)));
      if (score > best.score) best = { action: cmd.intent, score };
    }
  }

  return best.score >= threshold ? best.action : null;
}
