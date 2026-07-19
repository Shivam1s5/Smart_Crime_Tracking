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

# Placeholder for authentication
def get_auth_token():
    # In a real scenario, this would involve a login process
    return "YOUR_ACCESS_TOKEN"

def simulate_detection():
    try:
        # Fetch actual cameras from the backend
        token = get_auth_token()
        if not token:
            print("[AI-NODE] Skipping detection due to missing auth token.")
            return

        headers = {'Authorization': f'Bearer {token}'}
        res = requests.get(f"{BACKEND_URL}/api/cameras", headers=headers)
        if res.status_code != 200:
            print("[AI-NODE] Failed to fetch cameras from backend.")
            return

        cameras = res.json()
        if not cameras:
            print("[AI-NODE] No active cameras found for monitoring.")
            return

        # Randomly select a camera that the user has added
        camera = random.choice(cameras)
        
        crime_types = ["Weapon", "Assault", "Suspicious Activity", "Vandalism"]
        alert = {
            "type": random.choice(crime_types),
            "camera_id": camera.get('name', camera.get('camera_id')),
            "area": camera.get('area', 'Unknown Location'),
            "confidence": round(random.uniform(0.7, 0.99), 2),
            "timestamp": time.time() * 1000
        }
        
        response = requests.post(f"{BACKEND_URL}/api/alerts/trigger", json=alert)
        if response.status_code == 200:
            print(f"[AI-NODE] Alert successfully triggered for {alert['area']} - {alert['camera_id']}")
        else:
            print(f"[AI-NODE] Failed to trigger alert: {response.text}")
            
    except Exception as e:
        print(f"[AI-NODE] Error simulating detection: {e}")

if __name__ == "__main__":
    print("\nScanning video feeds... (Press Ctrl+C to stop)")
    try:
        while True:
            # Wait for a random time between 10 to 30 seconds before finding a "threat"
            delay = random.randint(10, 30)
            print(f"Analyzing streams... Next anomaly check in {delay} seconds.")
            time.sleep(delay)
            simulate_detection()
    except KeyboardInterrupt:
        print("\nShutting down AI Node.")
        sys.exit(0)
