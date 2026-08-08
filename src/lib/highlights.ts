import type { HighlightKind, HighlightLabel, HighlightLink } from "../types";

export type VideoContentRect = {
  /** Content box relative to the video element. */
  x: number;
  y: number;
  width: number;
  height: number;
  videoWidth: number;
  videoHeight: number;
};

/** True when the utterance should place visual callouts on the frame. */
export function wantsHighlight(message: string): boolean {
  const t = message
    .toLowerCase()
    .replace(/[’”]/g, "'")
    .replace(/\bwhere'?s\b/g, "where is");
  if (
    /\b(highlight|circle|outline|label|mark|annotate|call\s*out)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(point|points|pointing)\s+(to|at|out)\b/.test(t)) return true;
  if (/\bshow\s+(me\s+)?where\b/.test(t)) return true;
  if (/\bwhere\s+(is|are)\s+(the|my|that|this)\b/.test(t)) return true;
  // Connection/route questions → arrow between two callouts.
  if (/\bwhere\s+do(es)?\s+(this|that|the|it|these)\b/.test(t)) return true;
  if (/\b(connects?|plugs?\s+in|attach(es)?|goes|leads?)\s+(to|into|in)\b/.test(t)) {
    return true;
  }
  if (
    /\b(what('s|\s+is)\s+(this|that)|what\s+am\s+i\s+(looking|seeing)|identify|what's\s+that)\b/.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function normalizeLabels(
  raw: unknown,
  max = 2,
): Omit<HighlightLabel, "id">[] {
  if (!Array.isArray(raw)) return [];
  const out: Omit<HighlightLabel, "id">[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = String(o.text || o.label || "").trim().slice(0, 40);
    const kind: HighlightKind = o.kind === "zone" ? "zone" : "box";
    let x = Number(o.x);
    let y = Number(o.y);
    let w = Number(o.w ?? o.width);
    let h = Number(o.h ?? o.height);
    if (!text || ![x, y, w, h].every(Number.isFinite)) continue;
    x = clamp01(x);
    y = clamp01(y);
    w = clamp01(w);
    h = clamp01(h);
    if (x + w > 1) w = 1 - x;
    if (y + h > 1) h = 1 - y;
    if (w < 0.04 || h < 0.04) continue;
    out.push({ text, kind, x, y, w, h });
    if (out.length >= max) break;
  }
  return out;
}

export function withLabelIds(
  labels: Omit<HighlightLabel, "id">[],
): HighlightLabel[] {
  const t = Date.now();
  return labels.map((l, i) => ({ ...l, id: `hl-${t}-${i}` }));
}

/** Validate a model-returned link (label indices) against placed labels. */
export function normalizeLink(
  raw: unknown,
  labels: HighlightLabel[],
): HighlightLink[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const from = Number(o.from);
  const to = Number(o.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) {
    return [];
  }
  const a = labels[from];
  const b = labels[to];
  if (!a || !b) return [];
  return [{ fromId: a.id, toId: b.id }];
}

/** Letterboxed content rect inside an object-fit: contain video element. */
export function getVideoContentRect(
  video: HTMLVideoElement,
): VideoContentRect | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const cw = video.clientWidth;
  const ch = video.clientHeight;
  const scale = Math.min(cw / vw, ch / vh);
  const width = vw * scale;
  const height = vh * scale;
  return {
    x: (cw - width) / 2,
    y: (ch - height) / 2,
    width,
    height,
    videoWidth: vw,
    videoHeight: vh,
  };
}

type TrackTarget = {
  id: string;
  text: string;
  kind: HighlightKind;
  box: { x: number; y: number; w: number; h: number };
  grayT: Float32Array;
  edgeT: Float32Array;
  hist: Float32Array;
  tw: number;
  th: number;
  score: number;
  misses: number;
};

const TRACK_W = 360;
const TEMPL = 48;
const SEARCH_PAD = 0.28;
const MIN_SCORE = 0.34;
const MAX_MISSES = 30;
const HIST_BINS = 8; // 8^3 = 512 RGB bins

function luma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    out[i] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
  }
  return out;
}

/** Sobel magnitude for edge template matching. */
function sobelMag(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] -
        2 * gray[i - 1] -
        gray[i + w - 1] +
        gray[i - w + 1] +
        2 * gray[i + 1] +
        gray[i + w + 1];
      const gy =
        -gray[i - w - 1] -
        2 * gray[i - w] -
        gray[i - w + 1] +
        gray[i + w - 1] +
        2 * gray[i + w] +
        gray[i + w + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

function extractFieldPatch(
  field: Float32Array,
  gw: number,
  gh: number,
  nx: number,
  ny: number,
  nw: number,
  nh: number,
  tw: number,
  th: number,
): Float32Array {
  const patch = new Float32Array(tw * th);
  const x0 = nx * gw;
  const y0 = ny * gh;
  const bw = Math.max(1, nw * gw);
  const bh = Math.max(1, nh * gh);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const sx = Math.min(
        gw - 1,
        Math.max(0, Math.floor(x0 + ((tx + 0.5) / tw) * bw)),
      );
      const sy = Math.min(
        gh - 1,
        Math.max(0, Math.floor(y0 + ((ty + 0.5) / th) * bh)),
      );
      patch[ty * tw + tx] = field[sy * gw + sx];
    }
  }
  return patch;
}

