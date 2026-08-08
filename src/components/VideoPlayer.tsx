import { useCallback, useEffect, useRef, useState } from "react";
import VoiceBubble from "./VoiceBubble";
import MiniSpotify from "./MiniSpotify";
import MiniTwitter from "./MiniTwitter";
import ManualOverlay from "./ManualOverlay";
import VideoHighlights from "./VideoHighlights";
import {
  askGrok,
  captureFrame,
  needsVideoContext,
  useGrokListener,
} from "../hooks/useVoice";
import { useSpeechLevel } from "../hooks/useSpeechLevel";
import { useSpotifyPlayer } from "../hooks/useSpotifyPlayer";
import { useTwitterFeed } from "../hooks/useTwitterFeed";
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
import { parseSpotifyAction } from "../lib/spotify";
import { parseTwitterAction } from "../lib/twitter";
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

/** Drop STT that is mostly Grok reading its own reply back into the mic. */
function looksLikeEcho(heard: string, spoken: string) {
  const raw = heard.toLowerCase();
  // Fresh user commands should never be treated as speaker bleed.
  if (
    /\b(highlight|circle|outline|label|mark|point|show|find|where|open|next|previous|close|stop|play|spotify|bowie|music|pause|twitter|tweet|starship|spacex)\b/.test(
      raw,
    )
  ) {
    return false;
  }

  const a = raw
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const b = spoken
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (a.length < 3 || b.length < 3) return false;
  const setB = new Set(b);
  const overlap = a.filter((w) => setB.has(w)).length;
  if (overlap / a.length >= 0.7) return true;
  const heardJoin = a.join(" ");
  const spokenJoin = b.join(" ");
  if (heardJoin.length >= 18 && spokenJoin.includes(heardJoin)) return true;
  if (spokenJoin.length >= 18 && heardJoin.includes(spokenJoin.slice(0, 48))) {
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
  const [highlights, setHighlights] = useState<HighlightLabel[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const spotifyOpenRef = useRef(false);
  const [twitterOpen, setTwitterOpen] = useState(false);
  const twitterOpenRef = useRef(false);
  const voiceBusy = phase !== "idle";
  const spotify = useSpotifyPlayer();
  const twitter = useTwitterFeed();

  useEffect(() => {
    spotifyOpenRef.current = spotifyOpen;
  }, [spotifyOpen]);
  useEffect(() => {
    twitterOpenRef.current = twitterOpen;
  }, [twitterOpen]);

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

  const playSpoken = useCallback(
    async (text: string, sessionId: number) => {
      lastSpokenRef.current = text;
      setMicArmed(false);
      setReply(text);
      setPhase("speaking");
      const audioUrl = await speakText(text);
      if (sessionId !== sessionRef.current) {
        URL.revokeObjectURL(audioUrl);
        return;
      }
      await playAudioUrl(audioUrl, sessionId);
    },
    [playAudioUrl],
  );

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
        const twitterAction = parseTwitterAction(heard, twitterOpenRef.current);
        if (twitterAction?.type === "open_twitter") {
          setTwitterOpen(true);
          twitterOpenRef.current = true;
          if (!twitter.tweets.length) {
            void twitter.openAccount("SpaceX").catch((err) => {
              setError(err instanceof Error ? err.message : "Twitter failed");
            });
          }
          return;
        }
        if (twitterAction?.type === "close_twitter") {
          twitter.setPlaying(null);
          setTwitterOpen(false);
          twitterOpenRef.current = false;
          return;
        }
        if (twitterAction?.type === "scroll_next") {
          setTwitterOpen(true);
          twitterOpenRef.current = true;
          if (!twitter.tweets.length) {
            void twitter.openAccount("SpaceX").then(() => twitter.scrollNext());
          } else {
            twitter.scrollNext();
          }
          return;
        }
        if (twitterAction?.type === "scroll_prev") {
          setTwitterOpen(true);
          twitterOpenRef.current = true;
          twitter.scrollPrev();
          return;
        }
        if (twitterAction?.type === "open_account") {
          setTwitterOpen(true);
          twitterOpenRef.current = true;
          void twitter.openAccount(twitterAction.username).catch((err) => {
            setError(err instanceof Error ? err.message : "Could not open account");
          });
          return;
        }
        if (twitterAction?.type === "search") {
          setTwitterOpen(true);
          twitterOpenRef.current = true;
          void twitter.search(twitterAction.query).catch((err) => {
            setError(err instanceof Error ? err.message : "Twitter search failed");
          });
          return;
        }
        if (twitterAction?.type === "play_starship") {
          setTwitterOpen(true);
          twitterOpenRef.current = true;
          void twitter.playStarship().catch((err) => {
            setError(err instanceof Error ? err.message : "No Starship video found");
          });
          return;
        }

        const spotifyAction = parseSpotifyAction(heard, spotifyOpenRef.current);
        if (spotifyAction?.type === "open_spotify" || spotifyAction?.type === "nudge_play") {
          setSpotifyOpen(true);
          spotifyOpenRef.current = true;
          // Don't block the voice loop — otherwise UI sticks on Thinking.
          void spotify.playBowie().catch((err) => {
            const msg =
              err instanceof Error ? err.message : "Spotify is not ready yet";
            setError(msg);
          });
          return;
        }
        if (spotifyAction?.type === "play_query") {
          setSpotifyOpen(true);
          spotifyOpenRef.current = true;
          void spotify.playQuery(spotifyAction.query).catch((err) => {
            const msg =
              err instanceof Error ? err.message : "Could not play that";
            setError(msg);
          });
          return;
        }
        if (spotifyAction?.type === "next_track") {
          setSpotifyOpen(true);
          spotifyOpenRef.current = true;
          void spotify.nextTrack().catch((err) => {
            const msg =
              err instanceof Error ? err.message : "Could not skip track";
            setError(msg);
          });
          return;
        }
        if (spotifyAction?.type === "previous_track") {
          setSpotifyOpen(true);
          spotifyOpenRef.current = true;
          void spotify.previousTrack().catch((err) => {
            const msg =
              err instanceof Error ? err.message : "Could not go to previous";
            setError(msg);
          });
          return;
        }
        if (spotifyAction?.type === "close_spotify") {
          void spotify.pause().catch(() => {});
          setSpotifyOpen(false);
          spotifyOpenRef.current = false;
          return;
        }

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
    [armMicSoon, playAudioUrl, playSpoken, spotify, twitter, video.description, video.detectorPack, video.title],
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
    onQuestion: (text) => {
      if (looksLikeEcho(text, lastSpokenRef.current)) {
        console.log("[voice] ignoring likely TTS echo:", text);
        setPhase("idle");
        setTranscript("");
        if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
        return;
      }
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
    return () => {
      if (rearmTimerRef.current != null) {
        window.clearTimeout(rearmTimerRef.current);
      }
    };
  }, []);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (phase === "idle") el.volume = spotifyOpen ? 0.02 : WAKE_DUCK;
    if (phase === "speaking") el.volume = 0.05;
    if (phase === "listening") el.volume = 0.02;
  }, [phase, spotifyOpen]);

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
        <MiniSpotify
          open={spotifyOpen}
          onClose={() => setSpotifyOpen(false)}
          configured={spotify.configured}
          authenticated={spotify.authenticated}
          activated={spotify.activated}
          isPlaying={spotify.isPlaying}
          track={spotify.track}
          error={spotify.error}
          onLogin={spotify.login}
          onEnable={() => {
            void spotify.enablePlayback().catch(() => {});
          }}
        />
        <MiniTwitter
          open={twitterOpen}
          onClose={() => {
            twitter.setPlaying(null);
            setTwitterOpen(false);
          }}
          configured={twitter.configured}
          loading={twitter.loading}
          error={twitter.error}
          user={twitter.user}
          queryLabel={twitter.queryLabel}
          current={twitter.current}
          index={twitter.index}
          total={twitter.tweets.length}
          playing={twitter.playing}
          onStopVideo={() => twitter.setPlaying(null)}
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
