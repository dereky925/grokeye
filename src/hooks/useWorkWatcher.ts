import { useCallback, useEffect, useRef } from "react";
import { useFrameBuffer } from "./useFrameBuffer";
import { captureFrame } from "./useVoice";
import {
  WATCH_MOTION_H,
  WATCH_MOTION_W,
  WATCH_TUNING,
  computeRegionMotion,
  createBoundaryTracker,
  createWatchBudget,
  fetchWatch,
  selectWatchFrames,
  type ActionBoundary,
  type WatchVerdict,
} from "../lib/workWatch";
import {
  WATCH_WINDOWS,
  WATCH_WINDOW_GRACE_S,
  findWatchWindows,
  nextWindowStart,
  type WatchWindow,
} from "../lib/watchWindows";
import type { ProactiveFinding } from "../lib/watchSpeech";
import type { TaskSession } from "../types";

/** Sampler cadence. 1 fps can't resolve a 700ms settle window; 10 Hz can. */
const SAMPLE_INTERVAL_MS = 100;

type FireRecord = {
  generation: number;
  fireMediaTime: number;
  firedAt: number;
  windowId: string | null;
  severity: WatchWindow["severity"] | null;
  settledFrame: string | null;
  hadTask: boolean;
  /** The action resumed — this check's result must never surface. */
  dead: boolean;
  /** The settle window confirmed; a verdict may surface. */
  settled: boolean;
  pendingVerdict: WatchVerdict | null;
  controller: AbortController;
};

/**
 * The proactive work-watcher loop: samples region-split motion at 10 Hz,
 * detects action boundaries, and speculatively fires /api/watch as an action
 * settles so the verdict is usually in hand by the time the settle confirms.
 * All speech arbitration lives in the caller — this hook only emits findings.
 */
