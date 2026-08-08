import { useCallback, useEffect, useRef } from "react";

export type BufferedFrame = {
  /** JPEG data URL. */
  url: string;
  /** performance.now() at capture. */
  t: number;
  /** Mean absolute luma difference from the previous sample, 0–255. */
  motion: number;
};

type Options = {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Samples per second. 12 is enough to catch a bottle mid-rotation. */
  fps?: number;
  /** How much history to keep. */
  seconds?: number;
  maxW?: number;
  quality?: number;
};

/** Downscale used for motion scoring only — tiny on purpose. */
const MOTION_W = 48;
const MOTION_H = 36;

/**
 * Keeps a rolling window of recent camera frames so a question asked *after*
 * something happened can still be answered. A bottle flip is over in under a
 * second, and the user only asks how it went once it has landed.
 *
 * Each sample carries a motion score computed against the previous one, which
 * lets the caller find the attempt inside a buffer that is mostly a still desk.
 */
export function useFrameBuffer({
  enabled,
  videoRef,
  fps = 12,
  seconds = 5,
  maxW = 512,
  quality = 0.6,
}: Options) {
  const framesRef = useRef<BufferedFrame[]>([]);
  const captureRef = useRef<HTMLCanvasElement | null>(null);
  const motionRef = useRef<HTMLCanvasElement | null>(null);
  const prevLumaRef = useRef<Uint8ClampedArray | null>(null);

  const clear = useCallback(() => {
    framesRef.current = [];
    prevLumaRef.current = null;
  }, []);

  /** Snapshot of the buffer, oldest first. */
  const read = useCallback(() => framesRef.current.slice(), []);

  useEffect(() => {
    if (!enabled) {
      clear();
      return;
    }

    const maxFrames = Math.max(8, Math.round(fps * seconds));
    const interval = 1000 / fps;
    let raf = 0;
    let timer = 0;
    let last = 0;
    let stopped = false;

    const capture = () => {
      const el = videoRef.current;
      if (!el || !el.videoWidth || !el.videoHeight) return;

      if (!captureRef.current) captureRef.current = document.createElement("canvas");
      if (!motionRef.current) {
        const m = document.createElement("canvas");
        m.width = MOTION_W;
        m.height = MOTION_H;
        motionRef.current = m;
      }

      const scale = Math.min(1, maxW / el.videoWidth);
      const canvas = captureRef.current;
      canvas.width = Math.max(1, Math.round(el.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(el.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);

      // Score motion off a thumbnail so this stays cheap at 12fps.
      let motion = 0;
      const mctx = motionRef.current.getContext("2d", { willReadFrequently: true });
      if (mctx) {
        mctx.drawImage(el, 0, 0, MOTION_W, MOTION_H);
        const { data } = mctx.getImageData(0, 0, MOTION_W, MOTION_H);
        const luma = new Uint8ClampedArray(MOTION_W * MOTION_H);
        for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
          luma[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
        }
        const prev = prevLumaRef.current;
        if (prev && prev.length === luma.length) {
          let sum = 0;
          for (let p = 0; p < luma.length; p += 1) sum += Math.abs(luma[p] - prev[p]);
          motion = sum / luma.length;
        }
        prevLumaRef.current = luma;
      }

      framesRef.current.push({
        url: canvas.toDataURL("image/jpeg", quality),
        t: performance.now(),
        motion,
      });
      if (framesRef.current.length > maxFrames) {
        framesRef.current.splice(0, framesRef.current.length - maxFrames);
      }
    };

    const loop = (now: number) => {
      if (stopped) return;
      if (now - last >= interval) {
        last = now;
        capture();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // rAF stalls in a background tab; a slow timer keeps some history alive.
    const onHidden = () => {
      if (document.hidden) {
        timer = window.setInterval(capture, interval * 4);
      } else if (timer) {
        window.clearInterval(timer);
        timer = 0;
      }
    };
    document.addEventListener("visibilitychange", onHidden);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onHidden);
      clear();
    };
  }, [enabled, videoRef, fps, seconds, maxW, quality, clear]);

  return { read, clear };
}
