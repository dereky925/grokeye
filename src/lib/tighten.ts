import type { HighlightLabel } from "../types";
import { clamp01, luma, sobelMag } from "./highlights";
import { profileForQuery, rgbToHsv, type ColorProfile } from "./colorDetect";

export type NormBox = { x: number; y: number; w: number; h: number };

const TIGHTEN_W = 320;
/** Fraction of in-box edge energy the shrunken box must retain. */
const KEEP_ENERGY = 0.92;
/** Never shrink a side below this fraction of its original length. */
const MIN_DIM_FRAC = 0.4;
/** The tightened center may shift at most this fraction of the original size. */
const MAX_CENTER_SHIFT = 0.25;

function trimSpan(
  sums: Float32Array,
  start: number,
  end: number, // exclusive
  keep: number,
): { a: number; b: number } {
  let total = 0;
  for (let i = start; i < end; i++) total += sums[i];
  let a = start;
  let b = end - 1;
  if (total <= 0) return { a, b };
  const budget = (1 - keep) * total;
  let removed = 0;
  while (a < b) {
    const lo = sums[a];
    const hi = sums[b];
    const next = Math.min(lo, hi);
    if (removed + next > budget) break;
    removed += next;
    if (lo <= hi) a++;
    else b--;
  }
  return { a, b };
}

function capSpan(
  a: number,
  b: number, // inclusive px span after trimming
  orig0: number,
  origLen: number,
  limit: number, // frame size in px
): { p0: number; len: number } {
  let len = b - a + 1;
  let center = a + len / 2;
  const minLen = origLen * MIN_DIM_FRAC;
  if (len < minLen) len = minLen;
  const origCenter = orig0 + origLen / 2;
  const maxShift = origLen * MAX_CENTER_SHIFT;
  center = Math.min(origCenter + maxShift, Math.max(origCenter - maxShift, center));
  let p0 = center - len / 2;
  p0 = Math.min(limit - len, Math.max(0, p0));
  return { p0, len };
}

/**
 * Shrink a model-returned box to the salient content inside it using
 * edge-energy projection profiles: each side trims inward until the remaining
 * span still holds ~92% of the Sobel energy in the (slightly padded) region.
 * Conservative by construction — worst case the box comes back unchanged.
 */
export function tightenBox(
  edges: Float32Array,
  gw: number,
  gh: number,
  box: NormBox,
): NormBox {
  const bx = box.x * gw;
  const by = box.y * gh;
  const bw = box.w * gw;
  const bh = box.h * gh;
  const padX = bw * 0.05;
  const padY = bh * 0.05;
  const x0 = Math.max(0, Math.floor(bx - padX));
  const y0 = Math.max(0, Math.floor(by - padY));
  const x1 = Math.min(gw, Math.ceil(bx + bw + padX));
  const y1 = Math.min(gh, Math.ceil(by + bh + padY));
  if (x1 - x0 < 8 || y1 - y0 < 8) return box;

  const colSums = new Float32Array(gw);
  const rowSums = new Float32Array(gh);
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const e = edges[y * gw + x];
      colSums[x] += e;
      rowSums[y] += e;
      total += e;
    }
  }
  if (total <= 0) return box;

  const cols = trimSpan(colSums, x0, x1, KEEP_ENERGY);
  const rows = trimSpan(rowSums, y0, y1, KEEP_ENERGY);
  const xs = capSpan(cols.a, cols.b, bx, bw, gw);
  const ys = capSpan(rows.a, rows.b, by, bh, gh);

  const out = {
    x: clamp01(xs.p0 / gw),
    y: clamp01(ys.p0 / gh),
    w: clamp01(xs.len / gw),
    h: clamp01(ys.len / gh),
  };
  if (out.w < 0.04 || out.h < 0.04) return box;
  if (out.x + out.w > 1) out.w = 1 - out.x;
  if (out.y + out.h > 1) out.h = 1 - out.y;
  return out;
}

/**
 * Bounding box of color-profile pixels inside a (slightly padded) box — used
 * for color-nameable objects (e.g. salmon), where the hue mask outlines the
 * object more faithfully than edge energy.
 */
export function colorBoundsInBox(
  rgba: Uint8ClampedArray,
  gw: number,
  gh: number,
  box: NormBox,
  profile: ColorProfile,
): NormBox | null {
  const pad = 0.08;
  const x0 = Math.max(0, Math.floor((box.x - box.w * pad) * gw));
  const y0 = Math.max(0, Math.floor((box.y - box.h * pad) * gh));
  const x1 = Math.min(gw, Math.ceil((box.x + box.w * (1 + pad)) * gw));
  const y1 = Math.min(gh, Math.ceil((box.y + box.h * (1 + pad)) * gh));

  let minX = x1;
  let minY = y1;
  let maxX = x0 - 1;
  let maxY = y0 - 1;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * gw + x) * 4;
      const { h, s, v } = rgbToHsv(rgba[o], rgba[o + 1], rgba[o + 2]);
      if (!profile.match(h, s, v)) continue;
      count++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (count < 30 || maxX < minX || maxY < minY) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (count / (bw * bh) < 0.25) return null;

  const padX = bw * 0.08;
  const padY = bh * 0.08;
  const out = {
    x: clamp01((minX - padX) / gw),
    y: clamp01((minY - padY) / gh),
    w: clamp01((bw + padX * 2) / gw),
    h: clamp01((bh + padY * 2) / gh),
  };
  if (out.w < 0.04 || out.h < 0.04) return null;
  if (out.x + out.w > 1) out.w = 1 - out.x;
  if (out.y + out.h > 1) out.h = 1 - out.y;
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("frame decode failed"));
    img.src = src;
  });
}

/**
 * Canvas-facing wrapper: tighten every Grok `box` label against the frame it
 * was located on. Zones pass through untouched. Runs off the spoken loop
 * (one 320px Sobel, ~ms); any failure returns the labels unchanged.
 */
export async function tightenLabelsOnFrame(
  frameSrc: string,
  labels: Omit<HighlightLabel, "id">[],
  query: string,
): Promise<Omit<HighlightLabel, "id">[]> {
  if (!labels.some((l) => l.kind === "box")) return labels;
  const img = await loadImage(frameSrc);
  const gw = Math.min(TIGHTEN_W, img.naturalWidth || TIGHTEN_W);
  const gh = Math.max(
    1,
    Math.round((img.naturalHeight / Math.max(1, img.naturalWidth)) * gw),
  );
  const canvas = document.createElement("canvas");
  canvas.width = gw;
  canvas.height = gh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return labels;
  ctx.drawImage(img, 0, 0, gw, gh);
  const { data } = ctx.getImageData(0, 0, gw, gh);
  const edges = sobelMag(luma(data, gw, gh), gw, gh);
  const profile = profileForQuery(query);

  return labels.map((l) => {
    if (l.kind !== "box") return l;
    let tight = tightenBox(edges, gw, gh, l);
    if (profile) {
      const cb = colorBoundsInBox(data, gw, gh, l, profile);
      if (cb && cb.w * cb.h < tight.w * tight.h) tight = cb;
    }
    return { ...l, ...tight };
  });
}
