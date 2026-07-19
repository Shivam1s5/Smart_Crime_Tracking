import requests
import time
import random
import sys

# Change this to your live Render backend URL when testing on production
BACKEND_URL = "http://localhost:5000" 
# BACKEND_URL = "https://smart-crime-tracking.onrender.com"

print("========================================")
print(" AI CAMERA SURVEILLANCE NODE (MOCK)")
print("========================================")
print(f"Connecting to Backend: {BACKEND_URL}")

cameras = [
    {"id": "CAM-001", "area": "Downtown"},
    {"id": "CAM-002", "area": "North Side"},
    {"id": "CAM-003", "area": "Downtown"}
]

threat_types = ["Weapon Detected (Gun)", "Weapon Detected (Knife)", "Violent Altercation", "Unauthorized Intrusion"]

def send_alert():
    cam = random.choice(cameras)
    threat = random.choice(threat_types)
    confidence = round(random.uniform(0.75, 0.99), 2)
    
    payload = {
        "camera_id": cam["id"],
        "area": cam["area"],
        "type": threat,
        "confidence": confidence,
        "image_url": "" # In a real scenario, this would be a URL to the S3 bucket where the frame is saved
    }
    
    print(f"\n[!] THREAT DETECTED: {threat} at {cam['area']} ({cam['id']})")
    print(f"    Confidence: {confidence * 100}%")
    print("    Transmitting Red Alert to Command Center...")
    
    try:
        res = requests.post(f"{BACKEND_URL}/api/alerts/trigger", json=payload)
        if res.status_code == 201:
            print("    [SUCCESS] Alert transmitted and broadcasted.")
        else:
            print(f"    [FAILED] Server responded with code: {res.status_code}")
    except Exception as e:
        print(f"    [ERROR] Could not connect to backend: {e}")

if __name__ == "__main__":
    print("\nScanning video feeds... (Press Ctrl+C to stop)")
    try:
        while True:
            # Wait for a random time between 10 to 30 seconds before finding a "threat"
            delay = random.randint(10, 30)
            print(f"Analyzing streams... Next anomaly check in {delay} seconds.")
            time.sleep(delay)
            send_alert()
    except KeyboardInterrupt:
        print("\nShutting down AI Node.")
        sys.exit(0)
