"""
YOLO Crime & Behavior Detection Engine
---------------------------------------
Inspired by Attention-based YOLO and Multi-Object Tracking (ByteTrack).
Detects:
 - Persistent Track IDs per person across frames (ByteTrack)
 - Armed Suspects & Weapon Proximity (knife, bat, scissors via COCO; firearms and
   other weapons only through a custom model passed in as `weapon_detections`)
 - Violent Altercations & Kinetic Strikes (Lunging, Physical Assault)
 - Mutual Brawls (Hostile convergence of multiple subjects)
 - Fallen Person / Collapse (Medical / Assault Distress)
 - Crowd Overcrowding / Gathering Threshold Breaches
 - High-tech Tactical HUD Annotations with forensic timestamp
"""

import cv2
import time
import base64
import numpy as np
from collections import deque
from ultralytics import YOLO

# Standard COCO classes related to humans and potential weapons/threat objects
# Class 0: person, 43: knife, 34: baseball bat, 76: scissors
WEAPON_CLASSES = {
    'knife': 43,
    'fork': 42,
    'scissors': 76,
    'baseball bat': 34,
    'bottle': 39
}

# Also support custom weapon names if using a custom-trained crime model
KNOWN_WEAPON_NAMES = {'knife', 'gun', 'pistol', 'rifle', 'baseball bat', 'bat', 'scissors', 'fork', 'bottle', 'machete', 'sword', 'blade'}

