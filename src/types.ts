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

export type TaskStage = "awaiting_action" | "verifying" | "resolved";

export type TaskVerdict =
  | "complete"
  | "not_complete"
  | "not_visible"
  | "unsafe_to_judge";

export type TaskSession = {
  goal: string;
  instruction: string;
  beforeFrame: string;
  stage: TaskStage;
  verdict?: TaskVerdict;
};

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

/** Grounded per-tool presence: "in_view" only when visible in the sent frame. */
export type ToolStatus = "in_view" | "missing" | "unknown";

export type ToolkitItem = {
  name: string;
  purpose: string;
  status: ToolStatus;
  essential: boolean;
};

export type ToolkitDoc = {
  task: string;
  tools: ToolkitItem[];
  spoken: string;
};

export type ToolkitState = {
  doc: ToolkitDoc | null;
  loading: boolean;
};

/** "box" = object reticle; "zone" = soft-filled region (areas, not things). */
export type HighlightKind = "box" | "zone";

/** Axis-aligned box in normalized video frame coords (origin top-left, 0–1). */
export type HighlightLabel = {
  id: string;
  text: string;
  kind: HighlightKind;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Arrow drawn between two tracked labels ("where does this cable go?"). */
export type HighlightLink = {
  fromId: string;
  toId: string;
};

export type GuidanceStatus =
  | "ready"
  | "wrong_tool"
  | "not_visible"
  | "unsafe_to_show";

export type GuidanceMotionType = "arc" | "rotate" | "line";

export type GuidanceDirection =
  | "clockwise"
  | "counterclockwise"
  | "toward"
  | "away"
  | "up"
  | "down"
  | "left"
  | "right";

/** Motion cue resolved from model label indices to stable tracked label IDs. */
export type GuidanceMotion = {
  type: GuidanceMotionType;
  pivotId: string;
  movingId: string;
  direction: GuidanceDirection;
  sweep: number;
  label: string;
};

export type GuidanceCue = {
  status: GuidanceStatus;
  note: string;
  motion: GuidanceMotion | null;
};
