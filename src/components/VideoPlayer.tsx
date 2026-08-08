import { useCallback, useEffect, useRef, useState } from "react";
import VoiceBubble from "./VoiceBubble";
import MiniSpotify from "./MiniSpotify";
import MiniTwitter from "./MiniTwitter";
import MiniYoutube from "./MiniYoutube";
import ManualOverlay from "./ManualOverlay";
import ToolsOverlay from "./ToolsOverlay";
import VideoHighlights from "./VideoHighlights";
import {
  askGrok,
  captureFrame,
  needsVideoContext,
  useGrokListener,
  useWakeWord,
  WAKE_RE,
} from "../hooks/useVoice";
import { useSpeechLevel } from "../hooks/useSpeechLevel";
import { useCameraStream } from "../hooks/useCameraStream";
import { useFrameBuffer } from "../hooks/useFrameBuffer";
import { useSpotifyPlayer } from "../hooks/useSpotifyPlayer";
import { useTwitterFeed } from "../hooks/useTwitterFeed";
import { useYoutubePlayer } from "../hooks/useYoutubePlayer";
import {
  normalizeLabels,
  wantsHighlight,
  withLabelIds,
} from "../lib/highlights";
import { detectColorTargets } from "../lib/colorDetect";
import {
  applyManualAction,
  fetchManual,
  identifyTopicFromFrame,
  parseManualAction,
  snapPosition,
  speakText,
} from "../lib/manual";
import { snapCommand } from "../lib/commands";
import { cropSprite, fetchGhost, wantsGhost } from "../lib/ghost";
import GhostOverlay from "./GhostOverlay";
import FlipReview from "./FlipReview";
import { fetchFlipReview, selectAttemptFrames, wantsFlipReview } from "../lib/flip";
import { fetchTools, listPhrase, wantsTools } from "../lib/tools";
import { parseSpotifyAction } from "../lib/spotify";
import { parseTwitterAction } from "../lib/twitter";
import { parseYoutubeAction } from "../lib/youtube";
import type {
  FlipReviewState,
  GhostState,
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
  const raw = heard.toLowerCase();
  // Fresh user commands should never be treated as speaker bleed.
  if (
    /\b(highlight|circle|outline|label|mark|point|show|find|where|open|next|previous|close|stop|play|spotify|bowie|music|pause|twitter|tweet|tweets|feed|elon|musk|starship|spacex|youtube|watch|skip|rewind|manual|ikea|desk|flip)\b/.test(
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
  const toolsRef = useRef<ToolsState | null>(null);
  const resumeAfterHighlightRef = useRef(false);
  const resumeAfterGhostRef = useRef(false);
  const ghostRef = useRef<GhostState | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ttsAudio, setTtsAudio] = useState<HTMLAudioElement | null>(null);
  const [usedVision, setUsedVision] = useState(false);
  const [manual, setManual] = useState<ManualOverlayState | null>(null);
  const [tools, setTools] = useState<ToolsState | null>(null);
  const [highlights, setHighlights] = useState<HighlightLabel[]>([]);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const spotifyOpenRef = useRef(false);
  const [twitterOpen, setTwitterOpen] = useState(false);
  const twitterOpenRef = useRef(false);
  const [cameraId, setCameraId] = useState<string | undefined>(undefined);
  const live = Boolean(video.live);
  const flipMode = video.mode === "flip";
  const camera = useCameraStream({
    enabled: live,
    videoRef,
    deviceId: cameraId,
  });
  // A flip is over in under a second, so the frames have to already be in hand
  // by the time the user asks about it.
  const { read: readFlipFrames } = useFrameBuffer({
    enabled: live && flipMode,
    videoRef,
  });
  const [flipReview, setFlipReview] = useState<FlipReviewState | null>(null);
  const flipReviewRef = useRef<FlipReviewState | null>(null);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const youtubeOpenRef = useRef(false);
  const [youtubeSeek, setYoutubeSeek] = useState<{
    seq: number;
    seconds: number;
  } | null>(null);
  const voiceBusy = phase !== "idle";
  const spotify = useSpotifyPlayer();
  const twitter = useTwitterFeed();
  const youtube = useYoutubePlayer();

  useEffect(() => {
    spotifyOpenRef.current = spotifyOpen;
  }, [spotifyOpen]);
  useEffect(() => {
    twitterOpenRef.current = twitterOpen;
  }, [twitterOpen]);
  useEffect(() => {
    youtubeOpenRef.current = youtubeOpen;
  }, [youtubeOpen]);

  useEffect(() => {
    manualRef.current = manual;
  }, [manual]);

  useEffect(() => {
    toolsRef.current = tools;
  }, [tools]);

  useEffect(() => {
    flipReviewRef.current = flipReview;
  }, [flipReview]);

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

  const clearGhost = useCallback(() => {
    setGhost(null);
    ghostRef.current = null;
    if (resumeAfterGhostRef.current) {
      resumeAfterGhostRef.current = false;
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
    clearGhost();
    setDetecting(false);
    setError(null);
    setReply("");
    setTranscript("");
    setUsedVision(false);
    setPhase("idle");
    if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
    armMicSoon(350);
  }, [armMicSoon, clearGhost, stopTts]);

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
      // A new turn supersedes whatever demo is on screen.
      if (ghostRef.current) clearGhost();

      try {
        const youtubeAction = parseYoutubeAction(heard, youtubeOpenRef.current);
        if (youtubeAction?.type === "open_youtube") {
          setYoutubeOpen(true);
          youtubeOpenRef.current = true;
          return;
        }
        if (youtubeAction?.type === "close_youtube") {
          setYoutubeOpen(false);
          youtubeOpenRef.current = false;
          return;
        }
        if (youtubeAction?.type === "search") {
          setYoutubeOpen(true);
          youtubeOpenRef.current = true;
          void youtube.search(youtubeAction.query).catch((err) => {
            setError(err instanceof Error ? err.message : "YouTube search failed");
          });
          return;
        }
        if (youtubeAction?.type === "play_starship") {
          setYoutubeOpen(true);
          youtubeOpenRef.current = true;
          void youtube.playStarship().catch((err) => {
            setError(err instanceof Error ? err.message : "No Starship webcast found");
          });
          return;
        }
        if (youtubeAction?.type === "next") {
          setYoutubeOpen(true);
          youtubeOpenRef.current = true;
          youtube.next();
          return;
        }
        if (youtubeAction?.type === "previous") {
          setYoutubeOpen(true);
          youtubeOpenRef.current = true;
          youtube.previous();
          return;
        }
        if (youtubeAction?.type === "seek") {
          if (!youtubeOpenRef.current || !youtube.current) {
            setError("Open a YouTube video first, then say “skip 30 seconds”.");
            return;
          }
          setYoutubeSeek((prev) => ({
            seq: (prev?.seq || 0) + 1,
            seconds: youtubeAction.seconds,
          }));
          return;
        }

        const twitterAction = parseTwitterAction(heard, twitterOpenRef.current);
        if (twitterAction?.type === "open_twitter") {
          setTwitterOpen(true);
          twitterOpenRef.current = true;
          void twitter.openAccount("SpaceX").catch((err) => {
            setError(err instanceof Error ? err.message : "Twitter failed");
          });
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
          // Prefer the YouTube widget for Starship webcasts.
          setYoutubeOpen(true);
          youtubeOpenRef.current = true;
          void youtube.playStarship().catch((err) => {
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

        // Flip coach owns "how did I do" while it is the active mode. The
        // attempt is already over, so this reads back through the frame buffer
        // instead of capturing now.
        if (flipMode && wantsFlipReview(heard)) {
          const picked = selectAttemptFrames(readFlipFrames());
          if (picked.length < 2) {
            setReply("I need to see a flip first — try one and ask again.");
            setPhase("idle");
            return;
          }

          const strip = picked.map((f) => f.url);
          const loadingState: FlipReviewState = {
            review: null,
            strip,
            loading: true,
            x: flipReviewRef.current?.x ?? 24,
            y: flipReviewRef.current?.y ?? 96,
          };
          setFlipReview(loadingState);
          flipReviewRef.current = loadingState;
          setUsedVision(true);

          const review = await fetchFlipReview({ question: heard, frames: strip });
          if (sessionId !== sessionRef.current) return;

          const done: FlipReviewState = {
            ...loadingState,
            review,
            loading: false,
          };
          setFlipReview(done);
          flipReviewRef.current = done;

          if (review.spoken) {
            setReply(review.spoken);
            lastSpokenRef.current = review.spoken;
            setMicArmed(false);
            setPhase("speaking");
            try {
              const url = await speakText(review.spoken);
              await playAudioUrl(url, sessionId);
            } catch {
              /* the panel already has the verdict */
            }
          }
          return;
        }

        // Ahead of the manual router on purpose: "how do I use this jack?"
        // matches the open-manual regex, but the user wants a demo, not a guide.
        if (wantsGhost(heard) && el) {
          el.pause();
          resumeAfterGhostRef.current = true;
          const frame = captureFrame(el, { maxW: 1024, quality: 0.8 });
          if (!frame) throw new Error("Could not capture the frame");

          setUsedVision(true);
          setGhost({
            label: "",
            caption: "",
            box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
            motion: { primitive: "slide", to: { x: 0.6, y: 0.4 }, rotateDeg: 0 },
            spriteUrl: "",
            loading: true,
          });

          const m = manualRef.current;
          let planned;
          try {
            planned = await fetchGhost({
              question: heard,
              frame,
              videoTitle: video.title,
              stepText: m ? m.doc.steps[m.stepIndex]?.text : undefined,
            });
          } catch (err) {
            clearGhost();
            throw err;
          }
          if (sessionId !== sessionRef.current) return;

          // No usable box still gets a demo: trail plus caption, no sprite.
          const box = planned.box ?? { x: 0.36, y: 0.4, w: 0.28, h: 0.2 };
          const next: GhostState = {
            label: planned.label,
            caption: planned.caption,
            box,
            motion: planned.motion,
            spriteUrl: planned.box ? cropSprite(el, box) : "",
            loading: false,
          };
          setGhost(next);
          ghostRef.current = next;

          if (planned.caption) {
            setReply(planned.caption);
            lastSpokenRef.current = planned.caption;
            setMicArmed(false);
            setPhase("speaking");
            try {
              const url = await speakText(planned.caption);
              await playAudioUrl(url, sessionId);
            } catch {
              /* the animation is the point — audio is a bonus */
            }
          }
          return;
        }

        const open = Boolean(manualRef.current);
        const toolsOpen = Boolean(toolsRef.current);
        // Exact regex first; fall back to fuzzy command snapping over all
        // recognition alternatives to recover misheard controls.
        const action =
          parseManualAction(heard, open, toolsOpen) ??
          snapCommand([heard, ...alternatives], open);

        if (action) {
          // Moving the tools panel is its own thing — never touch the manual.
          if (action.type === "move_overlay" && action.target === "tools") {
            const current = toolsRef.current;
            if (current) {
              const { x, y } = snapPosition(
                action.snap,
                current.x,
                current.y,
                168,
                260,
              );
              const next = { ...current, x, y };
              setTools(next);
              toolsRef.current = next;
            }
            return;
          }

          // Changing steps invalidates any tools shown for the old step, but
          // repositioning the manual leaves them valid.
          if (action.type !== "move_overlay") setTools(null);

          if (action.type === "open_manual") {
            const ikeaPdf =
              video.manualPdf ||
              (video.id === "ikea" ? "/manuals/micke-desk.pdf" : undefined);
            const ikeaPages =
              video.manualPdfPages || (video.id === "ikea" ? 28 : undefined);
            const loading: ManualOverlayState = {
              doc: {
                title: ikeaPdf ? "Opening IKEA pamphlet…" : "Searching the web…",
                // Placeholder only; the real topic may still need a vision call.
                topic: action.topic || video.manualTopic || heard,
                mode: ikeaPdf ? "pdf" : "steps",
                pdfUrl: ikeaPdf,
                source: {
                  title: ikeaPdf ? "IKEA" : "Searching",
                  url: ikeaPdf || "https://x.ai",
                  siteName: ikeaPdf ? "ikea.com" : "searching…",
                },
                steps: [
                  {
                    n: 1,
                    text: ikeaPdf
                      ? "Loading the official assembly pamphlet…"
                      : "Finding a trusted source and building steps…",
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

            // A live feed has no meaningful title, so never let it stand in as
            // the topic — that's how "open this water bottle" turned into a
            // guide for using the camera. Ask Grok to name what it sees instead.
            let topic = action.topic || video.manualTopic;
            if (!topic && live && el) {
              const frame = captureFrame(el, { maxW: 1024, quality: 0.8 });
              topic = frame
                ? await identifyTopicFromFrame(frame, heard)
                : undefined;
              if (sessionId !== sessionRef.current) return;
            }
            if (!topic) topic = live ? heard : video.title || "sushi";

            const doc = await fetchManual({
              topic,
              // A live feed's title describes the camera, not the subject.
              videoTitle: live ? undefined : video.title,
              videoDescription: live ? undefined : video.description,
              manualPdf: ikeaPdf,
              manualPdfPages: ikeaPages,
              videoId: video.id,
            });
            if (sessionId !== sessionRef.current) return;
            // Never fall back to word-summary steps when we have an official PDF.
            if (ikeaPdf && doc.mode !== "pdf") {
              doc.mode = "pdf";
              doc.pdfUrl = ikeaPdf;
            }
            const result = applyManualAction(manualRef.current, action, doc);
            setManual(result.state);
            manualRef.current = result.state;
            if (result.speak) {
              lastSpokenRef.current = result.speak;
              setMicArmed(false);
              setPhase("speaking");
              try {
                const url = await speakText(result.speak);
                await playAudioUrl(url, sessionId);
              } catch {
                /* overlay already updated */
              }
            }
            return;
          }

          const result = applyManualAction(manualRef.current, action);
          setManual(result.state);
          manualRef.current = result.state;
          // Read steps aloud; keep panel moves silent.
          if (result.speak && action.type !== "move_overlay") {
            lastSpokenRef.current = result.speak;
            setMicArmed(false);
            setPhase("speaking");
            try {
              const url = await speakText(result.speak);
              await playAudioUrl(url, sessionId);
            } catch {
              /* overlay already updated */
            }
          }
          return;
        }

        if (wantsTools(heard)) {
          const m = manualRef.current;
          const stepText = m ? m.doc.steps[m.stepIndex]?.text : undefined;
          const stepNumber = m ? m.stepIndex + 1 : null;
          const topic = m ? m.doc.topic : video.title;

          const toolsX = toolsRef.current?.x ?? 16;
          const toolsY = toolsRef.current?.y ?? 150;
          setTools({
            tools: [],
            stepNumber,
            loading: true,
            x: toolsX,
            y: toolsY,
          });

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
          setTools({
            tools: found,
            stepNumber,
            loading: false,
            x: toolsX,
            y: toolsY,
          });

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
    [
      armMicSoon,
      clearGhost,
      flipMode,
      live,
      playAudioUrl,
      readFlipFrames,
      spotify,
      twitter,
      youtube,
      video.description,
      video.detectorPack,
      video.title,
    ],
  );

  // Mute the main recognizer while Grok is talking — browser STT will hear the
  // speakers otherwise.
  const listenerEnabled = micArmed && (phase === "idle" || phase === "listening");

  // Barge-in: while Grok is thinking or talking, a wake-word-only recognizer
  // takes over so "Hey Grok" can cut the answer short. Only one recognition can
  // be active at a time, hence the negated listenerEnabled.
  useWakeWord({
    enabled: !listenerEnabled && (phase === "thinking" || phase === "speaking"),
    onWake: () => {
      // Don't let Grok interrupt itself if its own reply says the wake phrase.
      if (WAKE_RE.test(lastSpokenRef.current)) return;
      console.log("[voice] barge-in on wake word");
      interruptGrok();
    },
  });

  const { supported, micLive, interim, startCommand } = useGrokListener({
    // Mute recognition while Grok is talking — browser STT will hear speakers otherwise.
    enabled: listenerEnabled,
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
        setPhase("idle");
        setTranscript("");
        if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
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
    if (phase === "idle") el.volume = spotifyOpen || youtubeOpen ? 0.02 : WAKE_DUCK;
    if (phase === "speaking") el.volume = 0.05;
    if (phase === "listening") el.volume = 0.02;
  }, [phase, spotifyOpen, youtubeOpen]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || live) return; // the camera hook owns playback in live mode
    el.volume = WAKE_DUCK;
    void el.play().catch(() => {});
  }, [video.src, live]);

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
        if (live) return; // nothing to scrub through on a camera feed
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
  }, [phase, startCommand, live]);

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
        <div className="player-title">
          {video.title}
          {live && (
            <span className="live-pill" title={camera.activeLabel}>
              <span className="live-pill-dot" />
              {camera.starting ? "STARTING" : "LIVE"}
            </span>
          )}
        </div>
        {live && camera.devices.length > 1 && (
          <select
            className="camera-select"
            value={camera.activeDeviceId ?? ""}
            onChange={(e) => setCameraId(e.target.value)}
            title="Camera source"
          >
            {camera.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}
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
          // srcObject is set by useCameraStream — never both.
          src={live ? undefined : video.src}
          playsInline
          muted={live}
          loop={!live}
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
        {ghost && !ghost.loading && (
          <GhostOverlay
            videoRef={videoRef}
            ghost={ghost}
            onDismiss={clearGhost}
          />
        )}
        {live && camera.starting && !camera.error && (
          <div className="camera-status" role="status" aria-live="polite">
            <span className="detect-status-spinner" aria-hidden />
            <span>Opening the camera…</span>
          </div>
        )}
        {live && camera.error && (
          <div className="camera-status error" role="alert">
            {camera.error}
          </div>
        )}
        {detecting && (
          <div className="detect-status" role="status" aria-live="polite">
            <span className="detect-status-spinner" aria-hidden />
            <span>Finding it…</span>
          </div>
        )}
        {ghost?.loading && (
          <div className="detect-status" role="status" aria-live="polite">
            <span className="detect-status-spinner" aria-hidden />
            <span>Working out the motion…</span>
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
        <MiniYoutube
          open={youtubeOpen}
          onClose={() => setYoutubeOpen(false)}
          loading={youtube.loading}
          error={youtube.error}
          queryLabel={youtube.queryLabel}
          current={youtube.current}
          index={youtube.index}
          total={youtube.videos.length}
          seekRequest={youtubeSeek}
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

      {tools && (
        <ToolsOverlay
          state={tools}
          onChangePosition={(x, y) => {
            setTools((t) => {
              if (!t) return t;
              const next = { ...t, x, y };
              toolsRef.current = next;
              return next;
            });
          }}
          onClose={() => {
            setTools(null);
            toolsRef.current = null;
          }}
        />
      )}

      {flipReview && (
        <FlipReview
          state={flipReview}
          onChangePosition={(x, y) => {
            setFlipReview((f) => {
              if (!f) return f;
              const next = { ...f, x, y };
              flipReviewRef.current = next;
              return next;
            });
          }}
          onClose={() => {
            setFlipReview(null);
            flipReviewRef.current = null;
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
          title="Stop Grok — or just say “Hey Grok”"
        >
          <span className="interrupt-icon" aria-hidden />
          Stop
        </button>
      )}
    </div>
  );
}
