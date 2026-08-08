import { useCallback, useEffect, useRef, useState } from "react";
import VoiceBubble from "./VoiceBubble";
import ManualOverlay from "./ManualOverlay";
import VideoHighlights from "./VideoHighlights";
import {
  askGrok,
  captureFrame,
  needsVideoContext,
  useGrokListener,
} from "../hooks/useVoice";
import { useSpeechLevel } from "../hooks/useSpeechLevel";
import {
  normalizeLabels,
  wantsHighlight,
  withLabelIds,
} from "../lib/highlights";
import {
  applyManualAction,
  fetchManual,
  parseManualAction,
  speakText,
} from "../lib/manual";
import type {
  HighlightLabel,
  ManualOverlayState,
  VideoItem,
  VoicePhase,
} from "../types";

type Props = {
  video: VideoItem;
  onBack: () => void;
};

const WAKE_DUCK = 0.035;
const NORMAL_VOLUME = 1;

export default function VideoPlayer({ video, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef(0);
  const manualRef = useRef<ManualOverlayState | null>(null);
  const resumeAfterHighlightRef = useRef(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ttsAudio, setTtsAudio] = useState<HTMLAudioElement | null>(null);
  const [usedVision, setUsedVision] = useState(false);
  const [manual, setManual] = useState<ManualOverlayState | null>(null);
  const [highlights, setHighlights] = useState<HighlightLabel[]>([]);
  const voiceBusy = phase !== "idle";

  useEffect(() => {
    manualRef.current = manual;
  }, [manual]);

  const [listenActivity, setListenActivity] = useState(0);

  const speechLevel = useSpeechLevel({
    activity: phase === "listening" ? listenActivity : 0,
    audioElement: phase === "speaking" ? ttsAudio : null,
  });

  const clearHighlights = useCallback(() => {
    setHighlights([]);
    if (resumeAfterHighlightRef.current) {
      resumeAfterHighlightRef.current = false;
      const el = videoRef.current;
      if (el) void el.play().catch(() => {});
    }
  }, []);

  const playSpoken = useCallback(async (text: string, sessionId: number) => {
    setReply(text);
    setPhase("speaking");
    const audioUrl = await speakText(text);
    if (sessionId !== sessionRef.current) {
      URL.revokeObjectURL(audioUrl);
      return;
    }
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    setTtsAudio(audio);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Could not play voice reply"));
      audio.play().catch(reject);
    });
    URL.revokeObjectURL(audioUrl);
  }, []);

  const handleQuestion = useCallback(
    async (heard: string) => {
      const sessionId = ++sessionRef.current;
      const el = videoRef.current;
      setTranscript(heard);
      setError(null);
      setReply("");
      setUsedVision(false);
      setPhase("thinking");

      try {
        const open = Boolean(manualRef.current);
        const action = parseManualAction(heard, open);

        if (action) {
          if (action.type === "open_manual") {
            const topic = action.topic || video.title || "sushi";
            const loading: ManualOverlayState = {
              doc: {
                title: "Searching the web…",
                topic,
                source: {
                  title: "Searching",
                  url: "https://x.ai",
                  siteName: "searching…",
                },
                steps: [
                  {
                    n: 1,
                    text: "Finding a trusted source and building steps…",
                  },
                ],
              },
              stepIndex: 0,
              x: manualRef.current?.x ?? 24,
              y: manualRef.current?.y ?? 96,
              loading: true,
            };
            setManual(loading);
            manualRef.current = loading;
            setReply("One sec…");

            const doc = await fetchManual({
              topic,
              videoTitle: video.title,
              videoDescription: video.description,
            });
            if (sessionId !== sessionRef.current) return;
            const result = applyManualAction(manualRef.current, action, doc);
            setManual(result.state);
            manualRef.current = result.state;
            await playSpoken(result.speak, sessionId);
            return;
          }

          const result = applyManualAction(manualRef.current, action);
          setManual(result.state);
          manualRef.current = result.state;
          await playSpoken(result.speak, sessionId);
          return;
        }

        const highlight = wantsHighlight(heard);
        const wantFrames = highlight || needsVideoContext(heard);
        setUsedVision(wantFrames);

        let frames: string[] = [];
        let currentTime = el?.currentTime || 0;
        let duration = el && Number.isFinite(el.duration) ? el.duration : 0;

        if (wantFrames && el) {
          if (highlight && !el.paused) {
            el.pause();
            resumeAfterHighlightRef.current = true;
          }
          const frame = captureFrame(
            el,
            highlight ? { maxW: 768, quality: 0.62 } : undefined,
          );
          if (frame) frames = [frame];
        }

        if (highlight) setHighlights([]);

        const result = await askGrok({
          message: heard,
          videoTitle: video.title,
          videoDescription: video.description,
          currentTime,
          duration,
          frames,
          wantLabels: highlight,
        });

        if (sessionId !== sessionRef.current) {
          void result.audioPromise.then((url) => URL.revokeObjectURL(url));
          return;
        }

        // Paint boxes as soon as chat returns — don't wait on TTS.
        if (highlight) {
          const placed = withLabelIds(normalizeLabels(result.labels));
          setHighlights(placed);
          if (!placed.length && resumeAfterHighlightRef.current) {
            resumeAfterHighlightRef.current = false;
            void el?.play().catch(() => {});
          }
        }

        setReply(result.reply);
        setPhase("speaking");

        const audioUrl = await result.audioPromise;
        if (sessionId !== sessionRef.current) {
          URL.revokeObjectURL(audioUrl);
          return;
        }

        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        setTtsAudio(audio);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("Could not play voice reply"));
          audio.play().catch(reject);
        });
        URL.revokeObjectURL(audioUrl);
      } catch (err) {
        if (sessionId !== sessionRef.current) return;
        setError(err instanceof Error ? err.message : "Voice session failed");
        setPhase("error");
        if (resumeAfterHighlightRef.current) {
          resumeAfterHighlightRef.current = false;
          void videoRef.current?.play().catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 2200));
      } finally {
        if (sessionId === sessionRef.current) {
          setPhase("idle");
          setTranscript("");
          setTtsAudio(null);
          setUsedVision(false);
          if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
        }
      }
    },
    [playSpoken, video.description, video.title],
  );

  const { supported, micLive, interim, startCommand } = useGrokListener({
    enabled: phase === "idle" || phase === "listening",
    onSpeechStart: () => {
      setError(null);
      setReply("");
      setTranscript("");
      setPhase("listening");
      if (videoRef.current) videoRef.current.volume = 0.02;
    },
    onQuestion: (text) => {
      void handleQuestion(text);
    },
  });

  useEffect(() => {
    if (phase === "listening" && interim) setTranscript(interim);
  }, [interim, phase]);

  useEffect(() => {
    if (phase !== "listening") {
      setListenActivity(0);
      return;
    }
    if (!interim && !transcript) return;
    setListenActivity(0.85);
    const t = window.setTimeout(() => setListenActivity(0.22), 140);
    return () => window.clearTimeout(t);
  }, [interim, transcript, phase]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (phase === "idle") el.volume = WAKE_DUCK;
    if (phase === "speaking") el.volume = 0.08;
    if (phase === "listening") el.volume = 0.02;
  }, [phase]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.volume = WAKE_DUCK;
    void el.play().catch(() => {});
  }, [video.src]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "KeyG" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        if (phase === "idle") {
          event.preventDefault();
          startCommand();
        }
        return;
      }
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      const el = videoRef.current;
      if (!el) return;
      resumeAfterHighlightRef.current = false;
      if (el.paused) void el.play();
      else el.pause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, startCommand]);

  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      audioRef.current?.pause();
      if (videoRef.current) videoRef.current.volume = NORMAL_VOLUME;
    };
  }, []);

  const wakeLabel = supported ? "Grok" : "Ask Grok";

  return (
    <div className="player-screen">
      <div className="player-bar">
        <button type="button" className="back-btn" onClick={onBack}>
          ← Library
        </button>
        <div className="player-title">{video.title}</div>
        <button
          type="button"
          className={`mic-btn ${voiceBusy || micLive ? "active" : ""} ${micLive && !voiceBusy ? "hot" : ""}`}
          onClick={() => {
            if (phase !== "idle") return;
            startCommand();
          }}
          title={
            supported
              ? "Mic is live — just talk, or tap"
              : "Tap to talk (speech unsupported in this browser)"
          }
        >
          <span className={`mic-dot ${micLive ? "on" : ""}`} />
          {wakeLabel}
        </button>
      </div>

      <div className="player-video-wrap">
        <video
          ref={videoRef}
          className="player-video"
          src={video.src}
          playsInline
          loop
          onClick={() => {
            const el = videoRef.current;
            if (!el) return;
            resumeAfterHighlightRef.current = false;
            if (el.paused) void el.play();
            else el.pause();
          }}
        />
        <VideoHighlights
          videoRef={videoRef}
          labels={highlights}
          onLabelsChange={(next) => {
            if (!next.length) clearHighlights();
            else setHighlights(next);
          }}
        />
      </div>

      {manual && (
        <ManualOverlay
          manual={manual}
          onChangePosition={(x, y) => {
            setManual((m) => {
              if (!m) return m;
              const next = { ...m, x, y };
              manualRef.current = next;
              return next;
            });
          }}
          onClose={() => {
            setManual(null);
            manualRef.current = null;
          }}
        />
      )}

      <VoiceBubble
        phase={phase}
        transcript={transcript || interim}
        reply={reply}
        error={error}
        level={speechLevel}
        usedVision={usedVision}
      />
    </div>
  );
}
