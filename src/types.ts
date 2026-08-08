export type VideoItem = {
  id: string;
  title: string;
  description: string;
  src: string;
  thumbnail: string;
  durationSeconds: number;
  /** Local YOLO-World pack id (see detector/packs). */
  detectorPack?: string;
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

export type Tool = {
  name: string;
  note: string;
  imageUrl: string;
};

export type ToolsState = {
  tools: Tool[];
  stepNumber: number | null;
  loading: boolean;
  x: number;
  y: number;
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
