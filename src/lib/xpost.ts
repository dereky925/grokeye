/**
 * "Ask X" escalation: when the session audit can't verify an action, the user
 * approves (one tap or "post it") a frame-collage post asking X if it's right.
 * Never auto-posts — the approval grammar is dead unless a card is showing.
 * The one exception is `parseDirectXAsk`: there the user's own "post on X"
 * command is the approval.
 */

export type PostAction = "post" | "skip" | null;

const POST_RES: readonly RegExp[] = [
  /^(?:yes,?\s+)?(?:post|send|ship)(?:\s+(?:it|that|this|the post))?$/,
  /^ask x$/,
  /^go ahead,?(?:\s+post(?:\s+it)?)?$/,
];

const SKIP_RES: readonly RegExp[] = [
  /^skip(?:\s+(?:it|that|this))?$/,
  /^(?:no,?\s+)?don't post(?:\s+(?:it|that|this))?$/,
  /^cancel(?:\s+(?:it|that|this|the post))?$/,
  /^dismiss(?:\s+it)?$/,
  /^never\s?mind$/,
];

/**
 * Narrow approval grammar, only live while a card awaits a decision. Bare
 * "yes"/"no"/"okay" are deliberately unmatched — too collision-prone with the
 * rest of the voice loop.
 */
export function parsePostAction(
  message: string,
  cardPending: boolean,
): PostAction {
  if (!cardPending) return null;
  const text = String(message || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!text) return null;
  if (POST_RES.some((re) => re.test(text))) return "post";
  if (SKIP_RES.some((re) => re.test(text))) return "skip";
  return null;
}

/**
 * Direct escalation: the user explicitly asks to put the current moment on X
 * for human eyes ("I'm not sure — post on X asking real people for
 * verification"). Unlike the approval grammar above this needs no pending
 * card, and the utterance itself IS the approval — the resulting card
 * auto-posts once its collage is ready.
 */
export function parseDirectXAsk(message: string): boolean {
  const t = String(message || "")
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!t) return false;
  const postToX =
    /\b(?:post|share|put)\s+(?:it\s+|this\s+|that\s+)?(?:up\s+)?(?:on|to)\s+(?:x|twitter)\b/.test(
      t,
    );
  const askX = /\bask\s+(?:on\s+)?(?:x|twitter)\b/.test(t);
  if (postToX || askX) return true;
  // Without X named, "ask (real) people/humans" still counts when the intent
  // is verification — never on a bare "ask people" (too collision-prone).
  return (
    /\bask(?:ing)?\s+(?:some\s+|the\s+|real\s+|actual\s+)*(?:people|folks|humans?)\b/.test(
      t,
    ) &&
    /\b(?:verify|verification|check|confirm|right|correct|sure)\b/.test(t)
  );
}

export type CollageCell = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
};

export type CollageLayout = {
  width: number;
  height: number;
  cells: CollageCell[];
};

const CELL = 512;
const GUTTER = 4;

/**
 * Horizontal before→after strip; 2 frames land on X's friendly 2:1 crop.
 * Pure math so it tests in Node without a canvas.
 */
export function computeCollageLayout(frameCount: number): CollageLayout {
  const count = Math.max(2, Math.min(3, Math.floor(frameCount)));
  const labels =
    count === 2 ? ["BEFORE", "AFTER"] : ["BEFORE", "DURING", "AFTER"];
  return {
    width: CELL * count,
    height: CELL,
    cells: labels.map((label, i) => ({
      x: i * CELL + (i > 0 ? GUTTER / 2 : 0),
      y: 0,
      w: CELL - (i > 0 && i < count - 1 ? GUTTER : GUTTER / 2),
      h: CELL,
      label,
    })),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Collage frame failed to load"));
    img.src = url;
  });
}

