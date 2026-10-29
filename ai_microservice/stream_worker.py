"""
AI Camera Stream Worker (YOLO + ByteTrack)
------------------------------------------
Connects to video sources (Webcam, Pre-recorded Video, or Network RTSP Stream),
runs real-time YOLO tracking, behavioral threat detection, and dispatches verified
evidence alerts to the Police Dashboard via the Flask backend.

Usage:
    python stream_worker.py --source 0                 # Run on local webcam
    python stream_worker.py --source video.mp4         # Run on sample video file
    python stream_worker.py --backend http://localhost:5000
"""

import cv2
import time
import argparse
import requests
import sys
import os
from yolo_crime_engine import YOLOCrimeEngine

# Default backend URL
DEFAULT_BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:5000")

def parse_args():
    parser = argparse.ArgumentParser(description="Police Tactical AI Stream Worker (YOLOv12 + ByteTrack)")
    parser.add_argument("--source", type=str, default="0", help="Video source: '0' for webcam, or path to video file, or RTSP stream URL")
    parser.add_argument("--camera-id", type=str, default="CAM-LOCAL", help="Camera identifier")
    parser.add_argument("--area", type=str, default="Tactical Command Area", help="Location area name")
    parser.add_argument("--backend", type=str, default=DEFAULT_BACKEND_URL, help="Backend API base URL")
    parser.add_argument("--model", type=str, default="yolov8n.pt", help="YOLO model weights (e.g. 'yolov8n.pt', 'yolo11n.pt')")
    parser.add_argument("--gathering-limit", type=int, default=5, help="Crowd gathering limit threshold")
    parser.add_argument("--no-gui", action="store_true", help="Disable OpenCV preview window (headless mode)")
    return parser.parse_args()

def fetch_camera_config(backend_url, camera_id):
    """Attempts to fetch real-time camera metadata (gathering threshold, sound limit) from backend."""
    try:
        res = requests.get(f"{backend_url}/api/cameras", timeout=3)
        if res.status_code == 200:
            cams = res.json()
            for c in cams:
                if c.get("camera_id") == camera_id or c.get("name") == camera_id:
                    return c
    except Exception:
        pass
    return None

def dispatch_alert(backend_url, camera_id, area, threat_type, confidence, base64_image):
    """Sends high-confidence threat alert + evidence snapshot to Flask backend."""
    payload = {
        "camera_id": camera_id,
        "area": area,
        "type": threat_type.upper(),
        "confidence": float(confidence),
        "image_base64": base64_image,
        "timestamp": time.time() * 1000
    }
    try:
        resp = requests.post(f"{backend_url}/api/alerts/trigger", json=payload, timeout=5)
        if resp.status_code in (200, 201):
            print(f"\n>>> [POLICE ALERT DISPATCHED] <<<")
            print(f"    Threat: {threat_type}")
            print(f"    Confidence: {int(confidence * 100)}%")
            print(f"    Camera: {camera_id} ({area})")
            print(f"    Broadcasted to WebSockets & Cloudinary\n")
            return True
        else:
            print(f"[ALERT-FAIL] Backend rejected alert: {resp.text}")
    except Exception as e:
        print(f"[ALERT-ERR] Connection to backend failed: {e}")
    return False

def main():
    args = parse_args()
    
    print("=" * 65)
    print(" POLICE SMART CRIME SURVEILLANCE NODE (YOLO + BYTETRACK)")
    print("=" * 65)
    print(f" Source        : {args.source}")
    print(f" Camera ID     : {args.camera_id} ({args.area})")
    print(f" Backend Host  : {args.backend}")
    print(f" Model Weights : {args.model}")
    print(f" Crowd Limit   : {args.gathering_limit} persons")
    print("=" * 65)

    # Convert numeric camera source
    video_source = int(args.source) if args.source.isdigit() else args.source

    # Initialize YOLO Crime Engine
    engine = YOLOCrimeEngine(model_path=args.model, conf_threshold=0.35, tracker="bytetrack.yaml")

    # Open video feed
    cap = cv2.VideoCapture(video_source)
    if not cap.isOpened():
        print(f"[FATAL] Could not open video source: {video_source}")
        sys.exit(1)

    print("\n[ACTIVE] Surveillance monitoring started. Press 'q' or Ctrl+C to stop.\n")

    fps_count = 0
    fps_start = time.time()
    current_fps = 0.0

    last_config_check = 0
    gathering_threshold = args.gathering_limit

    try:
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                # Loop video if running from a test file
                if not str(args.source).isdigit():
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                else:
                    print("[INFO] Camera stream ended.")
                    break

            # Periodically poll backend for live camera threshold updates (every 10s)
            now = time.time()
            if now - last_config_check > 10:
                last_config_check = now
                cam_cfg = fetch_camera_config(args.backend, args.camera_id)
                if cam_cfg and 'gathering_threshold' in cam_cfg:
                    gathering_threshold = int(cam_cfg['gathering_threshold'])

            # Run YOLO + ByteTrack behavioral analysis
            results = engine.analyze_frame(frame, gathering_threshold=gathering_threshold)
            annotated_frame = results['annotated_frame']
            alerts = results['alerts']

            # Calculate FPS
            fps_count += 1
            if now - fps_start >= 1.0:
                current_fps = fps_count / (now - fps_start)
                fps_count = 0
                fps_start = now

            # Overlay FPS counter
            cv2.putText(
                annotated_frame,
                f"FPS: {current_fps:.1f}",
                (frame.shape[1] - 90, 28),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                (0, 255, 0),
                1,
                cv2.LINE_AA
            )

            # Check if any detected threat qualifies for a Police Red Alert
            for alert in alerts:
                threat_type = alert['type']
                confidence = alert['confidence']

                if engine.should_trigger_alert(threat_type, confidence):
                    # Capture forensic base64 image
                    evidence_b64 = engine.frame_to_base64(annotated_frame, quality=85)
                    dispatch_alert(
                        backend_url=args.backend,
                        camera_id=args.camera_id,
                        area=args.area,
                        threat_type=threat_type,
                        confidence=confidence,
                        base64_image=evidence_b64
                    )

            # Display GUI window unless headless
            if not args.no_gui:
                cv2.imshow("Tactical Police AI Surveillance Feed (YOLO + ByteTrack)", annotated_frame)
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q') or key == 27:
                    break

    except KeyboardInterrupt:
        print("\n[INFO] Stopped by user.")
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("[INFO] Surveillance node cleanly shut down.")

if __name__ == "__main__":
    main()
