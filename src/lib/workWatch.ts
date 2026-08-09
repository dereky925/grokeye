import type { BufferedFrame } from "../hooks/useFrameBuffer";
import type { VerifyAttention } from "./verify";
import type { NormBox, TaskSession } from "../types";

/**
 * Real-time work verification: pure detection core.
 *
 * The watcher decides *when* an on-screen action has finished (never judge
 * mid-action), *which* frames describe it, and *whether* a check is worth an
 * upstream vision call. The verdict itself always comes from the live model
 * via /api/watch — authored data and this module never pre-record an answer.
 */

/** Thumbnail geometry shared with the sampler canvas. */
export const WATCH_MOTION_W = 48;
export const WATCH_MOTION_H = 36;

/**
 * All boundary/budget thresholds in one mutable object so they can be tuned
 * live from DevTools (`import("... /workWatch")` or the [watch] debug logs)
 * while scrubbing real footage.
 */
export const WATCH_TUNING = {
  /** `action` score needed to count toward entering ACTION. */
  enter: 3.0,
  /** Consecutive qualifying samples before ACTION starts (~200ms @10Hz). */
  enterSamples: 2,
  /** Absolute floor for the settle threshold. */
  settleFloor: 1.5,
  /** Settle threshold as a fraction of the action's motion peak. */
  settleRatio: 0.25,
  /** Resume threshold as a fraction of the peak (hysteresis above settle). */
  resumeRatio: 0.3,
  /** How long motion must stay low before the action counts as finished. */
  settleMs: 700,
  /** Actions shorter than this are camera jitter — discarded silently. */
  minActionMs: 400,
  /** Global score at/above which the frame is treated as a camera pan. */
  panGuard: 12,
  /** During a pan, entry needs this multiple of `enter` in local action. */
  panEnterMult: 2,
  /** A sample gap this long (pause, hidden tab, stall) resets the tracker. */
  gapResetMs: 500,
  /** Minimum wall-clock spacing between upstream checks. */
  checkIntervalMs: 8000,
  /** Maximum upstream checks per loop iteration of a clip. */
  maxChecksPerLoop: 6,
  /** Center region (hands live lower-center in head-cam POV), 0–1 fractions. */
  centerX0: 1 / 6,
  centerX1: 5 / 6,
  centerY0: 0.28,
  centerY1: 1.0,
};

export type WatchTuning = typeof WATCH_TUNING;

export type MotionSample = {
  /** performance.now() at capture. */
  tMs: number;
  /** HTMLMediaElement.currentTime at capture, in seconds. */
  mediaTime: number;
  /** Mean abs luma delta over the whole thumbnail (lights up on head pans). */
  global: number;
  /** Mean abs luma delta over the lower-center hands region. */
  center: number;
  /** Mean abs luma delta over the outer ring. */
  border: number;
  /** Camera-compensated hand-work score: max(0, center - border). */
  action: number;
};

/**
 * Region-split motion score. A head pan moves center and border about equally
 * so `action` stays near zero; hand work under a steady head lights up only
 * the center. Under-counting during a pan is the safe direction — we would
 * rather extend ACTION than call a verdict mid-motion.
 */
export function computeRegionMotion(
  cur: ArrayLike<number>,
  prev: ArrayLike<number> | null,
  w = WATCH_MOTION_W,
  h = WATCH_MOTION_H,
  tuning: WatchTuning = WATCH_TUNING,
): Pick<MotionSample, "global" | "center" | "border" | "action"> {
  if (!prev || prev.length !== cur.length || cur.length !== w * h) {
    return { global: 0, center: 0, border: 0, action: 0 };
  }
  const cx0 = Math.floor(w * tuning.centerX0);
  const cx1 = Math.ceil(w * tuning.centerX1) - 1;
  const cy0 = Math.floor(h * tuning.centerY0);
  const cy1 = Math.ceil(h * tuning.centerY1) - 1;

  let globalSum = 0;
  let centerSum = 0;
  let centerCount = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      const d = Math.abs(cur[p] - prev[p]);
      globalSum += d;
      if (x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1) {
        centerSum += d;
        centerCount += 1;
      }
    }
  }
  const total = w * h;
  const borderCount = total - centerCount;
  const global = globalSum / total;
  const center = centerCount ? centerSum / centerCount : 0;
  const border = borderCount ? (globalSum - centerSum) / borderCount : 0;
  return { global, center, border, action: Math.max(0, center - border) };
}

