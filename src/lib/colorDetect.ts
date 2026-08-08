import { clamp01 } from "./highlights";

type ColorLabel = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
};

type ColorProfile = {
  label: string;
  match: (h: number, s: number, v: number) => boolean;
  minArea: number;
  minFill: number;
  maxArea: number;
};

const SALMON_MATCH = (h: number, s: number, v: number) =>
  ((h >= 3 && h <= 24) || h >= 352) && s >= 0.48 && s <= 0.98 && v >= 0.34 && v <= 0.92;

const PROFILES: Record<string, ColorProfile> = {
  salmon: {
    label: "salmon",
    match: SALMON_MATCH,
    minArea: 0.003,
    minFill: 0.28,
    maxArea: 0.28,
  },
  fish: {
    label: "salmon",
    match: SALMON_MATCH,
    minArea: 0.003,
    minFill: 0.28,
    maxArea: 0.28,
  },
};

function rgbToHsv(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max <= 1e-6 ? 0 : d / max;
  return { h, s, v: max };
}

function profileForQuery(query: string): ColorProfile | null {
  const q = query.toLowerCase();
  if (/\b(salmon|sashimi)\b/.test(q)) return PROFILES.salmon;
  if (/\b(raw\s+)?fish\b/.test(q)) return PROFILES.fish;
  return null;
}

/**
 * Tiny client-side color blob detector (no neural net).
 * Tuned for salmon / raw fish orange-pink in the sushi video.
 */
export function detectColorTargets(
  video: HTMLVideoElement,
  query: string,
  maxW = 220,
): ColorLabel[] {
  const profile = profileForQuery(query);
  if (!profile) return [];
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return [];

  const scale = Math.min(1, maxW / vw);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const { h: hh, s, v } = rgbToHsv(data[i], data[i + 1], data[i + 2]);
    if (profile.match(hh, s, v)) {
      mask[p] = 1;
      count++;
    }
  }
  if (count / (w * h) < profile.minArea) return [];

  const seen = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  type Blob = { area: number; minX: number; minY: number; maxX: number; maxY: number };
  const blobs: Blob[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (!mask[start] || seen[start]) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      seen[start] = 1;
      let area = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      while (head < tail) {
        const cx = qx[head];
        const cy = qy[head];
        head++;
        area++;
        if (cx < minX) minX = cx;
        if (cy < minY) minY = cy;
        if (cx > maxX) maxX = cx;
        if (cy > maxY) maxY = cy;
        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
      if (area / (w * h) >= profile.minArea) {
        blobs.push({ area, minX, minY, maxX, maxY });
      }
    }
  }

  if (!blobs.length) return [];

  let best: Blob | null = null;
  let bestScore = -1;
  for (const b of blobs) {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const fill = b.area / (bw * bh);
    const areaFrac = b.area / (w * h);
    if (fill < profile.minFill || areaFrac > profile.maxArea) continue;
    const score = fill * areaFrac;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  if (!best) {
    blobs.sort((a, b) => a.area - b.area);
    best = blobs[0];
  }

  const bw = best.maxX - best.minX + 1;
  const bh = best.maxY - best.minY + 1;
  const padX = bw * 0.08;
  const padY = bh * 0.08;
  let x0 = (best.minX - padX) / w;
  let y0 = (best.minY - padY) / h;
  let ww = (bw + padX * 2) / w;
  let hh = (bh + padY * 2) / h;
  x0 = clamp01(x0);
  y0 = clamp01(y0);
  ww = clamp01(ww);
  hh = clamp01(hh);
  if (x0 + ww > 1) ww = 1 - x0;
  if (y0 + hh > 1) hh = 1 - y0;
  if (ww < 0.04 || hh < 0.04) return [];

  const score = Math.min(0.95, 0.45 + (best.area / (w * h)) * 8);
  return [
    {
      text: profile.label,
      x: round4(x0),
      y: round4(y0),
      w: round4(ww),
      h: round4(hh),
      score: round4(score),
    },
  ];
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