/** Stitch 2–3 data-URL frames into one labeled JPEG, ~150–300KB. */
export async function composeCollage(frames: string[]): Promise<string> {
  const usable = frames.filter(Boolean).slice(0, 3);
  if (usable.length < 2) throw new Error("Collage needs at least 2 frames");
  const layout = computeCollageLayout(usable.length);
  const images = await Promise.all(usable.map(loadImage));

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, layout.width, layout.height);

  layout.cells.forEach((cell, i) => {
    const img = images[i];
    // Cover-crop the source into its square cell.
    const scale = Math.max(cell.w / img.width, cell.h / img.height);
    const sw = cell.w / scale;
    const sh = cell.h / scale;
    const sx = (img.width - sw) / 2;
    const sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, cell.x, cell.y, cell.w, cell.h);

    const pad = 10;
    ctx.font = "600 18px system-ui, sans-serif";
    const metrics = ctx.measureText(cell.label);
    const chipW = metrics.width + pad * 2;
    const chipH = 30;
    const chipX = cell.x + 12;
    const chipY = cell.y + cell.h - chipH - 12;
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.roundRect(chipX, chipY, chipW, chipH, 8);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(cell.label, chipX + pad, chipY + chipH / 2 + 1);
  });

  return canvas.toDataURL("image/jpeg", 0.8);
}

export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Deterministic caption for a user-initiated ask — no failed verdict to
 * report, just an honest request for human eyes.
 */
export function directAskCaption(input: {
  question: string;
  videoTitle: string;
  mediaTime: number;
}): string {
  const title = input.videoTitle.trim();
  const question = input.question.trim().replace(/[.!?]*$/, "?");
  const base = title
    ? `${title} @ ${formatMediaTime(input.mediaTime)} — need a human eye on this one. ${question} #Grokathon`
    : `Need a human eye on this one. ${question} #Grokathon`;
  return base.slice(0, 280);
}

/** Deterministic caption used whenever /api/x/caption is slow or down. */
export function fallbackCaption(input: {
  question: string;
  videoTitle: string;
  mediaTime: number;
}): string {
  const title = input.videoTitle.trim();
  const question = input.question.trim().replace(/[.!?]*$/, "?");
  const base = title
    ? `${title} @ ${formatMediaTime(input.mediaTime)} — Grok couldn't verify this one. ${question} #Grokathon`
    : `Grok couldn't verify this one. ${question} #Grokathon`;
  return base.slice(0, 280);
}

export type XPostCardStatus =
  | "composing"
  | "pending"
  | "posting"
  | "posted"
  | "failed";

export type XPostCardState = {
  clientToken: string;
  question: string;
  caption: string;
  collageUrl: string | null;
  status: XPostCardStatus;
  /** Playhead of the unverified moment — used to de-duplicate a retry caption. */
  mediaTime: number;
  /**
   * Who initiated the ask. "audit" cards report a verification Grok failed;
   * "user" cards are a direct "post on X" command — the header copy must not
   * claim a failed verdict that never happened.
   */
  origin?: "audit" | "user";
  postedUrl?: string;
  error?: string;
  errorCode?: string;
};

/** A card the approval grammar (and the buttons) should act on. */
export function isCardActionable(card: XPostCardState | undefined | null): boolean {
  return card?.status === "pending" || card?.status === "failed";
}

export async function fetchXCaption(input: {
  question: string;
  instructionText: string;
  videoTitle: string;
  mediaTime: number;
}): Promise<string> {
  const res = await fetch("/api/x/caption", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Caption failed");
  return String(data.caption || "");
}

export async function fetchXPost(input: {
  imageDataUrl: string;
  text: string;
  clientToken: string;
}): Promise<{ id: string; url: string }> {
  const res = await fetch("/api/x/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Post failed") as Error & {
      code?: string;
    };
    err.code = data.code;
    throw err;
  }
  return { id: String(data.id), url: String(data.url) };
}

export async function fetchXStatus(): Promise<{
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}> {
  const res = await fetch("/api/x/auth/status");
  const data = await res.json().catch(() => ({}));
  return {
    configured: Boolean(data.configured),
    authenticated: Boolean(data.authenticated),
    username: data.username || null,
  };
}
