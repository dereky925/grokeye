import { useCallback, useEffect, useRef, useState } from "react";
import VoiceBubble from "./VoiceBubble";
import ManualOverlay from "./ManualOverlay";
import ToolsOverlay from "./ToolsOverlay";
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
import { detectColorTargets } from "../lib/colorDetect";
import {
  applyManualAction,
  fetchManual,
  parseManualAction,
  speakText,
} from "../lib/manual";
import { snapCommand } from "../lib/commands";
import { fetchTools, listPhrase, wantsTools } from "../lib/tools";
import type {
  HighlightLabel,
  ManualOverlayState,
  ToolsState,
  VideoItem,
  VoicePhase,
} from "../types";

type Props = {
  video: VideoItem;
  onBack: () => void;
};

const WAKE_DUCK = 0.035;
const NORMAL_VOLUME = 1;

/** Drop STT that is mostly Grok reading its own reply back into the mic. */
function looksLikeEcho(heard: string, spoken: string) {
  const a = heard
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const b = spoken
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (a.length < 2 || b.length < 2) return false;
  const setB = new Set(b);
  const overlap = a.filter((w) => setB.has(w)).length;
  if (overlap / a.length >= 0.55) return true;
  const heardJoin = a.join(" ");
  const spokenJoin = b.join(" ");
  if (heardJoin.length >= 12 && spokenJoin.includes(heardJoin)) return true;
  if (spokenJoin.length >= 12 && heardJoin.includes(spokenJoin.slice(0, 48))) {
    return true;
  }
  return false;
}

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
  const [tools, setTools] = useState<ToolsState | null>(null);
  const [highlights, setHighlights] = useState<HighlightLabel[]>([]);
  const [detecting, setDetecting] = useState(false);
  const voiceBusy = phase !== "idle";

  useEffect(() => {
    manualRef.current = manual;
  }, [manual]);

  const [micArmed, setMicArmed] = useState(true);
  const [listenActivity, setListenActivity] = useState(0);
  const lastSpokenRef = useRef("");
  const rearmTimerRef = useRef<number | null>(null);

  const speechLevel = useSpeechLevel({
    activity: phase === "listening" ? listenActivity : 0,
    audioElement: phase === "speaking" ? ttsAudio : null,
  });

  const armMicSoon = useCallback((delayMs = 850) => {
    if (rearmTimerRef.current != null) {
      window.clearTimeout(rearmTimerRef.current);
    }
    setMicArmed(false);
    rearmTimerRef.current = window.setTimeout(() => {
      setMicArmed(true);
      rearmTimerRef.current = null;
    }, delayMs);
  }, []);

  const clearHighlights = useCallback(() => {
    setHighlights([]);
    setDetecting(false);
    if (resumeAfterHighlightRef.current) {
      resumeAfterHighlightRef.current = false;
      const el = videoRef.current;
      if (el) void el.play().catch(() => {});
    }
  }, []);

  const stopTts = useCallback(() => {
    const audio = audioRef.current as
      | (HTMLAudioElement & { __resolveSpeak?: () => void })
      | null;
    if (!audio) return;
    const resolve = audio.__resolveSpeak;
    audio.__resolveSpeak = undefined;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audioRef.current = null;
    setTtsAudio(null);
    resolve?.();
  }, []);

  const interruptGrok = useCallback(() => {
    sessionRef.current += 1;
    stopTts();
    setDetecting(false);
    setError(null);
    setReply("");
    setTranscript("");
    setUsedVision(false);
    setPhase("idle");
    if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
    armMicSoon(350);
  }, [armMicSoon, stopTts]);

  const canInterrupt =
    detecting ||
    phase === "thinking" ||
    phase === "speaking" ||
    phase === "error";

  const playAudioUrl = useCallback(async (audioUrl: string, sessionId: number) => {
    if (sessionId !== sessionRef.current) {
      URL.revokeObjectURL(audioUrl);
      return;
    }
    stopTts();
    const audio = new Audio(audioUrl) as HTMLAudioElement & {
      __resolveSpeak?: () => void;
    };
    audioRef.current = audio;
    setTtsAudio(audio);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          audio.__resolveSpeak = undefined;
          resolve();
        };
        audio.__resolveSpeak = done;
        audio.onended = done;
        audio.onerror = () => reject(new Error("Could not play voice reply"));
        audio.play().catch(reject);
      });
    } finally {
      URL.revokeObjectURL(audioUrl);
      if (audioRef.current === audio) {
        audioRef.current = null;
        setTtsAudio(null);
      }
    }
  }, [stopTts]);

  const handleQuestion = useCallback(
    async (heard: string, alternatives: string[] = []) => {
      const sessionId = ++sessionRef.current;
      const el = videoRef.current;
      setTranscript(heard);
      setError(null);
      setReply("");
      setUsedVision(false);
      setPhase("thinking");

      try {
        const open = Boolean(manualRef.current);
        // Exact regex first; fall back to fuzzy command snapping over all
        // recognition alternatives to recover misheard controls.
        const action =
          parseManualAction(heard, open) ??
          snapCommand([heard, ...alternatives], open);

        if (action) {
          // Navigating the manual invalidates any tools shown for the old step.
          setTools(null);
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

            const doc = await fetchManual({
              topic,
              videoTitle: video.title,
              videoDescription: video.description,
            });
            if (sessionId !== sessionRef.current) return;
            // Panel-only: update the overlay, no spoken readout or center text.
            const result = applyManualAction(manualRef.current, action, doc);
            setManual(result.state);
            manualRef.current = result.state;
            return;
          }

          // Panel-only: update the overlay, no spoken readout or center text.
          const result = applyManualAction(manualRef.current, action);
          setManual(result.state);
          manualRef.current = result.state;
          return;
        }

        if (wantsTools(heard)) {
          const m = manualRef.current;
          const stepText = m ? m.doc.steps[m.stepIndex]?.text : undefined;
          const stepNumber = m ? m.stepIndex + 1 : null;
          const topic = m ? m.doc.topic : video.title;

          setTools({ tools: [], stepNumber, loading: true });

          let found;
          try {
            found = await fetchTools({
              topic,
              stepText,
              stepNumber,
              videoTitle: video.title,
            });
          } catch (err) {
            if (sessionId !== sessionRef.current) return;
            setTools(null);
            throw err;
          }
          if (sessionId !== sessionRef.current) return;
          setTools({ tools: found, stepNumber, loading: false });

          const summary = found.length
            ? `You'll need ${listPhrase(found.map((t) => t.name))}.`
            : "I couldn't find the tools for this step.";
          lastSpokenRef.current = summary;
          setMicArmed(false);
          setPhase("speaking");
          try {
            const url = await speakText(summary);
            await playAudioUrl(url, sessionId);
          } catch {
            /* audio is optional — cards are already shown */
          }
          return;
        }

        const highlight = wantsHighlight(heard);
        const wantFrames = highlight || needsVideoContext(heard);
        setUsedVision(wantFrames);

        let frames: string[] = [];
        let currentTime = el?.currentTime || 0;
        let duration = el && Number.isFinite(el.duration) ? el.duration : 0;
        let precomputed: Array<{
          text: string;
          x: number;
          y: number;
          w: number;
          h: number;
          score?: number;
        }> = [];

        if (wantFrames && el) {
          // Grab a frame while playing — don’t freeze the video for detection.
          const frame = captureFrame(
            el,
            highlight ? { maxW: 512, quality: 0.55 } : undefined,
          );
          if (frame) frames = [frame];
        }

        if (highlight) {
          setHighlights([]);
          setDetecting(true);

          // Lightest path: salmon/fish color blob on-device (no model).
          if (el) {
            const colorHits = detectColorTargets(el, heard);
            if (colorHits.length) {
              precomputed = normalizeLabels(colorHits);
              if (precomputed.length) {
                setHighlights(withLabelIds(precomputed));
                setDetecting(false);
              }
            }
          }

          if (!precomputed.length && frames[0]) {
            try {
              const detectRes = await fetch("/api/detect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  image: frames[0],
                  pack: video.detectorPack || "sushi",
                  query: heard,
                  max_detections: 2,
                }),
              });
              const detectData = await detectRes.json();
              if (sessionId !== sessionRef.current) return;
              if (detectRes.ok) {
                precomputed = normalizeLabels(detectData.labels);
                if (precomputed.length) {
                  setHighlights(withLabelIds(precomputed));
                  setDetecting(false);
                }
              }
            } catch (err) {
              console.warn("[detect] client path failed", err);
            }
          }
        }

        const result = await askGrok({
          message: heard,
          videoTitle: video.title,
          videoDescription: video.description,
          currentTime,
          duration,
          frames,
          // Boxes already on screen — skip a second server-side detect.
          wantLabels: highlight && precomputed.length === 0,
          detections: precomputed.length ? precomputed : undefined,
          detectorPack: video.detectorPack || "sushi",
        });

        if (sessionId !== sessionRef.current) {
          setDetecting(false);
          void result.audioPromise.then((url) => URL.revokeObjectURL(url));
          return;
        }

        if (highlight && precomputed.length === 0) {
          const placed = withLabelIds(normalizeLabels(result.labels));
          setHighlights(placed);
        }
        if (highlight) setDetecting(false);

        setReply(result.reply);
        lastSpokenRef.current = result.reply;
        setMicArmed(false);
        setPhase("speaking");

        const audioUrl = await result.audioPromise;
        await playAudioUrl(audioUrl, sessionId);
      } catch (err) {
        if (sessionId !== sessionRef.current) return;
        setDetecting(false);
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
          armMicSoon(900);
        }
      }
    },
    [armMicSoon, playAudioUrl, video.description, video.detectorPack, video.title],
  );

  const { supported, micLive, interim, startCommand } = useGrokListener({
    // Mute recognition while Grok is talking — browser STT will hear speakers otherwise.
    enabled: micArmed && (phase === "idle" || phase === "listening"),
    onSpeechStart: () => {
      setError(null);
      setReply("");
      setTranscript("");
      setPhase("listening");
      if (videoRef.current) videoRef.current.volume = 0.02;
    },
    onQuestion: (text, alternatives) => {
      if (looksLikeEcho(text, lastSpokenRef.current)) {
        console.log("[voice] ignoring likely TTS echo:", text);
        return;
      }
      void handleQuestion(text, alternatives);
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
    return () => {
      if (rearmTimerRef.current != null) {
        window.clearTimeout(rearmTimerRef.current);
      }
    };
  }, []);
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
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return Boolean(
        el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.isContentEditable),
      );
    };

    const scrubBy = (delta: number) => {
      const el = videoRef.current;
      if (!el) return;
      const duration = Number.isFinite(el.duration) ? el.duration : 0;
      const next = Math.min(Math.max(0, el.currentTime + delta), duration || Infinity);
      el.currentTime = next;
    };

    const onKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.code === "KeyG" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (phase === "idle") {
          event.preventDefault();
          startCommand();
        }
        return;
      }

      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 1 : 5;
        scrubBy(event.code === "ArrowLeft" ? -step : step);
        return;
      }

      if (event.code !== "Space") return;
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
        {detecting && (
          <div className="detect-status" role="status" aria-live="polite">
            <span className="detect-status-spinner" aria-hidden />
            <span>Finding it…</span>
          </div>
        )}
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

      {tools && (
        <ToolsOverlay state={tools} onClose={() => setTools(null)} />
      )}

      <VoiceBubble
        phase={phase}
        transcript={transcript || interim}
        reply={reply}
        error={error}
        level={speechLevel}
        usedVision={usedVision}
      />

      {canInterrupt && (
        <button
          type="button"
          className="interrupt-btn"
          onClick={interruptGrok}
          title="Stop Grok"
        >
          <span className="interrupt-icon" aria-hidden />
          Stop
        </button>
      )}
    </div>
  );
}
