"""
Local detector for GrokEye AR highlights.
Supports closed-set YOLO (e.g. yolov8n.pt) and open-vocab YOLO-World packs.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
PACKS_DIR = ROOT / "packs"
MODEL_CACHE: dict[str, Any] = {}
app = FastAPI(title="GrokEye Detector", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Map spoken sushi / kitchen phrases → COCO class names for closed-set YOLO.
QUERY_TO_COCO: dict[str, list[str]] = {
    "person": ["person"],
    "people": ["person"],
    "hand": ["person"],
    "hands": ["person"],
    "chef": ["person"],
    "knife": ["knife"],
    "bowl": ["bowl"],
    "spoon": ["spoon"],
    "fork": ["fork"],
    "chopsticks": ["fork", "spoon"],
    "cup": ["cup", "wine glass"],
    "glass": ["wine glass", "cup"],
    "bottle": ["bottle"],
    "table": ["dining table"],
    "board": ["dining table"],
    "carrot": ["carrot"],
    "broccoli": ["broccoli"],
    "banana": ["banana"],
    "apple": ["apple"],
    "orange": ["orange"],
    "sandwich": ["sandwich"],
    "roll": ["sandwich"],
    # Not in COCO — leave empty so we don't fake boxes; Grok can still narrate.
    "salmon": [],
    "fish": [],
    "rice": [],
    "nori": [],
    "seaweed": [],
    "avocado": [],
    "cucumber": [],
    "sushi": [],
}


class DetectRequest(BaseModel):
    image: str = Field(..., description="data:image/...;base64,... or raw base64")
    pack: str = "sushi"
    classes: list[str] | None = None
    query: str | None = None
    conf: float | None = None
    max_detections: int = 4


def load_pack(pack_id: str) -> dict:
    path = PACKS_DIR / f"{pack_id}.json"
    if not path.exists():
        raise HTTPException(404, f"Unknown detector pack: {pack_id}")
    return json.loads(path.read_text())


def is_world_model(model_name: str, pack: dict | None = None) -> bool:
    if pack and str(pack.get("kind", "")).lower() == "world":
        return True
    if pack and str(pack.get("kind", "")).lower() == "yolo":
        return False
    return "world" in model_name.lower()


def get_model(model_name: str, world: bool):
    key = f"{'world' if world else 'yolo'}:{model_name}"
    if key in MODEL_CACHE:
        return MODEL_CACHE[key]
    print(f"[detector] loading {model_name} ({'world' if world else 'yolo'}) …")
    if world:
        from ultralytics import YOLOWorld

        model = YOLOWorld(model_name)
    else:
        from ultralytics import YOLO

        model = YOLO(model_name)
    MODEL_CACHE[key] = model
    print(f"[detector] ready: {model_name}")
    return model


def decode_image(data_url: str) -> Image.Image:
    raw = data_url.strip()
    if "," in raw and raw.startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        buf = base64.b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Invalid image base64: {exc}") from exc
    try:
        img = Image.open(io.BytesIO(buf)).convert("RGB")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Invalid image bytes: {exc}") from exc
    return img


def phrase_from_query(query: str | None) -> str:
    if not query:
        return ""
    q = query.lower().strip()
    m = re.search(
        r"\b(?:highlight|circle|point(?:\s+to)?|show(?:\s+me)?|find|where(?:\s+is)?(?:\s+the)?)\s+(.+)$",
        q,
    )
    if not m:
        return q
    phrase = re.sub(r"[^\w\s-]", " ", m.group(1)).strip()
    phrase = re.sub(
        r"\b(please|for me|on (?:the )?screen|in (?:the )?video|a|an|the)\b",
        " ",
        phrase,
    )
    return re.sub(r"\s+", " ", phrase).strip()


def classes_from_query_world(query: str | None, defaults: list[str]) -> list[str]:
    if not query:
        return defaults
    q = query.lower().strip()
    hits = [c for c in defaults if c.lower() in q]
    phrase = phrase_from_query(query)
    extras: list[str] = []
    if phrase and len(phrase) < 40:
        extras.append(phrase)
        if "salmon" in phrase:
            extras.extend(["salmon", "raw salmon", "salmon fillet", "fish"])
        if "nori" in phrase or "seaweed" in phrase:
            extras.extend(["nori", "seaweed sheet", "seaweed"])
        if "rice" in phrase:
            extras.extend(["rice", "sushi rice", "cooked rice"])
        if "hand" in phrase:
            extras.extend(["hand", "hands", "person"])

    if extras or hits:
        merged: list[str] = []
        for item in extras + hits:
            item = item.strip()
            if item and item not in merged:
                merged.append(item)
        return merged[:10]
    return defaults


def classes_from_query_coco(query: str | None, defaults: list[str]) -> list[str]:
    """Resolve spoken query → COCO class names. Empty list = nothing mappable."""
    if not query:
        return defaults
    q = query.lower()
    phrase = phrase_from_query(query)
    tokens = set(re.findall(r"[a-zA-Z]{3,}", f"{q} {phrase}"))
    mapped: list[str] = []
    for token in tokens:
        for name in QUERY_TO_COCO.get(token, []):
            if name not in mapped:
                mapped.append(name)
    for c in defaults:
        if c.lower() in q and c not in mapped:
            mapped.append(c)
    # Explicit empty mapping for sushi terms (e.g. salmon → []) wins over defaults.
    for token in tokens:
        if token in QUERY_TO_COCO and QUERY_TO_COCO[token] == []:
            return []
    return mapped or defaults


def filter_labels_for_query(labels: list[dict], query: str | None) -> list[dict]:
    if not query or not labels:
        return labels
    q = query.lower()
    keys = set(re.findall(r"[a-zA-Z]{3,}", q))
    keys -= {
        "highlight",
        "circle",
        "point",
        "show",
        "find",
        "where",
        "please",
        "this",
        "that",
        "video",
        "screen",
    }
    if not keys:
        return labels

    expanded = set(keys)
    for k in list(keys):
        for name in QUERY_TO_COCO.get(k, []):
            expanded.add(name.lower())
            for part in name.lower().split():
                expanded.add(part)

    focused = []
    for lab in labels:
        text = str(lab.get("text", "")).lower()
        if any(k in text or text in k for k in expanded):
            focused.append(lab)
        elif "salmon" in keys and text in {"fish", "raw fish", "salmon fillet"}:
            focused.append({**lab, "text": "salmon"})
        elif "rice" in keys and "rice" in text:
            focused.append(lab)
        elif "hand" in keys and text == "person":
            focused.append({**lab, "text": "hand"})
    return focused or labels


def class_indices(model: Any, names: list[str]) -> list[int] | None:
    lookup = {str(v).lower(): int(k) for k, v in (model.names or {}).items()}
    ids = []
    for name in names:
        idx = lookup.get(name.lower())
        if idx is not None and idx not in ids:
            ids.append(idx)
    return ids or None


def run_yolo_predict(
    img: Image.Image,
    model_name: str,
    world: bool,
    classes: list[str],
    conf: float,
    iou: float,
    imgsz: int,
    query: str | None,
    max_detections: int,
) -> list[dict]:
    model = get_model(model_name, world=world)
    predict_kwargs: dict[str, Any] = {
        "source": img,
        "conf": conf,
        "iou": iou,
        "imgsz": imgsz,
        "verbose": False,
    }

    if world:
        try:
            if hasattr(model, "model"):
                model.model.clip_model = None
        except Exception:  # noqa: BLE001
            pass
        model.set_classes(list(classes) + [""])
    else:
        ids = class_indices(model, classes)
        if ids is not None:
            predict_kwargs["classes"] = ids

    results = model.predict(**predict_kwargs)
    if not results:
        return []

    r0 = results[0]
    names = r0.names or {}
    w = float(r0.orig_shape[1])
    h = float(r0.orig_shape[0])

    def name_for(cls_id: int) -> str:
        if isinstance(names, dict):
            return str(
                names.get(cls_id, classes[cls_id] if cls_id < len(classes) else "object")
            )
        if isinstance(names, (list, tuple)) and 0 <= cls_id < len(names):
            return str(names[cls_id])
        if 0 <= cls_id < len(classes):
            return str(classes[cls_id])
        return "object"

    labels = []
    if r0.boxes is not None:
        for box in r0.boxes:
            cls_id = int(box.cls.item())
            score = float(box.conf.item())
            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
            bw = max(0.0, x2 - x1)
            bh = max(0.0, y2 - y1)
            if bw < 2 or bh < 2:
                continue
            labels.append(
                {
                    "text": name_for(cls_id),
                    "x": round(x1 / w, 4),
                    "y": round(y1 / h, 4),
                    "w": round(bw / w, 4),
                    "h": round(bh / h, 4),
                    "score": round(score, 4),
                }
            )

    labels.sort(key=lambda d: d["score"], reverse=True)
    labels = filter_labels_for_query(labels, query)
    return labels[: max(1, min(max_detections, 6))]


@app.get("/health")
def health():
    return {
        "ok": True,
        "packs": [p.stem for p in PACKS_DIR.glob("*.json")],
        "loaded_models": list(MODEL_CACHE.keys()),
    }


@app.post("/detect")
def detect(req: DetectRequest):
    from color_blob import find_color_labels

    pack = load_pack(req.pack)
    model_name = pack.get("model", "yolov8n.pt")
    world = is_world_model(model_name, pack)
    defaults = list(pack.get("default_classes") or ["person", "bowl"])
    open_defaults = list(pack.get("open_classes") or defaults)
    if req.classes:
        classes = req.classes
    elif world:
        classes = classes_from_query_world(req.query, open_defaults)
    else:
        classes = classes_from_query_coco(req.query, defaults)

    conf = float(req.conf if req.conf is not None else pack.get("conf", 0.2))
    iou = float(pack.get("iou", 0.45))
    imgsz = int(pack.get("imgsz", 320 if not world else 480))
    img = decode_image(req.image)
    source = "yolo"

    # 1) Closed COCO path when we have mapped classes
    labels: list[dict] = []
    if world or classes:
        if not (not world and classes == []):
            labels = run_yolo_predict(
                img,
                model_name,
                world,
                classes if classes else defaults,
                conf,
                iou,
                imgsz,
                req.query,
                req.max_detections,
            )
            source = "world" if world else "yolo"

    # 2) Color blob (salmon / fish) — cheap, no neural net
    if not labels:
        color_labels = find_color_labels(img, req.query)
        if color_labels:
            labels = color_labels[: max(1, min(req.max_detections, 6))]
            source = "color"
            classes = [lab["text"] for lab in labels]

    # 3) Open-vocab nano World fallback for sushi terms COCO can't see
    fallback = pack.get("fallback_model")
    if not labels and fallback and not world:
        fb_world = str(pack.get("fallback_kind", "world")).lower() == "world"
        fb_classes = classes_from_query_world(req.query, open_defaults)
        fb_imgsz = int(pack.get("fallback_imgsz", 416))
        labels = run_yolo_predict(
            img,
            str(fallback),
            fb_world,
            fb_classes,
            max(0.1, conf * 0.75),
            iou,
            fb_imgsz,
            req.query,
            req.max_detections,
        )
        if labels:
            source = "world-fallback"
            classes = fb_classes
            model_name = str(fallback)

    return {
        "labels": labels,
        "classes": classes,
        "pack": req.pack,
        "model": model_name if labels and source != "color" else (
            "color-blob" if source == "color" else model_name
        ),
        "source": source,
        "count": len(labels),
    }


def main():
    host = os.environ.get("DETECT_HOST", "127.0.0.1")
    port = int(os.environ.get("DETECT_PORT", "8790"))
    try:
        pack = load_pack("sushi")
        name = pack.get("model", "yolov8n.pt")
        get_model(name, world=is_world_model(name, pack))
    except Exception as exc:  # noqa: BLE001
        print(f"[detector] warmup skipped: {exc}")
    uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
