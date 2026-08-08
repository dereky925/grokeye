"""Cheap color-blob helpers for ingredients YOLO can't see (e.g. salmon)."""

from __future__ import annotations

import numpy as np
from PIL import Image


def _rgb_to_hsv_np(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rn = rgb[..., 0].astype(np.float32) / 255.0
    gn = rgb[..., 1].astype(np.float32) / 255.0
    bn = rgb[..., 2].astype(np.float32) / 255.0
    maxc = np.maximum(np.maximum(rn, gn), bn)
    minc = np.minimum(np.minimum(rn, gn), bn)
    d = maxc - minc

    h = np.zeros_like(maxc)
    mask = d > 1e-6
    rmask = mask & (maxc == rn)
    gmask = mask & (maxc == gn)
    bmask = mask & (maxc == bn)
    h[rmask] = ((gn[rmask] - bn[rmask]) / d[rmask]) % 6.0
    h[gmask] = (bn[gmask] - rn[gmask]) / d[gmask] + 2.0
    h[bmask] = (rn[bmask] - gn[bmask]) / d[bmask] + 4.0
    h = h * 60.0
    h[h < 0] += 360.0

    s = np.zeros_like(maxc)
    nonzero = maxc > 1e-6
    s[nonzero] = d[nonzero] / maxc[nonzero]
    return h, s, maxc


def _salmon_mask(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> np.ndarray:
    # Vivid sashimi orange — avoids pale wood / desaturated skin.
    hue_ok = ((h >= 3.0) & (h <= 24.0)) | (h >= 352.0)
    return hue_ok & (s >= 0.48) & (s <= 0.98) & (v >= 0.34) & (v <= 0.92)


def find_color_labels(img: Image.Image, query: str | None, max_side: int = 220) -> list[dict]:
    if not query:
        return []
    q = query.lower()
    if not (("salmon" in q) or ("sashimi" in q) or ("fish" in q)):
        return []

    rgb = img.convert("RGB")
    w0, h0 = rgb.size
    scale = min(1.0, max_side / float(max(w0, h0)))
    if scale < 1.0:
        rgb = rgb.resize((max(1, int(w0 * scale)), max(1, int(h0 * scale))), Image.BILINEAR)
    arr = np.asarray(rgb)
    h, w = arr.shape[:2]
    hh, ss, vv = _rgb_to_hsv_np(arr)
    mask = _salmon_mask(hh, ss, vv)
    frac = float(mask.mean())
    if frac < 0.003:
        return []

    # Collect blobs by area; prefer densest mid-sized one (not whole board).
    h_img, w_img = mask.shape
    seen = np.zeros_like(mask, dtype=np.uint8)
    blobs: list[tuple[int, int, int, int, int]] = []
    ys, xs = np.where(mask)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]:
            continue
        stack = [(x0, y0)]
        seen[y0, x0] = 1
        area = 0
        minx = maxx = x0
        miny = maxy = y0
        while stack:
            x, y = stack.pop()
            area += 1
            minx = min(minx, x)
            maxx = max(maxx, x)
            miny = min(miny, y)
            maxy = max(maxy, y)
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if nx < 0 or ny < 0 or nx >= w_img or ny >= h_img:
                    continue
                if not mask[ny, nx] or seen[ny, nx]:
                    continue
                seen[ny, nx] = 1
                stack.append((nx, ny))
        if area / float(w_img * h_img) >= 0.003:
            blobs.append((minx, miny, maxx, maxy, area))

    if not blobs:
        return []

    scored = []
    for minx, miny, maxx, maxy, area in blobs:
        bw = maxx - minx + 1
        bh = maxy - miny + 1
        box_a = float(bw * bh)
        fill = area / box_a if box_a else 0.0
        area_frac = area / float(w_img * h_img)
        if fill < 0.28 or area_frac > 0.28:
            continue
        # Prefer compact, saturated blobs over giant warm regions.
        scored.append((fill * area_frac, minx, miny, maxx, maxy, area))
    if not scored:
        # Fallback: smallest blob above min area (often the fish piece).
        blobs.sort(key=lambda b: b[4])
        minx, miny, maxx, maxy, area = blobs[0]
    else:
        scored.sort(reverse=True)
        _, minx, miny, maxx, maxy, area = scored[0]

    bw = maxx - minx + 1
    bh = maxy - miny + 1

    pad_x = bw * 0.08
    pad_y = bh * 0.08
    x0 = max(0.0, (minx - pad_x) / w)
    y0 = max(0.0, (miny - pad_y) / h)
    ww = min(1.0 - x0, (bw + pad_x * 2) / w)
    hh = min(1.0 - y0, (bh + pad_y * 2) / h)
    if ww < 0.04 or hh < 0.04:
        return []

    score = min(0.95, 0.45 + (area / float(w * h)) * 8.0)
    return [
        {
            "text": "salmon",
            "x": round(x0, 4),
            "y": round(y0, 4),
            "w": round(ww, 4),
            "h": round(hh, 4),
            "score": round(score, 4),
            "source": "color",
        }
    ]