function extractHist(
  rgba: Uint8ClampedArray,
  gw: number,
  gh: number,
  nx: number,
  ny: number,
  nw: number,
  nh: number,
): Float32Array {
  const hist = new Float32Array(HIST_BINS * HIST_BINS * HIST_BINS);
  const x0 = Math.max(0, Math.floor(nx * gw));
  const y0 = Math.max(0, Math.floor(ny * gh));
  const x1 = Math.min(gw, Math.ceil((nx + nw) * gw));
  const y1 = Math.min(gh, Math.ceil((ny + nh) * gh));
  let count = 0;
  const q = 256 / HIST_BINS;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * gw + x) * 4;
      const ri = Math.min(HIST_BINS - 1, (rgba[o] / q) | 0);
      const gi = Math.min(HIST_BINS - 1, (rgba[o + 1] / q) | 0);
      const bi = Math.min(HIST_BINS - 1, (rgba[o + 2] / q) | 0);
      hist[ri * HIST_BINS * HIST_BINS + gi * HIST_BINS + bi] += 1;
      count += 1;
    }
  }
  if (count > 0) {
    for (let i = 0; i < hist.length; i++) hist[i] /= count;
  }
  return hist;
}

function histScore(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i] * b[i]);
  return s;
}

function meanStd(a: Float32Array) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  const mean = sum / a.length;
  let v = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - mean;
    v += d * d;
  }
  return { mean, std: Math.sqrt(v / a.length) + 1e-3 };
}

function nccAt(
  field: Float32Array,
  gw: number,
  gh: number,
  tmpl: Float32Array,
  tw: number,
  th: number,
  tStats: { mean: number; std: number },
  px: number,
  py: number,
): number {
  if (px < 0 || py < 0 || px + tw > gw || py + th > gh) return -1;
  let sum = 0;
  let sumSq = 0;
  for (let ty = 0; ty < th; ty++) {
    const row = (py + ty) * gw + px;
    for (let tx = 0; tx < tw; tx++) {
      const g = field[row + tx];
      sum += g;
      sumSq += g * g;
    }
  }
  const n = tw * th;
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean)) + 1e-3;
  let cov = 0;
  for (let ty = 0; ty < th; ty++) {
    const row = (py + ty) * gw + px;
    const trow = ty * tw;
    for (let tx = 0; tx < tw; tx++) {
      cov += (field[row + tx] - mean) * (tmpl[trow + tx] - tStats.mean);
    }
  }
  return cov / (n * std * tStats.std);
}

function fusedSearch(
  gray: Float32Array,
  edges: Float32Array,
  rgba: Uint8ClampedArray,
  gw: number,
  gh: number,
  target: TrackTarget,
): { x: number; y: number; w: number; h: number; score: number } | null {
  const { box, grayT, edgeT, hist, tw, th } = target;
  const gStats = meanStd(grayT);
  const eStats = meanStd(edgeT);

  const bwPx = Math.max(tw, box.w * gw);
  const bhPx = Math.max(th, box.h * gh);
  const cx = (box.x + box.w / 2) * gw;
  const cy = (box.y + box.h / 2) * gh;
  const padX = SEARCH_PAD * gw;
  const padY = SEARCH_PAD * gh;

  const x0 = Math.max(0, Math.floor(cx - bwPx / 2 - padX));
  const y0 = Math.max(0, Math.floor(cy - bhPx / 2 - padY));
  const x1 = Math.min(gw - tw, Math.ceil(cx + bwPx / 2 + padX - tw));
  const y1 = Math.min(gh - th, Math.ceil(cy + bhPx / 2 + padY - th));
  if (x1 < x0 || y1 < y0) return null;

  let best = -1;
  let bestX = x0;
  let bestY = y0;
  const step = Math.max(2, Math.floor(Math.min(tw, th) / 8));

  const scoreAt = (x: number, y: number) => {
    const nccG = nccAt(gray, gw, gh, grayT, tw, th, gStats, x, y);
    if (nccG < 0.05) return -1;
    const nccE = nccAt(edges, gw, gh, edgeT, tw, th, eStats, x, y);
    const nx = x / gw;
    const ny = y / gh;
    const h = extractHist(rgba, gw, gh, nx, ny, box.w, box.h);
    const hs = histScore(hist, h);
    return nccG * 0.45 + Math.max(0, nccE) * 0.25 + hs * 0.3;
  };

  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const s = scoreAt(x, y);
      if (s > best) {
        best = s;
        bestX = x;
        bestY = y;
      }
    }
  }

  for (let dy = -step; dy <= step; dy++) {
    for (let dx = -step; dx <= step; dx++) {
      const x = bestX + dx;
      const y = bestY + dy;
      if (x < 0 || y < 0 || x + tw > gw || y + th > gh) continue;
      const s = scoreAt(x, y);
      if (s > best) {
        best = s;
        bestX = x;
        bestY = y;
      }
    }
  }

  if (best < MIN_SCORE) return null;

  const nx = clamp01(bestX / gw);
  const ny = clamp01(bestY / gh);
  return {
    x: nx,
    y: ny,
    w: Math.min(box.w, 1 - nx),
    h: Math.min(box.h, 1 - ny),
    score: best,
  };
}

