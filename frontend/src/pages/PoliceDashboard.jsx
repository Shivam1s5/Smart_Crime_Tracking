import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, LogOut, Video, Search, AlertTriangle, AlertOctagon, X, MapPin, Camera, Plus, CheckCircle, Trash2, Pause, Play, Maximize2, Users, SlidersHorizontal, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import { ThreatEngine, loadAiModels } from '../lib/vision/threatEngine.js';

const LocalWebcam = React.forwardRef((props, ref) => {
  const { onAudioLevel } = props;
  const onAudioLevelRef = useRef(onAudioLevel);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    onAudioLevelRef.current = onAudioLevel;
  }, [onAudioLevel]);

  useEffect(() => {
    let localStream = null;

    const startMedia = async () => {
      try {
        let stream;
        try {
          // Request video + microphone audio for acoustic analysis
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (audioErr) {
          console.warn("Could not capture microphone, falling back to video only:", audioErr);
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }

        localStream = stream;
        if (ref && ref.current) {
          ref.current.srcObject = stream;
        }

        // Setup Web Audio Analyser if audio track is active
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          try {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioContextClass();
            audioContextRef.current = audioCtx;

            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.35;
            analyserRef.current = analyser;

            const source = audioCtx.createMediaStreamSource(stream);
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const sampleAudio = () => {
              if (!analyserRef.current) return;
              analyserRef.current.getByteFrequencyData(dataArray);

              let sum = 0;
              for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
              }
              const avg = sum / bufferLength;

              // Convert average energy to realistic decibel scale
              // Ambient quiet room: ~35-42 dB, Speaking: ~55-70 dB, Screaming/Shouting: ~80-95 dB, Max: ~115 dB
              const db = Math.min(115, Math.round(35 + (avg / 255) * 75));
              if (onAudioLevelRef.current) {
                onAudioLevelRef.current(db);
              }

              animFrameRef.current = requestAnimationFrame(sampleAudio);
            };

            animFrameRef.current = requestAnimationFrame(sampleAudio);
          } catch (e) {
            console.error("AudioContext initialization error:", e);
          }
        }
      } catch (err) {
        console.error("Local webcam error", err);
      }
    };

    startMedia();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
    };
  }, [ref]);

  return <video ref={ref} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'relative', zIndex: 2 }} />;
});

