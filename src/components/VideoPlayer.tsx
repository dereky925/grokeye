import { useCallback, useEffect, useRef, useState } from "react";
import VoiceBubble, { VOICE_BUBBLE_EXIT_MS } from "./VoiceBubble";
import GuidanceStatusChip from "./GuidanceStatusChip";
import ManualOverlay from "./ManualOverlay";
import MiniSpotify from "./MiniSpotify";
import MiniTwitter from "./MiniTwitter";
import MiniYoutube from "./MiniYoutube";
import PlayerTransport from "./PlayerTransport";
import TaskStateChip from "./TaskStateChip";
import ToolsDropdown from "./ToolsDropdown";
import ToolsOverlay from "./ToolsOverlay";
import VideoHighlights from "./VideoHighlights";
import {
  askGrok,
  askWeb,
  captureFrame,
  fetchLabels,
  needsVideoContext,
  needsWebSearch,
  useGrokListener,
  useWakeWord,
  WAKE_RE,
} from "../hooks/useVoice";
import { useSpeechLevel } from "../hooks/useSpeechLevel";
import { useCameraStream } from "../hooks/useCameraStream";
import {
  LIGHTWEIGHT_FRAME_BUFFER_OPTIONS,
  type BufferedFrame,
  useFrameBuffer,
} from "../hooks/useFrameBuffer";
import { useSpotifyPlayer } from "../hooks/useSpotifyPlayer";
import { useTwitterFeed } from "../hooks/useTwitterFeed";
import { useYoutubePlayer } from "../hooks/useYoutubePlayer";
import {
  extractLocateTarget,
  filterLabelsByEcho,
  normalizeLabels,
  normalizeLink,
  wantsHighlight,
  withLabelIds,
} from "../lib/highlights";
import { tightenLabelsOnFrame } from "../lib/tighten";
import { detectColorTargets } from "../lib/colorDetect";
import {
  applyManualAction,
  fetchManual,
  identifyTopicFromFrame,
  snapPosition,
  speakText,
} from "../lib/manual";
import {
  fetchToolkit,
  fetchTools,
  listPhrase,
  parseToolsAction,
  wantsTools,
} from "../lib/tools";
import { fetchVerify, parseVerifyAction } from "../lib/verify";
import {
  fetchGuidance,
  normalizeGuidance,
} from "../lib/guidance";
import { type CatalogMotionCue } from "../lib/choreography";
import { resolveInstructionRoute } from "../lib/instructionRouting";
import {
  selectContextFrames,
  wantsRecentVisualHistory,
} from "../lib/frameMemory";
import {
  resolveVisualSubjectHint,
  updateVisualMemory,
  type GroundedReferentSource,
  type VisualReferentMemory,
} from "../lib/visualMemory";
import { cropSprite, fetchGhost } from "../lib/ghost";
import GhostOverlay from "./GhostOverlay";
import FlipReview from "./FlipReview";
import StepReviewPanel from "./StepReviewPanel";
import { fetchFlipReview, selectAttemptFrames, wantsFlipReview } from "../lib/flip";
import {
  captureStepFrames,
  fetchStepReview,
  fetchVideoScript,
  selectReviewStep,
  wantsStepReview,
} from "../lib/stepReview";
import { useWorkWatcher } from "../hooks/useWorkWatcher";
import {
  WATCH_FLUSH_GRACE_MS,
  WATCH_FLUSH_RETRY_MS,
  decideProactiveSpeech,
  dedupeKey,
  isEchoSafeCallout,
  offerPending,
  parseWatchAction,
  takePending,
  type PendingSlot,
  type ProactiveFinding,
  type WatchGate,
} from "../lib/watchSpeech";
import { parseSpotifyAction } from "../lib/spotify";
import { parseTwitterAction } from "../lib/twitter";
import { parseYoutubeAction } from "../lib/youtube";
import {
  appendTurn,
  attachAfterFrames,
  createLedger,
  markEscalated,
  markRouted,
  nextEntryId,
  recordVerdict,
  selectAfterFrame,
  selectAuditItems,
  isActionable,
  type LedgerEntryKind,
  type SessionLedger,
} from "../lib/sessionLedger";
import {
  buildEscalationPayloads,
  parseAuditAction,
  runAudit,
  summarizeAudit,
  type AuditItem,
  type EscalationPayload,
} from "../lib/audit";
import {
  composeCollage,
  fallbackCaption,
  fetchXCaption,
  fetchXPost,
  formatMediaTime,
  isCardActionable,
  parsePostAction,
  type XPostCardState,
} from "../lib/xpost";
import XPostCard from "./XPostCard";
import type {
  FlipReviewState,
  GhostState,
  StepReviewState,
  GuidanceCue,
  HighlightLabel,
  HighlightLink,
  ManualDoc,
  ManualOverlayState,
  TaskSession,
  ToolkitState,
  ToolsState,
  VideoItem,
  VoicePhase,
} from "../types";

// The local YOLO ladder is dev-only tooling: the timed demo runs Grok boxes +
// the local tracker per the demo contract, and a loose COCO match ("person"
// for "hand") pre-empting Grok was a top wrong-object source. VITE_LOCAL_DETECTOR=1
// re-enables it.
const USE_LOCAL_DETECTOR = import.meta.env.VITE_LOCAL_DETECTOR === "1";

type Props = {
  video: VideoItem;
  onBack: () => void;
};

type PendingTask = {
  sessionId: number;
  goal: string;
  beforeFrame: string;
  instruction: string | null;
  link: HighlightLink[] | null;
  /** Session-ledger entry this task's verdicts should write back to. */
  entryId: string | null;
};

/**
 * Per-turn accumulator for the session ledger. Branches stamp their kind with
 * one line; the `finally` block appends the finished record. The entry id is
 * pre-generated so async callbacks (labels link, verify) can reference it
 * whether or not the append has happened yet.
 */
type TurnRecord = {
  sessionId: number;
  entryId: string;
  kind: LedgerEntryKind;
  question: string;
  mediaTime: number;
  askedAtT: number;
  beforeFrame: string | null;
  manualStepText?: string;
  /** Branch-supplied answer for turns that never speak (widget nav). */
  answer?: string;
  /** lastSpokenRef at turn start — distinguishes this turn's speech from stale. */
  spokenAtStart: string;
  routed: boolean;
};

const WAKE_DUCK = 0.035;
const NORMAL_VOLUME = 1;

