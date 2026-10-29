"""
Train a weapon detector for the surveillance node.

Usage
-----
    python train_weapon_model.py --data datasets/weapons/data.yaml --epochs 100
    python train_weapon_model.py --data datasets/weapons/data.yaml --base yolov8s.pt --device 0

The best checkpoint is copied to `ai_microservice/models/weapon_best.pt`, which is
where `stream_worker.py` looks for it by default.

Dataset format: Ultralytics YOLO (images/ + labels/ + data.yaml).
See WEAPONS.md for free datasets and class-naming guidance.
"""

import argparse
import shutil
import sys
from pathlib import Path

MICROSERVICE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT = MICROSERVICE_DIR / "models" / "weapon_best.pt"


def parse_args():
    parser = argparse.ArgumentParser(description="Train a YOLO weapon detector")
    parser.add_argument("--data", required=True, help="Path to the dataset data.yaml")
    parser.add_argument("--base", default="yolov8n.pt", help="Base weights (yolov8n/s/m.pt)")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default="", help="'0' for GPU, 'cpu' for CPU")
    parser.add_argument("--project", default="runs/weapon", help="Output project directory")
    parser.add_argument("--name", default="train", help="Run name")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Where to copy best.pt")
    parser.add_argument("--patience", type=int, default=25, help="Early stopping patience")
    return parser.parse_args()


def main():
    args = parse_args()

    data_path = Path(args.data).expanduser().resolve()
    if not data_path.exists():
        sys.exit(f"[TRAIN] Dataset config not found: {data_path}")

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("[TRAIN] ultralytics is not installed. Run: pip install -r requirements.txt")

    print(f"[TRAIN] data={data_path}")
    print(f"[TRAIN] base={args.base} epochs={args.epochs} imgsz={args.imgsz} batch={args.batch}")

    model = YOLO(args.base)
    results = model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device or None,
        project=args.project,
        name=args.name,
        patience=args.patience,
        exist_ok=True,
    )

    save_dir = Path(getattr(results, "save_dir", Path(args.project) / args.name))
    best = save_dir / "weights" / "best.pt"

    if not best.exists():
        sys.exit(f"[TRAIN] Training finished but best.pt was not found at {best}")

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, output)

    print("\n[TRAIN] Done.")
    print(f"[TRAIN] Best weights: {best}")
    print(f"[TRAIN] Copied to   : {output}")
    print("[TRAIN] Start the node with:")
    print(f"        python stream_worker.py --source 0 --weapon-model \"{output}\"")


if __name__ == "__main__":
    main()
