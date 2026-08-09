import { useEffect, useRef, useState, type RefObject } from "react";
import {
  createHighlightTracker,
  getVideoContentRect,
  type VideoContentRect,
} from "../lib/highlights";
import type { CatalogMotionCue } from "../lib/choreography";
import CatalogMotionOverlay from "./CatalogMotionOverlay";
import GuidanceMotionOverlay from "./GuidanceMotionOverlay";
import type {
  GuidanceMotion,
  GuidanceStatus,
  HighlightLabel,
  HighlightLink,
} from "../types";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  labels: HighlightLabel[];
  /** Arrows drawn between tracked labels (endpoints follow the tracker). */
  links?: HighlightLink[];
  /** Animated physical gesture resolved to tracked label IDs. */
  guidanceMotion?: GuidanceMotion | null;
  /** Instant authored silhouette choreography for a known catalog scene. */
  catalogMotion?: CatalogMotionCue | null;
  /** Exit authored choreography in lockstep with the spoken-response bubble. */
  catalogMotionLeaving?: boolean;
  guidanceStatus?: GuidanceStatus | null;
  onLabelsChange: (labels: HighlightLabel[]) => void;
  /**
   * Voice-synced expiry: a performance.now() timestamp (set ~2s after TTS
   * ends) at which callouts fade. null = fall back to maxMs only.
   */
  holdUntil?: number | null;
  /**
   * Data URL of the frame the boxes were located on. The tracker seeds its
   * templates from it (instead of the live video) so late-arriving boxes
   * lock onto the right object and walk forward onto the moving picture.
   */
  seedFrame?: string | null;
  /** Backstop expiry (TTS failed / never fired) after this many ms. */
  maxMs?: number;
  /** Keep boxes up at least this long even if the voice reply is short. */
  minHoldMs?: number;
};

/**
 * Curved connection geometry: a lifted cubic Bézier that departs the source
 * along the center line, rises, then descends into the target — reads as
 * "pick it up and seat it there" instead of a flat pointer. Presentation
 * only; the tracker still deals exclusively in axis-aligned boxes.
 */
function connectionGeometry(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  planeH: number,
) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  // Perpendicular pointing toward the top of the frame.
  let nx = -uy;
  let ny = ux;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  let lift = Math.min(72, Math.max(22, dist * 0.3));
  // Keep the apex on the picture: shrink the bow near the top edge; if there
  // is no headroom left, flip the bow downward instead.
  const midY = (p1.y + p2.y) / 2;
  const apexY = midY + ny * lift;
  if (apexY < 12) {
    lift -= 12 - apexY;
    if (lift < 16) {
      nx = -nx;
      ny = -ny;
      lift = Math.min(52, Math.max(16, planeH - 12 - midY));
    }
  }
  const c1x = p1.x + ux * dist * 0.3 + nx * lift;
  const c1y = p1.y + uy * dist * 0.3 + ny * lift;
  const c2x = p2.x - ux * dist * 0.22 + nx * lift * 0.85;
  const c2y = p2.y - uy * dist * 0.22 + ny * lift * 0.85;
  return {
    p1,
    p2,
    d: `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`,
    headAngle: (Math.atan2(p2.y - c2y, p2.x - c2x) * 180) / Math.PI,
  };
}

/** Energy packets streaming along the connection rail (staggered phases). */
const COMETS = [
  { dur: 1.45, begin: -0.3, r: 2.8, tail: 10 },
  { dur: 1.7, begin: -0.95, r: 2.1, tail: 8 },
  { dur: 1.55, begin: -1.45, r: 2.5, tail: 9 },
  { dur: 1.9, begin: -0.6, r: 1.8, tail: 6.5 },
];