/** Drop STT that is mostly Grok reading its own reply back into the mic. */
function looksLikeEcho(heard: string, spoken: string) {
  const raw = heard.toLowerCase();
  // Fresh user commands should never be treated as speaker bleed.
  if (
    /\b(highlight|circle|outline|label|mark|point|show|find|where|how|which|motion|direction|open|next|previous|close|stop|play|spotify|bowie|music|pause|twitter|tweet|tweets|feed|elon|musk|starship|spacex|youtube|watch|skip|rewind|manual|ikea|desk|flip)\b/.test(
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

const GENERIC_GROUNDED_SUBJECT_RE =
  /^(?:it|this|that|object|thing|part|piece|pivot|move this|moving part|target)$/i;

function pickGroundedSubject(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const subject = String(candidate || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 96);
    if (subject && !GENERIC_GROUNDED_SUBJECT_RE.test(subject)) return subject;
  }
  return null;
}

export default function VideoPlayer({ video, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef(0);
  const manualRef = useRef<ManualOverlayState | null>(null);
  const toolkitRef = useRef<ToolkitState | null>(null);
  const taskRef = useRef<TaskSession | null>(null);
  const pendingTaskRef = useRef<PendingTask | null>(null);
  const resumeAfterTurnRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const turnInFlightRef = useRef(false);
  const highlightHoldRef = useRef(false);
  const speechFrameRef = useRef<string | null>(null);
  const speechTimeRef = useRef<number | null>(null);
  const speechContextFramesRef = useRef<BufferedFrame[]>([]);
  const visualMemoryRef = useRef<VisualReferentMemory | null>(null);
  const toolsRef = useRef<ToolsState | null>(null);
  const resumeAfterGhostRef = useRef(false);
  const ghostRef = useRef<GhostState | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ttsAudio, setTtsAudio] = useState<HTMLAudioElement | null>(null);
  const [usedVision, setUsedVision] = useState(false);
  const [manual, setManual] = useState<ManualOverlayState | null>(null);
  const [toolkit, setToolkit] = useState<ToolkitState | null>(null);
  const [task, setTask] = useState<TaskSession | null>(null);
  const [guidanceCue, setGuidanceCue] = useState<GuidanceCue | null>(null);
  const [catalogMotion, setCatalogMotion] =
    useState<CatalogMotionCue | null>(null);
  const [catalogMotionLeaving, setCatalogMotionLeaving] = useState(false);
  const [highlights, setHighlights] = useState<HighlightLabel[]>([]);
  const [highlightLinks, setHighlightLinks] = useState<HighlightLink[]>([]);
  const [scanning, setScanning] = useState(false);
  const [holdUntil, setHoldUntil] = useState<number | null>(null);
  const [highlightSeed, setHighlightSeed] = useState<string | null>(null);
  const [tools, setTools] = useState<ToolsState | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const spotifyOpenRef = useRef(false);
  const [twitterOpen, setTwitterOpen] = useState(false);
  const twitterOpenRef = useRef(false);
  const [cameraId, setCameraId] = useState<string | undefined>(undefined);
  const live = Boolean(video.live);
  const flipMode = video.mode === "flip";
  // Proactive work-watcher: default ON for catalog clips, hard OFF for
  // live/flip. Machine-initiated speech goes through decideProactiveSpeech.
  const [watchEnabled, setWatchEnabled] = useState(!live && flipMode === false);
  const [watchArmedLabel, setWatchArmedLabel] = useState<string | null>(null);
  const watchEnabledRef = useRef(watchEnabled);
  const phaseRef = useRef<VoicePhase>("idle");
  const scanningRef = useRef(false);
  const detectingRef = useRef(false);
  const holdUntilRef = useRef<number | null>(null);
  const announcedRef = useRef<Set<string>>(new Set());
  const pendingSlotRef = useRef<PendingSlot | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const lastActivityAtRef = useRef<number | null>(null);
  const lastProactiveEndedAtRef = useRef<number | null>(null);
  const watchGenRef = useRef<() => number>(() => 0);
  // Session verification: the per-video Q&A/action ledger, the in-flight turn
  // accumulator, delayed after-frame timers, and the "ask X" approval queue.
  const ledgerRef = useRef<SessionLedger>(createLedger(video.id));
  const turnRecordRef = useRef<TurnRecord | null>(null);
  const afterTimersRef = useRef<Map<string, number>>(new Map());
  const endAuditFiredRef = useRef(false);
  const [xQueue, setXQueue] = useState<XPostCardState[]>([]);
  const xQueueRef = useRef<XPostCardState[]>([]);
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
  const { read: readContextFrames, clear: clearContextFrames } = useFrameBuffer({
    enabled: !flipMode,
    videoRef,
    ...LIGHTWEIGHT_FRAME_BUFFER_OPTIONS,
    maxW: 512,
    quality: 0.5,
  });
  const [flipReview, setFlipReview] = useState<FlipReviewState | null>(null);
  const flipReviewRef = useRef<FlipReviewState | null>(null);
  const [stepReview, setStepReview] = useState<StepReviewState | null>(null);
  const stepReviewRef = useRef<StepReviewState | null>(null);
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
    toolkitRef.current = toolkit;
  }, [toolkit]);

  useEffect(() => {
    toolsRef.current = tools;
  }, [tools]);

  useEffect(() => {
    flipReviewRef.current = flipReview;
  }, [flipReview]);

  // Ref mirrors for the proactive-speech gate, which runs inside long-lived
  // async closures (same house pattern as manualRef/taskRef above).
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    scanningRef.current = scanning;
  }, [scanning]);
  useEffect(() => {
    detectingRef.current = detecting;
  }, [detecting]);
  useEffect(() => {
    holdUntilRef.current = holdUntil;
  }, [holdUntil]);
  useEffect(() => {
    watchEnabledRef.current = watchEnabled;
  }, [watchEnabled]);

  // A new clip is a fresh slate: per-clip default, empty announce set, no
  // deferred callout carried across videos.
  useEffect(() => {
    setWatchEnabled(!live && !flipMode);
    setWatchArmedLabel(null);
    announcedRef.current.clear();
    pendingSlotRef.current = null;
  }, [flipMode, live, video.id]);

  useEffect(() => {
    xQueueRef.current = xQueue;
  }, [xQueue]);

  // The ledger is per-video conversational history: it survives seeks and
  // loop-arounds (unlike frame geometry) and resets only on a video change.
  useEffect(() => {
    ledgerRef.current = createLedger(video.id);
    turnRecordRef.current = null;
    endAuditFiredRef.current = false;
    setXQueue([]);
    const timers = afterTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [video.id]);

  useEffect(() => {
    visualMemoryRef.current = null;
    speechContextFramesRef.current = [];
    clearContextFrames();

    const el = videoRef.current;
    if (!el) return;
    const clearVisualContext = () => {
      visualMemoryRef.current = null;
      speechContextFramesRef.current = [];
      clearContextFrames();
    };
    el.addEventListener("seeking", clearVisualContext);
    return () => el.removeEventListener("seeking", clearVisualContext);
  }, [clearContextFrames, video.id]);

  const rememberVisualSubject = useCallback(
    (
      subjectInput: string | null | undefined,
      source: GroundedReferentSource,
      videoTimeSeconds: number,
      cueId?: string,
    ) => {
      const subject = pickGroundedSubject(subjectInput);
      if (!subject) return;
      visualMemoryRef.current = updateVisualMemory(visualMemoryRef.current, {
        videoId: video.id,
        subject,
        source,
        cueId,
        videoTimeSeconds,
      });
    },
    [video.id],
  );

  const commitTask = useCallback((next: TaskSession | null) => {
    taskRef.current = next;
    setTask(next);
  }, []);

  const sealTaskIfReady = useCallback(
    (sessionId: number) => {
      const pending = pendingTaskRef.current;
      if (
        !pending ||
        pending.sessionId !== sessionId ||
        sessionId !== sessionRef.current ||
        pending.instruction == null ||
        pending.link == null
      ) {
        return;
      }
      commitTask({
        goal: pending.goal,
        instruction: pending.instruction,
        beforeFrame: pending.beforeFrame,
        stage: "awaiting_action",
        ledgerEntryId: pending.entryId ?? undefined,
      });
      pendingTaskRef.current = null;
    },
    [commitTask],
  );

  const [micArmed, setMicArmed] = useState(true);
  const [listenActivity, setListenActivity] = useState(0);
  const lastSpokenRef = useRef("");
  const rearmTimerRef = useRef<number | null>(null);

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
    setHighlightLinks([]);
    setGuidanceCue(null);
    setCatalogMotion(null);
    setDetecting(false);
    setHoldUntil(null);
    setHighlightSeed(null);
    highlightHoldRef.current = false;
    if (!turnInFlightRef.current) resumeIfAutoPaused();
  }, [resumeIfAutoPaused]);

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
    pendingTaskRef.current = null;
    // A toolkit still loading would spin forever once its turn is dead.
    if (toolkitRef.current?.loading) {
      toolkitRef.current = null;
      setToolkit(null);
    }
    if (taskRef.current?.stage === "verifying") {
      commitTask({ ...taskRef.current, stage: "awaiting_action" });
    }
    stopTts();
    clearGhost();
    setDetecting(false);
    setScanning(false);
    setGuidanceCue(null);
    setCatalogMotion(null);
    setHoldUntil(null);
    highlightHoldRef.current = false;
    turnInFlightRef.current = false;
    setError(null);
    setReply("");
    setTranscript("");
    setUsedVision(false);
    setPhase("idle");
    if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
    resumeIfAutoPaused();
    armMicSoon(350);
    // An interruption is user activity — proactive callouts yield the floor.
    lastActivityAtRef.current = performance.now();
  }, [armMicSoon, clearGhost, commitTask, resumeIfAutoPaused, stopTts]);

  // A guide without boxes (not visible / unsafe) still needs a bounded HUD
  // lifetime. Box-backed guides usually clear sooner through VideoHighlights.
  useEffect(() => {
    // Authored choreography instead follows the reply bubble exactly below.
    if (!guidanceCue || catalogMotion) return;
    const timer = window.setTimeout(clearHighlights, 12000);
    return () => window.clearTimeout(timer);
  }, [catalogMotion, clearHighlights, guidanceCue]);

  // Authored choreography is part of Grok's answer, not a persistent
  // highlight. Start its exit with VoiceBubble and remove both together.
  useEffect(() => {
    if (!catalogMotion || phase !== "idle") {
      setCatalogMotionLeaving(false);
      return;
    }

    setCatalogMotionLeaving(true);
    const timer = window.setTimeout(clearHighlights, VOICE_BUBBLE_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [catalogMotion, clearHighlights, phase]);

  const canInterrupt =
    detecting ||
    scanning ||
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

  /** One-line branch stamp onto the in-flight turn record. */
  const stampTurn = useCallback(
    (kind: LedgerEntryKind, extra?: Partial<TurnRecord>) => {
      const rec = turnRecordRef.current;
      if (rec) Object.assign(rec, { kind }, extra);
    },
    [],
  );

  /**
   * ~9s after an instructed action, pull the "what the user did" frames from
   * the rolling buffer (zero API cost): the motion peak plus a settled after
   * view. Falls back to a live grab when a seek or loop wiped the buffer.
   */
  const scheduleAfterCapture = useCallback(
    (entryId: string, askedAtT: number) => {
      const timers = afterTimersRef.current;
      const existing = timers.get(entryId);
      if (existing) window.clearTimeout(existing);
      timers.set(
        entryId,
        window.setTimeout(() => {
          timers.delete(entryId);
          let { after, mid } = selectAfterFrame(readContextFrames(), askedAtT);
          if (!after) {
            const el = videoRef.current;
            const url = el ? captureFrame(el, { maxW: 512, quality: 0.5 }) : null;
            if (url) {
              after = {
                url,
                t: performance.now(),
                mediaTime: el?.currentTime ?? 0,
                motion: 0,
              };
              mid = null;
            }
          }
          ledgerRef.current = attachAfterFrames(
            ledgerRef.current,
            entryId,
            after ? { url: after.url, t: after.t, mediaTime: after.mediaTime } : null,
            mid ? { url: mid.url, t: mid.t, mediaTime: mid.mediaTime } : null,
          );
        }, 9000),
      );
    },
    [readContextFrames],
  );

  const patchXCard = useCallback(
    (clientToken: string, patch: Partial<XPostCardState>) => {
      setXQueue((queue) =>
        queue.map((card) =>
          card.clientToken === clientToken ? { ...card, ...patch } : card,
        ),
      );
    },
    [],
  );

  const dismissXCard = useCallback((clientToken: string) => {
    setXQueue((queue) => queue.filter((card) => card.clientToken !== clientToken));
  }, []);

  /**
   * Queue an unverifiable action for a one-tap "ask X" post. The card shows a
   * deterministic caption instantly; Grok's caption swaps in if it arrives
   * before approval. Collage composition gates the Post button.
   */
  const enqueueXPost = useCallback(
    (payload: EscalationPayload) => {
      const clientToken = crypto.randomUUID();
      setXQueue((queue) => [
        ...queue,
        {
          clientToken,
          question: payload.question,
          caption: fallbackCaption(payload),
          collageUrl: null,
          status: "composing",
          mediaTime: payload.mediaTime,
        },
      ]);
      void composeCollage(payload.frames)
        .then((collageUrl) => patchXCard(clientToken, { collageUrl, status: "pending" }))
        .catch(() =>
          patchXCard(clientToken, {
            status: "failed",
            error: "Couldn't build the frame collage.",
          }),
        );
      void fetchXCaption({
        question: payload.question,
        instructionText: payload.instruction,
        videoTitle: payload.videoTitle,
        mediaTime: payload.mediaTime,
      })
        .then((caption) => {
          setXQueue((queue) =>
            queue.map((card) =>
              card.clientToken === clientToken &&
              (card.status === "composing" || card.status === "pending")
                ? { ...card, caption }
                : card,
            ),
          );
        })
        .catch(() => {
          /* the fallback caption is already on the card */
        });
    },
    [patchXCard],
  );

  /**
   * Post the head card. Voice approvals pass their turn's sessionId so the
   * outcome is spoken; button taps pass null (the visual state is feedback
   * enough). The artifact survives every failure — the card keeps collage and
   * caption, and the server's clientToken makes tap+voice double-fires safe.
   */
  const approveXPost = useCallback(
    async (sessionId: number | null) => {
      const card = xQueueRef.current[0];
      if (!card || !isCardActionable(card) || !card.collageUrl || !card.caption) {
        return;
      }
      // An identical caption 403s as duplicate content on retry — stamp the
      // clip moment to make it honestly unique.
      const text =
        card.errorCode === "duplicate"
          ? `${card.caption} · ${formatMediaTime(card.mediaTime)}`.slice(0, 280)
          : card.caption;
      patchXCard(card.clientToken, { status: "posting", error: undefined });
      try {
        const { url } = await fetchXPost({
          imageDataUrl: card.collageUrl,
          text,
          clientToken: card.clientToken,
        });
        patchXCard(card.clientToken, { status: "posted", postedUrl: url });
        window.setTimeout(() => dismissXCard(card.clientToken), 8000);
        if (sessionId != null && sessionId === sessionRef.current) {
          try {
            await playSpoken("Posted — X is on it.", sessionId);
          } catch {
            /* the card already shows the live URL */
          }
        }
      } catch (err) {
        const failure = err as Error & { code?: string };
        patchXCard(card.clientToken, {
          status: "failed",
          error: failure.message,
          errorCode: failure.code,
        });
        if (sessionId != null && sessionId === sessionRef.current) {
          const line =
            failure.code === "reauth"
              ? "X login expired — reconnect in the browser."
              : "Posting failed — I kept the card, try again.";
          try {
            await playSpoken(line, sessionId);
          } catch {
            /* error already visible on the card */
          }
        }
      }
    },
    [dismissXCard, patchXCard, playSpoken],
  );

  /**
   * Whole-session audit: judge every unsettled instructed action with parallel
   * /api/verify calls (verdicts land in the ledger as they resolve), escalate
   * what stays unverifiable to the X queue, and speak a ≤3-sentence verdict.
   * The spoken acknowledgment overlaps the upstream latency.
   */
  const runSessionAudit = useCallback(
    async (sessionId: number) => {
      const el = videoRef.current;
      const entries = selectAuditItems(ledgerRef.current);
      if (!entries.length) {
        await playSpoken(
          "Nothing to check yet — walk through a step with me first.",
          sessionId,
        );
        return;
      }

      const items: AuditItem[] = [];
      for (const entry of entries) {
        let afterUrl = entry.afterFrame?.url ?? null;
        // Previously failed items get a fresh look — the user may have fixed
        // it since — and never-captured items get a last-chance live grab.
        if (!afterUrl || entry.status === "failed") {
          const grabbed = el ? captureFrame(el, { maxW: 512, quality: 0.5 }) : null;
          if (grabbed) {
            afterUrl = grabbed;
            ledgerRef.current = attachAfterFrames(
              ledgerRef.current,
              entry.id,
              { url: grabbed, t: performance.now(), mediaTime: el?.currentTime ?? 0 },
              entry.midFrame,
            );
          }
        }
        if (!entry.beforeFrame || !afterUrl || !entry.answer) continue;
        items.push({
          entryId: entry.id,
          goal: entry.question,
          instruction: entry.answer,
          beforeFrame: entry.beforeFrame,
          afterFrame: afterUrl,
          manualStepText: entry.manualStepText,
        });
      }
      if (!items.length) {
        await playSpoken(
          "I couldn't get a clear view to check — ask me again in a moment.",
          sessionId,
        );
        return;
      }

      setUsedVision(true);
      // Fire the verifies before speaking: the ack TTS masks their latency,
      // and verdicts persist as they land so a barge-in keeps partial results.
      const auditPromise = runAudit(items, {
        verify: fetchVerify,
        videoTitle: video.title,
        concurrency: 3,
        onResult: (result) => {
          if (sessionId !== sessionRef.current || !result.ok) return;
          ledgerRef.current = recordVerdict(ledgerRef.current, result.entryId, {
            verdict: result.verdict,
            spoken: result.spoken,
            source: "audit",
            nowMs: Date.now(),
          });
        },
      });
      try {
        await playSpoken("Let me look over what we did.", sessionId);
      } catch {
        /* the ack is a nicety */
      }
      if (sessionId !== sessionRef.current) return;
      setPhase("thinking");

      const results = await auditPromise;
      if (sessionId !== sessionRef.current) return;

      const payloads = buildEscalationPayloads(ledgerRef.current, video.title);
      ledgerRef.current = markEscalated(
        ledgerRef.current,
        payloads.map((payload) => payload.entryId),
      );
      for (const payload of payloads) enqueueXPost(payload);

      await playSpoken(
        summarizeAudit(results, { escalations: payloads.length }),
        sessionId,
      );
    },
    [enqueueXPost, playSpoken, video.title],
  );

  /** End-of-video audit owns its own turn discipline (no utterance behind it). */
  const runEndOfVideoAudit = useCallback(async () => {
    const sessionId = ++sessionRef.current;
    turnInFlightRef.current = true;
    setError(null);
    setReply("");
    setPhase("thinking");
    try {
      await runSessionAudit(sessionId);
    } catch {
      /* machine-initiated — fail silently, the ledger keeps its state */
    } finally {
      if (sessionId === sessionRef.current) {
        turnInFlightRef.current = false;
        setPhase("idle");
        setTtsAudio(null);
        setUsedVision(false);
        if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
        armMicSoon(900);
        lastActivityAtRef.current = performance.now();
      }
    }
  }, [armMicSoon, runSessionAudit]);

  // Catalog clips loop, so `ended` never fires — watch the playhead instead.
  // Fires once per approach to the end, only when something is still worth
  // checking; audited items leave the pool, so loops never nag.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || live) return;
    const onTime = () => {
      const duration = el.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const remaining = duration - el.currentTime;
      if (remaining > 5) {
        endAuditFiredRef.current = false;
        return;
      }
      if (remaining > 0.8 || endAuditFiredRef.current) return;
      if (phaseRef.current !== "idle" || turnInFlightRef.current) return;
      if (!selectAuditItems(ledgerRef.current).length) return;
      endAuditFiredRef.current = true;
      void runEndOfVideoAudit();
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [live, runEndOfVideoAudit, video.id]);

  const buildWatchGate = useCallback((): WatchGate => {
    const el = videoRef.current;
    const now = performance.now();
    return {
      now,
      watchEnabled: watchEnabledRef.current,
      live,
      flipMode,
      tabHidden: document.hidden,
      videoPaused: Boolean(el?.paused),
      videoSeeking: Boolean(el?.seeking),
      videoId: video.id,
      playhead: el?.currentTime ?? 0,
      seekEpoch: watchGenRef.current(),
      phase: phaseRef.current,
      turnInFlight: turnInFlightRef.current,
      scanning: scanningRef.current,
      detecting: detectingRef.current,
      highlightHold:
        highlightHoldRef.current ||
        (holdUntilRef.current != null && holdUntilRef.current > now),
      ghostActive: Boolean(ghostRef.current),
      lastActivityAt: lastActivityAtRef.current,
      lastProactiveEndedAt: lastProactiveEndedAtRef.current,
      announced: announcedRef.current,
    };
  }, [flipMode, live, video.id]);

  const paintWatchAttention = useCallback(
    (f: ProactiveFinding) => {
      if (!f.attention) return;
      const placed = withLabelIds(
        normalizeLabels([{ ...f.attention, kind: "zone" }], 1),
      );
      if (!placed.length) return;
      clearHighlights();
      highlightHoldRef.current = true;
      setHighlightSeed(f.frame);
      setHighlights(placed);
    },
    [clearHighlights],
  );

  // Deferred-callout retry loop. The function ref breaks the circular
  // dependency between speakProactive (defers) and flushPendingWatch (retries).
  const flushFnRef = useRef<() => void>(() => {});
  const scheduleWatchFlush = useCallback((delayMs: number) => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
    }
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushFnRef.current();
    }, delayMs);
  }, []);

  /**
   * Machine-initiated speech. Order matters: synthesize TTS while claiming
   * nothing (the listener stays live and the user wins any race), then
   * re-check the gate and claim the turn in one synchronous block.
   */
  const speakProactive = useCallback(
    async (f: ProactiveFinding) => {
      let decision = decideProactiveSpeech(f, buildWatchGate());
      if (decision.action === "drop") {
        console.log(`[watch] callout dropped (${decision.reason}): ${f.id}`);
        return;
      }
      if (decision.action === "defer") {
        pendingSlotRef.current = offerPending(pendingSlotRef.current, f);
        scheduleWatchFlush(WATCH_FLUSH_RETRY_MS);
        return;
      }

      if (!isEchoSafeCallout(f.spoken)) {
        // Speaking this could self-trigger the recognizer through the echo
        // filter's command-word bypass — paint the zone, skip the voice.
        console.warn("[watch] callout failed echo lint, zone only:", f.spoken);
        announcedRef.current.add(dedupeKey(f));
        paintWatchAttention(f);
        setHoldUntil(performance.now() + 5000);
        return;
      }

      const sessionSnapshot = sessionRef.current;
      let audioUrl: string;
      try {
        audioUrl = await speakText(f.spoken);
      } catch {
        return;
      }

      // Anything the user started during synthesis wins.
      decision = decideProactiveSpeech(f, buildWatchGate());
      if (sessionRef.current !== sessionSnapshot || decision.action !== "speak") {
        URL.revokeObjectURL(audioUrl);
        if (
          sessionRef.current === sessionSnapshot &&
          decision.action === "defer"
        ) {
          pendingSlotRef.current = offerPending(pendingSlotRef.current, f);
          scheduleWatchFlush(WATCH_FLUSH_RETRY_MS);
        }
        return;
      }

      const sessionId = ++sessionRef.current;
      turnInFlightRef.current = true;
      announcedRef.current.add(dedupeKey(f));
      lastSpokenRef.current = f.spoken;
      setMicArmed(false);
      setUsedVision(true);
      setReply(f.spoken);
      setPhase("speaking");
      paintWatchAttention(f);
      if (f.relatedToTask && taskRef.current) {
        commitTask({
          ...taskRef.current,
          stage: "awaiting_action",
          verdict: "not_complete",
        });
        // The realtime watcher is an external verifier for the session audit.
        const entryId = taskRef.current?.ledgerEntryId;
        if (entryId) {
          ledgerRef.current = recordVerdict(ledgerRef.current, entryId, {
            verdict: "not_complete",
            spoken: f.spoken,
            source: "external",
            nowMs: Date.now(),
          });
        }
      }
      try {
        await playAudioUrl(audioUrl, sessionId);
      } catch {
        /* the amber zone is already on screen */
      } finally {
        if (sessionId === sessionRef.current) {
          turnInFlightRef.current = false;
          setPhase("idle");
          setTtsAudio(null);
          setUsedVision(false);
          if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
          if (highlightHoldRef.current) {
            setHoldUntil(performance.now() + 2000);
          }
          armMicSoon(900);
          const ended = performance.now();
          lastProactiveEndedAtRef.current = ended;
          lastActivityAtRef.current = ended;
        }
      }
    },
    [
      armMicSoon,
      buildWatchGate,
      commitTask,
      paintWatchAttention,
      playAudioUrl,
      scheduleWatchFlush,
    ],
  );

  /** Retry a deferred callout; every attempt re-runs the full gate. */
  const flushPendingWatch = useCallback(() => {
    const f = takePending(pendingSlotRef.current, performance.now());
    if (!f) {
      pendingSlotRef.current = null;
      return;
    }
    const decision = decideProactiveSpeech(f, buildWatchGate());
    if (decision.action === "speak") {
      pendingSlotRef.current = null;
      void speakProactive(f);
    } else if (decision.action === "defer") {
      scheduleWatchFlush(WATCH_FLUSH_RETRY_MS);
    } else {
      pendingSlotRef.current = null;
    }
  }, [buildWatchGate, scheduleWatchFlush, speakProactive]);
  flushFnRef.current = flushPendingWatch;

  // When the stage frees up, give the user a grace beat to follow up first,
  // then let a still-valid deferred callout through.
  useEffect(() => {
    if (phase !== "idle") return;
    scheduleWatchFlush(WATCH_FLUSH_GRACE_MS);
    return () => {
      if (flushTimerRef.current != null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [phase, scheduleWatchFlush]);

  const watcher = useWorkWatcher({
    enabled: watchEnabled && !live && !flipMode,
    videoRef,
    videoId: video.id,
    videoTitle: video.title,
    getTask: () => taskRef.current,
    onFinding: (f) => {
      void speakProactive(f);
    },
    onArmedLabel: setWatchArmedLabel,
  });
  watchGenRef.current = watcher.getGeneration;

  const handleQuestion = useCallback(
    async (heard: string, alternatives: string[] = []) => {
      const sessionId = ++sessionRef.current;
      pendingTaskRef.current = null;
      const el = videoRef.current;
      const turnTime = speechTimeRef.current ?? el?.currentTime ?? 0;
      turnInFlightRef.current = true;
      turnRecordRef.current = {
        sessionId,
        entryId: nextEntryId(ledgerRef.current),
        kind: "chat",
        question: heard,
        mediaTime: turnTime,
        askedAtT: performance.now(),
        beforeFrame: speechFrameRef.current,
        spokenAtStart: lastSpokenRef.current,
        routed: false,
      };
      setTranscript(heard);
      setError(null);
      setReply("");
      setUsedVision(false);
      setScanning(false);
      setGuidanceCue(null);
      setCatalogMotion(null);
      setPhase("thinking");
      // A new turn supersedes whatever demo is on screen.
      if (ghostRef.current) clearGhost();

      try {
        // "Post it" / "skip" only exist while an ask-X card awaits a decision,
        // so this outranks every other router without ever colliding.
        const postAction = parsePostAction(
          heard,
          isCardActionable(xQueueRef.current[0]),
        );
        if (postAction) {
          stampTurn("widget", {
            answer: postAction === "post" ? "Approved the X post" : "Skipped the X post",
          });
          resumeIfAutoPaused();
          if (postAction === "post") {
            await approveXPost(sessionId);
          } else {
            const head = xQueueRef.current[0];
            if (head) dismissXCard(head.clientToken);
            await playSpoken("Okay, skipped.", sessionId);
          }
          return;
        }

        const youtubeAction = parseYoutubeAction(heard, youtubeOpenRef.current);
        if (youtubeAction) stampTurn("widget", { answer: "YouTube control" });
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
        if (twitterAction) stampTurn("widget", { answer: "X feed control" });
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
        if (spotifyAction) stampTurn("widget", { answer: "Spotify control" });
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

        // Work-watcher voice toggle. Sits after the media widgets so their
        // "watch X" grammar keeps winning; anchored on work/build nouns.
        const watchAction = parseWatchAction(heard);
        if (watchAction) {
          stampTurn("widget");
          resumeIfAutoPaused();
          if (live || flipMode) {
            await playSpoken("Watching isn't available on this feed.", sessionId);
            return;
          }
          if (watchAction === "watch_on") {
            setWatchEnabled(true);
            await playSpoken("I'm watching your work now.", sessionId);
          } else if (watchAction === "watch_off") {
            setWatchEnabled(false);
            pendingSlotRef.current = null;
            await playSpoken("Okay, eyes off.", sessionId);
          } else {
            announcedRef.current.clear();
            await playSpoken(
              "Fresh eyes. I'll call things out again.",
              sessionId,
            );
          }
          return;
        }

        // Flip coach owns "how did I do" while it is the active mode. The
        // attempt is already over, so this reads back through the frame buffer
        // instead of capturing now.
        if (flipMode && wantsFlipReview(heard)) {
          stampTurn("flip");
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

        // Step correctness — "how did I do on that step?" Judges ONE step:
        // asking in the first half of a step means the step that just
        // finished, second half means the current one. The answer is visual,
        // not spoken: the panel shows the frames it judged plus a written
        // verdict, so nothing goes to TTS or the voice bubble. Flip mode owns
        // its own "how did I do" above.
        if (!flipMode && !live && wantsStepReview(heard)) {
          const script = await fetchVideoScript(video.id);
          if (sessionId !== sessionRef.current) return;
          if (script) {
            stampTurn("verify", { question: heard });
            const step = selectReviewStep(script, turnTime);
            const opening: StepReviewState = {
              review: null,
              strip: [],
              loading: true,
              stepNumber: step.n,
              stepText: step.text,
              x: stepReviewRef.current?.x ?? 24,
              y: stepReviewRef.current?.y ?? 360,
            };
            setStepReview(opening);
            stepReviewRef.current = opening;

            try {
              const frames = await captureStepFrames(
                video.src,
                step.start,
                step.end,
              );
              if (sessionId !== sessionRef.current) return;
              const withStrip = { ...opening, strip: frames };
              setStepReview(withStrip);
              stepReviewRef.current = withStrip;

              const review = await fetchStepReview({
                videoId: video.id,
                stepNumber: step.n,
                question: heard,
                frames,
              });
              if (sessionId !== sessionRef.current) return;
              const done: StepReviewState = {
                ...withStrip,
                review,
                loading: false,
              };
              setStepReview(done);
              stepReviewRef.current = done;
            } catch (err) {
              if (sessionId !== sessionRef.current) return;
              setStepReview(null);
              stepReviewRef.current = null;
              throw err;
            }
            return;
          }
        }

        const visualSubjectHint = [heard, ...alternatives]
          .map((message) =>
            resolveVisualSubjectHint(visualMemoryRef.current, {
              message,
              videoId: video.id,
            }),
          )
          .find((subject): subject is string => Boolean(subject)) ?? null;

        const instructionRoute = resolveInstructionRoute({
          primary: heard,
          alternatives,
          manualOpen: Boolean(manualRef.current),
          toolsOpen: Boolean(toolsRef.current),
          videoId: video.id,
          currentTime: turnTime,
          subjectHint: visualSubjectHint,
        });

        // Catalog choreography has already won in resolveInstructionRoute.
        // Ghost remains the dynamic visual fallback for its narrower grammar.
        if (instructionRoute?.kind === "ghost" && el) {
          stampTurn("ghost");
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
              question: instructionRoute.utterance,
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

        const action =
          instructionRoute?.kind === "manual" ? instructionRoute.action : null;

        if (action) {
          stampTurn(
            action.type === "move_overlay" || action.type === "close_manual"
              ? "widget"
              : "manual_step",
            { answer: "Manual overlay" },
          );
          // Manual turns don't need the frozen frame — let it play under the card.
          resumeIfAutoPaused();

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
            const requestedTopic = action.topic || video.manualTopic;
            // The video's bundled pamphlet is only the default when the user
            // didn't name a different subject — "show me a sushi guide" on the
            // IKEA video must not open the MICKE pamphlet.
            const topicWantsPamphlet =
              !requestedTopic ||
              /\b(ikea|micke)\b/i.test(requestedTopic) ||
              (/\bdesk\b/i.test(requestedTopic) &&
                /\b(manual|assembl|instruction)/i.test(requestedTopic));
            const ikeaPdf = topicWantsPamphlet
              ? video.manualPdf ||
                (video.id === "ikea" ? "/manuals/micke-desk.pdf" : undefined)
              : undefined;
            const ikeaPages = topicWantsPamphlet
              ? video.manualPdfPages || (video.id === "ikea" ? 28 : undefined)
              : undefined;
            const loading: ManualOverlayState = {
              doc: {
                title: ikeaPdf
                  ? "Opening the IKEA pamphlet…"
                  : requestedTopic
                    ? `Finding a guide: ${requestedTopic}`
                    : "Searching the web…",
                // Placeholder only; the real topic may still need a vision call.
                topic: requestedTopic || heard,
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
            // If this turn dies before the real doc lands, the placeholder must
            // not survive it — otherwise the pane sits on "loading" forever and
            // bleeds into the next request.
            const clearIfStillPlaceholder = () => {
              if (manualRef.current === loading) {
                setManual(null);
                manualRef.current = null;
              }
            };

            // A live feed has no meaningful title, so never let it stand in as
            // the topic — that's how "open this water bottle" turned into a
            // guide for using the camera. Ask Grok to name what it sees instead.
            let topic = requestedTopic;
            if (!topic && live && el) {
              const frame = captureFrame(el, { maxW: 1024, quality: 0.8 });
              topic = frame
                ? await identifyTopicFromFrame(frame, heard)
                : undefined;
              if (sessionId !== sessionRef.current) {
                clearIfStillPlaceholder();
                return;
              }
            }
            if (!topic) topic = live ? heard : video.title || "sushi";

            let doc: ManualDoc;
            try {
              doc = await fetchManual({
                topic,
                // A live feed's title describes the camera, not the subject.
                videoTitle: live ? undefined : video.title,
                videoDescription: live ? undefined : video.description,
                manualPdf: ikeaPdf,
                manualPdfPages: ikeaPages,
                videoId: topicWantsPamphlet ? video.id : undefined,
              });
            } catch (err) {
              clearIfStillPlaceholder();
              throw err;
            }
            if (sessionId !== sessionRef.current) {
              clearIfStillPlaceholder();
              return;
            }
            // Never fall back to word-summary steps when we have an official PDF.
            if (ikeaPdf && doc.mode !== "pdf") {
              doc.mode = "pdf";
              doc.pdfUrl = ikeaPdf;
            }
            const result = applyManualAction(manualRef.current, action, doc);
            setManual(result.state);
            manualRef.current = result.state;
            if (result.state && !result.state.loading) {
              stampTurn("manual_step", {
                manualStepText:
                  result.state.doc.steps[result.state.stepIndex]?.text,
              });
            }
            if (result.speak) {
              try {
                await playSpoken(result.speak, sessionId);
              } catch {
                /* overlay and visible reply already updated */
              }
            }
            return;
          }

          const result = applyManualAction(manualRef.current, action);
          setManual(result.state);
          manualRef.current = result.state;
          if (
            result.state &&
            !result.state.loading &&
            action.type !== "move_overlay" &&
            action.type !== "close_manual"
          ) {
            stampTurn("manual_step", {
              manualStepText:
                result.state.doc.steps[result.state.stepIndex]?.text,
            });
          }
          // Read steps aloud; keep panel moves silent.
          if (result.speak && action.type !== "move_overlay") {
            try {
              await playSpoken(result.speak, sessionId);
            } catch {
              /* overlay and visible reply already updated */
            }
          }
          return;
        }

        if (wantsTools(heard)) {
          stampTurn("toolkit");
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
              videoDescription: video.description,
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

        const toolsAction = parseToolsAction(heard, Boolean(toolkitRef.current));
        if (toolsAction) {
          stampTurn("toolkit");
          // Checklist turns render in the dropdown — let the video keep playing.
          resumeIfAutoPaused();
          if (toolsAction.type === "close_tools") {
            setToolkit(null);
            toolkitRef.current = null;
            await playSpoken("Tool list closed.", sessionId);
            return;
          }

          const frame =
            speechFrameRef.current ??
            (el ? captureFrame(el, { maxW: 768, quality: 0.62 }) : null);
          setUsedVision(Boolean(frame));
          const loading: ToolkitState = { doc: null, loading: true };
          setToolkit(loading);
          toolkitRef.current = loading;
          setReply("One sec…");

          try {
            const doc = await fetchToolkit({
              message: heard,
              frame: frame ?? undefined,
              videoTitle: video.title,
              videoDescription: video.description,
            });
            if (sessionId !== sessionRef.current) return;
            const ready: ToolkitState = { doc, loading: false };
            setToolkit(ready);
            toolkitRef.current = ready;
            await playSpoken(doc.spoken, sessionId);
          } catch {
            if (sessionId !== sessionRef.current) return;
            setToolkit(null);
            toolkitRef.current = null;
            await playSpoken(
              "I couldn't build the tool list — try asking again.",
              sessionId,
            );
          }
          return;
        }

        const verifyAction = parseVerifyAction(heard);
        if (verifyAction) {
          stampTurn("verify");
          resumeIfAutoPaused();
          const activeTask = taskRef.current;
          if (!activeTask) {
            await playSpoken(
              "I haven't guided you through anything yet.",
              sessionId,
            );
            return;
          }

          const afterFrame =
            speechFrameRef.current ??
            (el ? captureFrame(el, { maxW: 768, quality: 0.62 }) : null);
          if (!afterFrame) {
            await playSpoken(
              "I couldn't capture the view to verify that — try asking again.",
              sessionId,
            );
            return;
          }

          setUsedVision(true);
          commitTask({ ...activeTask, stage: "verifying" });
          const openManual = manualRef.current;
          const manualStepText = openManual?.loading
            ? undefined
            : openManual?.doc.steps[openManual.stepIndex]?.text;

          let verification;
          try {
            verification = await fetchVerify({
              goal: activeTask.goal,
              instruction: activeTask.instruction,
              beforeFrame: activeTask.beforeFrame,
              afterFrame,
              videoTitle: video.title,
              manualStepText,
            });
          } catch {
            if (sessionId !== sessionRef.current) return;
            commitTask({ ...activeTask, stage: "awaiting_action" });
            await playSpoken(
              "I couldn't verify that — try asking again.",
              sessionId,
            );
            return;
          }

          if (sessionId !== sessionRef.current) return;
          clearHighlights();
          const nextTask: TaskSession = {
            ...activeTask,
            stage:
              verification.verdict === "not_complete"
                ? "awaiting_action"
                : "resolved",
            verdict: verification.verdict,
          };
          commitTask(nextTask);
          // Single-task verify and the session audit share one verdict store.
          if (activeTask.ledgerEntryId) {
            ledgerRef.current = recordVerdict(
              ledgerRef.current,
              activeTask.ledgerEntryId,
              {
                verdict: verification.verdict,
                spoken: verification.spoken,
                source: "single_verify",
                nowMs: Date.now(),
              },
            );
          }

          if (
            verification.verdict === "not_complete" &&
            verification.attention
          ) {
            const placed = withLabelIds(
              normalizeLabels(
                [{ ...verification.attention, kind: "zone" }],
                1,
              ),
            );
            if (placed.length) {
              highlightHoldRef.current = true;
              setHighlightSeed(afterFrame);
              setHighlights(placed);
            }
          }

          await playSpoken(verification.spoken, sessionId);
          if (sessionId === sessionRef.current && highlightHoldRef.current) {
            setHoldUntil(performance.now() + 2000);
          }
          return;
        }

        // Whole-session review ("did I do everything right?"). Kept disjoint
        // from the single-task verify grammar above, which retains priority.
        if (parseAuditAction(heard)) {
          stampTurn("audit");
          resumeIfAutoPaused();
          await runSessionAudit(sessionId);
          return;
        }

        const motionGuidance =
          instructionRoute?.kind === "catalog_motion" ||
          instructionRoute?.kind === "motion";
        const motionMessage =
          instructionRoute?.kind === "catalog_motion" ||
          instructionRoute?.kind === "motion"
            ? instructionRoute.utterance
            : heard;
        const authoredMotion =
          instructionRoute?.kind === "catalog_motion"
            ? instructionRoute.cue
            : null;
        const highlight = !motionGuidance && wantsHighlight(heard);
        // Web-fact turns skip frames entirely — the answer lives online, and
        // cached repeats come back before the video even notices.
        const webSearch = !motionGuidance && !highlight && needsWebSearch(heard);
        const recentVisualHistory =
          !motionGuidance && !highlight && wantsRecentVisualHistory(heard);
        const wantFrames =
          !webSearch &&
          (motionGuidance ||
            highlight ||
            recentVisualHistory ||
            needsVideoContext(heard));
        setUsedVision(wantFrames);
        if (motionGuidance) stampTurn("guidance");
        else if (highlight) stampTurn("highlight");
        else if (webSearch) stampTurn("web");

        // Non-visual turn: the freeze-on-speech pause isn't needed after all.
        if (!wantFrames) resumeIfAutoPaused();

        let frames: string[] = [];
        let currentTime = turnTime;
        let duration = el && Number.isFinite(el.duration) ? el.duration : 0;
        let precomputed: Omit<HighlightLabel, "id">[] = [];
        let geomFrame: string | null = null;
        const locateTarget = highlight ? extractLocateTarget(heard) : null;

        if (wantFrames && el) {
          // Prefer the snapshot taken at speech onset — the frame the user
          // reacted to — and fall back to a live grab if it's missing.
          const frame =
            speechFrameRef.current ??
            captureFrame(
              el,
              highlight || motionGuidance
                ? { maxW: 768, quality: 0.62 }
                : undefined,
            );
          if (frame) {
            const buffered = speechContextFramesRef.current;
            frames =
              recentVisualHistory && buffered.length > 1
                ? buffered.map((item) => item.url)
                : [frame];
          }
          if (highlight) {
            // Geometry rides a fresh end-of-utterance frame — the onset
            // snapshot is seconds stale by now and only the spoken reply
            // wants it. Sharper too (960px): it skips the chat payload.
            geomFrame =
              captureFrame(el, { maxW: 960, quality: 0.68 }) ?? frame ?? null;
          }
        }

        if (motionGuidance) {
          // Motion guidance is its own tracked visual turn, independent of
          // connection-task seeding and the local object detector ladder.
          commitTask(null);
          setHighlights([]);
          setHighlightLinks([]);
          setHoldUntil(null);
          setHighlightSeed(null);
          highlightHoldRef.current = false;

          if (authoredMotion) {
            // Known demo footage gets instant silhouette choreography: trace
            // the real object, then move the same outline. No model rectangle
            // and no geometry latency.
            //
            // The silhouettes are traced against one exact frame, so snap the
            // playhead to it and hold there while the cue is on screen —
            // otherwise the POV camera drifts and the outline lands mid-air.
            // clearHighlights resumes playback when the cue exits.
            if (el && !live) {
              if (!el.paused) {
                resumeAfterTurnRef.current = true;
                el.pause();
              }
              if (Math.abs(el.currentTime - authoredMotion.previewAt) > 0.12) {
                el.currentTime = authoredMotion.previewAt;
              }
              highlightHoldRef.current = true;
            }
            setManual(null);
            manualRef.current = null;
            setTools(null);
            toolsRef.current = null;
            setScanning(false);
            setCatalogMotionLeaving(false);
            setCatalogMotion(authoredMotion);
            rememberVisualSubject(
              authoredMotion.subject,
              "catalog",
              turnTime,
              authoredMotion.id,
            );
            setGuidanceCue({
              status: "ready",
              note: authoredMotion.note,
              motion: null,
            });
            setReply(`Follow the animated outline: ${authoredMotion.label}.`);
          } else if (frames[0]) {
            setScanning(true);
            void fetchGuidance({
              message: motionMessage,
              frame: frames[0],
              videoTitle: video.title,
              subjectHint: visualSubjectHint,
            })
              .then((raw) => {
                if (sessionId !== sessionRef.current) return;
                setScanning(false);
                setCatalogMotion(null);
                const placed = withLabelIds(normalizeLabels(raw.labels));
                const cue = normalizeGuidance(raw, placed);
                const shown =
                  raw.status === "ready" && cue.status !== "ready"
                    ? []
                    : placed;
                if (cue.status === "ready") {
                  rememberVisualSubject(
                    pickGroundedSubject(
                      visualSubjectHint,
                      placed[1]?.text,
                      placed[0]?.text,
                    ),
                    "guidance",
                    turnTime,
                  );
                }
                highlightHoldRef.current = shown.length > 0;
                setHighlightSeed(frames[0] ?? null);
                setHighlights(shown);
                setGuidanceCue(cue);
              })
              .catch(() => {
                if (sessionId !== sessionRef.current) return;
                setScanning(false);
              });
          }
        }

        if (highlight) {
          // A new visual guidance request supersedes the previous task.
          commitTask(null);
          if (frames[0]) {
            pendingTaskRef.current = {
              sessionId,
              goal: heard,
              beforeFrame: frames[0],
              instruction: null,
              link: null,
              entryId: turnRecordRef.current?.entryId ?? null,
            };
          }
          setHighlights([]);
          setHighlightLinks([]);
          setHoldUntil(null);
          setHighlightSeed(null);
          highlightHoldRef.current = false;
          setDetecting(true);

          // Lightest path: salmon/fish color blob on-device (no model).
          if (el) {
            const colorHits = detectColorTargets(el, heard);
            if (colorHits.length) {
              precomputed = normalizeLabels(colorHits);
              if (precomputed.length) {
                highlightHoldRef.current = true;
                setHighlights(withLabelIds(precomputed));
                rememberVisualSubject(
                  pickGroundedSubject(locateTarget, precomputed[0]?.text),
                  "highlight",
                  turnTime,
                );
              }
            }
          }

          if (USE_LOCAL_DETECTOR && !precomputed.length && frames[0]) {
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
                  highlightHoldRef.current = true;
                  // Boxes were located on the speech-onset frame — seed the
                  // tracker from it so they walk forward onto the live video.
                  setHighlightSeed(frames[0] ?? null);
                  setHighlights(withLabelIds(precomputed));
                  rememberVisualSubject(
                    pickGroundedSubject(locateTarget, precomputed[0]?.text),
                    "highlight",
                    turnTime,
                  );
                }
              }
            } catch (err) {
              console.warn("[detect] client path failed", err);
            }
          }

          setDetecting(false);
        }

        // No detector hit — Grok boxes ride a parallel labels-only call so
        // they paint while the spoken reply is still generating.
        if (highlight && !precomputed.length && (geomFrame || frames.length)) {
          setScanning(true);
          const geomSeed = geomFrame ?? frames[0] ?? null;
          const turnEntryId = turnRecordRef.current?.entryId ?? null;
          void fetchLabels({
            message: locateTarget ?? heard,
            frames: geomFrame ? [geomFrame] : frames,
            videoTitle: video.title,
          })
            .then(async (raw) => {
              if (sessionId !== sessionRef.current) return;
              setScanning(false);
              // Echo cross-check catches wrong-object answers; skipped for
              // routes, whose destination label names a different object.
              const rawLabels = raw.link
                ? raw.labels
                : filterLabelsByEcho(raw.labels, locateTarget);
              let normalized = normalizeLabels(rawLabels);
              if (geomSeed && normalized.some((l) => l.kind === "box")) {
                try {
                  normalized = await tightenLabelsOnFrame(
                    geomSeed,
                    normalized,
                    locateTarget ?? heard,
                  );
                } catch {
                  // Tightening is best-effort; the raw boxes still paint.
                }
                if (sessionId !== sessionRef.current) return;
              }
              const placed = withLabelIds(normalized);
              const links = normalizeLink(raw.link, placed);
              highlightHoldRef.current = placed.length > 0;
              setHighlightSeed(geomSeed);
              setHighlights(placed);
              setHighlightLinks(links);
              if (placed.length) {
                rememberVisualSubject(
                  pickGroundedSubject(
                    locateTarget,
                    visualSubjectHint,
                    placed[0]?.text,
                  ),
                  "highlight",
                  turnTime,
                );
              }
              const pending = pendingTaskRef.current;
              if (links.length && pending?.sessionId === sessionId) {
                pending.link = links;
                sealTaskIfReady(sessionId);
              }
              // A source→target link upgrades this locate turn into an
              // auditable connection, whether or not the turn already ended.
              if (links.length && turnEntryId) {
                const rec = turnRecordRef.current;
                if (rec?.entryId === turnEntryId) rec.routed = true;
                else ledgerRef.current = markRouted(ledgerRef.current, turnEntryId);
              }
            })
            .catch(() => {
              if (sessionId !== sessionRef.current) return;
              setScanning(false);
            });
        }

        const result = webSearch
          ? await askWeb({ message: heard, videoTitle: video.title })
          : await askGrok({
              message: heard,
              videoTitle: video.title,
              videoDescription: video.description,
              currentTime,
              duration,
              frames,
              temporalContext: recentVisualHistory && frames.length > 1,
              subjectHint: visualSubjectHint,
              lowDetail: highlight || motionGuidance,
              motionGuide: authoredMotion
                ? {
                    note: authoredMotion.note,
                    label: authoredMotion.label,
                    scene: authoredMotion.scene,
                  }
                : undefined,
              // Detector boxes ride along so Grok narrates them as authoritative;
              // Grok-box turns get geometry from the parallel /api/labels call.
              detections: precomputed.length ? precomputed : undefined,
              detectorPack: video.detectorPack || "sushi",
            });

        if (sessionId !== sessionRef.current) {
          setDetecting(false);
          void result.audioPromise.then((url) => URL.revokeObjectURL(url));
          return;
        }

        const pending = pendingTaskRef.current;
        if (pending?.sessionId === sessionId) {
          pending.instruction = result.reply;
          sealTaskIfReady(sessionId);
        }

        setReply(result.reply);
        lastSpokenRef.current = result.reply;
        setMicArmed(false);
        setPhase("speaking");

        const audioUrl = await result.audioPromise;
        await playAudioUrl(audioUrl, sessionId);

        // Keep a grounded follow-up referent alive for ten seconds after the
        // spoken answer finishes, not merely from the start of model latency.
        if (authoredMotion && sessionId === sessionRef.current) {
          rememberVisualSubject(
            authoredMotion.subject,
            "catalog",
            turnTime,
            authoredMotion.id,
          );
        }

        // Callouts breathe ~2s past the voice, then fade and the video resumes.
        if (sessionId === sessionRef.current && highlightHoldRef.current) {
          setHoldUntil(performance.now() + 2000);
        }
      } catch (err) {
        if (sessionId !== sessionRef.current) return;
        setDetecting(false);
        setError(err instanceof Error ? err.message : "Voice session failed");
        setPhase("error");
        setScanning(false);
        setGuidanceCue(null);
        setCatalogMotion(null);
        setHighlights([]);
        setHighlightLinks([]);
        setHoldUntil(null);
        highlightHoldRef.current = false;
        resumeIfAutoPaused();
        await new Promise((r) => setTimeout(r, 2200));
      } finally {
        // Every branch — early returns included — funnels through here, so
        // this is the one place the session ledger records the finished turn.
        const rec = turnRecordRef.current;
        if (rec && rec.sessionId === sessionId && sessionId === sessionRef.current) {
          const spokenNow = lastSpokenRef.current;
          const answer =
            spokenNow && spokenNow !== rec.spokenAtStart
              ? spokenNow
              : rec.answer ?? "";
          if (answer) {
            const { ledger, entryId } = appendTurn(ledgerRef.current, {
              question: rec.question,
              answer,
              kind:
                rec.routed && rec.kind === "highlight"
                  ? "highlight_route"
                  : rec.kind,
              mediaTime: rec.mediaTime,
              askedAtT: rec.askedAtT,
              nowMs: Date.now(),
              beforeFrame: rec.beforeFrame,
              manualStepText: rec.manualStepText,
            });
            ledgerRef.current = ledger;
            const entry = ledger.entries.find((item) => item.id === entryId);
            if (entry && isActionable(entry)) {
              scheduleAfterCapture(entryId, rec.askedAtT);
            }
          }
        }
        if (turnRecordRef.current?.sessionId === sessionId) {
          turnRecordRef.current = null;
        }
        if (sessionId === sessionRef.current) {
          turnInFlightRef.current = false;
          setPhase("idle");
          setTranscript("");
          setTtsAudio(null);
          setUsedVision(false);
          speechFrameRef.current = null;
          speechTimeRef.current = null;
          speechContextFramesRef.current = [];
          if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
          // Placed callouts extend the freeze; clearHighlights resumes later.
          if (!highlightHoldRef.current) resumeIfAutoPaused();
          armMicSoon(900);
          // The user just had the floor — hold proactive callouts briefly.
          lastActivityAtRef.current = performance.now();
        }
      }
    },
    [
      approveXPost,
      armMicSoon,
      clearGhost,
      clearHighlights,
      commitTask,
      dismissXCard,
      flipMode,
      live,
      playAudioUrl,
      playSpoken,
      readFlipFrames,
      rememberVisualSubject,
      resumeIfAutoPaused,
      runSessionAudit,
      scheduleAfterCapture,
      sealTaskIfReady,
      stampTurn,
      spotify,
      twitter,
      youtube,
      video.description,
      video.detectorPack,
      video.id,
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

  const { supported, micLive, interim, startCommand, cancelCommand } =
    useGrokListener({
      // Mute recognition while Grok is talking — browser STT will hear speakers otherwise.
      enabled: listenerEnabled,
      onSpeechStart: () => {
        setError(null);
        setReply("");
        setTranscript("");
        setPhase("listening");
        const el = videoRef.current;
        if (el) {
          // Real-time mode: never pause. Snapshot the frame at speech onset —
          // it's the moment the user reacted to — and keep playback rolling.
          const frame = captureFrame(el, {
            maxW: 768,
            quality: 0.62,
          });
          const mediaTime = el.currentTime || 0;
          const capturedAt = performance.now();
          speechFrameRef.current = frame;
          speechTimeRef.current = mediaTime;
          speechContextFramesRef.current = frame
            ? selectContextFrames(readContextFrames(), {
                url: frame,
                t: capturedAt,
                mediaTime,
                motion: 0,
              })
            : [];
          el.volume = 0.02;
        }
      },
      onQuestion: (text, alternatives) => {
        if (looksLikeEcho(text, lastSpokenRef.current)) {
          console.log("[voice] ignoring likely TTS echo:", text);
          setPhase("idle");
          setTranscript("");
          if (videoRef.current) videoRef.current.volume = WAKE_DUCK;
          resumeIfAutoPaused();
          return;
        }
        void handleQuestion(text, alternatives);
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
    if (!el) return;
    pendingTaskRef.current = null;
    commitTask(null);
    if (live) return; // the camera hook owns playback in live mode
    el.volume = WAKE_DUCK;
    void el.play().catch(() => {});
  }, [commitTask, video.src, live]);

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
      resumeAfterTurnRef.current = false;
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
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
      if (videoRef.current) videoRef.current.volume = NORMAL_VOLUME;
    };
  }, []);

  const wakeLabel = supported ? "Grok" : "Ask Grok";

  return (
    <div className="player-screen">
      <div className="player-bar">
        <button
          type="button"
          className="back-btn"
          onClick={onBack}
          aria-label="Back to library"
          title="Back to library"
        >
          ←
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
          onClick={(event) => {
            const el = videoRef.current;
            if (!el) return;
            if (clickTimerRef.current !== null) {
              // double press: skip 10s toward the tapped side
              window.clearTimeout(clickTimerRef.current);
              clickTimerRef.current = null;
              const rect = el.getBoundingClientRect();
              const forward = event.clientX - rect.left > rect.width / 2;
              const duration = Number.isFinite(el.duration) ? el.duration : 0;
              const next = el.currentTime + (forward ? 10 : -10);
              el.currentTime = Math.min(Math.max(0, next), duration || Infinity);
              return;
            }
            clickTimerRef.current = window.setTimeout(() => {
              clickTimerRef.current = null;
              resumeAfterTurnRef.current = false;
              if (el.paused) void el.play();
              else el.pause();
            }, 250);
          }}
        />
        {scanning && (
          <div className="video-scan" aria-hidden>
            <span className="video-scan-bar" />
          </div>
        )}
        {usedVision && voiceBusy && (
          <div
            className={`frame-freeze-chip ${task ? "with-task" : ""}`}
            aria-hidden
          >
            <span className="frame-freeze-dot" />
            Grok is watching
          </div>
        )}
        {watchEnabled && !live && !flipMode && phase === "idle" && (
          <div
            className={`frame-freeze-chip watch-idle ${task ? "with-task" : ""}`}
            aria-hidden
          >
            <span className="frame-freeze-dot" />
            {watchArmedLabel ?? "Watching"}
          </div>
        )}
        {task && <TaskStateChip task={task} />}
        {xQueue[0] && (
          <XPostCard
            card={xQueue[0]}
            onPost={() => void approveXPost(null)}
            onSkip={() => dismissXCard(xQueue[0].clientToken)}
          />
        )}
        {guidanceCue && (
          <GuidanceStatusChip
            cue={guidanceCue}
            authored={Boolean(catalogMotion)}
            leaving={catalogMotionLeaving}
          />
        )}
        <VideoHighlights
          videoRef={videoRef}
          labels={highlights}
          links={highlightLinks}
          guidanceMotion={guidanceCue?.motion ?? null}
          catalogMotion={catalogMotion}
          catalogMotionLeaving={catalogMotionLeaving}
          guidanceStatus={guidanceCue?.status ?? null}
          holdUntil={holdUntil}
          seedFrame={highlightSeed}
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
        <PlayerTransport
          videoRef={videoRef}
          onUserControl={() => {
            resumeAfterTurnRef.current = false;
          }}
        />
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

      {toolkit && (
        <ToolsDropdown
          toolkit={toolkit}
          onClose={() => {
            setToolkit(null);
            toolkitRef.current = null;
          }}
        />
      )}

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

      {stepReview && (
        <StepReviewPanel
          state={stepReview}
          onChangePosition={(x, y) => {
            setStepReview((r) => {
              if (!r) return r;
              const next = { ...r, x, y };
              stepReviewRef.current = next;
              return next;
            });
          }}
          onClose={() => {
            setStepReview(null);
            stepReviewRef.current = null;
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