function blendTemplate(dst: Float32Array, src: Float32Array, a: number) {
  const b = 1 - a;
  for (let i = 0; i < dst.length; i++) dst[i] = dst[i] * b + src[i] * a;
}

export type HighlightTracker = {
  update: (video: HTMLVideoElement) => HighlightLabel[] | null;
  dispose: () => void;
};

/**
 * Fused tracker: grayscale NCC + Sobel-edge NCC + RGB histogram.
 * Neighborhood search ~12fps. Holds while paused. No OpenCV.js bundle.
 */
export function createHighlightTracker(
  video: HTMLVideoElement,
  labels: HighlightLabel[],
): HighlightTracker | null {
  if (!labels.length || !video.videoWidth) return null;

  const canvas = document.createElement("canvas");
  const gw = TRACK_W;
  const gh = Math.max(1, Math.round(video.videoHeight * (TRACK_W / video.videoWidth)));
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, 0, 0, gw, gh);
  const seed = ctx.getImageData(0, 0, gw, gh);
  const gray0 = luma(seed.data, gw, gh);
  const edge0 = sobelMag(gray0, gw, gh);

  const targets: TrackTarget[] = labels.map((l) => ({
    id: l.id,
    text: l.text,
    kind: l.kind,
    box: { x: l.x, y: l.y, w: l.w, h: l.h },
    grayT: extractFieldPatch(gray0, gw, gh, l.x, l.y, l.w, l.h, TEMPL, TEMPL),
    edgeT: extractFieldPatch(edge0, gw, gh, l.x, l.y, l.w, l.h, TEMPL, TEMPL),
    hist: extractHist(seed.data, gw, gh, l.x, l.y, l.w, l.h),
    tw: TEMPL,
    th: TEMPL,
    score: 1,
    misses: 0,
  }));

  let lastTs = 0;
  const minDt = 1000 / 12;

  return {
    update(el) {
      if (!el.videoWidth) return labels;

      if (el.paused) {
        return targets.map((t) => ({
          id: t.id,
          text: t.text,
          kind: t.kind,
          ...t.box,
        }));
      }

      const now = performance.now();
      if (now - lastTs < minDt) {
        return targets
          .filter((t) => t.misses < MAX_MISSES)
          .map((t) => ({ id: t.id, text: t.text, kind: t.kind, ...t.box }));
      }
      lastTs = now;

      ctx.drawImage(el, 0, 0, gw, gh);
      const frame = ctx.getImageData(0, 0, gw, gh);
      const gray = luma(frame.data, gw, gh);
      const edges = sobelMag(gray, gw, gh);

      const alive: HighlightLabel[] = [];
      for (const t of targets) {
        const hit = fusedSearch(gray, edges, frame.data, gw, gh, t);
        if (!hit) {
          t.misses += 1;
          if (t.misses < MAX_MISSES) {
            alive.push({ id: t.id, text: t.text, kind: t.kind, ...t.box });
          }
          continue;
        }

        t.misses = Math.max(0, t.misses - 3);
        t.score = hit.score;
        t.box = {
          x: t.box.x * 0.55 + hit.x * 0.45,
          y: t.box.y * 0.55 + hit.y * 0.45,
          w: t.box.w * 0.8 + hit.w * 0.2,
          h: t.box.h * 0.8 + hit.h * 0.2,
        };

        if (hit.score > 0.5) {
          const gPatch = extractFieldPatch(
            gray,
            gw,
            gh,
            t.box.x,
            t.box.y,
            t.box.w,
            t.box.h,
            TEMPL,
            TEMPL,
          );
          const ePatch = extractFieldPatch(
            edges,
            gw,
            gh,
            t.box.x,
            t.box.y,
            t.box.w,
            t.box.h,
            TEMPL,
            TEMPL,
          );
          const hPatch = extractHist(
            frame.data,
            gw,
            gh,
            t.box.x,
            t.box.y,
            t.box.w,
            t.box.h,
          );
          blendTemplate(t.grayT, gPatch, 0.08);
          blendTemplate(t.edgeT, ePatch, 0.08);
          blendTemplate(t.hist, hPatch, 0.06);
        }

        alive.push({ id: t.id, text: t.text, kind: t.kind, ...t.box });
      }
      return alive.length ? alive : null;
    },
    dispose() {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}
