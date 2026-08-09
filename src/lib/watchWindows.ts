import type { NormBox } from "../types";

/**
 * Hand-authored *watch* windows for the catalog clips: when and what the
 * proactive work-watcher should pay attention to. A window arms the watcher
 * and biases the /api/watch prompt with known failure modes to check — it
 * NEVER supplies a verdict, a canned spoken line, or a claim about the
 * footage. The live model judges real frames every time; correct technique
 * inside an armed window must come back as silence.
 *
 * Human mirror: public/videos/WATCH-WINDOWS.md — keep both in sync.
 */
export type WatchSeverity = "info" | "warn" | "danger";

export type WatchWindow = {
  id: string;
  videoId: string;
  /** Seconds, half-open [start, end). */
  start: number;
  end: number;
  /** What competent execution requires here — judge context, not a verdict. */
  concern: string;
  /** Specific, visually checkable failure modes to look FOR (not assertions). */
  watchFor: string[];
  /** Optional normalized 0–1 region to prioritize; a hint, never an answer. */
  region?: NormBox;
  severity: WatchSeverity;
  /**
   * "settle" (default): a motion boundary inside the window triggers the
   * check. "window-end": one static-state check as the window closes — for
   * mistakes that persist without a hand action (e.g. cables left unrouted).
   */
  fireOn?: "settle" | "window-end";
  /** HUD chip text describing what is watched, never the outcome. */
  label?: string;
};

/** An action may straddle a window edge; keep the arm alive this long after. */
export const WATCH_WINDOW_GRACE_S = 5;

export const WATCH_WINDOWS: readonly WatchWindow[] = [
  {
    id: "pc-fail-esd-handling",
    videoId: "pov-pc-build-fail",
    start: 0,
    end: 5.5,
    concern:
      "ESD-safe handling of the motherboard and components during unpacking",
    watchFor: [
      "circuit board or components resting directly on fabric, towel, or carpet",
      "bare fingers pressed onto PCB traces, gold contacts, or socket pins",
      "components stacked loosely or sliding against each other",
    ],
    severity: "danger",
    fireOn: "settle",
    label: "Watching: component handling",
  },
  {
    id: "pc-fail-cable-prep",
    videoId: "pov-pc-build-fail",
    start: 11.5,
    end: 16,
    concern: "Case and cable preparation state before mounting parts",
    watchFor: [
      "a tangle of unrouted cables left across the mounting area",
      "parts or brackets balanced loosely on the case edge",
    ],
    severity: "warn",
    // The camera whip-pans here — no hand action to settle on, so check the
    // static state once as the window closes.
    fireOn: "window-end",
    label: "Watching: cable prep",
  },
  {
    id: "cpu-ram-cpu-seating",
    videoId: "pov-pc-build-cpu-ram",
    start: 54,
    end: 101,
    concern: "Careful LGA socket handling while seating the CPU",
    watchFor: [
      "the CPU slid or dragged across the open socket contacts",
      "the CPU dropped or forced into the socket instead of lowered flat",
      "fingers touching the CPU underside or the socket pin bed",
      "the alignment notches obviously mismatched before lowering",
    ],
    severity: "danger",
    fireOn: "settle",
    label: "Watching: CPU seating",
  },
  {
    id: "cpu-ram-ram-seating",
    videoId: "pov-pc-build-cpu-ram",
    start: 118,
    end: 155,
    concern: "RAM sticks fully seated in the DIMM slots",
    watchFor: [
      "a DIMM latch still open after the stick was pressed",
      "a stick sitting visibly higher on one end than the other",
      "the stick's key notch misaligned with the slot key",
    ],
    severity: "warn",
    fireOn: "settle",
    label: "Watching: RAM seating",
  },
  {
    id: "tuna-knife-safety",
    videoId: "pov-tuna-melt",
    start: 15,
    end: 43,
    concern: "Knife safety while chopping celery on the board",
    watchFor: [
      "fingertips extended into the blade path instead of tucked under",
      "the knife cutting toward the holding hand",
      "the food item unstable or rolling while being cut",
    ],
    severity: "danger",
    fireOn: "settle",
    label: "Watching: knife work",
  },
  {
    id: "plumbing-torch-safety",
    videoId: "pov-copper-plumbing",
    start: 50,
    end: 89,
    concern: "Torch handling while soldering copper joints",
    watchFor: [
      "the open flame directed at or near visibly flammable material",
      "the lit torch set down unattended while still burning",
    ],
    severity: "danger",
    fireOn: "settle",
    label: "Watching: torch work",
  },
];

/** Windows whose [start, end) contains t, for this clip. */
export function findWatchWindows(videoId: string, t: number): WatchWindow[] {
  return WATCH_WINDOWS.filter(
    (w) => w.videoId === videoId && t >= w.start && t < w.end,
  );
}

export function hasWatchWindows(videoId: string): boolean {
  return WATCH_WINDOWS.some((w) => w.videoId === videoId);
}

/** Start of the next window at or after t, so generic checks don't starve it. */
export function nextWindowStart(videoId: string, t: number): number | null {
  let best: number | null = null;
  for (const w of WATCH_WINDOWS) {
    if (w.videoId !== videoId || w.start < t) continue;
    if (best == null || w.start < best) best = w.start;
  }
  return best;
}
