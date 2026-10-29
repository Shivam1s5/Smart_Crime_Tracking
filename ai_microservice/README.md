# Police AI Surveillance Microservice (YOLO + ByteTrack)

This microservice provides high-accuracy, real-time Computer Vision surveillance for the **Smart Crime Tracking** system, integrating Attention-based YOLO and Multi-Object Tracking (ByteTrack).

---

## 🚀 Key Features

1. **Multi-Object Tracking (MOT)**:
   - Assigns a permanent, unique `Track ID` (`id:1`, `id:343`, etc.) to every detected person across all frames.
2. **Lethal Weapon & Armed Suspect Detection**:
   - COCO classes (knife, scissors, bat, bottle) are detected out of the box and bound spatially to the nearest person, flagged as `ARMED SUSPECT`.
   - **Firearms require a purpose-trained model** — COCO has no gun class. Drop weights into `models/weapon_best.pt` (or pass `--weapon-model`) and firearms are detected with the same binding + alert pipeline. See [WEAPONS.md](WEAPONS.md).
3. **Physical Assault & Strike Detection**:
   - Computes kinetic velocity ($\Delta \text{pos} / \Delta t$) per track ID to detect lunges, high-speed strikes, and mutual brawls.
4. **Fallen / Distressed Person Detection**:
   - Detects sudden collapses or incapacitated victims lying on the ground.
5. **Overcrowding & Gathering Limit Verification**:
   - Compares active tracked persons in the frame against the dynamic camera threshold configured by police/admin.
6. **Tactical Military-Grade HUD Overlays**:
   - High-contrast corner brackets, status chips, strike lines, live gathering counts, and forensic timestamp watermark.
7. **Automated Evidence Packaging**:
   - Encodes annotated forensic frames to Base64 and dispatches them to `/api/alerts/trigger` for instant Cloudinary storage and live WebSocket alerting.

---

## 🛠️ Quick Start

### 1. Run on Local Webcam (Live Testing)
Double-click `run_yolo.bat` or execute in terminal:
```bash
ai_microservice\venv\Scripts\python.exe ai_microservice\stream_worker.py --source 0
```

### 2. Run on Pre-Recorded Video File
```bash
ai_microservice\venv\Scripts\python.exe ai_microservice\stream_worker.py --source path/to/footage.mp4
```

### 3. Run on Remote CCTV / RTSP Stream
```bash
ai_microservice\venv\Scripts\python.exe ai_microservice\stream_worker.py --source "rtsp://user:pass@camera_ip:554/stream" --camera-id CAM-001 --area "Downtown"
```

### 4. Headless Server Mode (No GUI Window)
```bash
ai_microservice\venv\Scripts\python.exe ai_microservice\stream_worker.py --source 0 --no-gui
```

### 5. Enable Firearm / Weapon Detection (custom model)
COCO weights cannot detect guns. Train a weapon model first, then point the node at it:

```bash
# 1. train (see WEAPONS.md for datasets)
python train_weapon_model.py --data datasets/weapons/data.yaml --epochs 100

# 2. run with the model
ai_microservice\venv\Scripts\python.exe ai_microservice\stream_worker.py ^
  --source 0 --weapon-model ai_microservice\models\weapon_best.pt --weapon-conf 0.35
```

Without the weights file the node still runs normally — firearm detection is simply reported as `disabled`.

### Useful flags

| Flag | Purpose |
|---|---|
| `--weapon-model` | Path to a custom weapon YOLO model |
| `--weapon-conf` | Weapon confidence threshold (default 0.35) |
| `--device` | `0` for GPU, `cpu`, or empty for auto |
| `--token` | JWT so per-camera thresholds sync from the backend |
| `--gathering-limit` | Fallback crowd limit when no token is supplied |
