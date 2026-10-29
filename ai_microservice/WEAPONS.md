# Weapon Detection (Firearms, Blades, Blunt Weapons)

## Why a custom model is required

The stock YOLOv8/COCO weights used for person detection **cannot detect guns**.

The COCO dataset has 80 classes. `knife`, `scissors`, `baseball bat`, `bottle`
and `fork` are among them — `gun`, `pistol`, `rifle` and `firearm` are **not**.
Any code that claims "GUN DETECTED" from a COCO model is guessing.

That is exactly why the browser dashboard's old two-hand "aiming posture"
heuristic was removed: it fired on ordinary gestures. Real firearm detection
needs a model that was trained on firearms.

This microservice now supports such a model through `weapon_detector.py`.

---

## How it behaves without weights

Gracefully degraded — nothing breaks:

```text
[WEAPONS] No custom weapon model found (.../models/weapon_best.pt).
[WEAPONS] Firearm detection is DISABLED — COCO weights have no gun class.
```

Person tracking, crowd limits, fighting detection and COCO weapon classes keep
working exactly as before.

---

## Step 1 — Get a dataset

Ultralytics YOLO format (`images/`, `labels/`, `data.yaml`):

| Source | Notes |
|---|---|
| Roboflow Universe — search "weapon detection" | Largest selection; export as *YOLOv8* |
| Kaggle — "weapon detection YOLO" datasets | Good volume, mixed quality |
| Your own CCTV footage | Best final accuracy; needs labelling (Roboflow / CVAT) |

**Check the licence of any dataset before commercial use.** Many research
datasets are non-commercial only.

Class names should be simple and lowercase, e.g.:

```yaml
names:
  0: gun
  1: knife
  2: bat
```

Any name not listed in `DEFAULT_CATEGORIES` (in `weapon_detector.py`) is ignored,
so a dataset that also labels `person` or `car` is safe to use as-is.

### Reality check on accuracy

| Target | Realistic mAP50 | Notes |
|---|---|---|
| Knife / bat | 0.80 – 0.92 | Distinct silhouette |
| Handgun | 0.60 – 0.80 | Small, occluded, often in hand |
| Rifle | 0.70 – 0.85 | Larger, easier |
| Any weapon, long distance | < 0.5 | A 20 px gun is not detectable |

> 100% accuracy does not exist. Expect false positives on phone-holding,
> tools, and dark clothing. Tune the confidence threshold for your site.

---

## Step 2 — Train

```bash
cd ai_microservice
pip install -r requirements.txt

python train_weapon_model.py --data path/to/data.yaml --epochs 100
```

Output is copied to `models/weapon_best.pt` automatically.

Useful flags:

```bash
--base yolov8s.pt   # larger = more accurate, slower
--imgsz 640         # 960 helps small objects if you have GPU memory
--device 0          # first GPU
--batch 16
```

Weights are **not** committed to git (`*.pt` is in `.gitignore`).

---

## Step 3 — Run

```bash
python stream_worker.py --source 0 --weapon-model models/weapon_best.pt
```

Or with the launcher:

```bat
ai_microservice\venv\Scripts\python.exe ai_microservice\stream_worker.py ^
  --source 0 --weapon-model ai_microservice\models\weapon_best.pt
```

Or via environment variable:

```bash
set WEAPON_MODEL_PATH=C:\path\to\weapon_best.pt
```

---

## Tuning

Inside `weapon_detector.py`:

| Knob | Default | Effect |
|---|---|---|
| `conf_threshold` | 0.35 | Lower = more detections + more false alarms |
| `confirm_frames` | 2 | Frames a weapon must appear in before alerting |
| `memory_seconds` | 1.5 | How long a confirmed weapon stays on the HUD |
| `max_area_ratio` | 0.5 | Rejects absurdly large boxes |

Rule of thumb: if you get false alarms on kitchen knives on a table, raise
`conf_threshold` to ~0.5 and `confirm_frames` to 3.

---

## How it connects to alerts

`stream_worker.py` passes detections into `YOLOCrimeEngine.analyze_frame(...,
weapon_detections=...)`. From there the existing pipeline handles it:

1. weapon is bound to the nearest person (spatial proximity)
2. that person is marked `ARMED` on the HUD
3. an alert is dispatched to `/api/alerts/trigger`
4. the backend classifies it as category `WEAPON` (18 s server cooldown)
5. it appears on the police and admin dashboards with the evidence snapshot

Because the cooldown/streak logic already exists, a weapon held for 10 seconds
produces one alert, not one per frame.

---

## Legal and ethical notes

Weapon detection is a high-impact system. Before deploying:

- A human must review every alert before any action is taken.
- Never treat a detection as probable cause.
- Store evidence with access control and a retention policy.
- Check local law on automated surveillance and biometric processing.
- Publish an accuracy/misuse policy for the operators.

A false "armed suspect" alert is not a minor bug — it is a safety risk.
