import { useCallback, useEffect, useRef, useState } from "react";
import VoiceBubble from "./VoiceBubble";
import ManualOverlay from "./ManualOverlay";
import VideoHighlights from "./VideoHighlights";
import {
  askGrok,
  captureFrame,
  fetchLabels,
  needsVideoContext,
  useGrokListener,
} from "../hooks/useVoice";
import { useSpeechLevel } from "../hooks/useSpeechLevel";
import {
  normalizeLabels,
  normalizeLink,
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
  HighlightLink,
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
  const resumeAfterTurnRef = useRef(false);
  const turnInFlightRef = useRef(false);
  const highlightHoldRef = useRef(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ttsAudio, setTtsAudio] = useState<HTMLAudioElement | null>(null);
  const [usedVision, setUsedVision] = useState(false);
  const [manual, setManual] = useState<ManualOverlayState | null>(null);
  const [highlights, setHighlights] = useState<HighlightLabel[]>([]);
  const [highlightLinks, setHighlightLinks] = useState<HighlightLink[]>([]);
  const [scanning, setScanning] = useState(false);
  const [holdUntil, setHoldUntil] = useState<number | null>(null);
  const voiceBusy = phase !== "idle";

  useEffect(() => {
    manualRef.current = manual;
  }, [manual]);

  const [listenActivity, setListenActivity] = useState(0);

  const speechLevel = useSpeechLevel({
    activity: phase === "listening" ? listenActivity : 0,
    audioElement: phase === "speaking" ? ttsAudio : null,
  });

  const resumeIfAutoPaused = useCallback(() => {
    if (resumeAfterTurnRef.current) {
      resumeAfterTurnRef.current = false;
      void videoRef.current?.play().catch(() => {});
    }
  }, []);

  const clearHighlights = useCallback(() => {
    setHighlights([]);
    setHighlightLinks([]);
    setHoldUntil(null);
    highlightHoldRef.current = false;
    // Mid-turn clears leave the frame frozen; the turn's own exit resumes it.
    if (!turnInFlightRef.current) resumeIfAutoPaused();
  }, [resumeIfAutoPaused]);

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
      turnInFlightRef.current = true;
      setTranscript(heard);
      setError(null);
      setReply("");
      setUsedVision(false);
      setScanning(false);
      setPhase("thinking");

      try {
        const open = Boolean(manualRef.current);
        const action = parseManualAction(heard, open);

        if (action) {
          // Manual turns don't need the frozen frame — let it play under the card.
          resumeIfAutoPaused();
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

        // Non-visual turn: the freeze-on-speech pause isn't needed after all.
        if (!wantFrames) resumeIfAutoPaused();

        let frames: string[] = [];
        let currentTime = el?.currentTime || 0;
        let duration = el && Number.isFinite(el.duration) ? el.duration : 0;

        if (wantFrames && el) {
          // Video froze at speech onset, so this is the frame the user reacted to.
          const frame = captureFrame(
            el,
            highlight ? { maxW: 768, quality: 0.62 } : undefined,
          );
          if (frame) frames = [frame];
        }

        if (highlight) {
          setHighlights([]);
          setHighlightLinks([]);
          setHoldUntil(null);
          highlightHoldRef.current = false;
        }

        // Boxes ride a parallel labels-only call so they paint while the
        // spoken reply is still generating.
        if (highlight && frames.length) {
          setScanning(true);
          void fetchLabels({
            message: heard,
            frames,
            videoTitle: video.title,
          })
            .then((raw) => {
              if (sessionId !== sessionRef.current) return;
              setScanning(false);
              const placed = withLabelIds(normalizeLabels(raw.labels));
              highlightHoldRef.current = placed.length > 0;
              setHighlights(placed);
              setHighlightLinks(normalizeLink(raw.link, placed));
            })
            .catch(() => {
              if (sessionId !== sessionRef.current) return;
              setScanning(false);
            });
        }

        const result = await askGrok({
          message: heard,
          videoTitle: video.title,
          videoDescription: video.description,
          currentTime,
          duration,
          frames,
          lowDetail: highlight,
        });

        if (sessionId !== sessionRef.current) {
          void result.audioPromise.then((url) => URL.revokeObjectURL(url));
          return;
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

        // Callouts breathe ~2s past the voice, then fade and the video resumes.
        if (highlightHoldRef.current) {
          setHoldUntil(performance.now() + 2000);
        }
      } catch (err) {
        if (sessionId !== sessionRef.current) return;
        setError(err instanceof Error ? err.message : "Voice session failed");
        setPhase("error");
        setScanning(false);
        setHighlights([]);
        setHighlightLinks([]);
        setHoldUntil(null);
        highlightHoldRef.current = false;
        resumeIfAutoPaused();
        await new Promise((r) => setTimeout(r, 2200));
      } finally {
        if (sessionId === sessionRef.current) {
          turnInFlightRef.current = false;
          setPhase("idle");
          setTranscript("");
          setTtsAudio(null);
          setUsedVision(false);
          if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
          // Placed callouts extend the freeze; clearHighlights resumes later.
          if (!highlightHoldRef.current) resumeIfAutoPaused();
        }
      }
    },
    [playSpoken, resumeIfAutoPaused, video.description, video.title],
  );

  const { supported, micLive, interim, startCommand, cancelCommand } =
    useGrokListener({
      enabled: phase === "idle" || phase === "listening",
      onSpeechStart: () => {
        setError(null);
        setReply("");
        setTranscript("");
        setPhase("listening");
        const el = videoRef.current;
        if (el) {
          // Freeze on speech onset: the captured frame is the one the user
          // was reacting to, not one ~2s later when intent resolves.
          if (!el.paused) {
            el.pause();
            resumeAfterTurnRef.current = true;
          }
          el.volume = 0.02;
        }
      },
      onQuestion: (text) => {
        void handleQuestion(text);
      },
    });

  // Watchdog: a capture that never produces words (stray mic tap, noise)
  // must not leave the video frozen. Reset the turn and resume.
  useEffect(() => {
    if (phase !== "listening" || transcript || interim) return;
    const t = window.setTimeout(() => {
      cancelCommand();
      setPhase("idle");
      resumeIfAutoPaused();
    }, 8000);
    return () => window.clearTimeout(t);
  }, [phase, transcript, interim, cancelCommand, resumeIfAutoPaused]);

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
      resumeAfterTurnRef.current = false;
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
            resumeAfterTurnRef.current = false;
            if (el.paused) void el.play();
            else el.pause();
          }}
        />
        {scanning && (
          <div className="video-scan" aria-hidden>
            <span className="video-scan-bar" />
          </div>
        )}
        {usedVision && voiceBusy && (
          <div className="frame-freeze-chip" aria-hidden>
            <span className="frame-freeze-dot" />
            Answering from this frame
          </div>
        )}
        <VideoHighlights
          videoRef={videoRef}
          labels={highlights}
          links={highlightLinks}
          holdUntil={holdUntil}
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