export function useWorkWatcher(opts: {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoId: string;
  videoTitle: string;
  getTask: () => TaskSession | null;
  onFinding: (f: ProactiveFinding) => void;
  onArmedLabel?: (label: string | null) => void;
}) {
  const { enabled, videoRef, videoId, videoTitle } = opts;

  // Seek/loop/video-change epoch: any bump invalidates in-flight checks.
  const generationRef = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const { read: readWatchFrames } = useFrameBuffer({
    enabled,
    videoRef,
    fps: 8,
    seconds: 8,
    maxW: 512,
    quality: 0.55,
  });

  const getGeneration = useCallback(() => generationRef.current, []);

  useEffect(() => {
    generationRef.current += 1;
  }, [videoId]);

  useEffect(() => {
    if (!enabled) return;

    const debug = () => {
      try {
        return localStorage.getItem("grokeyeWatchDebug") === "1";
      } catch {
        return false;
      }
    };

    const tracker = createBoundaryTracker(WATCH_TUNING);
    const budget = createWatchBudget(WATCH_TUNING);
    const canvas = document.createElement("canvas");
    canvas.width = WATCH_MOTION_W;
    canvas.height = WATCH_MOTION_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let prevLuma: Uint8ClampedArray | null = null;
    let lastSampleAt = 0;
    let lastMediaTime: number | null = null;
    let activeFire: FireRecord | null = null;
    let armedLabel: string | null = null;
    const windowEndFired = new Set<string>();
    let raf = 0;
    let stopped = false;

    const invalidate = (why: string) => {
      generationRef.current += 1;
      tracker.reset();
      prevLuma = null;
      lastMediaTime = null;
      if (activeFire) {
        activeFire.dead = true;
        activeFire.controller.abort();
        activeFire = null;
      }
      if (debug()) console.log(`[watch] invalidated (${why})`);
    };

    const surface = (record: FireRecord, verdict: WatchVerdict) => {
      const el = videoRef.current;
      if (!el || record.dead || record.generation !== generationRef.current) {
        console.log("[watch] verdict dropped (stale fire)");
        return;
      }
      if (verdict.verdict !== "mistake" || !verdict.spoken) {
        console.log(`[watch] verdict=${verdict.verdict} — staying silent`);
        return;
      }
      const finding: ProactiveFinding = {
        id:
          record.windowId ??
          `generic-${Math.floor(record.fireMediaTime / 5) * 5}s`,
        videoId,
        spoken: verdict.spoken,
        attention: verdict.attention,
        frame: record.settledFrame,
        playheadAtDetection: el.currentTime || 0,
        detectedAt: performance.now(),
        seekEpoch: generationRef.current,
        relatedToTask: record.hadTask,
      };
      console.log(`[watch] mistake finding: ${finding.id}`);
      optsRef.current.onFinding(finding);
    };

    const handleVerdict = (record: FireRecord, verdict: WatchVerdict) => {
      if (record.dead || record.generation !== generationRef.current) return;
      if (!record.settled) {
        // Fired speculatively at SETTLING; hold until the settle confirms so
        // a verdict can never surface mid-action.
        record.pendingVerdict = verdict;
        return;
      }
      surface(record, verdict);
    };

    const fire = (
      mediaTime: number,
      windows: WatchWindow[],
      frames: string[],
      settledFrame: string | null,
    ) => {
      const task = optsRef.current.getTask();
      const taskContext =
        task && task.stage === "awaiting_action"
          ? { goal: task.goal, instruction: task.instruction }
          : undefined;
      const primary = windows[0] ?? null;
      const record: FireRecord = {
        generation: generationRef.current,
        fireMediaTime: mediaTime,
        firedAt: performance.now(),
        windowId: primary?.id ?? null,
        severity: primary?.severity ?? null,
        settledFrame,
        hadTask: Boolean(taskContext),
        dead: false,
        settled: false,
        pendingVerdict: null,
        controller: new AbortController(),
      };
      activeFire = record;
      budget.spend(performance.now());
      console.log(
        `[watch] fire ${record.windowId ?? "generic"} @${mediaTime.toFixed(1)}s frames=${frames.length}`,
      );
      fetchWatch(
        {
          frames,
          videoTitle,
          currentTime: mediaTime,
          concern: windows.map((w) => w.concern).join("; ") || undefined,
          watchFor: windows.length
            ? windows.flatMap((w) => w.watchFor)
            : undefined,
          region: primary?.region,
          taskContext,
        },
        record.controller.signal,
      )
        .then((verdict) => handleVerdict(record, verdict))
        .catch((err) => {
          if (!record.dead) console.log(`[watch] check failed: ${err.message}`);
        });
    };

    /** Windows armed for an action: in-window at the peak, or grace-tailed. */
    const armedWindows = (boundary: ActionBoundary): WatchWindow[] => {
      const settleWindows = (t: number) =>
        findWatchWindows(videoId, t).filter((w) => w.fireOn !== "window-end");
      const atPeak = settleWindows(boundary.peakTime);
      if (atPeak.length) return atPeak;
      const atStart = settleWindows(boundary.actionStart);
      if (atStart.length) return atStart;
      // Grace tail: the action started inside a window that just ended.
      return WATCH_WINDOWS.filter(
        (w) =>
          w.videoId === videoId &&
          w.fireOn !== "window-end" &&
          boundary.actionStart < w.end &&
          boundary.actionEnd <= w.end + WATCH_WINDOW_GRACE_S,
      );
    };

    const maybeFire = (boundary: ActionBoundary, mediaTime: number) => {
      const el = videoRef.current;
      if (!el) return;
      const windows = armedWindows(boundary);
      const budgetCheck = budget.canFire(performance.now());
      if (!budgetCheck.ok) {
        if (debug()) console.log(`[watch] skip fire (${budgetCheck.reason})`);
        return;
      }
      // Generic checks yield to an authored window arriving soon.
      if (!windows.length) {
        const next = nextWindowStart(videoId, mediaTime);
        if (
          next != null &&
          (next - mediaTime) * 1000 < WATCH_TUNING.checkIntervalMs
        ) {
          if (debug()) console.log("[watch] skip generic (window upcoming)");
          return;
        }
      }
      const settledFrame = captureFrame(el, { maxW: 640, quality: 0.62 });
      const frames = selectWatchFrames(readWatchFrames(), boundary, settledFrame);
      if (!frames.length) return;
      fire(mediaTime, windows, frames, settledFrame);
    };

    const fireWindowEnd = (w: WatchWindow) => {
      const el = videoRef.current;
      if (!el) return;
      const budgetCheck = budget.canFire(performance.now());
      if (!budgetCheck.ok) {
        if (debug()) console.log(`[watch] skip window-end (${budgetCheck.reason})`);
        return;
      }
      const frame = captureFrame(el, { maxW: 640, quality: 0.62 });
      if (!frame) return;
      const t = el.currentTime || 0;
      fire(t, [w], [frame], frame);
      // Window-end checks are static-state reads; there is no settle to wait
      // for, so let the verdict surface as soon as it lands.
      if (activeFire) activeFire.settled = true;
    };

    const sample = () => {
      const el = videoRef.current;
      if (
        !el ||
        !el.videoWidth ||
        !el.videoHeight ||
        el.paused ||
        el.ended ||
        el.seeking ||
        document.hidden ||
        !ctx
      ) {
        return;
      }

      const now = performance.now();
      const mediaTime = el.currentTime || 0;

      // Loop wrap / backward jump: a new timeline, and the per-loop budget
      // cap restarts. (The seeking listener below catches explicit seeks.)
      if (lastMediaTime != null && mediaTime < lastMediaTime - 0.5) {
        invalidate("loop");
        budget.resetLoop();
        windowEndFired.clear();
      }

      // Static-state windows fire once as the playhead crosses their end.
      if (lastMediaTime != null && mediaTime > lastMediaTime) {
        for (const w of WATCH_WINDOWS) {
          if (
            w.videoId === videoId &&
            w.fireOn === "window-end" &&
            lastMediaTime < w.end &&
            mediaTime >= w.end &&
            tracker.state === "idle" &&
            !windowEndFired.has(w.id)
          ) {
            windowEndFired.add(w.id);
            fireWindowEnd(w);
          }
        }
      }
      lastMediaTime = mediaTime;

      // Armed-window HUD label (describes what is watched, never an outcome).
      const nowWindows = findWatchWindows(videoId, mediaTime);
      const label = nowWindows[0]?.label ?? null;
      if (label !== armedLabel) {
        armedLabel = label;
        optsRef.current.onArmedLabel?.(label);
      }

      ctx.drawImage(el, 0, 0, WATCH_MOTION_W, WATCH_MOTION_H);
      const { data } = ctx.getImageData(0, 0, WATCH_MOTION_W, WATCH_MOTION_H);
      const luma = new Uint8ClampedArray(WATCH_MOTION_W * WATCH_MOTION_H);
      for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
        luma[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      }
      const region = computeRegionMotion(luma, prevLuma);
      prevLuma = luma;

      const event = tracker.push({ tMs: now, mediaTime, ...region });
      if (!event) return;
      if (debug()) {
        console.log(
          `[watch] ${event.type} @${mediaTime.toFixed(1)}s action=${region.action.toFixed(1)} global=${region.global.toFixed(1)}`,
        );
      }

      if (event.type === "settling") {
        maybeFire(event, mediaTime);
      } else if (event.type === "action_resumed") {
        if (activeFire && !activeFire.settled) {
          activeFire.dead = true;
          activeFire.controller.abort();
          activeFire = null;
        }
      } else if (event.type === "settled") {
        if (activeFire && !activeFire.dead) {
          activeFire.settled = true;
          if (activeFire.pendingVerdict) {
            surface(activeFire, activeFire.pendingVerdict);
            activeFire = null;
          }
        }
      }
    };

    const loop = (now: number) => {
      if (stopped) return;
      if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
        lastSampleAt = now;
        sample();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const el = videoRef.current;
    const onSeeking = () => invalidate("seek");
    el?.addEventListener("seeking", onSeeking);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      el?.removeEventListener("seeking", onSeeking);
      if (activeFire) {
        activeFire.dead = true;
        activeFire.controller.abort();
      }
      optsRef.current.onArmedLabel?.(null);
    };
  }, [enabled, readWatchFrames, videoId, videoRef, videoTitle]);

  return { getGeneration };
}