export type WatchState = "idle" | "action" | "settling";

export type ActionBoundary = {
  /** mediaTime where the action began. */
  actionStart: number;
  /** mediaTime where motion first dropped below the settle threshold. */
  actionEnd: number;
  peak: number;
  /** mediaTime of the strongest motion sample. */
  peakTime: number;
};

export type BoundaryEvent =
  | { type: "action_start"; mediaTime: number }
  /** Motion dropped — the speculative-fire hook. May still resume. */
  | ({ type: "settling"; mediaTime: number } & ActionBoundary)
  /** Motion stayed low for settleMs — the action is really over. */
  | ({ type: "settled"; mediaTime: number } & ActionBoundary)
  /** The worker kept going: any in-flight speculative check is now void. */
  | { type: "action_resumed"; mediaTime: number };

/**
 * Streaming version of flip.ts's retrospective peak-window detector: an
 * IDLE → ACTION → SETTLING state machine with hysteresis, a settle
 * confirmation window, and a blip filter. Pure; drive it with samples.
 */
export function createBoundaryTracker(tuning: WatchTuning = WATCH_TUNING) {
  let state: WatchState = "idle";
  let enterStreak = 0;
  let candidateStart = 0;
  let actionStart = 0;
  let actionStartTMs = 0;
  let peak = 0;
  let peakTime = 0;
  let settlingStartTMs = 0;
  let settlingStartMediaTime = 0;
  let lastTMs: number | null = null;

  const reset = () => {
    state = "idle";
    enterStreak = 0;
    peak = 0;
    lastTMs = null;
  };

  const boundary = (): ActionBoundary => ({
    actionStart,
    actionEnd: settlingStartMediaTime,
    peak,
    peakTime,
  });

  const push = (s: MotionSample): BoundaryEvent | null => {
    // A long gap means pause/seek/hidden tab — old momentum is meaningless.
    if (lastTMs != null && s.tMs - lastTMs > tuning.gapResetMs) reset();
    lastTMs = s.tMs;

    if (state === "idle") {
      const panning = s.global >= tuning.panGuard;
      const needed = panning ? tuning.enter * tuning.panEnterMult : tuning.enter;
      if (s.action >= needed) {
        if (enterStreak === 0) candidateStart = s.mediaTime;
        enterStreak += 1;
        if (enterStreak >= tuning.enterSamples) {
          state = "action";
          actionStart = candidateStart;
          actionStartTMs = s.tMs;
          peak = s.action;
          peakTime = s.mediaTime;
          enterStreak = 0;
          return { type: "action_start", mediaTime: s.mediaTime };
        }
      } else {
        enterStreak = 0;
      }
      return null;
    }

    if (state === "action") {
      if (s.action > peak) {
        peak = s.action;
        peakTime = s.mediaTime;
      }
      const settleT = Math.max(tuning.settleFloor, peak * tuning.settleRatio);
      if (s.action <= settleT) {
        // Camera jitter masquerading as an action: drop it without events.
        if (s.tMs - actionStartTMs < tuning.minActionMs) {
          state = "idle";
          return null;
        }
        state = "settling";
        settlingStartTMs = s.tMs;
        settlingStartMediaTime = s.mediaTime;
        return { type: "settling", mediaTime: s.mediaTime, ...boundary() };
      }
      return null;
    }

    // settling
    const resumeT = Math.max(tuning.enter, peak * tuning.resumeRatio);
    if (s.action >= resumeT) {
      state = "action";
      return { type: "action_resumed", mediaTime: s.mediaTime };
    }
    if (s.tMs - settlingStartTMs >= tuning.settleMs) {
      const event: BoundaryEvent = {
        type: "settled",
        mediaTime: s.mediaTime,
        ...boundary(),
      };
      state = "idle";
      peak = 0;
      return event;
    }
    return null;
  };

  return {
    push,
    reset,
    get state() {
      return state;
    },
  };
}

/** Frames covering the action itself, on top of the one pre-action frame. */
export const WATCH_ACTION_FRAMES = 8;

export type WatchStrip = {
  /** Chronological frames: the pre-action frame first when present. */
  frames: string[];
  /**
   * How many leading frames predate the action. The watcher must not read
   * current state off these — the whole point is that they are stale.
   */
  preCount: number;
};

