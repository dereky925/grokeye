export type VideoItem = {
  id: string;
  title: string;
  description: string;
  src: string;
  thumbnail: string;
  durationSeconds: number;
};

export type VoicePhase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type ManualStep = {
  n: number;
  text: string;
};

export type ManualSource = {
  title: string;
  url: string;
  siteName: string;
};

export type ManualDoc = {
  title: string;
  topic: string;
  source: ManualSource;
  steps: ManualStep[];
};

export type ManualOverlayState = {
  doc: ManualDoc;
  stepIndex: number;
  x: number;
  y: number;
  loading?: boolean;
};

/** Axis-aligned box in normalized video frame coords (origin top-left, 0–1). */
export type HighlightLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
