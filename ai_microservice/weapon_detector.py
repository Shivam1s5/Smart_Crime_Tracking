"""
Weapon detector for the surveillance microservice.

Why this module exists
----------------------
Stock YOLOv8/COCO weights CANNOT detect firearms. The COCO dataset has no
`gun`, `pistol` or `rifle` class, so any "gun detected" claim from a COCO model
is a false positive. The only honest way to detect weapons is a purpose-trained
detector.

This module plugs such a detector into the pipeline:

    stream_worker.py --weapon-model models/weapon_best.pt

It accepts any Ultralytics YOLO checkpoint whose classes are weapon names
(gun / pistol / rifle / knife / bat / ...). Train one with
`train_weapon_model.py` — see WEAPONS.md for datasets and expected accuracy.

If the weights file is missing the detector reports itself unavailable and the
surveillance node keeps running exactly as before (COCO-only behaviour), so a
missing model can never crash a live camera.
"""

import os
import time
from pathlib import Path

# Maps dataset class names -> human readable category. Anything not listed here
# is ignored, so a model that also predicts 'person' or 'car' stays clean.
DEFAULT_CATEGORIES = {
    # Firearms
    "gun": "Firearm",
    "guns": "Firearm",
    "pistol": "Firearm",
    "handgun": "Firearm",
    "rifle": "Firearm",
    "shotgun": "Firearm",
    "firearm": "Firearm",
    "machine gun": "Firearm",
    "smg": "Firearm",
    # Bladed
    "knife": "Bladed weapon",
    "blade": "Bladed weapon",
    "dagger": "Bladed weapon",
    "machete": "Bladed weapon",
    "sword": "Bladed weapon",
    "cleaver": "Bladed weapon",
    # Blunt
    "bat": "Blunt weapon",
    "baseball bat": "Blunt weapon",
    "baton": "Blunt weapon",
    "axe": "Blunt weapon",
    "hammer": "Blunt weapon",
    "crowbar": "Blunt weapon",
}

DEFAULT_MODEL_RELATIVE_PATH = os.path.join("models", "weapon_best.pt")


