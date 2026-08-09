import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type RecognitionAlternative = { transcript: string; confidence: number };
type RecognitionResult = ArrayLike<RecognitionAlternative> & {
  isFinal: boolean;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type Mode = "idle" | "capturing" | "paused";

export type VoiceListenState = {
  supported: boolean;
  micLive: boolean;
  mode: Mode;
  interim: string;
  startCommand: () => void;
  cancelCommand: () => void;
};

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

// Browser STT mangles "grok" in fairly predictable ways.
const WAKE_LEAD = "hey|hi|ok|okay|yo";
const GROK_HEARD = "grok|groc|grock|grawk|greg|brook|brock|crock";

// Optional strip if someone still says it out of habit
const WAKE_STRIP_RE = new RegExp(
  `^(?:.*?\\b)?(?:${WAKE_LEAD})[\\s,.-]*(?:${GROK_HEARD})[\\s,.-]*`,
  "i",
);

/** The wake phrase anywhere in an utterance — used to barge in mid-answer. */
export const WAKE_RE = new RegExp(
  `\\b(?:${WAKE_LEAD})[\\s,.-]*(?:${GROK_HEARD})\\b`,
  "i",
);

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function cleanUtterance(text: string) {
  return normalize(text.replace(WAKE_STRIP_RE, ""));
}

/**
 * Always-on listener: any speech starts a request (no "Hey Grok" gate).
 * Ends the turn after a short silence.
 */
export function useGrokListener(options: {
  enabled: boolean;
  onSpeechStart: () => void;
  onQuestion: (text: string, alternatives?: string[]) => void;
  onInterim?: (text: string) => void;
}): VoiceListenState {
  const { enabled, onSpeechStart, onQuestion, onInterim } = options;
  const [supported, setSupported] = useState(true);
  const [micLive, setMicLive] = useState(false);
  const [mode, setMode] = useState<Mode>("paused");
  const [interim, setInterim] = useState("");

  const modeRef = useRef<Mode>("paused");
  const onSpeechStartRef = useRef(onSpeechStart);
  const onQuestionRef = useRef(onQuestion);
  const onInterimRef = useRef(onInterim);
  const bufferRef = useRef("");
  const lastFinalAltsRef = useRef<string[]>([]);
  const silenceTimerRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRunningRef = useRef(false);

  useEffect(() => {
    onSpeechStartRef.current = onSpeechStart;
    onQuestionRef.current = onQuestion;
    onInterimRef.current = onInterim;
  }, [onSpeechStart, onQuestion, onInterim]);

  const setModeBoth = useCallback((next: Mode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  const clearSilence = useCallback(() => {
    if (silenceTimerRef.current != null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const finishUtterance = useCallback(() => {
    clearSilence();
    const text = cleanUtterance(bufferRef.current);
    const alts = lastFinalAltsRef.current
      .map((a) => cleanUtterance(a))
      .filter(Boolean);
    bufferRef.current = "";
    lastFinalAltsRef.current = [];
    setInterim("");
    setModeBoth("idle");
    if (text) onQuestionRef.current(text, alts);
  }, [clearSilence, setModeBoth]);

  const bumpSilenceWatch = useCallback(() => {
    clearSilence();
    silenceTimerRef.current = window.setTimeout(() => {
      if (
        modeRef.current === "capturing" &&
        cleanUtterance(bufferRef.current)
      ) {
        finishUtterance();
      }
    }, 1600);
  }, [clearSilence, finishUtterance]);

  const beginCapture = useCallback(() => {
    if (modeRef.current === "capturing") return;
    bufferRef.current = "";
    lastFinalAltsRef.current = [];
    setInterim("");
    setModeBoth("capturing");
    onSpeechStartRef.current();
  }, [setModeBoth]);

  const startCommand = useCallback(() => {
    beginCapture();
  }, [beginCapture]);

  const cancelCommand = useCallback(() => {
    clearSilence();
    bufferRef.current = "";
    setInterim("");
    setModeBoth("idle");
  }, [clearSilence, setModeBoth]);

  useEffect(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setSupported(false);
      return;
    }

    if (!enabled) {
      wantRunningRef.current = false;
      clearSilence();
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      setMicLive(false);
      setModeBoth("paused");
      return;
    }

    wantRunningRef.current = true;
    setModeBoth("idle");

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 4;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    const safeStart = () => {
      if (!wantRunningRef.current) return;
      try {
        recognition.start();
      } catch {
        /* already started */
      }
    };

    recognition.onstart = () => setMicLive(true);

    recognition.onresult = (event) => {
      let interimChunk = "";
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = result[0].transcript;
        if (result.isFinal) {
          finalChunk += `${piece} `;
          const alts: string[] = [];
          for (let a = 0; a < result.length; a += 1) {
            const tr = result[a]?.transcript;
            if (tr) alts.push(tr);
          }
          lastFinalAltsRef.current = alts;
        } else {
          interimChunk += piece;
        }
      }

      const live = cleanUtterance(`${finalChunk} ${interimChunk}`);
      if (!live && !finalChunk && !interimChunk) return;

      if (modeRef.current !== "capturing") {
        beginCapture();
      }

      if (finalChunk) {
        bufferRef.current = cleanUtterance(
          `${bufferRef.current} ${finalChunk}`,
        );
      }

      const shown = cleanUtterance(`${bufferRef.current} ${interimChunk}`);
      setInterim(shown);
      onInterimRef.current?.(shown);
      if (shown) bumpSilenceWatch();
    };

    recognition.onerror = (event) => {
      const fatal =
        event.error === "not-allowed" || event.error === "service-not-allowed";
      if (fatal) {
        setSupported(false);
        wantRunningRef.current = false;
        setMicLive(false);
      }
    };

    recognition.onend = () => {
      setMicLive(false);
      if (!wantRunningRef.current) return;
      if (
        modeRef.current === "capturing" &&
        cleanUtterance(bufferRef.current)
      ) {
        finishUtterance();
      }
      restartTimerRef.current = window.setTimeout(safeStart, 220);
    };

    safeStart();

    return () => {
      wantRunningRef.current = false;
      clearSilence();
      if (restartTimerRef.current != null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.abort();
      recognitionRef.current = null;
      setMicLive(false);
      setModeBoth("paused");
    };
  }, [
    enabled,
    beginCapture,
    bumpSilenceWatch,
    clearSilence,
    finishUtterance,
    setModeBoth,
  ]);

  return {
    supported,
    micLive,
    mode,
    interim,
    startCommand,
    cancelCommand,
  };
}

/**
 * Barge-in listener: a second recognizer that reacts to nothing but the wake
 * phrase, so it can stay live while Grok is talking without Grok's own speech
 * triggering a new turn. Interim results are honoured so the interrupt lands
 * mid-word instead of after the phrase finalizes.
 *
 * The browser only allows one active recognition at a time, so callers must
 * keep this mutually exclusive with useGrokListener.
 */
export function useWakeWord(options: { enabled: boolean; onWake: () => void }) {
  const { enabled, onWake } = options;
  const onWakeRef = useRef(onWake);

  useEffect(() => {
    onWakeRef.current = onWake;
  }, [onWake]);

  useEffect(() => {
    if (!enabled) return;
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;

    let running = true;
    let fired = false;
    let restartTimer: number | null = null;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 4;
    recognition.lang = "en-US";

    const safeStart = () => {
      if (!running) return;
      try {
        recognition.start();
      } catch {
        /* already started */
      }
    };

    recognition.onresult = (event) => {
      if (fired) return;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        for (let a = 0; a < result.length; a += 1) {
          const heard = result[a]?.transcript || "";
          if (!WAKE_RE.test(heard)) continue;
          fired = true;
          running = false;
          recognition.abort();
          onWakeRef.current();
          return;
        }
      }
    };

    recognition.onerror = null;
    recognition.onend = () => {
      if (!running) return;
      restartTimer = window.setTimeout(safeStart, 200);
    };

    safeStart();

    return () => {
      running = false;
      if (restartTimer != null) window.clearTimeout(restartTimer);
      recognition.onresult = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.abort();
    };
  }, [enabled]);
}

export function captureVideoFrames(
  video: HTMLVideoElement,
  priorDataUrls: string[] = [],
): { frames: string[]; currentTime: number; duration: number } {
  const frames = [...priorDataUrls];
  const frame = captureFrame(video);
  if (frame) frames.push(frame);
  const uniq = Array.from(new Set(frames)).slice(-3);
  return {
    frames: uniq,
    currentTime: video.currentTime || 0,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
  };
}

export function captureFrame(
  video: HTMLVideoElement,
  opts?: { maxW?: number; quality?: number },
): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const maxW = opts?.maxW ?? 1024;
  const quality = opts?.quality ?? 0.72;
  const scale = Math.min(1, maxW / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Only attach frames when the user is asking about what's on screen. */
export function needsVideoContext(message: string): boolean {
  const t = message
    .toLowerCase()
    .replace(/[’”]/g, "'")
    .replace(/\bwhere'?s\b/g, "where is");

  if (
    /\b(look|looking|see|seeing|watch|watching|shown?|showing|visible|on\s*screen|on\s*the\s*screen|in\s*(the|this)\s*(video|clip|scene|frame|shot|image|picture)|this\s*(video|clip|scene|frame|moment|shot)|right\s*now|currently|what's\s*happening|what\s*is\s*happening|what\s*am\s*i\s*(watching|looking)|describe\s*(this|that|the\s*scene|what)|tell\s*me\s*what\s*(you\s*see|this\s*is|that\s*is|i'?m\s*seeing)|can\s*you\s*see|do\s*you\s*see|what('s|\s+is)\s*(this|that|on\s*(the\s*)?(screen|video))|who\s*(is|are)\s*(that|this|in)|what\s*(color|colour|ingredient|food|object|thing)|how\s*many|holding|wearing)\b/.test(
      t,
    )
  ) {
    return true;
  }

  if (/\b(what|who|where)\b/.test(t) && /\b(this|that|here|there)\b/.test(t)) {
    return true;
  }

  // Hands-on guidance often arrives as an action question rather than an
  // explicit "what do you see?" request. A deictic subject means the worker is
  // referring to the thing in the current view, so attach the speech-onset
  // frame for both the instruction and the visible-result check.
  const refersToVisibleSubject = /\b(this|that|it|these|those)\b/.test(t);
  if (
    refersToVisibleSubject &&
    (/\bhow\s+(?:(?:do|should|can|would)\s+i|to)\b/.test(t) ||
      /\b(?:did|have|has|am|is|was)\s+(?:i|she|he|they)\b/.test(t) ||
      /\b(?:is|are|does|do)\s+(?:this|that|it|these|those)\b/.test(t))
  ) {
    return true;
  }

  // Verification asks ("what did she do wrong?", "did I make a mistake?")
  // are about the work in the current view even without a deictic word —
  // the answer is only checkable against the frame.
  if (
    /\b(i|she|he|we|they)\b/.test(t) &&
    /\b(?:(?:do(?:ne|ing)?|did|went|going)\s+(?:\w+\s+)?wrong|wrong\s+(?:with|here)|mistake|mess(?:ed|ing)?\s*up|forg(?:e|o)t(?:ting)?|miss(?:ed|ing)?\s+(?:a\s+|any\s+)?step)\b/.test(
      t,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Questions that need fresh web facts rather than the frame — routed to
 * /api/websearch (Grok web_search tool, cached server-side + localStorage).
 * Deliberately conservative: explicit search verbs, or a freshness cue paired
 * with a live-fact topic, so screen questions keep going to /api/chat.
 */
export function needsWebSearch(message: string): boolean {
  const t = message.toLowerCase().replace(/[’”]/g, "'");

  if (
    /\b(search\s+(the\s+)?(web|internet|online)|search\s+for|look\s+(that|this|it)?\s*up|google)\b/.test(
      t,
    )
  ) {
    return true;
  }

  if (/\b(what'?s|how'?s)\s+the\s+weather\b/.test(t) || /\bwho\s+won\b/.test(t)) {
    return true;
  }

  return (
    /\b(latest|newest|current|today'?s?|this\s+(week|month|year)|recent)\b/.test(t) &&
    /\b(price|prices|cost|news|version|release|score|weather|stock|update|deal|deals)\b/.test(
      t,
    )
  );
}

const WEB_ANSWER_TTL_MS = 10 * 60 * 1000;

/** Web-grounded ask; answers cache in localStorage so repeats skip the search. */
export async function askWeb(input: { message: string; videoTitle?: string }) {
  const cacheKey = `grokeye-web:${input.message.toLowerCase().replace(/\s+/g, " ")}`;

  let reply = "";
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as { reply: string; at: number };
      if (parsed?.reply && Date.now() - parsed.at < WEB_ANSWER_TTL_MS) {
        reply = parsed.reply;
      }
    }
  } catch {
    /* ignore bad cache */
  }

  if (!reply) {
    const res = await fetch("/api/websearch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Web search failed");
    }
    reply = String(data.reply || "");
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ reply, at: Date.now() }));
    } catch {
      /* quota / private mode */
    }
  }

  const audioPromise = (async () => {
    const ttsRes = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply }),
    });
    if (!ttsRes.ok) {
      const err = await ttsRes.json().catch(() => ({}));
      throw new Error(err.error || "TTS failed");
    }
    const blob = await ttsRes.blob();
    return URL.createObjectURL(blob);
  })();

  return { reply, labels: [], audioPromise, frameCount: 0 };
}

