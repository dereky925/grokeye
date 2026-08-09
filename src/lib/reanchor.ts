import { createHighlightTracker, type HighlightTracker } from "./highlights";
import type { HighlightLabel, NormBox } from "../types";

/**
 * Closed-loop correction for the local tracker.
 *
 * The tracker in `highlights.ts` is fast (one frame of latency) but open-loop:
 * seeded once from a Grok locate, it drifts, and once it loses the object it
 * never gets it back. A Grok round-trip is the opposite — right, but seconds
 * late, far too slow to draw from.
 *
 * So Grok never sits in the drawing path. The tracker keeps emitting boxes
 * every frame; a re-anchor request goes out roughly once a second on its own
 * clock, and when the answer lands it is *replayed forward* over the frames
 * buffered since it was asked, so a correction computed on a 1.5 s old frame
 * arrives current. Sub-second trail latency comes from the tracker; freedom
 * from drift and the ability to recover after an occlusion come from Grok.
 */

/** How much context around the current box to send. 1 = the box alone. */
export const CROP_EXPAND = 2.6;
/** Width of the crop JPEG posted for re-anchoring. */
export const CROP_W = 448;
/** Frames kept for replay, and the rate they are kept at. */
export const RING_FPS = 10;
export const RING_SECONDS = 3;
/** Above this IoU the tracker is basically right — trim drift gently. */
const DRIFT_IOU = 0.5;
/** Between this and DRIFT_IOU the tracker is sliding off — pull harder. */
const LOOSE_IOU = 0.2;
const BLEND_NEAR = 0.35;
const BLEND_FAR = 0.7;
/** A "tight" reticle never covers half the frame; treat that as a bad read. */
const MAX_AREA = 0.5;
const MIN_SIDE = 0.01;
/** Consecutive not_visible answers before the object counts as gone. */
export const MISSES_BEFORE_LOST = 2;

export function boxIou(a: NormBox, b: NormBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Region of the frame to send for a re-anchor: the current box grown by
 * `expand` and clamped to the frame. Cropping buys real resolution on the
 * object — the vision encoder downsamples whatever it is given, so a crop is
 * both cheaper and more accurate than the full frame.
 */
export function cropRectFor(box: NormBox, expand = CROP_EXPAND): NormBox {
  const w = Math.min(1, Math.max(MIN_SIDE, box.w * expand));
  const h = Math.min(1, Math.max(MIN_SIDE, box.h * expand));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return {
    w,
    h,
    x: Math.min(1 - w, Math.max(0, cx - w / 2)),
    y: Math.min(1 - h, Math.max(0, cy - h / 2)),
  };
}

/** Map a box expressed inside `crop` back into whole-frame coordinates. */
export function mapCropBoxToFrame(crop: NormBox, inCrop: NormBox): NormBox {
  return {
    x: crop.x + inCrop.x * crop.w,
    y: crop.y + inCrop.y * crop.h,
    w: inCrop.w * crop.w,
    h: inCrop.h * crop.h,
  };
}

export type Reconciliation =
  | { mode: "hold"; box: NormBox }
  | { mode: "blend"; box: NormBox }
  | { mode: "snap"; box: NormBox };

function lerpBox(a: NormBox, b: NormBox, t: number): NormBox {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  };
}

/**
 * Decide what to do with a re-anchor that has been brought up to date.
 *
 * Overlapping the tracker means it is on the right object and only drifting,
 * so ease toward the correction — snapping every second would read as a
 * twitch. No meaningful overlap means the tracker is on the wrong thing (it
 * latched onto the background during an occlusion, say), and easing would
 * crawl the box across the frame; take the correction outright.
 */
export function reconcileBox(
  current: NormBox,
  corrected: NormBox,
): Reconciliation {
  const area = corrected.w * corrected.h;
  if (
    !Number.isFinite(area) ||
    corrected.w < MIN_SIDE ||
    corrected.h < MIN_SIDE ||
    area > MAX_AREA
  ) {
    return { mode: "hold", box: current };
  }
  const iou = boxIou(current, corrected);
  if (iou >= DRIFT_IOU) {
    return { mode: "blend", box: lerpBox(current, corrected, BLEND_NEAR) };
  }
  if (iou >= LOOSE_IOU) {
    return { mode: "blend", box: lerpBox(current, corrected, BLEND_FAR) };
  }
  return { mode: "snap", box: corrected };
}

export type RingFrame = { canvas: HTMLCanvasElement; t: number };

export type FrameRing = {
  /** Snapshot `source` into the ring, stamped `t` (performance.now()). */
  capture: (source: CanvasImageSource, w: number, h: number, t: number) => void;
  /** Frames stamped after `t`, oldest first. */
  since: (t: number) => RingFrame[];
  /** Frame closest to `t`, or null when the ring is empty. */
  nearest: (t: number) => RingFrame | null;
  dispose: () => void;
};

/**
 * Small rolling buffer of downscaled frames. Only exists so a late correction
 * can be walked forward to the present; nothing is ever drawn from it.
 */
