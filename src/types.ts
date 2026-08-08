export type VideoItem = {
  id: string;
  title: string;
  description: string;
  src: string;
  thumbnail: string;
  durationSeconds: number;
  /** Optional default how-to topic when the user opens “the manual”. */
  manualTopic?: string;
  /** Hosted official PDF manual (preferred over generated text steps). */
  manualPdf?: string;
  /** Page count for `manualPdf` flip navigation. */
  manualPdfPages?: number;
  /** Local YOLO-World pack id (see detector/packs). */
  detectorPack?: string;
  /** Feed comes from an attached camera instead of `src`. */
  live?: boolean;
  /**
   * Opt into a specialized coaching flow. "flip" keeps a rolling frame buffer
   * so Grok can review an attempt that already finished.
   */
  mode?: "flip";
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
  /** Official pamphlet PDF (e.g. IKEA assembly instructions). */
  mode?: "steps" | "pdf";
  pdfUrl?: string;
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

/** Per-manual-step tool with a reference image (step tools overlay). */
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

/** Normalized box without the tracking identity a HighlightLabel carries. */
export type NormBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * A constrained move the client knows how to animate. The model picks the kind
 * of motion and its endpoint; easing and keyframes stay on the client so the
 * result is always smooth.
 */
export type GhostPrimitive =
  | "slide"
  | "lift"
  | "insert"
  | "rotate"
  | "press"
  | "pull";

export type GhostMotion = {
  primitive: GhostPrimitive;
  /** Target center in normalized frame coords. */
  to: { x: number; y: number };
  rotateDeg: number;
};

export type GhostState = {
  label: string;
  caption: string;
  /** Where the object sits in the paused frame. */
  box: NormBox;
  motion: GhostMotion;
  /** Cropped object pixels; empty when the crop was not possible. */
  spriteUrl: string;
  loading: boolean;
};

/** One physical reason an attempt turned out the way it did. */
export type FlipFactor = {
  label: string;
  detail: string;
};

export type FlipReview = {
  /** null when the frames don't show the landing. */
  landed: boolean | null;
  /** Short headline, e.g. "Under-rotated — landed on its side". */
  outcome: string;
  /** What the frames show about rotation, release, and water movement. */
  factors: FlipFactor[];
  /** Corrective cues, most important first. */
  fixes: string[];
  /** One or two sentences worth speaking aloud. */
  spoken: string;
};

export type FlipReviewState = {
  review: FlipReview | null;
  /** Thumbnails of the attempt being reviewed, oldest first. */
  strip: string[];
  loading: boolean;
  x: number;
  y: number;
};