/**
 * Frames for the /api/watch call.
 *
 * One frame from before the action (for before/after comparison only), then a
 * dense run across the action itself ending on the freshly captured settled
 * frame. Judging current state from three sparse frames was how the watcher
 * ended up announcing an "empty portafilter" from a stale pre-dose frame.
 */
export function selectWatchFrames(
  frames: BufferedFrame[],
  boundary: Pick<ActionBoundary, "actionStart" | "peakTime">,
  freshSettled: string | null,
): WatchStrip {
  const usable = frames.filter((f) => f.url);

  let pre: BufferedFrame | null = null;
  for (const f of usable) {
    if (f.mediaTime < boundary.actionStart) pre = f;
    else break;
  }

  // Everything from the action onward, thinned evenly to a budget so a long
  // action doesn't blow the payload.
  const during = usable.filter((f) => f.mediaTime >= boundary.actionStart);
  const picked: BufferedFrame[] = [];
  if (during.length <= WATCH_ACTION_FRAMES) {
    picked.push(...during);
  } else {
    for (let i = 0; i < WATCH_ACTION_FRAMES; i++) {
      const idx = Math.round((i * (during.length - 1)) / (WATCH_ACTION_FRAMES - 1));
      const f = during[idx];
      if (f && !picked.includes(f)) picked.push(f);
    }
  }

  // The peak-motion frame is the most informative single frame; make sure the
  // thinning never drops it.
  let peakFrame: BufferedFrame | null = null;
  let bestDelta = Infinity;
  for (const f of during) {
    const d = Math.abs(f.mediaTime - boundary.peakTime);
    if (d < bestDelta) {
      bestDelta = d;
      peakFrame = f;
    }
  }
  if (peakFrame && !picked.includes(peakFrame)) {
    picked.push(peakFrame);
    picked.sort((a, b) => a.mediaTime - b.mediaTime);
  }

  const out: string[] = [];
  const preUrl = pre?.url ?? null;
  if (preUrl) out.push(preUrl);
  const preCount = out.length;
  for (const f of picked) {
    if (!out.includes(f.url)) out.push(f.url);
  }
  if (freshSettled && !out.includes(freshSettled)) out.push(freshSettled);

  // Nothing usable from the action window — fall back to whatever exists, but
  // never claim a pre-action frame is current state.
  if (out.length === preCount) {
    const last = usable[usable.length - 1];
    if (last && !out.includes(last.url)) out.push(last.url);
  }

  return { frames: out, preCount: out.length > preCount ? preCount : 0 };
}

/**
 * Upstream-call budget: continuous checking of a 158s clip could burn a
 * vision call at every hand movement. Shared by authored and generic checks.
 */
export function createWatchBudget(tuning: WatchTuning = WATCH_TUNING) {
  let lastFireTMs: number | null = null;
  let checksThisLoop = 0;

  return {
    canFire(tMs: number): { ok: boolean; reason: string | null } {
      if (lastFireTMs != null && tMs - lastFireTMs < tuning.checkIntervalMs) {
        return { ok: false, reason: "interval" };
      }
      if (checksThisLoop >= tuning.maxChecksPerLoop) {
        return { ok: false, reason: "loop_cap" };
      }
      return { ok: true, reason: null };
    },
    spend(tMs: number) {
      lastFireTMs = tMs;
      checksThisLoop += 1;
    },
    /** The loop wrapped — the per-loop cap restarts; spacing carries over. */
    resetLoop() {
      checksThisLoop = 0;
    },
  };
}

export type WatchVerdict = {
  verdict: "ok" | "mistake" | "unclear";
  spoken: string | null;
  attention: VerifyAttention | null;
  confidence: number;
};

export type WatchRequest = {
  frames: string[];
  videoTitle: string;
  currentTime: number;
  /** Leading frames that predate the action — context only, never state. */
  preCount?: number;
  concern?: string;
  watchFor?: string[];
  region?: NormBox;
  taskContext?: Pick<TaskSession, "goal" | "instruction">;
};

export async function fetchWatch(
  input: WatchRequest,
  signal?: AbortSignal,
): Promise<WatchVerdict> {
  const response = await fetch("/api/watch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Watch check failed");
  }
  return data as WatchVerdict;
}
