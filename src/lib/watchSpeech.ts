import type { VoicePhase } from "../types";
import type { VerifyAttention } from "./verify";

/**
 * Proactive-speech arbiter: the single gate between a work-watcher finding
 * and Grok speaking unprompted. Machine-initiated speech is new in this app —
 * every rule here exists so a callout can never talk over the user, replay a
 * stale verdict after a seek/loop, or nag about a mistake twice.
 */

/** Give the user the floor for this long after any voice activity ends. */
export const WATCH_MIN_QUIET_MS = 2500;
/** Minimum spacing between proactive utterances, measured end-to-start. */
export const WATCH_PROACTIVE_COOLDOWN_MS = 10000;
/** A deferred finding may wait at most this long from detection. */
export const WATCH_PENDING_TTL_MS = 6000;
/** After phase returns to idle, wait this long before a deferred callout. */
export const WATCH_FLUSH_GRACE_MS = 1500;
/** Retry cadence while a deferred finding keeps deferring. */
export const WATCH_FLUSH_RETRY_MS = 750;
/** A finding older than this never speaks — the moment has passed. */
export const WATCH_MAX_FINDING_AGE_MS = 8000;
/** Playback may drift at most this far past the detection point. */
export const WATCH_MAX_PLAYHEAD_DRIFT_S = 6;

export type ProactiveFinding = {
  /** Stable per-mistake slug (window id, or a generic time bucket). */
  id: string;
  videoId: string;
  /** Model line to speak; must pass isEchoSafeCallout to reach TTS. */
  spoken: string;
  attention: VerifyAttention | null;
  /** Settled frame at detection — seeds the amber-zone tracker. */
  frame: string | null;
  playheadAtDetection: number;
  /** performance.now() when the verdict surfaced from the engine. */
  detectedAt: number;
  /** Watcher generation (seek/loop/video-change epoch) at detection. */
  seekEpoch: number;
  /** The engine matched this against an active TaskSession goal. */
  relatedToTask: boolean;
};

export type WatchGate = {
  now: number;
  watchEnabled: boolean;
  live: boolean;
  flipMode: boolean;
  tabHidden: boolean;
  videoPaused: boolean;
  videoSeeking: boolean;
  videoId: string;
  playhead: number;
  seekEpoch: number;
  phase: VoicePhase;
  turnInFlight: boolean;
  scanning: boolean;
  detecting: boolean;
  /** A user-requested callout still holds the stage. */
  highlightHold: boolean;
  ghostActive: boolean;
  /** When the last TTS/turn/capture activity ended (null = never). */
  lastActivityAt: number | null;
  lastProactiveEndedAt: number | null;
  announced: ReadonlySet<string>;
};

export type ArbiterDecision =
  | { action: "speak" }
  | { action: "defer"; reason: "user_capturing" | "grok_busy" }
  | { action: "drop"; reason: string };

export function dedupeKey(f: Pick<ProactiveFinding, "videoId" | "id">): string {
  return `${f.videoId}#${f.id}`;
}

/**
 * Hard invalidity is checked before transient business so a stale finding can
 * never survive in the pending slot; only rows that can heal defer.
 */
