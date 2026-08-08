import { useEffect, useRef, useState } from "react";

/**
 * Orb energy level.
 * - Prefer analysing a playing TTS element (no second mic).
 * - For listening, use an activity hint from recognition — never open getUserMedia,
 *   which steals / degrades Chrome's Web Speech mic.
 */
export function useSpeechLevel(options: {
  /** 0–1 hint while listening (e.g. transcript activity). */
  activity?: number;
  audioElement?: HTMLAudioElement | null;
}) {
  const { activity = 0, audioElement } = options;
  const [level, setLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activityRef = useRef(activity);

  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let analyser: AnalyserNode | null = null;
    let source: AudioNode | null = null;

    const ensureCtx = async () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      return audioCtxRef.current;
    };

    (async () => {
      try {
        if (audioElement) {
          const ctx = await ensureCtx();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          const keyed = audioElement as HTMLAudioElement & {
            __grokEyeSource?: MediaElementAudioSourceNode;
          };
          if (!keyed.__grokEyeSource) {
            keyed.__grokEyeSource = ctx.createMediaElementSource(audioElement);
          }
          source = keyed.__grokEyeSource;
          source.connect(analyser);
          analyser.connect(ctx.destination);

          const data = new Uint8Array(analyser.fftSize);
          const loop = () => {
            if (disposed || !analyser) return;
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i += 1) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            const boosted = Math.min(1, rms * 3.2);
            setLevel((prev) => prev * 0.55 + boosted * 0.45);
            raf = requestAnimationFrame(loop);
          };
          raf = requestAnimationFrame(loop);
          return;
        }

        // No mic stream — smooth the recognition activity hint.
        const loop = () => {
          if (disposed) return;
          const target = Math.min(1, Math.max(0, activityRef.current));
          setLevel((prev) => prev * 0.7 + target * 0.3);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      } catch {
        setLevel(0);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      try {
        source?.disconnect();
        analyser?.disconnect();
      } catch {
        /* ignore */
      }
      setLevel(0);
    };
  }, [audioElement]);

  useEffect(() => {
    return () => {
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
    };
  }, []);

  return level;
}