/** Labels-only sidecar for highlight turns; raw boxes + link, no reply, no TTS. */
export async function fetchLabels(input: {
  message: string;
  frames: string[];
  videoTitle?: string;
}): Promise<{ labels: unknown[]; link: unknown; status: string | null }> {
  const res = await fetch("/api/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Labels failed");
  }
  return {
    labels: Array.isArray(data.labels) ? data.labels : [],
    link: data.link ?? null,
    status: typeof data.status === "string" ? data.status : null,
  };
}

/**
 * One re-anchor for the local tracker. `crop` is a JPEG of the neighborhood
 * the tracker currently believes the object is in; the box comes back in that
 * crop's coordinates and the caller maps it home.
 */
export async function fetchRelocate(
  crop: string,
  target: string,
): Promise<{
  visible: boolean;
  box: { x: number; y: number; w: number; h: number } | null;
}> {
  const res = await fetch("/api/relocate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ crop, target }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Relocate failed");
  return {
    visible: Boolean(data.visible),
    box: data.visible && data.box ? data.box : null,
  };
}

export async function askGrok(input: {
  message: string;
  videoTitle?: string;
  videoDescription?: string;
  currentTime?: number;
  duration?: number;
  frames?: string[];
  /** Frames are chronological history; the final image is speech onset. */
  temporalContext?: boolean;
  /** Recent grounded referent for pronouns; never trusted over the attached frame. */
  subjectHint?: string | null;
  wantLabels?: boolean;
  lowDetail?: boolean;
  detectorPack?: string;
  /** Authored UI motion already visible; keep live prose synchronized with it. */
  motionGuide?: { note: string; label: string; scene?: string };
  /** Precomputed detector boxes — Grok narrates only, no second detect. */
  detections?: Array<{ text: string; x: number; y: number; w: number; h: number }>;
}) {
  const chatRes = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const chatData = await chatRes.json();
  if (!chatRes.ok) {
    throw new Error(chatData.error || "Chat failed");
  }

  const rawReply = String(chatData.reply || "").trim();
  const reply =
    input.motionGuide &&
    !/\b(animat(?:e|ed|ion)|outline|motion path|arrow)\b/i.test(rawReply)
      ? `Follow the animated outline. ${rawReply}`.trim()
      : rawReply;
  const labels = Array.isArray(chatData.labels) ? chatData.labels : [];

  // Kick off TTS immediately so the client can paint labels while audio encodes.
  const audioPromise = (async () => {
    const ttsRes = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: reply }),
    });
    if (!ttsRes.ok) {
      const err = await ttsRes.json().catch(() => ({}));
      throw new Error(err.error || "TTS failed");
    }
    const blob = await ttsRes.blob();
    return URL.createObjectURL(blob);
  })();

  return {
    reply,
    labels,
    audioPromise,
    frameCount: chatData.frameCount as number,
  };
}
