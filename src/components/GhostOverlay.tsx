import { useEffect, useRef, useState, type RefObject } from "react";
import { getVideoContentRect, type VideoContentRect } from "../lib/highlights";
import { motionKeyframes } from "../lib/ghost";
import type { GhostState } from "../types";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  ghost: GhostState;
  onDismiss: () => void;
  /** Auto-dismiss after this long so the frame doesn't stay frozen forever. */
  maxMs?: number;
};

export default function GhostOverlay({
  videoRef,
  ghost,
  onDismiss,
  maxMs = 16000,
}: Props) {
  const [content, setContent] = useState<VideoContentRect | null>(null);
  const [leaving, setLeaving] = useState(false);
  const spriteRef = useRef<HTMLImageElement | null>(null);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // Same letterbox measurement the highlight plane uses, so normalized coords
  // land on the actual picture rather than the element box.
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
  }, [videoRef]);

  useEffect(() => {
    if (ghost.loading) return;
    const timer = window.setTimeout(() => {
      setLeaving(true);
      window.setTimeout(() => onDismissRef.current(), 280);
    }, maxMs);
    return () => window.clearTimeout(timer);
  }, [ghost.loading, maxMs]);

  // Drive the loop through the Web Animations API so it runs on the compositor
  // instead of a per-frame React render. Rebuilt when the plane resizes, since
  // the keyframes are in pixels.
  useEffect(() => {
    const el = spriteRef.current;
    if (!el || !content || !ghost.spriteUrl) return;

    const { keyframes, durationMs } = motionKeyframes(ghost.box, ghost.motion, {
      width: content.width,
      height: content.height,
    });

    const animation = el.animate(keyframes, {
      duration: durationMs,
      iterations: Infinity,
      easing: "linear",
    });
    return () => animation.cancel();
  }, [content, ghost.box, ghost.motion, ghost.spriteUrl]);

  if (!content) return null;

  const { trail } = motionKeyframes(ghost.box, ghost.motion, {
    width: content.width,
    height: content.height,
  });

  const pad = 0.12;
  const spriteLeft = Math.max(0, ghost.box.x - ghost.box.w * pad);
  const spriteTop = Math.max(0, ghost.box.y - ghost.box.h * pad);
  const spriteW = ghost.box.w * (1 + pad * 2);
  const spriteH = ghost.box.h * (1 + pad * 2);

  return (
    <div className={`ghost-overlay ${leaving ? "is-leaving" : ""}`}>
      <div
        className="ghost-plane"
        style={{
          left: content.x,
          top: content.y,
          width: content.width,
          height: content.height,
        }}
      >
        {trail && (
          <svg className="ghost-trail" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <defs>
              <marker
                id="ghost-arrow"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 9 5 L 0 9 z" className="ghost-arrow-head" />
              </marker>
            </defs>
            <line
              className="ghost-trail-line"
              x1={trail.x1 * 100}
              y1={trail.y1 * 100}
              x2={trail.x2 * 100}
              y2={trail.y2 * 100}
              markerEnd="url(#ghost-arrow)"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}

        {ghost.spriteUrl && (
          <img
            ref={spriteRef}
            className="ghost-sprite"
            src={ghost.spriteUrl}
            alt=""
            aria-hidden
            style={{
              left: `${spriteLeft * 100}%`,
              top: `${spriteTop * 100}%`,
              width: `${spriteW * 100}%`,
              height: `${spriteH * 100}%`,
            }}
          />
        )}

        {ghost.caption && (
          <div className="ghost-caption">
            <span className="ghost-caption-label">{ghost.label}</span>
            {ghost.caption}
          </div>
        )}
      </div>

      <button type="button" className="ghost-close" onClick={onDismiss}>
        Done
      </button>
    </div>
  );
}
