import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, LogOut, Video, Search, AlertTriangle, AlertOctagon, X, MapPin, Camera, Plus, CheckCircle, Trash2, Pause, Play, Maximize2 } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import * as cocossd from '@tensorflow-models/coco-ssd';
import * as poseDetection from '@tensorflow-models/pose-detection';

const LocalWebcam = React.forwardRef((props, ref) => {
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => {
        if (ref.current) {
          ref.current.srcObject = stream;
        }
      })
      .catch(err => {
        console.error("Local webcam error", err);
      });
  }, [ref]);
  return <video ref={ref} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain', position: 'relative', zIndex: 2 }} />;
});

export default function PoliceDashboard() {
  const { logout } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  const [redAlert, setRedAlert] = useState(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);
  const [isCameraPaused, setIsCameraPaused] = useState(false);
  
  // Geolocation and Add Camera State
  const [policeLocation, setPoliceLocation] = useState({ lat: null, lng: null });
  const [policeAddress, setPoliceAddress] = useState('');
  const [showAddCameraModal, setShowAddCameraModal] = useState(false);
  const [newCameraData, setNewCameraData] = useState({ name: '', stream_url: '', location: '' });
  const [useLaptopCamera, setUseLaptopCamera] = useState(false);
  const laptopVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const [model, setModel] = useState(null);
  const [poseModel, setPoseModel] = useState(null);
  const aiIntervalRef = useRef(null);

  useEffect(() => {
    // Pre-load AI models for instant responsiveness
    const loadModels = async () => {
      try {
        await tf.ready();
        const loadedObject = await cocossd.load();
        setModel(loadedObject);
        const detectorConfig = {modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING};
        const loadedPose = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);
        setPoseModel(loadedPose);
      } catch (e) {
        console.error("Error pre-loading models:", e);
      }
    };
    loadModels();
    // Detect Police Location
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          setPoliceLocation({ lat, lng });

          try {
            const res = await axios.get(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
            if (res.data && res.data.display_name) {
              const parts = res.data.display_name.split(',');
              const shortAddress = parts.slice(0, 3).join(', ');
              setPoliceAddress(shortAddress);
            }
          } catch (err) {
            console.error("Reverse geocoding failed", err);
            setPoliceAddress(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
          }
        },
        (error) => {
          console.error("Error getting location: ", error);
        }
      );
    }

    fetchCameras();
    fetchAlerts();

    // Connect to WebSocket
    const socketUrl = import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com';
    const socket = io(socketUrl);
    
    socket.on('red_alert', (data) => {
      setRedAlert(data);
      setAlerts((prev) => [data, ...prev]);
      // Play a loud alert sound if possible
      try {
        const audio = new Audio('https://www.soundjay.com/buttons/sounds/beep-01a.mp3');
        audio.play();
      } catch (e) { }
    });

    return () => socket.disconnect();
  }, []);

  const fetchCameras = async () => {
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/cameras`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setCameras(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAlerts = async () => {
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/alerts`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setAlerts(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteAlert = async (alertId) => {
    try {
      await axios.delete(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/alerts/${alertId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setAlerts(alerts.filter(a => a._id !== alertId));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/records/search?q=${searchQuery}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setSearchResults(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddCamera = async (e) => {
    e.preventDefault();
    if (!useLaptopCamera && !newCameraData.stream_url) {
      alert("Please enter a stream URL or select Laptop Camera.");
      return;
    }
    
    try {
      const payload = {
        name: newCameraData.name,
        stream_url: useLaptopCamera ? 'LOCAL_WEBCAM' : newCameraData.stream_url,
        area: newCameraData.location,
        lat: policeLocation.lat,
        lng: policeLocation.lng
      };
      await axios.post(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/cameras`, payload, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setShowAddCameraModal(false);
      setNewCameraData({ name: '', stream_url: '', location: '' });
      setUseLaptopCamera(false);
      fetchCameras(); // Refresh cameras
    } catch (err) {
      console.error("Failed to add camera", err);
      alert("Failed to add camera. Check console.");
    }
  };

  const handleRemoveCamera = async (cameraId) => {
    try {
      await axios.delete(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/cameras/${cameraId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setCameras(cameras.filter(c => c.camera_id !== cameraId));
    } catch (err) {
      console.error(err);
      alert("Failed to remove camera.");
    }
  };

  const captureScreenshot = () => {
    try {
      const video = laptopVideoRef.current;
      if (!video) return '';
      const snapCanvas = document.createElement('canvas');
      snapCanvas.width = video.videoWidth;
      snapCanvas.height = video.videoHeight;
      const snapCtx = snapCanvas.getContext('2d');
      snapCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
      
      // Merge AI Drawing Layer
      const aiCanvas = canvasRef.current;
      if (aiCanvas) {
          snapCtx.drawImage(aiCanvas, 0, 0, snapCanvas.width, snapCanvas.height);
      }
      
      return snapCanvas.toDataURL('image/jpeg', 0.7); // 70% quality jpeg
    } catch (e) {
      console.error("Screenshot error", e);
      return '';
    }
  };

  const triggerRealAlert = async (type, score) => {
    // Reduced throttle to 4 seconds to catch repeated instances faster
    if (window.lastAlertTime && Date.now() - window.lastAlertTime < 4000) return;
    window.lastAlertTime = Date.now();
    
    const cam = cameras.find(c => c.stream_url === 'LOCAL_WEBCAM');
    if (!cam) return;
    
    const image_base64 = captureScreenshot();
    
    try {
      await axios.post(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/alerts/trigger`, {
          camera_id: cam.camera_id,
          area: cam.area,
          type: type.toUpperCase(),
          confidence: score,
          image_base64: image_base64
      });
    } catch (e) { console.error("Error triggering real AI alert", e); }
  };

  const runRealAI = async () => {
     try {
         await tf.ready();
         
         if (!model || !poseModel) {
            alert("AI Models are still loading. Please wait a few seconds and try again.");
            setIsProcessing(false);
            return;
         }
         
         if (aiIntervalRef.current) clearInterval(aiIntervalRef.current);
         isProcessingRef.current = true;
     
         aiIntervalRef.current = setInterval(async () => {
         if (!isProcessingRef.current) return;
        if (laptopVideoRef.current && laptopVideoRef.current.readyState === 4) {
           const video = laptopVideoRef.current;
           const canvas = canvasRef.current;
           const ctx = canvas ? canvas.getContext('2d') : null;
           
           if (canvas && ctx) {
               canvas.width = video.videoWidth;
               canvas.height = video.videoHeight;
               ctx.clearRect(0, 0, canvas.width, canvas.height);
               ctx.font = '16px Arial';
           }

           // A. Object Detection for Real Weapons
           const predictions = await model.detect(video);
           const dangerousObjects = ['knife', 'baseball bat', 'scissors', 'gun']; 
           for (let p of predictions) {
               if (ctx && p.score > 0.25) {
                   ctx.beginPath();
                   ctx.rect(...p.bbox);
                   ctx.lineWidth = 3;
                   ctx.strokeStyle = dangerousObjects.includes(p.class) ? '#ff0000' : '#00ff00';
                   ctx.fillStyle = dangerousObjects.includes(p.class) ? '#ff0000' : '#00ff00';
                   ctx.stroke();
                   ctx.fillText(`${p.class} (${Math.round(p.score * 100)}%)`, p.bbox[0], p.bbox[1] > 20 ? p.bbox[1] - 5 : 20);
               }

               if (dangerousObjects.includes(p.class) && p.score > 0.2) {
                  triggerRealAlert(`Weapon: ${p.class}`, p.score);
               }
           }
           
           // B. Pose Detection for Fighting/Violence
           const poses = await poseModel.estimatePoses(video);
           if (poses.length > 0) {
               const keypoints = poses[0].keypoints;
               
               const leftWrist = keypoints.find(k => k.name === 'left_wrist');
               const rightWrist = keypoints.find(k => k.name === 'right_wrist');
               const leftShoulder = keypoints.find(k => k.name === 'left_shoulder');
               const rightShoulder = keypoints.find(k => k.name === 'right_shoulder');
               
               let isViolent = false;
               let maxScore = 0;

               // Check if AT LEAST ONE wrist is raised above the shoulder (Fighting stance / punching)
               if (leftWrist && rightWrist && leftShoulder && rightShoulder) {
                   const isLeftWristRaised = leftWrist.score > 0.65 && leftWrist.y < leftShoulder.y;
                   const isRightWristRaised = rightWrist.score > 0.65 && rightWrist.y < rightShoulder.y;
                   
                   if ((isLeftWristRaised || isRightWristRaised) && (leftWrist.score > 0.65 || rightWrist.score > 0.65)) {
                       isViolent = true;
                       maxScore = Math.max(leftWrist.score, rightWrist.score);
                       triggerRealAlert('Violence: Fighting Pose', maxScore);
                   }
               }

               if (ctx) {
                   // Draw skeleton lines
                   const connections = [
                       ['nose', 'left_eye'], ['nose', 'right_eye'], ['left_eye', 'left_ear'], ['right_eye', 'right_ear'],
                       ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['right_shoulder', 'right_elbow'],
                       ['left_elbow', 'left_wrist'], ['right_elbow', 'right_wrist'], ['left_shoulder', 'left_hip'],
                       ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'], ['left_hip', 'left_knee'],
                       ['right_hip', 'right_knee'], ['left_knee', 'left_ankle'], ['right_knee', 'right_ankle']
                   ];
                   
                   ctx.lineWidth = 4;
                   ctx.strokeStyle = isViolent ? 'rgba(255, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.8)';
                   
                   connections.forEach(([p1Name, p2Name]) => {
                       const p1 = keypoints.find(k => k.name === p1Name);
                       const p2 = keypoints.find(k => k.name === p2Name);
                       if (p1 && p2 && p1.score > 0.4 && p2.score > 0.4) {
                           ctx.beginPath();
                           ctx.moveTo(p1.x, p1.y);
                           ctx.lineTo(p2.x, p2.y);
                           ctx.stroke();
                       }
                   });

                   // Draw keypoints
                   keypoints.forEach(k => {
                       if (k.score > 0.4) {
                           ctx.beginPath();
                           ctx.arc(k.x, k.y, 6, 0, 2 * Math.PI);
                           ctx.fillStyle = isViolent ? '#ff0000' : '#ffffff';
                           ctx.fill();
                       }
                   });
               }
           }
        }
     }, 200); // Scan faster (every 200ms) for better UX
     } catch (e) {
         console.error("AI Initialization Error:", e);
         setIsProcessing(false);
     }
  };

  const stopVideoProcessing = () => {
    isProcessingRef.current = false;
    if (aiIntervalRef.current) clearInterval(aiIntervalRef.current);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setIsProcessing(false);
  };

  const startVideoProcessing = async () => {
    try {
      setIsProcessing(true);
      await axios.post(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/video/start`, {}, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      runRealAI();
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', padding: '16px', gap: '16px', position: 'relative', overflowY: 'auto' }}>
      
      {/* Screenshot Viewer Modal */}
      {selectedScreenshot && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.9)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000
        }}>
          <div style={{ position: 'relative', maxWidth: '90%', maxHeight: '90%' }}>
            <button onClick={() => setSelectedScreenshot(null)} style={{ position: 'absolute', top: -40, right: 0, background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>
              <X size={32} />
            </button>
            <img src={selectedScreenshot} alt="Evidence Fullscreen" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px', border: '2px solid red' }} />
          </div>
        </div>
      )}

      {/* RED ALERT OVERLAY */}
      {redAlert && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(220, 38, 38, 0.4)', backdropFilter: 'blur(10px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999,
          animation: 'pulse 0.5s infinite'
        }}>
          <div className="glass-panel" style={{ background: 'rgba(0,0,0,0.9)', border: '4px solid red', padding: '40px', maxWidth: '600px', textAlign: 'center', position: 'relative', boxShadow: '0 0 50px red' }}>
            <button onClick={() => setRedAlert(null)} style={{ position: 'absolute', top: 10, right: 10, background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>
              <X size={24} />
            </button>
            <AlertOctagon size={100} color="red" style={{ margin: '0 auto 20px auto' }} />
            <h1 style={{ color: 'red', fontSize: '3rem', margin: '0 0 10px 0', textTransform: 'uppercase', textShadow: '0 0 20px red' }}>CRITICAL ALERT!</h1>
            <h2 style={{ margin: '0 0 20px 0', fontSize: '1.8rem' }}>{redAlert.type} Detected in {redAlert.area}</h2>
            <p style={{ fontSize: '1.4rem', color: '#fff' }}>Confidence: <strong style={{ color: 'red' }}>{(redAlert.confidence * 100).toFixed(1)}%</strong></p>
            <p style={{ fontSize: '1.2rem', color: '#ccc' }}>Source Camera: <strong>{redAlert.camera_id}</strong></p>
            
            <button className="btn-primary" onClick={() => setRedAlert(null)} style={{ marginTop: '30px', background: 'red', fontSize: '1.5rem', padding: '15px 40px', fontWeight: 'bold' }}>
              DISPATCH UNITS NOW
            </button>
          </div>
        </div>
      )}

      {/* Add Camera Modal */}
      {showAddCameraModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div className="glass-panel" style={{ padding: '32px', width: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><Camera /> Link New Camera</h2>
              <X size={24} style={{ cursor: 'pointer' }} onClick={() => setShowAddCameraModal(false)} />
            </div>
            <form onSubmit={handleAddCamera} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Camera Name (e.g. Mall Gate 1)</label>
                <input 
                  type="text" className="input-glass" required
                  value={newCameraData.name} onChange={e => setNewCameraData({...newCameraData, name: e.target.value})}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Location / Address (e.g. Indirapuram Mall Gate 1)</label>
                <input 
                  type="text" className="input-glass" required
                  value={newCameraData.location} onChange={e => setNewCameraData({...newCameraData, location: e.target.value})}
                />
              </div>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'white', marginBottom: '8px' }}>
                  <input type="checkbox" checked={useLaptopCamera} onChange={(e) => setUseLaptopCamera(e.target.checked)} style={{ width: '16px', height: '16px', accentColor: 'var(--accent)' }} />
                  Use my Laptop's built-in Webcam
                </label>
                {!useLaptopCamera && (
                  <>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Live Stream URL (IP Webcam link)</label>
                    <input 
                      type="url" className="input-glass" required placeholder="http://192.168.x.x:8080/video"
                      value={newCameraData.stream_url} onChange={e => setNewCameraData({...newCameraData, stream_url: e.target.value})}
                    />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Use any IP Webcam app on your phone to get an MJPEG stream URL and paste it here.
                    </p>
                  </>
                )}
              </div>
              <button type="submit" className="btn-primary" style={{ marginTop: '10px' }}>Deploy & Monitor Camera</button>
            </form>
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ShieldAlert color="var(--accent)" size={28} />
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Tactical Monitoring Command Center</h2>
        </div>
        
        {/* Police GPS Location Display */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '20px' }}>
          <MapPin size={18} color={policeLocation.lat ? "var(--success)" : "var(--text-secondary)"} />
          <span style={{ fontSize: '0.9rem' }}>
            {policeAddress
              ? `${policeAddress}`
              : policeLocation.lat 
                ? 'Acquiring Address...' 
                : 'Acquiring GPS Signal...'}
          </span>
        </div>

        <button onClick={logout} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LogOut size={18} /> Logout
        </button>
      </div>

      {/* Main Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Column: Cameras & ML Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
          
          {/* Top Half: Real-time Cameras */}
          <div className="glass-panel animate-fade-in" style={{ padding: '16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Video size={20} color="var(--accent)" /> Active Live Streams
                </h3>
              </div>
              <button className="btn-primary" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setShowAddCameraModal(true)}>
                <Plus size={18} /> Add Real Camera
              </button>
            </div>
            
            <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px', flex: 1 }}>
              {cameras.length === 0 ? (
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', color: 'var(--text-secondary)' }}>
                   <Camera size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                   <p>No active cameras found.</p>
                   <p style={{ fontSize: '0.9rem' }}>Click "Add Real Camera" to deploy and link an IP stream.</p>
                 </div>
              ) : (
                cameras.map((cam) => (
                  <div key={cam._id} style={{ minWidth: '400px', resize: 'both', overflow: 'hidden', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ width: '100%', flex: 1, background: '#000', borderRadius: '4px', marginBottom: '8px', position: 'relative', overflow: 'hidden', minHeight: '200px' }}>
                      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: '8px' }}>
                          {cam.stream_url === 'LOCAL_WEBCAM' && (
                              <button 
                                onClick={() => {
                                  if (laptopVideoRef.current) {
                                    if (isCameraPaused) laptopVideoRef.current.play();
                                    else laptopVideoRef.current.pause();
                                    setIsCameraPaused(!isCameraPaused);
                                  }
                                }} 
                                style={{ background: 'rgba(0,0,0,0.6)', border: 'none', color: 'white', padding: '4px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                              >
                                {isCameraPaused ? <Play size={14} /> : <Pause size={14} />}
                              </button>
                          )}
                          <button onClick={() => handleRemoveCamera(cam.camera_id)} style={{ background: 'rgba(255,0,0,0.8)', border: 'none', color: 'white', padding: '4px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Remove Camera">
                              <Trash2 size={14} />
                          </button>
                          {!isCameraPaused && <span style={{ background: 'red', color: 'white', fontSize: '0.7rem', padding: '3px 8px', borderRadius: '4px', fontWeight: 'bold', animation: 'pulse 2s infinite' }}>LIVE REC</span>}
                      </div>
                      
                      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)', zIndex: 1 }}>Camera Offline or Unreachable</div>
                      
                      {cam.stream_url ? (
                        cam.stream_url === 'LOCAL_WEBCAM' ? (
                          <>
                            <LocalWebcam ref={laptopVideoRef} />
                            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 3, pointerEvents: 'none' }} />
                          </>
                        ) : cam.stream_url.includes('youtube.com') ? (
                          <iframe src={cam.stream_url} frameBorder="0" allow="autoplay; encrypted-media" style={{ width: '100%', height: '100%', position: 'relative', zIndex: 2 }}></iframe>
                        ) : (
                          <img src={cam.stream_url} alt="Live Stream" style={{ width: '100%', height: '100%', objectFit: 'contain', position: 'relative', zIndex: 2 }} 
                            onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                          />
                        )
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)', position: 'relative', zIndex: 2, background: '#000' }}>
                           No Stream Linked
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ paddingRight: '8px' }}>
                        <strong style={{ display: 'block', fontSize: '1.05rem', color: 'var(--accent)' }}>{cam.name}</strong>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{cam.area}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                        {cam.lat && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {parseFloat(cam.lat).toFixed(4)}, {parseFloat(cam.lng).toFixed(4)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Bottom Half: ML Controls & Search */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} color="var(--accent)" /> AI Threat Analysis Engine
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
                Bind the local AI Microservice to these active video streams. The AI will scan frames for weapons/anomalies in the background.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    className="btn-primary" 
                    onClick={startVideoProcessing}
                    disabled={isProcessing}
                    style={{ background: isProcessing ? 'var(--success)' : 'var(--accent)', flex: 1 }}
                  >
                    {isProcessing ? 'Monitoring Active' : 'Start AI Monitoring'}
                  </button>
                  {isProcessing && (
                      <button 
                        className="btn-primary" 
                        onClick={stopVideoProcessing}
                        style={{ background: 'var(--danger)' }}
                      >
                        Stop
                      </button>
                  )}
              </div>
            </div>

            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={20} color="var(--accent)" /> Suspect Records
              </h3>
              <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <input
                  type="text"
                  className="input-glass"
                  style={{ margin: 0 }}
                  placeholder="Search alias or name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <button type="submit" className="btn-primary" style={{ width: 'auto' }}>Search</button>
              </form>
              
              <div style={{ maxHeight: '100px', overflowY: 'auto' }}>
                {searchResults.map(r => (
                  <div key={r._id} style={{ fontSize: '0.9rem', padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <strong>{r.name}</strong> ({r.alias}) - {r.crimes}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live Alerts Feed */}
        <div className="glass-panel animate-fade-in" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--danger)' }}>
            <AlertTriangle size={20} /> Actionable Alerts
          </h3>
          <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {alerts.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '40px' }}>No active threats detected.</p>
            ) : (
              alerts.map((alert, i) => (
                <div key={alert._id || i} className="alert-card animate-fade-in">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ color: 'var(--danger)' }}>{alert.type.toUpperCase()}</strong>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </span>
                        <X size={16} style={{ cursor: 'pointer', color: 'var(--text-secondary)' }} onClick={() => handleDeleteAlert(alert._id)} />
                    </div>
                  </div>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>Area: {alert.area}</p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>Cam: {alert.camera_id}</p>
                  
                  {alert.image_url ? (
                      <div style={{ marginBottom: '8px', borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,0,0,0.3)', position: 'relative', cursor: 'pointer' }} onClick={() => setSelectedScreenshot(alert.image_url)}>
                          <div style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', padding: '2px', borderRadius: '4px', color: 'white' }}><Maximize2 size={14} /></div>
                          <img src={alert.image_url} alt="Crime Evidence" style={{ width: '100%', display: 'block' }} />
                      </div>
                  ) : (
                      <div style={{ marginBottom: '8px', padding: '8px', borderRadius: '4px', background: 'rgba(255,0,0,0.1)', color: 'var(--danger)', fontSize: '0.8rem', textAlign: 'center', border: '1px solid rgba(255,0,0,0.2)' }}>
                          Cloudinary Sync Failed: Image not saved. Add keys in Render.
                      </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ height: '6px', background: 'rgba(255,255,255,0.2)', borderRadius: '3px', flex: 1 }}>
                      <div style={{ height: '100%', background: 'var(--danger)', borderRadius: '3px', width: `${alert.confidence * 100}%` }}></div>
                    </div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{(alert.confidence * 100).toFixed(1)}%</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