class WeaponDetector:
    """Thin, failure-tolerant wrapper around a custom weapon YOLO model."""

    def __init__(
        self,
        model_path=None,
        conf_threshold=0.35,
        iou_threshold=0.5,
        device="",
        confirm_frames=2,
        memory_seconds=1.5,
        max_area_ratio=0.5,
        categories=None,
    ):
        self.model_path = self._resolve_path(model_path)
        self.conf_threshold = float(conf_threshold)
        self.iou_threshold = float(iou_threshold)
        self.device = device or ""
        self.confirm_frames = max(1, int(confirm_frames))
        self.memory_seconds = float(memory_seconds)
        self.max_area_ratio = float(max_area_ratio)
        self.categories = dict(DEFAULT_CATEGORIES)
        if categories:
            self.categories.update({k.lower(): v for k, v in categories.items()})

        self.model = None
        self.available = False
        self.load_error = None

        self._recent = {}
        self._confirmed = {}

        self._load()

    # ------------------------------------------------------------------ setup
    def _resolve_path(self, model_path):
        if model_path:
            return Path(model_path).expanduser()
        env_path = os.environ.get("WEAPON_MODEL_PATH")
        if env_path:
            return Path(env_path).expanduser()
        return Path(__file__).resolve().parent / DEFAULT_MODEL_RELATIVE_PATH

    def _load(self):
        if not self.model_path.exists():
            self.load_error = f"weights not found at {self.model_path}"
            print(
                "[WEAPONS] No custom weapon model found "
                f"({self.model_path}).\n"
                "[WEAPONS] Firearm detection is DISABLED — COCO weights have no gun class.\n"
                "[WEAPONS] Train one with: python train_weapon_model.py --data weapons.yaml\n"
                "[WEAPONS] See ai_microservice/WEAPONS.md for datasets and instructions."
            )
            return

        try:
            from ultralytics import YOLO

            self.model = YOLO(str(self.model_path))
            if self.device:
                self.model.to(self.device)

            names = list(getattr(self.model, "names", {}).values())
            weapon_names = [name for name in names if self._category(name)]
            if not weapon_names:
                self.load_error = "model has no recognised weapon classes"
                print(
                    f"[WEAPONS] Model loaded but none of its classes are weapons: {names}.\n"
                    "[WEAPONS] Update DEFAULT_CATEGORIES in weapon_detector.py to match your dataset."
                )
                self.model = None
                return

            self.available = True
            print(
                f"[WEAPONS] Weapon model ready: {self.model_path.name} "
                f"({len(weapon_names)} classes: {', '.join(sorted(set(weapon_names)))})"
            )
        except Exception as exc:  # pragma: no cover - depends on environment
            self.load_error = str(exc)
            print(f"[WEAPONS] Failed to load weapon model: {exc}")

    # --------------------------------------------------------------- detection
    def _category(self, name):
        return self.categories.get(str(name).strip().lower())

    def reset(self):
        self._recent = {}
        self._confirmed = {}

    def detect(self, frame, conf_threshold=None):
        """
        Run the weapon model on a BGR frame.

        Returns a list of detections in the shape the YOLO crime engine expects:
            {name, label, category, conf, bbox: [x1, y1, x2, y2], center: (cx, cy)}

        Only weapons confirmed over `confirm_frames` frames are returned, and a
        confirmed weapon stays visible for `memory_seconds` so the HUD does not
        flicker between detections.
        """
        if not self.available or self.model is None or frame is None:
            return []

        now = time.time()
        threshold = self.conf_threshold if conf_threshold is None else float(conf_threshold)

        try:
            results = self.model.predict(
                source=frame,
                conf=threshold,
                iou=self.iou_threshold,
                verbose=False,
            )
        except Exception as exc:  # pragma: no cover - runtime safety
            print(f"[WEAPONS] inference error: {exc}")
            return []

        frame_area = float(frame.shape[0] * frame.shape[1]) or 1.0
        raw = []

        for result in results or []:
            boxes = getattr(result, "boxes", None)
            if boxes is None:
                continue

            names = getattr(result, "names", None) or getattr(self.model, "names", {}) or {}

            for box in boxes:
                try:
                    cls_id = int(box.cls[0].item())
                    score = float(box.conf[0].item())
                    x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                except (AttributeError, IndexError, ValueError):
                    continue

                class_name = names.get(cls_id, str(cls_id)) if isinstance(names, dict) else str(cls_id)
                category = self._category(class_name)
                if not category:
                    continue

                width = max(1.0, x2 - x1)
                height = max(1.0, y2 - y1)
                if width < 8 or height < 8:
                    continue
                if (width * height) / frame_area > self.max_area_ratio:
                    continue

                raw.append(
                    {
                        "name": str(class_name).lower(),
                        "label": category,
                        "category": category,
                        "conf": score,
                        "bbox": [x1, y1, x2, y2],
                        "center": ((x1 + x2) / 2.0, (y1 + y2) / 2.0),
                    }
                )

        return self._temporal_filter(raw, now)

    def _temporal_filter(self, detections, now):
        """Require repeated evidence before reporting a weapon."""
        for det in detections:
            key = det["name"]
            entry = self._recent.get(key)

            if entry and (now - entry["last"]) <= self.memory_seconds:
                entry["count"] += 1
                entry["bbox"] = det["bbox"]
                entry["conf"] = max(entry["conf"], det["conf"])
            else:
                entry = {"count": 1, "bbox": det["bbox"], "conf": det["conf"]}

            entry["last"] = now
            self._recent[key] = entry

            if entry["count"] >= self.confirm_frames:
                self._confirmed[key] = {
                    **det,
                    "bbox": entry["bbox"],
                    "conf": entry["conf"],
                    "confirmed_frames": entry["count"],
                    "seen_at": now,
                }

        # Expire stale state.
        self._recent = {
            key: value for key, value in self._recent.items() if now - value["last"] <= self.memory_seconds
        }
        self._confirmed = {
            key: value
            for key, value in self._confirmed.items()
            if now - value["seen_at"] <= self.memory_seconds
        }

        return [
            {key: value for key, value in det.items() if key != "seen_at"}
            for det in self._confirmed.values()
        ]

    # ------------------------------------------------------------------ helper
    def status(self):
        if self.available:
            return f"active ({self.model_path.name}, conf>={self.conf_threshold})"
        return f"disabled ({self.load_error})"