export default function PoliceDashboard() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [cameras, setCameras] = useState([
    {
      _id: 'default_local_cam',
      camera_id: 'CAM-LAPTOP',
      name: 'Operator Tactical Webcam',
      area: 'Command Station',
      stream_url: 'LOCAL_WEBCAM',
      status: 'Active',
      gathering_threshold: 5,
      sound_threshold: 75
    }
  ]);
  const camerasRef = useRef(cameras);

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  const [redAlert, setRedAlert] = useState(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);
  const [isCameraPaused, setIsCameraPaused] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(true);
  
  // Real-time Live Gathering & Sound / Noise State per camera
  const [liveGatheringCounts, setLiveGatheringCounts] = useState({});
  const [liveSoundLevels, setLiveSoundLevels] = useState({});
  const currentSoundLevelRef = useRef(42);

  const [showEditThresholdModal, setShowEditThresholdModal] = useState(false);
  const [editingCamera, setEditingCamera] = useState(null);
  const [editGatheringThresholdValue, setEditGatheringThresholdValue] = useState(5);
  const [editSoundThresholdValue, setEditSoundThresholdValue] = useState(75);
  const [cameraSizePreset, setCameraSizePreset] = useState('standard');

  // Geolocation and Add Camera State
  const [policeLocation, setPoliceLocation] = useState({ lat: null, lng: null });
  const [policeAddress, setPoliceAddress] = useState('');
  const [showAddCameraModal, setShowAddCameraModal] = useState(false);
  const [newCameraData, setNewCameraData] = useState({ 
    name: '', 
    stream_url: '', 
    location: '', 
    gathering_threshold: 5,
    sound_threshold: 75 
  });
  const [useLaptopCamera, setUseLaptopCamera] = useState(false);
  const laptopVideoRef = useRef(null);
  const canvasRef = useRef(null);

  const socketRef = useRef(null);
  const lastAlertTimesRef = useRef({});

  useEffect(() => {
    // Warm the shared models up once so the first "Start AI Monitoring" click is fast.
    loadAiModels((message) => console.info('[AI]', message)).catch((error) => {
      console.error('Error pre-loading AI models:', error);
    });
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
    socketRef.current = socket;
    
    socket.on('red_alert', (data) => {
      setRedAlert(data);
      setAlerts((prev) => [data, ...prev]);
      // Play a loud alert sound if possible
      try {
        const audio = new Audio('https://www.soundjay.com/buttons/sounds/beep-01a.mp3');
        audio.play();
      } catch (e) { }
    });

    socket.on('camera_updated', (updatedCam) => {
      setCameras((prev) => prev.map(c => c.camera_id === updatedCam.camera_id ? updatedCam : c));
    });



    return () => socket.disconnect();
  }, []);

  const fetchCameras = async () => {
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/cameras`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      let cams = Array.isArray(res.data) ? res.data : [];
      const hasLocalWebcam = cams.some(c => c.stream_url === 'LOCAL_WEBCAM');
      if (!hasLocalWebcam) {
        cams = [{
          _id: 'default_local_cam',
          camera_id: 'CAM-LAPTOP',
          name: 'Operator Tactical Webcam',
          area: 'Command Station',
          stream_url: 'LOCAL_WEBCAM',
          status: 'Active',
          gathering_threshold: 5,
          sound_threshold: 75
        }, ...cams];
      }
      setCameras(cams);
    } catch (err) {
      console.error(err);
      // Fallback local webcam if backend unreachable
      setCameras([{
        _id: 'default_local_cam',
        camera_id: 'CAM-LAPTOP',
        name: 'Operator Tactical Webcam',
        area: 'Command Station',
        stream_url: 'LOCAL_WEBCAM',
        status: 'Active',
        gathering_threshold: 5,
        sound_threshold: 75
      }]);
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

  const handleAudioLevel = useCallback((db) => {
    const activeCam = (camerasRef.current || []).find(c => c.stream_url === 'LOCAL_WEBCAM') || (camerasRef.current || [])[0];
    const camId = activeCam ? activeCam.camera_id : 'LOCAL_WEBCAM';
    currentSoundLevelRef.current = db;
    if (engineRef.current) engineRef.current.setSoundLevel(db);
    setLiveSoundLevels(prev => {
      if (prev[camId] && Math.abs(prev[camId] - db) < 2) return prev;
      return { ...prev, [camId]: db };
    });
  }, []);

  // Ambient sound fluctuation for external/remote streams
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveSoundLevels(prev => {
        let changed = false;
        const next = { ...prev };
        (camerasRef.current || []).forEach(cam => {
          if (cam.stream_url !== 'LOCAL_WEBCAM') {
            const base = 42;
            const delta = Math.floor(Math.random() * 7) - 3;
            const current = prev[cam.camera_id] || base;
            next[cam.camera_id] = Math.max(35, Math.min(62, current + delta));
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 2500);
    return () => clearInterval(timer);
  }, []);

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
        lng: policeLocation.lng,
        gathering_threshold: Math.max(1, parseInt(newCameraData.gathering_threshold, 10) || 5),
        sound_threshold: Math.max(1, parseInt(newCameraData.sound_threshold, 10) || 75)
      };
      await axios.post(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/cameras`, payload, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setShowAddCameraModal(false);
      setNewCameraData({ name: '', stream_url: '', location: '', gathering_threshold: 5, sound_threshold: 75 });
      setUseLaptopCamera(false);
      fetchCameras(); // Refresh cameras
    } catch (err) {
      console.error("Failed to add camera", err);
      alert("Failed to add camera. Check console.");
    }
  };

  const handleUpdateThreshold = async (e) => {
    e.preventDefault();
    if (!editingCamera) return;
    try {
      const gathering_threshold = Math.max(1, parseInt(editGatheringThresholdValue, 10) || 5);
      const sound_threshold = Math.max(1, parseInt(editSoundThresholdValue, 10) || 75);
      await axios.put(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/cameras/${editingCamera.camera_id}`, {
        gathering_threshold,
        sound_threshold
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      const updated = cameras.map(c => c.camera_id === editingCamera.camera_id ? { ...c, gathering_threshold, sound_threshold } : c);
      setCameras(updated);
      camerasRef.current = updated; // Real-time immediate update for running AI loop
      setShowEditThresholdModal(false);
      setEditingCamera(null);
    } catch (err) {
      console.error("Failed to update camera thresholds:", err);
      alert("Failed to update thresholds.");
    }
  };

  const handleRemoveCamera = async (cameraId) => {
    try {
      setCameras(prev => prev.filter(c => c.camera_id !== cameraId && c._id !== cameraId));
      if (cameraId !== 'CAM-LAPTOP' && cameraId !== 'CAM-LAPTOP-LOCAL' && cameraId !== 'default_local_cam') {
        try {
          await axios.delete(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/cameras/${cameraId}`, {
              headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          });
        } catch (apiErr) {
          console.warn("Backend camera delete notice:", apiErr);
        }
      }
    } catch (err) {
      console.error("Camera removal error:", err);
    }
  };

  const handleRestoreLocalWebcam = () => {
    const localCam = {
      _id: 'default_local_cam_' + Date.now(),
      camera_id: 'CAM-LAPTOP',
      name: 'Operator Tactical Webcam',
      area: 'Command Station',
      stream_url: 'LOCAL_WEBCAM',
      status: 'Active',
      gathering_threshold: 5,
      sound_threshold: 75
    };
    setCameras(prev => {
      const filtered = prev.filter(c => c.stream_url !== 'LOCAL_WEBCAM');
      return [localCam, ...filtered];
    });
  };

  const captureScreenshot = () => {
    try {
      const video = laptopVideoRef.current;
      if (!video) return '';
      const snapCanvas = document.createElement('canvas');
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      snapCanvas.width = w;
      snapCanvas.height = h;
      const snapCtx = snapCanvas.getContext('2d');
      
      // 1. Draw raw live video frame
      snapCtx.drawImage(video, 0, 0, w, h);
      
      // 2. Merge AI Drawing Layer with all bodily frames, skeletons, HUD labels, badges
      const aiCanvas = canvasRef.current;
      if (aiCanvas && aiCanvas.width > 0 && aiCanvas.height > 0) {
          snapCtx.drawImage(aiCanvas, 0, 0, w, h);
      }
      
      // 3. Forensic Tactical Timestamp Banner on Captured Evidence
      snapCtx.save();
      snapCtx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      snapCtx.fillRect(10, h - 34, w - 20, 24);
      snapCtx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      snapCtx.lineWidth = 1;
      snapCtx.strokeRect(10, h - 34, w - 20, 24);
      
      snapCtx.fillStyle = '#38bdf8';
      snapCtx.font = 'bold 11px monospace';
      const timeStr = new Date().toLocaleString();
      snapCtx.fillText(`POLICE TACTICAL AI EVIDENCE • ${timeStr} • CAMERA ACTIVE`, 20, h - 18);
      snapCtx.restore();

      return snapCanvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      console.error("Screenshot error", e);
      return '';
    }
  };

  const triggerRealAlert = async (type, score) => {
    const now = Date.now();
    const typeUpper = (type || '').toUpperCase();

    let category = 'GENERAL';
    let cooldownMs = 25000;

    if (typeUpper.includes('GATHERING') || typeUpper.includes('CROWD')) {
      category = 'CROWD';
      cooldownMs = 50000; // 50s cooldown for crowd limit notifications
    } else if (typeUpper.includes('NOISE') || typeUpper.includes('AUDIO')) {
      category = 'NOISE';
      cooldownMs = 40000; // 40s cooldown for noise notifications
    } else if (typeUpper.includes('WEAPON') || typeUpper.includes('GUN') || typeUpper.includes('KNIFE') || typeUpper.includes('ARMED') || typeUpper.includes('FIREARM')) {
      category = 'WEAPON';
      cooldownMs = 18000; // 18s cooldown
    } else if (typeUpper.includes('ASSAULT') || typeUpper.includes('PUNCH') || typeUpper.includes('COMBAT') || typeUpper.includes('STRIKE') || typeUpper.includes('BRAWL')) {
      category = 'COMBAT';
      cooldownMs = 10000; // 10s cooldown for physical combat strikes
    }

    // Play instant acoustic alert siren/beep via Web Audio API so user immediately hears audio confirmation
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        const audioCtx = new AudioContextClass();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = (category === 'COMBAT' || category === 'WEAPON') ? 'sawtooth' : 'sine';
        osc.frequency.setValueAtTime((category === 'COMBAT' || category === 'WEAPON') ? 920 : 580, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime((category === 'COMBAT' || category === 'WEAPON') ? 440 : 320, audioCtx.currentTime + 0.32);
        gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.32);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.32);
      }
    } catch (soundErr) {}

    const lastTime = (lastAlertTimesRef.current && lastAlertTimesRef.current[category]) || 0;
    if (now - lastTime < cooldownMs) {
      return; // Suppressed by active category cooldown
    }

    if (!lastAlertTimesRef.current) lastAlertTimesRef.current = {};
    lastAlertTimesRef.current[category] = now;
    window.lastAlertTime = now;
    
    const cam = (camerasRef.current || []).find(c => c.stream_url === 'LOCAL_WEBCAM') || (camerasRef.current || [])[0];
    if (!cam) return;
    
    const image_base64 = captureScreenshot();
    
    try {
      await axios.post(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/alerts/trigger`, {
          camera_id: cam.camera_id,
          area: cam.area,
          type: typeUpper,
          confidence: score,
          image_base64: image_base64
      });
    } catch (e) { console.error("Error triggering real AI alert", e); }
  };

  // ───────────────────────────────────────────────────────────────────────
  // AI threat engine wiring.
  // All detection logic lives in src/lib/vision/* — this component only
  // forwards state to the UI and alerts to the API.
  // ───────────────────────────────────────────────────────────────────────
  const engineRef = useRef(null);
  const [engineStatus, setEngineStatus] = useState('idle');
  const [engineDiag, setEngineDiag] = useState({ fps: 0, persons: 0, maxSpeed: 0, error: null });

  const activeCamera = () =>
    (camerasRef.current || []).find((cam) => cam.stream_url === 'LOCAL_WEBCAM') ||
    (camerasRef.current || [])[0] ||
    null;

  const getEngine = useCallback(() => {
    if (engineRef.current) return engineRef.current;

    engineRef.current = new ThreatEngine({
      onSnapshot: ({ gathering, fps, maxSpeed, error }) => {
        const cam = activeCamera();
        if (cam) {
          setLiveGatheringCounts((prev) =>
            prev[cam.camera_id] === gathering ? prev : { ...prev, [cam.camera_id]: gathering },
          );
        }
        setEngineDiag((prev) =>
          prev.fps === Math.round(fps) && prev.persons === gathering &&
          prev.maxSpeed === Math.round(maxSpeed * 10) && prev.error === error
            ? prev
            : { fps: Math.round(fps), persons: gathering, maxSpeed: Math.round(maxSpeed * 10), error },
        );
      },
      onAlert: (event) => {
        // Confidence comes from the engine's evidence, never a constant.
        triggerRealAlert(event.type, event.confidence);
      },
      onError: (error) => console.error('ThreatEngine frame error:', error),
      onWarn: (message) => console.warn('[AI]', message),
      onStatus: (status) => setEngineStatus(status),
    });

    return engineRef.current;
  }, []);

  const runRealAI = async () => {
    try {
      setIsProcessing(true);
      isProcessingRef.current = true;

      const engine = getEngine();
      await engine.init((message) => console.info('[AI]', message));

      const video = laptopVideoRef.current;
      if (!video || !canvasRef.current) {
        setIsProcessing(false);
        isProcessingRef.current = false;
        alert('Camera feed is not ready yet. Restore the operator webcam and try again.');
        return;
      }

      if (video.paused) {
        try {
          await video.play();
        } catch {
          // Autoplay can be blocked until the user interacts with the page.
        }
      }

      const cam = activeCamera();
      engine.setLimits({
        gatheringLimit: Number(cam?.gathering_threshold) || 5,
        soundLimit: Number(cam?.sound_threshold) || 75,
      });
      engine.start({
        // Getter form: the engine re-reads these every frame, so it survives a
        // React remount of the camera card instead of drawing into a detached
        // canvas (which looked like "engine runs but nothing appears").
        getVideo: () => laptopVideoRef.current,
        getCanvas: () => canvasRef.current,
      });
    } catch (error) {
      console.error('AI Initialization Error:', error);
      setIsProcessing(false);
      isProcessingRef.current = false;
    }
  };

  // Keep the running engine in sync when an operator edits the limits.
  useEffect(() => {
    if (!engineRef.current) return;
    const cam = activeCamera();
    engineRef.current.setLimits({
      gatheringLimit: Number(cam?.gathering_threshold) || 5,
      soundLimit: Number(cam?.sound_threshold) || 75,
    });
  }, [cameras]);

  // Never leave the camera or the render loop running after unmount.
  useEffect(
    () => () => {
      if (engineRef.current) engineRef.current.stop();
    },
    [],
  );

  const stopVideoProcessing = () => {
    isProcessingRef.current = false;
    if (engineRef.current) engineRef.current.stop();
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setIsProcessing(false);
  };

  const startVideoProcessing = async () => {
    setIsProcessing(true);
    // Non-blocking notification to backend
    axios.post(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/video/start`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    }).catch(e => console.warn("Background start notify skipped:", e));
    // Immediately start live camera threat AI
    runRealAI();
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

      {/* Edit Gathering & Sound Threshold Modal */}
      {showEditThresholdModal && editingCamera && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000
        }}>
          <div className="glass-panel" style={{ padding: '32px', width: '420px', background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SlidersHorizontal size={20} color="var(--accent)" /> Configure Camera Limits
              </h3>
              <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowEditThresholdModal(false)} />
            </div>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              Configure gathering limit and sound limit for <strong>{editingCamera.name}</strong> ({editingCamera.area}). Alerts trigger automatically if limits are exceeded.
            </p>
            <form onSubmit={handleUpdateThreshold} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.88rem', color: '#cbd5e1' }}>
                  <span style={{ fontWeight: 600 }}>👥 Maximum Gathering Limit</span>
                  <span style={{ fontSize: '0.76rem', color: 'var(--accent)', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(56, 189, 248, 0.25)' }}>
                    Operator Defined (No Limit)
                  </span>
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="number" 
                    min="1" 
                    className="input-glass" 
                    style={{ width: '100%', paddingRight: '80px', fontSize: '1.05rem', fontWeight: 'bold', color: 'var(--accent)', margin: 0 }}
                    placeholder="Enter custom gathering limit..."
                    value={editGatheringThresholdValue} 
                    onChange={(e) => setEditGatheringThresholdValue(e.target.value)} 
                    required
                  />
                  <span style={{ position: 'absolute', right: '12px', fontSize: '0.82rem', color: '#94a3b8', pointerEvents: 'none', fontWeight: 600 }}>
                    Persons
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Quick Set:</span>
                  {[5, 10, 25, 50, 100, 250, 500].map(val => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setEditGatheringThresholdValue(val)}
                      style={{
                        background: Number(editGatheringThresholdValue) === val ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${Number(editGatheringThresholdValue) === val ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
                        color: Number(editGatheringThresholdValue) === val ? 'var(--accent)' : '#94a3b8',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        fontSize: '0.72rem',
                        cursor: 'pointer'
                      }}
                    >
                      {val}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEditGatheringThresholdValue(prev => Math.max(1, (parseInt(prev, 10) || 0) + 5))}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    +5
                  </button>
                </div>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                  Alert triggers when live person count on this camera exceeds this operator threshold.
                </span>
              </div>

              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.88rem', color: '#cbd5e1' }}>
                  <span style={{ fontWeight: 600 }}>🔊 Noise / Sound Limit</span>
                  <span style={{ fontSize: '0.76rem', color: '#eab308', background: 'rgba(234, 179, 8, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(234, 179, 8, 0.25)' }}>
                    Operator Defined (No Limit)
                  </span>
                </label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input 
                    type="number" 
                    min="1" 
                    className="input-glass" 
                    style={{ width: '100%', paddingRight: '50px', fontSize: '1.05rem', fontWeight: 'bold', color: '#eab308', margin: 0 }}
                    placeholder="Enter custom sound limit in dB..."
                    value={editSoundThresholdValue} 
                    onChange={(e) => setEditSoundThresholdValue(e.target.value)} 
                    required
                  />
                  <span style={{ position: 'absolute', right: '12px', fontSize: '0.82rem', color: '#94a3b8', pointerEvents: 'none', fontWeight: 600 }}>
                    dB
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Presets:</span>
                  {[
                    { label: '50 (Quiet)', val: 50 },
                    { label: '75 (Normal)', val: 75 },
                    { label: '85 (Crowd)', val: 85 },
                    { label: '95 (Distress)', val: 95 },
                    { label: '110 (Loud)', val: 110 }
                  ].map(p => (
                    <button
                      key={p.val}
                      type="button"
                      onClick={() => setEditSoundThresholdValue(p.val)}
                      style={{
                        background: Number(editSoundThresholdValue) === p.val ? 'rgba(234, 179, 8, 0.25)' : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${Number(editSoundThresholdValue) === p.val ? '#eab308' : 'rgba(255,255,255,0.1)'}`,
                        color: Number(editSoundThresholdValue) === p.val ? '#eab308' : '#94a3b8',
                        borderRadius: '4px',
                        padding: '2px 8px',
                        fontSize: '0.72rem',
                        cursor: 'pointer'
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEditSoundThresholdValue(prev => Math.max(1, (parseInt(prev, 10) || 0) + 5))}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    +5 dB
                  </button>
                </div>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                  Automatic alert triggers if noise stays above {editSoundThresholdValue || 0} dB for more than 1.5 seconds.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '10px' }}>
                  Save & Apply Limits
                </button>
                <button type="button" onClick={() => setShowEditThresholdModal(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '6px', padding: '10px 16px', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Camera Modal */}
      {showAddCameraModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
        }}>
          <div className="glass-panel" style={{ padding: '32px', width: '420px' }}>
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
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Max Gathering Limit (Persons)</label>
                <input 
                  type="number" min="1" className="input-glass" required placeholder="e.g. 5, 25, 100 (Operator Defined)"
                  value={newCameraData.gathering_threshold} onChange={e => setNewCameraData({...newCameraData, gathering_threshold: e.target.value})}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Automatic alert will trigger if gathering exceeds this operator limit.</span>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Sound / Noise Limit (dB)</label>
                <input 
                  type="number" min="1" className="input-glass" required placeholder="e.g. 75, 85, 110 (Operator Defined)"
                  value={newCameraData.sound_threshold} onChange={e => setNewCameraData({...newCameraData, sound_threshold: e.target.value})}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Custom limit in dB. Alerts if sustained over 1.5 seconds.</span>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <ShieldAlert color="var(--accent)" size={28} />
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Tactical Monitoring Command Center</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
              <span style={{ 
                background: user?.role === 'Admin' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(16, 185, 129, 0.2)', 
                color: user?.role === 'Admin' ? '#38bdf8' : '#10b981', 
                border: `1px solid ${user?.role === 'Admin' ? 'rgba(56, 189, 248, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`, 
                fontSize: '0.74rem', 
                fontWeight: 'bold', 
                padding: '2px 8px', 
                borderRadius: '4px' 
              }}>
                {user?.role === 'Admin' ? 'ADMINISTRATOR' : 'POLICE OPERATOR'}
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Live Crowd Gathering & Multi-Person Threat AI
              </span>
            </div>
          </div>
        </div>
        
        {/* Police GPS Location Display & Admin Switch */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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

          {user?.role === 'Admin' && (
            <button 
              onClick={() => navigate('/admin')}
              className="btn-primary" 
              style={{ padding: '8px 14px', fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.35)', color: '#38bdf8' }}
            >
              <ShieldCheck size={16} /> Admin Portal
            </button>
          )}

          <button onClick={logout} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LogOut size={18} /> Logout
          </button>
        </div>
      </div>

      {/* Main Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px', flex: 1, alignItems: 'start' }}>
        
        {/* Left Column: Cameras & ML Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Top Half: Real-time Cameras */}
          <div className="glass-panel animate-fade-in" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Video size={20} color="var(--accent)" /> Active Live Streams
                </h3>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* Camera Size Presets */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', padding: '3px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <span style={{ fontSize: '0.74rem', color: '#94a3b8', marginRight: '4px' }}>Feed Size:</span>
                  {[
                    { id: 'compact', label: 'S (380p)' },
                    { id: 'standard', label: 'M (480p)' },
                    { id: 'wide', label: 'L (620p)' }
                  ].map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setCameraSizePreset(p.id)}
                      style={{
                        background: cameraSizePreset === p.id ? 'var(--accent)' : 'transparent',
                        color: cameraSizePreset === p.id ? '#090d16' : '#cbd5e1',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '3px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <button 
                  type="button"
                  onClick={handleRestoreLocalWebcam}
                  style={{ 
                    padding: '8px 14px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    fontSize: '0.82rem', 
                    background: 'rgba(56, 189, 248, 0.12)', 
                    border: '1px solid rgba(56, 189, 248, 0.35)', 
                    color: '#38bdf8', 
                    borderRadius: '6px', 
                    cursor: 'pointer',
                    fontWeight: 'bold'
                  }}
                  title="Restore Operator Tactical Webcam"
                >
                  <Camera size={16} /> Restore Webcam
                </button>
                <button className="btn-primary" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => setShowAddCameraModal(true)}>
                  <Plus size={18} /> Add Real Camera
                </button>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '12px', alignItems: 'flex-start' }}>
              {cameras.length === 0 ? (
                 <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', color: 'var(--text-secondary)', padding: '40px 0' }}>
                   <Camera size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                   <p>No active cameras found.</p>
                   <p style={{ fontSize: '0.9rem' }}>Click "Add Real Camera" to deploy and link an IP stream.</p>
                   <button 
                     type="button"
                     onClick={handleRestoreLocalWebcam} 
                     className="btn-primary" 
                     style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                   >
                     <Camera size={16} /> Restore Operator Tactical Webcam
                   </button>
                 </div>
              ) : (
                cameras.map((cam) => {
                  const cardWidth = cameraSizePreset === 'compact' ? '380px' : cameraSizePreset === 'standard' ? '480px' : '620px';
                  return (
                    <div 
                      key={cam._id} 
                      style={{ 
                        width: cardWidth,
                        minWidth: '320px', 
                        maxWidth: '100%',
                        resize: 'horizontal', 
                        overflow: 'hidden', 
                        background: 'rgba(255,255,255,0.05)', 
                        padding: '12px', 
                        borderRadius: '8px', 
                        border: '1px solid rgba(255,255,255,0.1)', 
                        display: 'flex', 
                        flexDirection: 'column',
                        flexShrink: 0
                      }}
                    >
                      <div style={{ 
                        width: '100%', 
                        aspectRatio: '16 / 9', 
                        background: '#000', 
                        borderRadius: '6px', 
                        marginBottom: '8px', 
                        position: 'relative', 
                        overflow: 'hidden' 
                      }}>
                      {/* Live Gathering Count Badge */}
                      <div style={{
                        position: 'absolute', top: 8, left: 8, zIndex: 10,
                        background: (liveGatheringCounts[cam.camera_id] || 0) > (cam.gathering_threshold || 5) ? 'rgba(220, 38, 38, 0.95)' : 'rgba(15, 23, 42, 0.88)',
                        border: `1px solid ${(liveGatheringCounts[cam.camera_id] || 0) > (cam.gathering_threshold || 5) ? '#ef4444' : 'rgba(56, 189, 248, 0.4)'}`,
                        color: '#fff', fontSize: '0.72rem', fontWeight: 'bold', padding: '3px 8px',
                        borderRadius: '6px', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: '5px',
                        boxShadow: (liveGatheringCounts[cam.camera_id] || 0) > (cam.gathering_threshold || 5) ? '0 0 10px #ef4444' : 'none'
                      }}>
                        <Users size={12} color={(liveGatheringCounts[cam.camera_id] || 0) > (cam.gathering_threshold || 5) ? '#fff' : '#38bdf8'} />
                        <span>
                          Gathering: {liveGatheringCounts[cam.camera_id] !== undefined ? liveGatheringCounts[cam.camera_id] : '—'} / Limit: {cam.gathering_threshold || 5}
                        </span>
                      </div>

                      {/* Live Sound Level Badge */}
                      <div style={{
                        position: 'absolute', top: 38, left: 8, zIndex: 10,
                        background: (liveSoundLevels[cam.camera_id] || 42) > (cam.sound_threshold || 75) ? 'rgba(239, 68, 68, 0.95)' : 'rgba(15, 23, 42, 0.88)',
                        border: `1px solid ${(liveSoundLevels[cam.camera_id] || 42) > (cam.sound_threshold || 75) ? '#ef4444' : 'rgba(234, 179, 8, 0.4)'}`,
                        color: '#fff', fontSize: '0.72rem', fontWeight: 'bold', padding: '3px 8px',
                        borderRadius: '6px', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: '5px',
                        boxShadow: (liveSoundLevels[cam.camera_id] || 42) > (cam.sound_threshold || 75) ? '0 0 10px #ef4444' : 'none'
                      }}>
                        <Volume2 size={12} color={(liveSoundLevels[cam.camera_id] || 42) > (cam.sound_threshold || 75) ? '#fff' : '#eab308'} />
                        <span>
                          Noise: {liveSoundLevels[cam.camera_id] || 42} dB / Limit: {cam.sound_threshold || 75} dB
                        </span>
                      </div>

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
                            <LocalWebcam ref={laptopVideoRef} onAudioLevel={handleAudioLevel} />
                            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, zIndex: 3, pointerEvents: 'none' }} />
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

                    {/* Gathering & Sound Limit Controller Footer */}
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)', width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>Gathering Limit:</span>
                          <span style={{ 
                            fontSize: '0.78rem', 
                            fontWeight: 'bold', 
                            color: (liveGatheringCounts[cam.camera_id] || 0) > (cam.gathering_threshold || 5) ? '#ef4444' : '#38bdf8',
                            background: (liveGatheringCounts[cam.camera_id] || 0) > (cam.gathering_threshold || 5) ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.12)',
                            padding: '2px 6px', borderRadius: '4px' 
                          }}>
                            {cam.gathering_threshold || 5} Persons
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>Sound Limit:</span>
                          <span style={{ 
                            fontSize: '0.78rem', 
                            fontWeight: 'bold', 
                            color: (liveSoundLevels[cam.camera_id] || 42) > (cam.sound_threshold || 75) ? '#ef4444' : '#eab308',
                            background: (liveSoundLevels[cam.camera_id] || 42) > (cam.sound_threshold || 75) ? 'rgba(239, 68, 68, 0.15)' : 'rgba(234, 179, 8, 0.12)',
                            padding: '2px 6px', borderRadius: '4px' 
                          }}>
                            {cam.sound_threshold || 75} dB
                          </span>
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
                        <button 
                          onClick={() => {
                            setEditingCamera(cam);
                            setEditGatheringThresholdValue(cam.gathering_threshold || 5);
                            setEditSoundThresholdValue(cam.sound_threshold || 75);
                            setShowEditThresholdModal(true);
                          }}
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.18)',
                            color: '#f8fafc',
                            borderRadius: '4px',
                            padding: '4px 10px',
                            cursor: 'pointer',
                            fontSize: '0.74rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <SlidersHorizontal size={12} color="var(--accent)" /> Configure Limits
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            </div>
          </div>

          {/* Bottom Half: ML Controls & Search */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} color="var(--accent)" /> AI Threat Analysis Engine
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '12px' }}>
                Runs entirely in this browser (COCO-SSD + MoveNet). Every person gets a tracked frame; weapons
                and strikes must be confirmed over several frames before an alert is raised.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '0.78rem', flexWrap: 'wrap' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: '4px', fontWeight: 700, letterSpacing: '0.04em',
                  background: engineStatus === 'running' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.12)',
                  color: engineStatus === 'running' ? 'var(--success)' : 'var(--text-secondary)',
                  border: `1px solid ${engineStatus === 'running' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(148, 163, 184, 0.25)'}`
                }}>
                  ENGINE: {engineStatus.toUpperCase()}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Crowd &amp; noise limits are read live from the active camera.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '0.78rem', marginBottom: '12px', color: 'var(--text-secondary)' }}>
                <span>FPS: <strong style={{ color: '#67e8f9' }}>{engineDiag.fps}</strong></span>
                <span>Tracked: <strong style={{ color: '#67e8f9' }}>{engineDiag.persons}</strong></span>
                <span>Peak motion: <strong style={{ color: '#67e8f9' }}>{(engineDiag.maxSpeed / 10).toFixed(1)} torso/s</strong></span>
              </div>

              {engineDiag.error && (
                <div className="alert-card" style={{ padding: '8px 12px', fontSize: '0.78rem', marginBottom: '12px' }}>
                  Engine error: {engineDiag.error}
                </div>
              )}
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
