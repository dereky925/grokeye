import { useEffect, useRef, useState, type RefObject } from "react";
import {
  createHighlightTracker,
  getVideoContentRect,
  type VideoContentRect,
} from "../lib/highlights";
import type { HighlightLabel } from "../types";

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  labels: HighlightLabel[];
  onLabelsChange: (labels: HighlightLabel[]) => void;
  /** Soft-expire callouts after this many ms. */
  maxMs?: number;
  /** Keep boxes up at least this long even if tracking slips. */
  minHoldMs?: number;
};

export default function VideoHighlights({
  videoRef,
  labels,
  onLabelsChange,
  maxMs = 14000,
  minHoldMs = 7000,
}: Props) {
  const [content, setContent] = useState<VideoContentRect | null>(null);
  const [leaving, setLeaving] = useState(false);
  const labelsRef = useRef(labels);
  const onChangeRef = useRef(onLabelsChange);

  useEffect(() => {
    labelsRef.current = labels;
  }, [labels]);

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
    const tracker = createHighlightTracker(video, labels);
    if (!tracker) return;

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

      const next = tracker.update(video);
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

    tick();

    return () => {
      dead = true;
      tracker.dispose();
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

  if (!labels.length || !content) return null;

  return (
    <div
      className={`video-highlights ${leaving ? "is-leaving" : ""}`}
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
            className="video-highlight"
            style={{
              left: `${label.x * 100}%`,
              top: `${label.y * 100}%`,
              width: `${label.w * 100}%`,
              height: `${label.h * 100}%`,
              animationDelay: `${i * 60}ms`,
            }}
          >
            <span className="video-highlight-ring" />
            <span className="video-highlight-label">{label.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