/** Point where the center-to-center line exits `box`, plus a small gap. */
function arrowEndpoint(
  box: HighlightLabel,
  dx: number,
  dy: number,
  planeW: number,
  planeH: number,
  gap: number,
) {
  const cx = (box.x + box.w / 2) * planeW;
  const cy = (box.y + box.h / 2) * planeH;
  const halfW = (box.w / 2) * planeW;
  const halfH = (box.h / 2) * planeH;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tx = ux !== 0 ? halfW / Math.abs(ux) : Infinity;
  const ty = uy !== 0 ? halfH / Math.abs(uy) : Infinity;
  const t = Math.min(tx, ty) + gap;
  return { x: cx + ux * t, y: cy + uy * t };
}

export default function VideoHighlights({
  videoRef,
  labels,
  links = [],
  guidanceMotion = null,
  catalogMotion = null,
  catalogMotionLeaving = false,
  guidanceStatus = null,
  onLabelsChange,
  holdUntil = null,
  seedFrame = null,
  maxMs = 12000,
  minHoldMs = 5000,
}: Props) {
  const [content, setContent] = useState<VideoContentRect | null>(null);
  const [leaving, setLeaving] = useState(false);
  const labelsRef = useRef(labels);
  const onChangeRef = useRef(onLabelsChange);
  const holdUntilRef = useRef<number | null>(holdUntil);

  useEffect(() => {
    labelsRef.current = labels;
  }, [labels]);

  useEffect(() => {
    holdUntilRef.current = holdUntil;
  }, [holdUntil]);

  useEffect(() => {
    onChangeRef.current = onLabelsChange;
  }, [onLabelsChange]);

  // Measure letterboxed content box
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const measure = () => setContent(getVideoContentRect(video));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(video);
    video.addEventListener("loadedmetadata", measure);
    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", measure);
    };
  }, [videoRef, labels.length]);

  // Local neighborhood tracker
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !labels.length) return;

    setLeaving(false);
    let tracker: ReturnType<typeof createHighlightTracker> = null;

    let dead = false;
    let raf = 0;
    const started = performance.now();

    const fadeOut = () => {
      setLeaving(true);
      window.setTimeout(() => {
        if (!dead) onChangeRef.current([]);
      }, 280);
    };

    const tick = () => {
      if (dead) return;
      const elapsed = performance.now() - started;
      if (elapsed > maxMs) {
        fadeOut();
        return;
      }

      // Voice-synced expiry: fade shortly after the spoken reply finished,
      // but never before the minimum demo beat.
      const hold = holdUntilRef.current;
      if (hold != null && elapsed >= minHoldMs && performance.now() >= hold) {
        fadeOut();
        return;
      }

      const next = tracker ? tracker.update(video) : labelsRef.current;
      // Ignore early track losses — keep the model box up for the demo beat.
      if (!next && elapsed >= minHoldMs) {
        fadeOut();
        return;
      }

      const publish = next ?? labelsRef.current;
      const prev = labelsRef.current;
      let changed = prev.length !== publish.length;
      if (!changed) {
        for (let i = 0; i < publish.length; i++) {
          const a = prev[i];
          const b = publish[i];
          if (
            !a ||
            a.id !== b.id ||
            Math.abs(a.x - b.x) > 0.004 ||
            Math.abs(a.y - b.y) > 0.004 ||
            Math.abs(a.w - b.w) > 0.004 ||
            Math.abs(a.h - b.h) > 0.004
          ) {
            changed = true;
            break;
          }
        }
      }
      if (changed) onChangeRef.current(publish);

      const rvfc = (
        video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        }
      ).requestVideoFrameCallback;

      if (typeof rvfc === "function" && !video.paused) {
        raf = rvfc.call(video, tick);
      } else {
        raf = window.setTimeout(
          tick,
          video.paused ? 250 : 70,
        ) as unknown as number;
      }
    };

    // Seed the tracker from the frame the boxes were computed on when we have
    // it; fall back to the live frame. Ticking starts immediately either way
    // so expiry timers run even while the seed image decodes.
    const begin = (img: CanvasImageSource | null) => {
      if (dead) return;
      tracker = createHighlightTracker(video, labels, img);
    };
    if (seedFrame) {
      const img = new Image();
      img.onload = () => begin(img);
      img.onerror = () => begin(null);
      img.src = seedFrame;
    } else {
      begin(null);
    }
    tick();

    return () => {
      dead = true;
      tracker?.dispose();
      const cancel = (
        video as HTMLVideoElement & {
          cancelVideoFrameCallback?: (id: number) => void;
        }
      ).cancelVideoFrameCallback;
      if (typeof cancel === "function") {
        try {
          cancel.call(video, raf);
        } catch {
          /* ignore */
        }
      }
      window.clearTimeout(raf);
    };
    // Re-seed tracker only when a new placement arrives (id set changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, labels.map((l) => l.id).join("|"), maxMs, minHoldMs]);

  if ((!labels.length && !catalogMotion) || !content) return null;

  const byId = new Map(labels.map((l) => [l.id, l]));
  const sourceIds = new Set(links.map((l) => l.fromId));
  const targetIds = new Set(links.map((l) => l.toId));
  const guidancePivotId = guidanceMotion?.pivotId;
  const guidanceMovingId = guidanceMotion?.movingId;
  const arrows = links.flatMap((link) => {
    const from = byId.get(link.fromId);
    const to = byId.get(link.toId);
    if (!from || !to) return [];
    const dx = (to.x + to.w / 2 - (from.x + from.w / 2)) * content.width;
    const dy = (to.y + to.h / 2 - (from.y + from.h / 2)) * content.height;
    const p1 = arrowEndpoint(from, dx, dy, content.width, content.height, 6);
    const p2 = arrowEndpoint(to, -dx, -dy, content.width, content.height, 9);
    // Boxes overlap or touch — no room for a readable arrow.
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 24) return [];
    return [
      {
        id: `${link.fromId}-${link.toId}`,
        ...connectionGeometry(p1, p2, content.height),
      },
    ];
  });

  return (
    <div
      className={`video-highlights ${leaving || catalogMotionLeaving ? "is-leaving" : ""}`}
      aria-hidden
    >
      <div
        className="video-highlights-plane"
        style={{
          left: content.x,
          top: content.y,
          width: content.width,
          height: content.height,
        }}
      >
        {labels.map((label, i) => (
          <div
            key={label.id}
            className={`video-highlight kind-${label.kind}${
              targetIds.has(label.id)
                ? " is-target"
                : sourceIds.has(label.id)
                  ? " is-source"
                  : ""
            }${label.id === guidancePivotId ? " is-guidance-pivot" : ""}${
              label.id === guidanceMovingId ? " is-guidance-moving" : ""
            }${guidanceStatus === "wrong_tool" ? " is-guidance-warning" : ""}`}
            style={{
              left: `${label.x * 100}%`,
              top: `${label.y * 100}%`,
              width: `${label.w * 100}%`,
              height: `${label.h * 100}%`,
              animationDelay: `${i * 60}ms`,
            }}
          >
            {label.kind === "zone" ? (
              <span className="video-highlight-zone" />
            ) : (
              <>
                <span className="video-highlight-ring" />
                <span className="video-highlight-corner tl" />
                <span className="video-highlight-corner tr" />
                <span className="video-highlight-corner bl" />
                <span className="video-highlight-corner br" />
              </>
            )}
            {label.kind === "box" &&
              !sourceIds.has(label.id) &&
              !targetIds.has(label.id) &&
              label.id !== guidancePivotId &&
              label.id !== guidanceMovingId && (
                <span
                  className={`video-highlight-pointer${
                    label.y < 0.15 || label.x + label.w > 0.88 ? " flip" : ""
                  }`}
                >
                  <svg viewBox="0 0 26 26" aria-hidden>
                    <line x1="22" y1="4" x2="10" y2="16" />
                    <line x1="10" y1="16" x2="16.8" y2="14.2" />
                    <line x1="10" y1="16" x2="11.8" y2="9.2" />
                  </svg>
                </span>
              )}
            <span className="video-highlight-leader" />
            <span className="video-highlight-label">{label.text}</span>
          </div>
        ))}
        {arrows.length > 0 && (
          <svg
            className="video-highlight-arrows"
            width={content.width}
            height={content.height}
            viewBox={`0 0 ${content.width} ${content.height}`}
          >
            <defs>
              <filter id="hl-conn-blur" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="3.2" />
              </filter>
              <linearGradient id="hl-conn-comet-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#9dffb0" stopOpacity="0" />
                <stop offset="0.55" stopColor="#9dffb0" stopOpacity="0.45" />
                <stop offset="1" stopColor="#eafff0" stopOpacity="0.95" />
              </linearGradient>
              <radialGradient id="hl-conn-pool-grad">
                <stop offset="0" stopColor="#9dffb0" stopOpacity="0.5" />
                <stop offset="1" stopColor="#9dffb0" stopOpacity="0" />
              </radialGradient>
            </defs>
            {arrows.map((a) => (
              <g key={a.id}>
                <linearGradient
                  id={`hl-conn-grad-${a.id}`}
                  gradientUnits="userSpaceOnUse"
                  x1={a.p1.x}
                  y1={a.p1.y}
                  x2={a.p2.x}
                  y2={a.p2.y}
                >
                  <stop offset="0" stopColor="#f5f8ff" stopOpacity="0.9" />
                  <stop offset="1" stopColor="#9dffb0" />
                </linearGradient>
                <path className="hl-conn-under" d={a.d} pathLength={1} />
                <path
                  className="hl-conn-glow"
                  d={a.d}
                  pathLength={1}
                  filter="url(#hl-conn-blur)"
                />
                <path
                  id={`hl-conn-rail-${a.id}`}
                  className="hl-conn-core"
                  d={a.d}
                  pathLength={1}
                  stroke={`url(#hl-conn-grad-${a.id})`}
                />
                <path className="hl-conn-flow" d={a.d} pathLength={1} />
                <g
                  transform={`translate(${a.p2.x} ${a.p2.y}) rotate(${a.headAngle})`}
                >
                  <path
                    className="hl-conn-head"
                    d="M3,0 L-14,-6.8 L-9.5,0 L-14,6.8 Z"
                  />
                </g>
                <g transform={`translate(${a.p2.x} ${a.p2.y})`}>
                  <circle
                    className="hl-conn-pool"
                    r="14"
                    fill="url(#hl-conn-pool-grad)"
                  />
                  <circle className="hl-conn-ripple" />
                  <circle className="hl-conn-ripple r2" />
                </g>
                <g className="hl-conn-comets">
                  {COMETS.map((c, i) => (
                    <g key={i}>
                      <ellipse
                        cx={-c.tail * 0.62}
                        rx={c.tail}
                        ry={c.r * 0.75}
                        fill="url(#hl-conn-comet-grad)"
                      />
                      <circle
                        className="hl-conn-comet-head"
                        r={c.r}
                        fill="#eafff0"
                      />
                      <animateMotion
                        dur={`${c.dur}s`}
                        begin={`${c.begin}s`}
                        repeatCount="indefinite"
                        rotate="auto"
                        calcMode="spline"
                        keyPoints="0;1"
                        keyTimes="0;1"
                        keySplines="0.3 0.08 0.35 1"
                      >
                        <mpath href={`#hl-conn-rail-${a.id}`} />
                      </animateMotion>
                      <animate
                        attributeName="opacity"
                        values="0;1;1;0"
                        keyTimes="0;0.1;0.82;1"
                        dur={`${c.dur}s`}
                        begin={`${c.begin}s`}
                        repeatCount="indefinite"
                      />
                    </g>
                  ))}
                </g>
              </g>
            ))}
          </svg>
        )}
        {catalogMotion && (
          <CatalogMotionOverlay
            cue={catalogMotion}
            width={content.width}
            height={content.height}
          />
        )}
        {guidanceMotion && (
          <GuidanceMotionOverlay
            motion={guidanceMotion}
            labels={labels}
            width={content.width}
            height={content.height}
          />
        )}
      </div>
    </div>
  );
}