class YOLOCrimeEngine:
    def __init__(self, model_path="yolov8n.pt", conf_threshold=0.20, tracker="bytetrack.yaml", device=""):
        """
        Initialize the YOLO-based Crime & Behavior Tracker.
        Args:
            model_path: Path or name of YOLO weights (e.g. 'yolov8n.pt', 'yolo11n.pt', 'yolov8m.pt')
            conf_threshold: Minimum confidence score to consider detection valid
            tracker: MOT tracker configuration ('bytetrack.yaml' or 'botsort.yaml')
            device: 'cuda:0', 'cuda', 'cpu', or '' (auto-detect)
        """
        print(f"[YOLO-ENGINE] Loading YOLO Model: {model_path} with Tracker: {tracker}...")
        self.conf_threshold = conf_threshold
        self.tracker = tracker
        
        # Load Ultralytics YOLO model
        self.model = YOLO(model_path)
        if device:
            self.model.to(device)
            
        # Subject Tracking History: track_id -> deque of recent tracking states
        # Each entry: { 'timestamp': float, 'center': (cx, cy), 'bbox': [x1, y1, x2, y2], 'velocity': float }
        self.track_history = {}
        self.max_history_len = 20

        # Alert cooldown & streak memory
        self.alert_streaks = {}  # threat_key -> consecutive_frames
        self.last_alert_time = {} # threat_key -> timestamp
        self.alert_cooldown = 4.0 # seconds

    def _update_trajectory(self, track_id, center, bbox, current_time):
        """Maintains motion kinematics for each persistent track ID."""
        if track_id not in self.track_history:
            self.track_history[track_id] = deque(maxlen=self.max_history_len)

        history = self.track_history[track_id]
        velocity = 0.0
        accel = 0.0

        if len(history) > 0:
            last = history[-1]
            dt = max(0.03, current_time - last['timestamp'])
            dist = np.hypot(center[0] - last['center'][0], center[1] - last['center'][1])
            velocity = dist / dt  # pixels per second

            if len(history) > 1:
                prev_vel = last['velocity']
                accel = (velocity - prev_vel) / dt

        record = {
            'timestamp': current_time,
            'center': center,
            'bbox': bbox,
            'velocity': velocity,
            'accel': accel
        }
        history.append(record)
        return record

    def analyze_frame(self, frame, gathering_threshold=5, weapon_detections=None):
        """
        Runs YOLO + ByteTrack on a single frame, extracts behaviors, weapons,
        strikes, crowds, and returns the tactical annotated frame + alerts.
        """
        current_time = time.time()
        annotated_frame = frame.copy()
        h, w = frame.shape[:2]

        # 1. Run Ultralytics YOLO tracking with ByteTrack
        results = self.model.track(
            source=frame,
            persist=True,
            conf=self.conf_threshold,
            tracker=self.tracker,
            verbose=False
        )

        detected_persons = []
        detected_weapons = []
        alerts_found = []

        if results and len(results) > 0:
            boxes = results[0].boxes
            if boxes is not None:
                for box in boxes:
                    cls_id = int(box.cls[0].item()) if box.cls is not None else -1
                    cls_name = self.model.names.get(cls_id, str(cls_id)).lower()
                    conf = float(box.conf[0].item()) if box.conf is not None else 0.0
                    xyxy = box.xyxy[0].cpu().numpy() if box.xyxy is not None else None
                    track_id = int(box.id[0].item()) if (box.id is not None and len(box.id) > 0) else None

                    if xyxy is None:
                        continue

                    x1, y1, x2, y2 = xyxy
                    bw = max(1.0, x2 - x1)
                    bh = max(1.0, y2 - y1)
                    cx = (x1 + x2) / 2.0
                    cy = (y1 + y2) / 2.0

                    if cls_name == 'person':
                        # Assign default fallback track ID if tracker is still initializing
                        if track_id is None:
                            track_id = len(detected_persons) + 1

                        kinematics = self._update_trajectory(track_id, (cx, cy), [x1, y1, x2, y2], current_time)

                        # Check for collapsed / fallen person (horizontal aspect ratio on ground)
                        aspect_ratio = bw / bh
                        is_fallen = aspect_ratio > 1.35 and (cy > h * 0.45)

                        person_obj = {
                            'id': track_id,
                            'bbox': [x1, y1, x2, y2],
                            'center': (cx, cy),
                            'width': bw,
                            'height': bh,
                            'conf': conf,
                            'velocity': kinematics['velocity'],
                            'accel': kinematics['accel'],
                            'is_fallen': is_fallen,
                            'state': 'FALLEN' if is_fallen else 'NORMAL',
                            'label': 'Fallen / Distressed' if is_fallen else 'Normal',
                            'threat_score': 0.85 if is_fallen else 0.0,
                            'armed_weapon': None,
                            'striking_target_id': None
                        }
                        detected_persons.append(person_obj)

                    elif cls_name in KNOWN_WEAPON_NAMES or cls_id in WEAPON_CLASSES.values():
                        detected_weapons.append({
                            'name': cls_name,
                            'conf': conf,
                            'bbox': [x1, y1, x2, y2],
                            'center': (cx, cy)
                        })

        # 1b. Merge detections from a purpose-trained weapon model.
        # COCO has no firearm class, so a custom model (see weapon_detector.py)
        # is the only way to detect guns. These detections join the normal
        # pipeline: proximity binding, HUD rendering and alert dispatch.
        if weapon_detections:
            for det in weapon_detections:
                bbox = det.get('bbox')
                if not bbox or len(bbox) != 4:
                    continue
                center = det.get('center')
                if not center:
                    center = ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)
                detected_weapons.append({
                    'name': det.get('name', 'weapon'),
                    'conf': float(det.get('conf', det.get('score', 0.0))),
                    'bbox': list(bbox),
                    'center': (float(center[0]), float(center[1])),
                    'source': 'weapon_model',
                })

        # 2. Weapon Proximity Binding (Associate detected weapons with closest person)
        for weapon in detected_weapons:
            wx, wy = weapon['center']
            min_dist = float('inf')
            closest_person = None

            for person in detected_persons:
                px, py = person['center']
                dist = np.hypot(wx - px, wy - py)
                if dist < min_dist:
                    min_dist = dist
                    closest_person = person

            # Proximity threshold: weapon within 1.2x of person's width/height radius
            if closest_person and min_dist < max(closest_person['width'], closest_person['height']) * 1.2:
                closest_person['state'] = 'ARMED'
                closest_person['armed_weapon'] = weapon['name']
                closest_person['label'] = f"ARMED: {weapon['name'].upper()}"
                closest_person['threat_score'] = max(closest_person['threat_score'], weapon['conf'])

                alerts_found.append({
                    'type': f"WEAPON DETECTED ({weapon['name'].upper()})",
                    'confidence': round(weapon['conf'], 2),
                    'subject_id': closest_person['id']
                })

        # 3. Kinetic Violence & Physical Assault Analysis (Multi-Person Interactions)
        if len(detected_persons) >= 2:
            for i in range(len(detected_persons)):
                p1 = detected_persons[i]
                for j in range(len(detected_persons)):
                    if i == j:
                        continue
                    p2 = detected_persons[j]

                    dist_centers = np.hypot(p1['center'][0] - p2['center'][0], p1['center'][1] - p2['center'][1])
                    interaction_threshold = max(p1['width'], p2['width']) * 1.8

                    # If two persons are close, and Person 1 has kinetic strike velocity (> 130 px/s)
                    if dist_centers < interaction_threshold:
                        if p1['velocity'] > 130 and p1['state'] != 'ARMED':
                            p1['state'] = 'AGGRESSOR'
                            p1['label'] = f"STRIKING Subject #{p2['id']} (Velocity: {int(p1['velocity'])} px/s)"
                            p1['striking_target_id'] = p2['id']
                            p1['threat_score'] = 0.92

                            if p2['state'] != 'AGGRESSOR' and p2['state'] != 'ARMED':
                                p2['state'] = 'VICTIM'
                                p2['label'] = f"UNDER ATTACK by Subject #{p1['id']}"

                            alerts_found.append({
                                'type': "PHYSICAL ASSAULT (VIOLENT STRIKE)",
                                'confidence': 0.92,
                                'subject_id': p1['id']
                            })

                        # Mutual kinetic velocity altercation (Brawl)
                        elif p1['velocity'] > 90 and p2['velocity'] > 90:
                            p1['state'] = 'BRAWL'
                            p2['state'] = 'BRAWL'
                            p1['label'] = f"BRAWLING with Subject #{p2['id']}"
                            p2['label'] = f"BRAWLING with Subject #{p1['id']}"
                            p1['threat_score'] = 0.94
                            p2['threat_score'] = 0.94

                            alerts_found.append({
                                'type': "PHYSICAL ALTERCATION / BRAWL",
                                'confidence': 0.94,
                                'subject_id': p1['id']
                            })
        elif len(detected_persons) == 1:
            p = detected_persons[0]
            if p['velocity'] > 140 and p['state'] != 'ARMED':
                p['state'] = 'AGGRESSOR'
                p['label'] = f"KINETIC STRIKE / LUNGE ({int(p['velocity'])} px/s)"
                p['threat_score'] = 0.90
                alerts_found.append({
                    'type': "PHYSICAL ASSAULT (VIOLENT LUNGE)",
                    'confidence': 0.90,
                    'subject_id': p['id']
                })

        # 4. Crowd Gathering Threshold Verification
        gathering_count = len(detected_persons)
        is_overcrowded = gathering_count > gathering_threshold

        if is_overcrowded:
            alerts_found.append({
                'type': f"CROWD GATHERING LIMIT EXCEEDED ({gathering_count}/{gathering_threshold} Persons)",
                'confidence': 0.95,
                'subject_id': None
            })

        # 5. Check for fallen/collapsed persons
        for p in detected_persons:
            if p['is_fallen']:
                alerts_found.append({
                    'type': f"FALLEN PERSON / MEDICAL DISTRESS (Subject #{p['id']})",
                    'confidence': 0.88,
                    'subject_id': p['id']
                })

        # 6. Render Tactical Police HUD on the Frame
        annotated_frame = self._render_tactical_hud(
            annotated_frame,
            detected_persons,
            detected_weapons,
            gathering_count,
            gathering_threshold,
            alerts_found
        )

        return {
            'annotated_frame': annotated_frame,
            'persons': detected_persons,
            'weapons': detected_weapons,
            'gathering_count': gathering_count,
            'is_overcrowded': is_overcrowded,
            'alerts': alerts_found
        }

    def _render_tactical_hud(self, frame, persons, weapons, gathering_count, gathering_threshold, alerts):
        """Draws police/military style high-contrast HUD overlays on OpenCV frame."""
        h, w = frame.shape[:2]

        # Colors (BGR)
        CYAN = (212, 182, 6)
        RED = (38, 38, 239)
        ORANGE = (22, 115, 249)
        DARK_BG = (15, 23, 42)
        WHITE = (255, 255, 255)

        # 1. Draw Tactical Corner Brackets & ID Badges for each person
        for p in persons:
            x1, y1, x2, y2 = [int(v) for v in p['bbox']]
            track_id = p['id']
            state = p['state']
            label = p['label']

            # Choose theme color based on threat state
            if state == 'ARMED' or state == 'AGGRESSOR' or state == 'BRAWL':
                color = RED
            elif state == 'VICTIM' or state == 'FALLEN':
                color = ORANGE
            else:
                color = CYAN

            # Corner brackets length
            bw = x2 - x1
            bh = y2 - y1
            c_len = max(8, min(20, int(min(bw, bh) * 0.25)))

            # Top-Left
            cv2.line(frame, (x1, y1), (x1 + c_len, y1), color, 2)
            cv2.line(frame, (x1, y1), (x1, y1 + c_len), color, 2)
            # Top-Right
            cv2.line(frame, (x2, y1), (x2 - c_len, y1), color, 2)
            cv2.line(frame, (x2, y1), (x2, y1 + c_len), color, 2)
            # Bottom-Left
            cv2.line(frame, (x1, y2), (x1 + c_len, y2), color, 2)
            cv2.line(frame, (x1, y2), (x1, y2 - c_len), color, 2)
            # Bottom-Right
            cv2.line(frame, (x2, y2), (x2 - c_len, y2), color, 2)
            cv2.line(frame, (x2, y2), (x2, y2 - c_len), color, 2)

            # Subtle bounding box line
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 1)

            # ID & Status Badge Header
            badge_text = f"ID:{track_id} {label}"
            (tw, th), _ = cv2.getTextSize(badge_text, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
            
            badge_y1 = max(4, y1 - 22)
            badge_y2 = badge_y1 + th + 8
            badge_x2 = min(w - 4, x1 + tw + 12)

            # Draw background capsule
            cv2.rectangle(frame, (x1, badge_y1), (badge_x2, badge_y2), DARK_BG, -1)
            cv2.rectangle(frame, (x1, badge_y1), (badge_x2, badge_y2), color, 1)
            cv2.putText(frame, badge_text, (x1 + 6, badge_y2 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.45, WHITE, 1, cv2.LINE_AA)

            # Velocity tag if high kinetic motion
            if p['velocity'] > 150:
                v_text = f"v: {int(p['velocity'])} px/s"
                cv2.putText(frame, v_text, (x1 + 4, y2 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 255, 255), 1)

        # 2. Draw Weapon Highlights
        for wp in weapons:
            wx1, wy1, wx2, wy2 = [int(v) for v in wp['bbox']]
            cv2.rectangle(frame, (wx1, wy1), (wx2, wy2), RED, 2)
            w_label = f"WEAPON: {wp['name'].upper()} ({int(wp['conf'] * 100)}%)"
            cv2.putText(frame, w_label, (wx1, max(15, wy1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, RED, 2)

        # 3. Top Banner for Active Threat / Alert
        if len(alerts) > 0:
            top_alert = alerts[0]
            alert_banner = f"ALERT: {top_alert['type'].upper()} ({int(top_alert['confidence'] * 100)}%)"
            (bw, bh), _ = cv2.getTextSize(alert_banner, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
            banner_x1 = max(10, (w - bw) // 2 - 14)
            banner_x2 = min(w - 10, banner_x1 + bw + 28)
            
            cv2.rectangle(frame, (banner_x1, 10), (banner_x2, 42), (0, 0, 180), -1)
            cv2.rectangle(frame, (banner_x1, 10), (banner_x2, 42), (0, 0, 255), 2)
            cv2.putText(frame, alert_banner, (banner_x1 + 14, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.6, WHITE, 2, cv2.LINE_AA)

        # 4. Gathering Count & Sound HUD (Top Left)
        gather_color = RED if gathering_count > gathering_threshold else CYAN
        gather_text = f"CROWD: {gathering_count}/{gathering_threshold} PERSONS {'(OVERCROWDED)' if gathering_count > gathering_threshold else '(NORMAL)'}"
        (gw, gh), _ = cv2.getTextSize(gather_text, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
        cv2.rectangle(frame, (10, 10), (10 + gw + 16, 36), DARK_BG, -1)
        cv2.rectangle(frame, (10, 10), (10 + gw + 16, 36), gather_color, 1)
        cv2.putText(frame, gather_text, (18, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.48, WHITE, 1, cv2.LINE_AA)

        # 5. Forensic Tactical Timestamp (Bottom Banner)
        time_str = time.strftime('%Y-%m-%d %H:%M:%S UTC')
        forensic_tag = f"POLICE SMART SURVEILLANCE • YOLOv12-MOT ACTIVE • {time_str}"
        cv2.rectangle(frame, (10, h - 28), (w - 10, h - 6), DARK_BG, -1)
        cv2.rectangle(frame, (10, h - 28), (w - 10, h - 6), (100, 100, 100), 1)
        cv2.putText(frame, forensic_tag, (18, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (200, 200, 200), 1, cv2.LINE_AA)

        return frame

    def should_trigger_alert(self, threat_type, confidence):
        """
        Applies a multi-frame streak verification and cooldown period
        so alarms don't spam duplicate notifications.
        """
        now = time.time()
        last_time = self.last_alert_time.get(threat_type, 0)

        # Enforce cooldown period
        if now - last_time < self.alert_cooldown:
            return False

        # Streak confirmation (must be seen for 2+ consecutive checks)
        streak = self.alert_streaks.get(threat_type, 0) + 1
        self.alert_streaks[threat_type] = streak

        if streak >= 2:
            self.last_alert_time[threat_type] = now
            self.alert_streaks[threat_type] = 0
            return True

        return False

    def frame_to_base64(self, frame, quality=80):
        """Encodes an OpenCV image to a base64 JPEG string for Cloudinary / Backend upload."""
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
        success, buffer = cv2.imencode('.jpg', frame, encode_params)
        if not success:
            return ""
        return "data:image/jpeg;base64," + base64.b64encode(buffer).decode('utf-8')
