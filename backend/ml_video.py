import cv2
import torch
import torch.nn as nn
import torchvision.models as models
import torchvision.transforms as transforms
from PIL import Image
import threading
import time

class CNNLSTM(nn.Module):
    def __init__(self, num_classes=2, hidden_size=256, num_layers=1):
        super(CNNLSTM, self).__init__()
        # Use a pre-trained CNN (ResNet18) for feature extraction
        resnet = models.resnet18(pretrained=True)
        # Remove the classification head
        self.cnn = nn.Sequential(*list(resnet.children())[:-1])
        
        # LSTM for temporal sequence
        self.lstm = nn.LSTM(input_size=512, hidden_size=hidden_size, num_layers=num_layers, batch_first=True)
        
        # Classifier
        self.fc = nn.Linear(hidden_size, num_classes)
        
    def forward(self, x):
        # x shape: (batch, seq_len, C, H, W)
        batch_size, seq_len, C, H, W = x.size()
        # Reshape to process all frames through CNN
        c_in = x.view(batch_size * seq_len, C, H, W)
        c_out = self.cnn(c_in) # shape: (batch*seq_len, 512, 1, 1)
        c_out = c_out.view(batch_size, seq_len, -1)
        
        # Pass sequence to LSTM
        r_out, (h_n, c_n) = self.lstm(c_out)
        
        # We take the output of the last time step
        last_out = r_out[:, -1, :]
        
        # Classify
        out = self.fc(last_out)
        return out

class VideoProcessor:
    def __init__(self, socketio, app, video_source=0):
        self.socketio = socketio
        self.app = app
        self.video_source = video_source
        self.is_running = False
        
        # Load Model
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = CNNLSTM().to(self.device)
        self.model.eval() # Inference mode
        
        # Transforms
        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        
        self.sequence_length = 10
        self.frame_buffer = []

    def start(self):
        if not self.is_running:
            self.is_running = True
            threading.Thread(target=self._process_loop, daemon=True).start()
            
    def stop(self):
        self.is_running = False

    def _process_loop(self):
        cap = cv2.VideoCapture(self.video_source)
        
        while self.is_running and cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                # Loop video if file
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue
                
            # Preprocess frame
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(rgb_frame)
            tensor_img = self.transform(pil_img)
            
            self.frame_buffer.append(tensor_img)
            
            if len(self.frame_buffer) == self.sequence_length:
                # Prepare sequence
                seq_tensor = torch.stack(self.frame_buffer).unsqueeze(0).to(self.device)
                
                with torch.no_grad():
                    output = self.model(seq_tensor)
                    probs = torch.nn.functional.softmax(output, dim=1)
                    violence_prob = probs[0][1].item() # Assuming class 1 is violence
                    
                # Threshold for alert
                if violence_prob > 0.7:
                    with self.app.app_context():
                        from models import db, Incident
                        # Record incident
                        new_incident = Incident(
                            type="Violence",
                            lat=28.6139, # Example coordinates (Delhi)
                            lng=77.2090,
                            confidence=violence_prob
                        )
                        db.session.add(new_incident)
                        db.session.commit()
                        
                        # Emit WebSocket alert
                        alert_data = {
                            "id": new_incident.id,
                            "type": "Violence",
                            "confidence": round(violence_prob * 100, 2),
                            "location": "Central Hub",
                            "lat": new_incident.lat,
                            "lng": new_incident.lng,
                            "timestamp": new_incident.timestamp.isoformat()
                        }
                        self.socketio.emit('new_alert', alert_data)
                        
                        # Clear buffer to avoid rapid consecutive alerts
                        self.frame_buffer = []
                        time.sleep(2) # Cooldown
                else:
                    self.frame_buffer.pop(0) # Remove oldest frame
            
            # Simulate real-time processing speed if reading from file
            time.sleep(0.03) 
            
        cap.release()
