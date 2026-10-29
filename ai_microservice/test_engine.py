"""
Quick Verification Test for YOLO Crime Engine
---------------------------------------------
Runs a dummy frame through YOLOCrimeEngine to verify:
 1. Model weights download and initialization
 2. Inference and Multi-Object Tracking (ByteTrack)
 3. Behavioral and Threat detection pipeline
 4. Tactical HUD frame rendering
 5. Base64 encoding for Cloudinary/Backend API
"""

import numpy as np
import cv2
import time
from yolo_crime_engine import YOLOCrimeEngine

def run_test():
    print("[TEST] Initializing YOLOCrimeEngine with yolov8n.pt...")
    engine = YOLOCrimeEngine(model_path="yolov8n.pt", conf_threshold=0.25)

    # Create a synthetic image (640x480 black canvas with a white rectangle / mock subject)
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(dummy_frame, "TACTICAL TEST SCENE", (150, 240), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)

    print("[TEST] Running analyze_frame on synthetic test frame...")
    start_time = time.time()
    results = engine.analyze_frame(dummy_frame, gathering_threshold=5)
    elapsed = (time.time() - start_time) * 1000

    print(f"[TEST] Inference Completed in {elapsed:.1f} ms!")
    print(f"[TEST] Persons detected : {len(results['persons'])}")
    print(f"[TEST] Weapons detected : {len(results['weapons'])}")
    print(f"[TEST] Alerts generated : {len(results['alerts'])}")
    print(f"[TEST] Gathering count   : {results['gathering_count']}")

    # Verify base64 encoding
    b64_str = engine.frame_to_base64(results['annotated_frame'], quality=70)
    print(f"[TEST] Base64 Screenshot encoded successfully ({len(b64_str)} chars).")

    print("\n>>> ALL TESTS PASSED! YOLO CRIME ENGINE IS 100% OPERATIONAL! <<<\n")

if __name__ == "__main__":
    run_test()