export function decideProactiveSpeech(
  f: ProactiveFinding,
  g: WatchGate,
): ArbiterDecision {
  if (!g.watchEnabled) return { action: "drop", reason: "disabled" };
  if (g.live || g.flipMode) return { action: "drop", reason: "mode" };
  if (g.tabHidden) return { action: "drop", reason: "hidden" };
  if (g.phase === "error") return { action: "drop", reason: "error" };
  if (g.videoPaused) return { action: "drop", reason: "paused" };
  if (g.videoSeeking) return { action: "drop", reason: "seeking" };
  if (f.videoId !== g.videoId) return { action: "drop", reason: "wrong_video" };
  if (f.seekEpoch !== g.seekEpoch) return { action: "drop", reason: "seeked" };
  const drift = g.playhead - f.playheadAtDetection;
  if (drift < 0) return { action: "drop", reason: "looped" };
  if (drift > WATCH_MAX_PLAYHEAD_DRIFT_S || g.now - f.detectedAt > WATCH_MAX_FINDING_AGE_MS) {
    return { action: "drop", reason: "stale" };
  }
  if (g.announced.has(dedupeKey(f))) return { action: "drop", reason: "announced" };
  if (
    g.lastProactiveEndedAt != null &&
    g.now - g.lastProactiveEndedAt < WATCH_PROACTIVE_COOLDOWN_MS
  ) {
    return { action: "drop", reason: "cooldown" };
  }
  if (g.highlightHold || g.scanning || g.detecting || g.ghostActive) {
    return { action: "drop", reason: "stage_held" };
  }
  if (g.phase === "listening") {
    return { action: "defer", reason: "user_capturing" };
  }
  if (g.turnInFlight || g.phase === "thinking" || g.phase === "speaking") {
    return { action: "defer", reason: "grok_busy" };
  }
  if (g.lastActivityAt != null && g.now - g.lastActivityAt < WATCH_MIN_QUIET_MS) {
    return { action: "defer", reason: "grok_busy" };
  }
  return { action: "speak" };
}

export type PendingSlot = {
  finding: ProactiveFinding;
  /** Anchored to detection time, never reset by re-defers. */
  expiresAt: number;
};

/** Capacity-1 holding area for a deferred finding; newest always wins. */
export function offerPending(
  _slot: PendingSlot | null,
  f: ProactiveFinding,
): PendingSlot {
  return { finding: f, expiresAt: f.detectedAt + WATCH_PENDING_TTL_MS };
}

/** The slot's finding if still within TTL; null (slot dead) otherwise. */
export function takePending(
  slot: PendingSlot | null,
  now: number,
): ProactiveFinding | null {
  if (!slot || now >= slot.expiresAt) return null;
  return slot.finding;
}

/**
 * looksLikeEcho's command-word bypass means TTS bleed containing these words
 * becomes a fake user turn — so a proactive callout must never contain them,
 * and a wake phrase inside a callout would make it un-interruptible. The
 * /api/watch prompt phrases lines as present-state observations; this is the
 * belt-and-suspenders lint before anything reaches the speakers.
 */
const ECHO_BYPASS_RE =
  /\b(highlight|circle|outline|label|mark|point|show|find|where|how|which|motion|direction|open|next|previous|close|stop|play|spotify|bowie|music|pause|twitter|tweet|tweets|feed|elon|musk|starship|spacex|youtube|watch|skip|rewind|manual|ikea|desk|flip)\b/i;
// Mirrors WAKE_RE in useVoice.ts, plus a bare "grok" self-reference guard.
const WAKE_PHRASE_RE =
  /\b(?:hey|hi|ok|okay|yo)[\s,.-]*(?:grok|groc|grock|grawk|greg|brook|brock|crock)\b|\bgrok\b/i;

export function isEchoSafeCallout(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (ECHO_BYPASS_RE.test(t)) return false;
  if (WAKE_PHRASE_RE.test(t)) return false;
  return true;
}

export type WatchAction = "watch_on" | "watch_off" | "watch_reset";

/**
 * Voice toggle for the watcher. Deliberately anchored on work/build nouns so
 * "watch this video" (YouTube grammar) and "check my work" (verify grammar)
 * never land here.
 */
export function parseWatchAction(message: string): WatchAction | null {
  const t = String(message || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.!?,]+$/g, "")
    .trim();
  if (!t) return null;

  if (
    /^(?:please\s+)?(?:watch (?:my|the) (?:work|build)|watch me work|keep an eye on (?:me|this|my work|my build)|(?:turn )?(?:work )?verification on|start watching)$/.test(
      t,
    )
  ) {
    return "watch_on";
  }
  if (
    /^(?:please\s+)?(?:stop watching(?: me| my work)?|quit watching|(?:turn )?(?:work )?verification off|stay quiet|eyes off)$/.test(
      t,
    )
  ) {
    return "watch_off";
  }
  if (/^(?:please\s+)?(?:fresh eyes|reset (?:your|the) watch(?:ing)?|call (?:it|things) out again)$/.test(t)) {
    return "watch_reset";
  }
  return null;
}
