import type { BufferedFrame } from "../hooks/useFrameBuffer";
import type { TaskVerdict } from "../types";

/**
 * What kind of turn a ledger entry records. Only turns that instructed a
 * physical action are auditable; pure Q&A and widget navigation are kept for
 * context but never verified.
 */
export type LedgerEntryKind =
  | "chat"
  | "web"
  | "widget"
  | "toolkit"
  | "flip"
  /** Locate-only highlight — becomes `highlight_route` once a link lands. */
  | "highlight"
  /** Highlight with a source→target connection link: auditable. */
  | "highlight_route"
  | "guidance"
  | "manual_step"
  | "ghost"
  | "verify"
  | "audit";

export type EntryStatus =
  | "unaudited"
  | "verified"
  | "failed"
  | "unverified"
  | "escalated";

export type LedgerFrame = {
  url: string;
  /** performance.now() at capture — survives seeks and loop wraps. */
  t: number;
  mediaTime: number;
};

export type LedgerVerification = {
  verdict: TaskVerdict;
  spoken: string;
  at: number;
  /** "external" is the seam for verdicts produced outside this module. */
  source: "audit" | "single_verify" | "external";
};

export type LedgerEntry = {
  id: string;
  question: string;
  /** What Grok actually spoke — the instruction being audited. */
  answer: string;
  kind: LedgerEntryKind;
  mediaTime: number;
  /** performance.now() at turn start. */
  askedAtT: number;
  /** Wall clock, injectable for tests. */
  askedAtMs: number;
  /** Speech-onset frame data URL. */
  beforeFrame: string | null;
  afterFrame: LedgerFrame | null;
  /** Highest-motion frame between ask and after — the action itself. */
  midFrame: LedgerFrame | null;
  manualStepText?: string;
  verification: LedgerVerification | null;
  status: EntryStatus;
};

export type SessionLedger = {
  videoId: string;
  seq: number;
  entries: LedgerEntry[];
};

/** ≤3 frames × ~80KB × 12 entries keeps the ledger a few MB at worst. */
export const MAX_LEDGER_ENTRIES = 12;

const ACTIONABLE_KINDS: ReadonlySet<LedgerEntryKind> = new Set([
  "guidance",
  "highlight_route",
  "manual_step",
  "ghost",
]);

export function createLedger(videoId: string): SessionLedger {
  return { videoId, seq: 0, entries: [] };
}

/** The id the next appendTurn will assign — lets async callbacks pre-reference it. */
export function nextEntryId(ledger: SessionLedger): string {
  return `${ledger.videoId}#${ledger.seq + 1}`;
}

export type AppendTurnInput = {
  question: string;
  answer: string;
  kind: LedgerEntryKind;
  mediaTime: number;
  askedAtT: number;
  nowMs: number;
  beforeFrame: string | null;
  manualStepText?: string;
};

export function appendTurn(
  ledger: SessionLedger,
  input: AppendTurnInput,
): { ledger: SessionLedger; entryId: string } {
  const entryId = nextEntryId(ledger);
  const entry: LedgerEntry = {
    id: entryId,
    question: String(input.question || "").trim(),
    answer: String(input.answer || "").trim(),
    kind: input.kind,
    mediaTime: input.mediaTime,
    askedAtT: input.askedAtT,
    askedAtMs: input.nowMs,
    beforeFrame: input.beforeFrame || null,
    afterFrame: null,
    midFrame: null,
    manualStepText: input.manualStepText,
    verification: null,
    status: "unaudited",
  };
  const entries = [...ledger.entries, entry].slice(-MAX_LEDGER_ENTRIES);
  return {
    ledger: { videoId: ledger.videoId, seq: ledger.seq + 1, entries },
    entryId,
  };
}

function updateEntry(
  ledger: SessionLedger,
  entryId: string,
  update: (entry: LedgerEntry) => LedgerEntry,
): SessionLedger {
  const index = ledger.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) return ledger;
  const entries = ledger.entries.slice();
  entries[index] = update(entries[index]);
  return { ...ledger, entries };
}

/** Upgrade a locate-only highlight once its source→target link resolves. */
export function markRouted(
  ledger: SessionLedger,
  entryId: string,
): SessionLedger {
  return updateEntry(ledger, entryId, (entry) =>
    entry.kind === "highlight" ? { ...entry, kind: "highlight_route" } : entry,
  );
}