export function createFrameRing(
  slots = Math.round(RING_FPS * RING_SECONDS),
): FrameRing {
  const frames: RingFrame[] = [];
  let cursor = 0;

  return {
    capture(source, w, h, t) {
      if (!w || !h) return;
      const height = Math.max(1, Math.round((h / w) * CROP_W));
      let slot = frames[cursor];
      if (!slot) {
        slot = { canvas: document.createElement("canvas"), t };
        frames[cursor] = slot;
      }
      const { canvas } = slot;
      if (canvas.width !== CROP_W || canvas.height !== height) {
        canvas.width = CROP_W;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, CROP_W, height);
      slot.t = t;
      cursor = (cursor + 1) % slots;
    },
    since(t) {
      return frames
        .filter((f) => f && f.t > t)
        .sort((a, b) => a.t - b.t);
    },
    nearest(t) {
      let best: RingFrame | null = null;
      let bestD = Infinity;
      for (const f of frames) {
        if (!f) continue;
        const d = Math.abs(f.t - t);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      return best;
    },
    dispose() {
      for (const f of frames) {
        if (!f) continue;
        f.canvas.width = 0;
        f.canvas.height = 0;
      }
      frames.length = 0;
    },
  };
}

export type RelocateResult = {
  visible: boolean;
  /** Box in crop-normalized coords, or null when not visible. */
  box: NormBox | null;
};

export type ReanchorLoop = {
  /** Drive from the caller's existing render loop — no second timer. */
  tick: (now: number) => void;
  dispose: () => void;
};

type LoopOptions = {
  video: HTMLVideoElement;
  tracker: HighlightTracker;
  /**
   * Fallback description, used only when a label carries no text of its own.
   * Each box is re-anchored against its OWN label text — a two-label answer
   * ("where does this cable go?" → cable, port) would otherwise ask for the
   * cable while sending the port's crop.
   */
  target: string;
  /** Posts the crop and returns the box within it. */
  relocate: (crop: string, target: string) => Promise<RelocateResult>;
  intervalMs?: number;
  /** Object confirmed gone from the frame. */
  onLost?: () => void;
  onCorrection?: (mode: Reconciliation["mode"], label: HighlightLabel) => void;
};

/**
 * What to ask for when re-anchoring `label`. Its own text names the object the
 * box actually contains, which is both more specific than the user's sentence
 * and correct when several boxes are up at once.
 */
export function labelTarget(
  label: { text?: string | null },
  fallback: string,
): string {
  const text = (label.text ?? "").trim();
  return text || fallback;
}

/** JPEG of `rect` taken from the live video, upscaled to CROP_W. */
function renderCrop(
  video: HTMLVideoElement,
  rect: NormBox,
  canvas: HTMLCanvasElement,
): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const sw = Math.max(1, rect.w * vw);
  const sh = Math.max(1, rect.h * vh);
  canvas.width = CROP_W;
  canvas.height = Math.max(1, Math.round((sh / sw) * CROP_W));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(
    video,
    rect.x * vw,
    rect.y * vh,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function createReanchorLoop({
  video,
  tracker,
  target,
  relocate,
  intervalMs = 1200,
  onLost,
  onCorrection,
}: LoopOptions): ReanchorLoop {
  const ring = createFrameRing();
  const cropCanvas = document.createElement("canvas");
  let inFlight = false;
  let lastFire = 0;
  let lastCapture = 0;
  let misses = 0;
  let cursor = 0;
  let dead = false;

  /**
   * Replay the correction over the frames buffered since it was requested, on
   * a throwaway tracker so a rejected answer never touches the live one.
   */
  const bringCurrent = (
    label: HighlightLabel,
    anchorBox: NormBox,
    anchorFrame: RingFrame,
    anchorT: number,
  ): NormBox => {
    const seeded: HighlightLabel = { ...label, ...anchorBox };
    const scratch = createHighlightTracker(
      video,
      [seeded],
      anchorFrame.canvas,
    );
    if (!scratch) return anchorBox;
    try {
      for (const frame of ring.since(anchorT)) scratch.advance(frame.canvas);
      const out = scratch.boxes()[0];
      return out ? { x: out.x, y: out.y, w: out.w, h: out.h } : anchorBox;
    } finally {
      scratch.dispose();
    }
  };

  return {
    tick(now) {
      if (dead || !video.videoWidth) return;

      if (now - lastCapture >= 1000 / RING_FPS) {
        lastCapture = now;
        ring.capture(video, video.videoWidth, video.videoHeight, now);
      }

      if (inFlight || now - lastFire < intervalMs) return;
      // includeLost: a target the local search has given up on is exactly the
      // one that most needs re-anchoring.
      const boxes = tracker.boxes(true).filter((l) => l.kind === "box");
      if (!boxes.length) return;

      // Round-robin: one request in flight keeps corrections fresh rather
      // than queueing a backlog of stale ones.
      const label = boxes[cursor % boxes.length];
      cursor += 1;
      const current: NormBox = {
        x: label.x,
        y: label.y,
        w: label.w,
        h: label.h,
      };
      const crop = cropRectFor(current);
      const jpeg = renderCrop(video, crop, cropCanvas);
      if (!jpeg) return;

      const anchorT = now;
      const anchorFrame = ring.nearest(anchorT);
      if (!anchorFrame) return;

      lastFire = now;
      inFlight = true;
      relocate(jpeg, labelTarget(label, target))
        .then((res) => {
          if (dead) return;
          if (!res.visible || !res.box) {
            misses += 1;
            if (misses >= MISSES_BEFORE_LOST) onLost?.();
            return;
          }
          misses = 0;

          const anchorBox = mapCropBoxToFrame(crop, res.box);
          const projected = bringCurrent(
            label,
            anchorBox,
            anchorFrame,
            anchorT,
          );
          const live = tracker.boxes(true).find((l) => l.id === label.id);
          if (!live) return;
          const decision = reconcileBox(
            { x: live.x, y: live.y, w: live.w, h: live.h },
            projected,
          );
          if (decision.mode === "hold") return;
          tracker.reanchor(video, { [label.id]: decision.box });
          onCorrection?.(decision.mode, label);
        })
        .catch(() => {
          /* A dropped correction just means the tracker runs open-loop
             until the next one. */
        })
        .finally(() => {
          inFlight = false;
        });
    },
    dispose() {
      dead = true;
      ring.dispose();
      cropCanvas.width = 0;
      cropCanvas.height = 0;
    },
  };
}