export function attachAfterFrames(
  ledger: SessionLedger,
  entryId: string,
  after: LedgerFrame | null,
  mid: LedgerFrame | null,
): SessionLedger {
  return updateEntry(ledger, entryId, (entry) => ({
    ...entry,
    afterFrame: after,
    midFrame: mid,
  }));
}

const VERDICT_STATUS: Record<TaskVerdict, EntryStatus> = {
  complete: "verified",
  not_complete: "failed",
  not_visible: "unverified",
  unsafe_to_judge: "unverified",
};

export function recordVerdict(
  ledger: SessionLedger,
  entryId: string,
  input: {
    verdict: TaskVerdict;
    spoken: string;
    source: LedgerVerification["source"];
    nowMs: number;
  },
): SessionLedger {
  const status = VERDICT_STATUS[input.verdict];
  if (!status) return ledger;
  return updateEntry(ledger, entryId, (entry) => ({
    ...entry,
    verification: {
      verdict: input.verdict,
      spoken: String(input.spoken || "").trim(),
      at: input.nowMs,
      source: input.source,
    },
    // Never regress an already-escalated entry back into the audit pool.
    status: entry.status === "escalated" ? entry.status : status,
  }));
}

export function isActionable(entry: LedgerEntry): boolean {
  return ACTIONABLE_KINDS.has(entry.kind) && entry.beforeFrame != null;
}

/**
 * Entries the next audit should judge: never-audited actions plus previously
 * failed ones (the user may have fixed them — re-check with a fresh frame).
 * Verified and already-escalated entries stay settled.
 */
export function selectAuditItems(ledger: SessionLedger): LedgerEntry[] {
  return ledger.entries.filter(
    (entry) =>
      isActionable(entry) &&
      (entry.status === "unaudited" || entry.status === "failed"),
  );
}

export function markEscalated(
  ledger: SessionLedger,
  entryIds: readonly string[],
): SessionLedger {
  const ids = new Set(entryIds);
  if (!ids.size) return ledger;
  return {
    ...ledger,
    entries: ledger.entries.map((entry) =>
      ids.has(entry.id) && entry.status === "unverified"
        ? { ...entry, status: "escalated" }
        : entry,
    ),
  };
}

/** Below this mean-luma-diff (0–255 scale) a frame counts as "settled". */
const DEFAULT_SETTLE_MOTION = 6;

/**
 * Pick the frames that show what the user did after being told to do it.
 * `mid` is the motion peak (the action itself); `after` is the last settled
 * frame following that peak (action finished, hands out of the way), falling
 * back to the newest sample. Wall-clock `t` filtering means frames from a
 * pre-seek or pre-loop timeline can never leak in — the buffer clears on
 * rewind, and anything still present with `t > askedAtT` was truly captured
 * after the ask.
 */
export function selectAfterFrame(
  history: readonly BufferedFrame[],
  askedAtT: number,
  options: { settleMotion?: number } = {},
): { after: BufferedFrame | null; mid: BufferedFrame | null } {
  const settleMotion = options.settleMotion ?? DEFAULT_SETTLE_MOTION;
  const candidates = history
    .filter(
      (frame) =>
        Boolean(frame.url) &&
        Number.isFinite(frame.t) &&
        Number.isFinite(frame.mediaTime) &&
        frame.t > askedAtT,
    )
    .slice()
    .sort((a, b) => a.t - b.t);
  if (!candidates.length) return { after: null, mid: null };

  let mid: BufferedFrame | null = null;
  for (const frame of candidates) {
    if (!mid || frame.motion > mid.motion) mid = frame;
  }
  // Motion never rose above the settle floor → nothing happened worth a
  // separate "during" frame.
  if (mid && mid.motion <= settleMotion) mid = null;

  let after: BufferedFrame | null = null;
  if (mid) {
    for (const frame of candidates) {
      if (frame.t > mid.t && frame.motion <= settleMotion) after = frame;
    }
  }
  if (!after) after = candidates[candidates.length - 1];
  if (mid && after && mid.url === after.url) mid = null;

  return { after, mid };
}
