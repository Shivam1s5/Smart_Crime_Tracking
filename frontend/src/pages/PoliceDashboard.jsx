import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, LogOut, Video, Search, AlertTriangle, AlertOctagon, X, MapPin, Camera, Plus, CheckCircle, Trash2, Pause, Play, Maximize2, Users, SlidersHorizontal, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import * as tf from '@tensorflow/tfjs';
import * as cocossd from '@tensorflow-models/coco-ssd';
import * as poseDetection from '@tensorflow-models/pose-detection';

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
  const [isProcessing, setIsProcessing] = useState(true);
  const isProcessingRef = useRef(true);
  const [redAlert, setRedAlert] = useState(null);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);
  const [isCameraPaused, setIsCameraPaused] = useState(false);
  
  // Real-time Live Gathering & Sound / Noise State per camera
  const [liveGatheringCounts, setLiveGatheringCounts] = useState({});
  const [liveSoundLevels, setLiveSoundLevels] = useState({});
  const currentSoundLevelRef = useRef(42);
  const highNoiseStartRef = useRef(null);

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
  const [model, setModel] = useState(null);
  const [poseModel, setPoseModel] = useState(null);
  const modelRef = useRef(null);
  const poseModelRef = useRef(null);
  const recentAssaultRef = useRef({}); // Stores assault persistence { timestamp, state, statusLabel, threatScore, strikingLimb, targetZone }
  const recentGuardRef = useRef({}); // Stores fighting guard stance persistence { timestamp, state, statusLabel, threatScore }
  const lastGlobalAssaultRef = useRef(null); // Fallback single-subject assault memory
  const aiIntervalRef = useRef(null);
  const poseHistoryRef = useRef([]); // Stores tracked subject keypoints, velocities, and facial dynamics over time
  const [relayFeeds, setRelayFeeds] = useState({});
  const [isLocalBroadcaster, setIsLocalBroadcaster] = useState(true);
  const socketRef = useRef(null);
  const lastAlertTimesRef = useRef({});

  useEffect(() => {
    // Pre-load AI models for instant responsiveness
    const loadModels = async () => {
      try {
        await tf.ready();
        const loadedObject = await cocossd.load();
        modelRef.current = loadedObject;
        setModel(loadedObject);
        const detectorConfig = {
          modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
          enableSmoothing: true,
          minPoseScore: 0.05
        };
        const loadedPose = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);
        poseModelRef.current = loadedPose;
        setPoseModel(loadedPose);

        // Auto-start AI monitoring once models are ready
        setIsProcessing(true);
        isProcessingRef.current = true;
        setTimeout(() => {
          runRealAI();
        }, 500);
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

    // Real-time multi-device live stream relay listener
    socket.on('live_feed_update', (feed) => {
      if (feed && feed.camera_id) {
        setRelayFeeds((prev) => ({
          ...prev,
          [feed.camera_id]: feed
        }));
        if (feed.gathering_count !== undefined) {
          setLiveGatheringCounts((prev) => ({
            ...prev,
            [feed.camera_id]: feed.gathering_count
          }));
        }
        if (feed.sound_level !== undefined) {
          setLiveSoundLevels((prev) => ({
            ...prev,
            [feed.camera_id]: feed.sound_level
          }));
        }
      }
    });

    // Fetch initial active live feeds
    axios.get(`${socketUrl}/api/cameras/live_feeds`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    }).then(res => {
      if (res.data && typeof res.data === 'object') {
        setRelayFeeds(res.data);
      }
    }).catch(() => {});

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

  const runRealAI = async () => {
     try {
         await tf.ready();
         
         // Dynamically load models if pending using refs as primary source
         let curModel = modelRef.current || model;
         let curPoseModel = poseModelRef.current || poseModel;
         if (!curModel) {
            try {
               curModel = await cocossd.load();
               modelRef.current = curModel;
               setModel(curModel);
            } catch (e) {
               console.error("COCO-SSD load error:", e);
            }
         }
         if (!curPoseModel) {
            try {
               const detectorConfig = {
                 modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
                 enableSmoothing: true,
                 minPoseScore: 0.05
               };
               curPoseModel = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);
               poseModelRef.current = curPoseModel;
               setPoseModel(curPoseModel);
            } catch (e) {
               console.error("MoveNet load error:", e);
            }
         }
         
         if (aiIntervalRef.current) clearInterval(aiIntervalRef.current);
         isProcessingRef.current = true;

         // Ensure video is playing
         if (laptopVideoRef.current && laptopVideoRef.current.paused) {
            try { await laptopVideoRef.current.play(); } catch(e) {}
         }
     
         aiIntervalRef.current = setInterval(async () => {
         if (!isProcessingRef.current) return;
         if (laptopVideoRef.current && (laptopVideoRef.current.readyState >= 2 || laptopVideoRef.current.videoWidth > 0)) {
            const video = laptopVideoRef.current;
            const canvas = canvasRef.current;
            const ctx = canvas ? canvas.getContext('2d') : null;
            
            if (canvas && ctx) {
                if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                    canvas.width = video.videoWidth || 640;
                    canvas.height = video.videoHeight || 480;
                }
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.font = '16px Arial';
            }

            // A. Object Detection for Real Weapons
            let predictions = [];
            if (curModel) {
                try {
                    predictions = await curModel.detect(video);
                } catch (detErr) {
                    console.warn("Detection frame error:", detErr);
                }
            }
            const bladeClasses = ['knife', 'scissors', 'fork'];
            const bluntClasses = ['baseball bat'];
            const detectedWeapons = [];

            for (let p of predictions) {
                // Highly sensitive threshold (0.08 for knife/scissors, 0.12 for fork/bat, 0.25 for bottle)
                const isBlade = bladeClasses.includes(p.class) && p.score >= 0.08;
                const isBlunt = bluntClasses.includes(p.class) && p.score >= 0.10;
                const isBottle = p.class === 'bottle' && p.score >= 0.25;

                if (isBlade || isBlunt || isBottle) {
                    const displayClass = (p.class === 'fork' || p.class === 'scissors') ? 'knife' : p.class;
                    detectedWeapons.push({ ...p, displayClass });
                    if (ctx) {
                        ctx.save();
                        ctx.strokeStyle = '#ef4444';
                        ctx.lineWidth = 3.5;
                        ctx.shadowColor = '#ef4444';
                        ctx.shadowBlur = 14;
                        ctx.strokeRect(...p.bbox);

                        ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
                        const labelY = p.bbox[1] > 26 ? p.bbox[1] - 24 : p.bbox[1];
                        ctx.fillRect(p.bbox[0], labelY, Math.max(p.bbox[2], 175), 22);

                        ctx.fillStyle = '#ffffff';
                        ctx.font = 'bold 12px sans-serif';
                        ctx.fillText(`⚠️ WEAPON: ${displayClass.toUpperCase()} (${Math.round(p.score * 100)}%)`, p.bbox[0] + 6, labelY + 16);
                        ctx.restore();
                    }
                }
            }
            
            // B. Multi-Person MoveNet Pose Estimation
            let poses = [];
            if (curPoseModel) {
                try {
                    poses = await curPoseModel.estimatePoses(video, {
                        maxPoses: 6,
                        flipHorizontal: false
                    });
                } catch (poseErr) {
                    console.warn("Pose estimation error:", poseErr);
                }
            }
            
            // Filter valid poses with relaxed confidence threshold (0.04)
            const validPoses = (poses || []).filter(p => {
                if (!p.keypoints || p.keypoints.length === 0) return false;
                const goodPts = p.keypoints.filter(k => k.score > 0.04);
                return (p.score && p.score > 0.03) || goodPts.length >= 2;
            });

            // C. Live Crowd / Gathering Count & Real-time Threshold Breach Check
            const detectedPersons = predictions.filter(p => p.class === 'person' && p.score >= 0.20);
            
            // Fallback synthesis: ONLY synthesize a pose if MoveNet failed to detect any person at all!
            // This prevents creating a duplicate phantom 2nd person on top of a single user.
            if (validPoses.length === 0 && detectedPersons.length > 0) {
                detectedPersons.forEach(dp => {
                    const [bx, by, bw, bh] = dp.bbox;
                    validPoses.push({
                        score: dp.score,
                        keypoints: [
                            { name: 'nose', x: bx + bw * 0.5, y: by + bh * 0.16, score: 0.8 },
                            { name: 'left_shoulder', x: bx + bw * 0.3, y: by + bh * 0.28, score: 0.8 },
                            { name: 'right_shoulder', x: bx + bw * 0.7, y: by + bh * 0.28, score: 0.8 },
                            { name: 'left_elbow', x: bx + bw * 0.22, y: by + bh * 0.42, score: 0.7 },
                            { name: 'right_elbow', x: bx + bw * 0.78, y: by + bh * 0.42, score: 0.7 },
                            { name: 'left_wrist', x: bx + bw * 0.25, y: by + bh * 0.52, score: 0.6 },
                            { name: 'right_wrist', x: bx + bw * 0.75, y: by + bh * 0.52, score: 0.6 },
                            { name: 'left_hip', x: bx + bw * 0.35, y: by + bh * 0.58, score: 0.8 },
                            { name: 'right_hip', x: bx + bw * 0.65, y: by + bh * 0.58, score: 0.8 },
                            { name: 'left_knee', x: bx + bw * 0.35, y: by + bh * 0.78, score: 0.7 },
                            { name: 'right_knee', x: bx + bw * 0.65, y: by + bh * 0.78, score: 0.7 },
                            { name: 'left_ankle', x: bx + bw * 0.35, y: by + bh * 0.95, score: 0.8 },
                            { name: 'right_ankle', x: bx + bw * 0.65, y: by + bh * 0.95, score: 0.8 }
                        ],
                        box: { xMin: bx, yMin: by, xMax: bx + bw, yMax: by + bh, width: bw, height: bh }
                    });
                });
            }

            const currentGatheringCount = validPoses.length > 0 ? validPoses.length : detectedPersons.length;

            // Read live from camerasRef so changes made midway update instantaneously without reload!
            const currentCams = camerasRef.current || [];
            const activeCam = currentCams.find(c => c.stream_url === 'LOCAL_WEBCAM') || currentCams[0];
            const gatheringThreshold = (activeCam && activeCam.gathering_threshold) ? Number(activeCam.gathering_threshold) : 5;
            const soundThreshold = (activeCam && activeCam.sound_threshold) ? Number(activeCam.sound_threshold) : 75;

            if (activeCam) {
                setLiveGatheringCounts(prev => ({
                    ...prev,
                    [activeCam.camera_id]: currentGatheringCount
                }));
            }

            const isOvercrowded = currentGatheringCount > gatheringThreshold;

            // D. Real-time Acoustic Noise Check & Sustained High Noise Duration
            const currentSound = currentSoundLevelRef.current || 42;
            const isNoiseOverLimit = currentSound > soundThreshold;

            if (isNoiseOverLimit) {
                if (!highNoiseStartRef.current) {
                    highNoiseStartRef.current = Date.now();
                }
            } else {
                highNoiseStartRef.current = null;
            }

            const sustainedNoiseDuration = highNoiseStartRef.current ? (Date.now() - highNoiseStartRef.current) : 0;
            const isSustainedNoiseBreach = isNoiseOverLimit && sustainedNoiseDuration >= 1500;

            // Sort persons Left-to-Right for stable Person 1, Person 2... labeling
            validPoses.sort((a, b) => {
                const getX = (pose) => {
                    if (pose.box && typeof pose.box.xMin === 'number') return pose.box.xMin;
                    const nose = pose.keypoints.find(k => k.name === 'nose');
                    if (nose && nose.score > 0.08) return nose.x;
                    const shoulder = pose.keypoints.find(k => k.name === 'left_shoulder' || k.name === 'right_shoulder');
                    if (shoulder && shoulder.score > 0.08) return shoulder.x;
                    const first = pose.keypoints.find(k => k.score > 0.08);
                    return first ? first.x : 0;
                };
                return getX(a) - getX(b);
            });

            // Build rich metadata for each detected subject
            const personEntities = validPoses.map((p, idx) => {
                const kpMap = {};
                p.keypoints.forEach(k => { kpMap[k.name] = k; });

                const nose = kpMap['nose'];
                const leftShoulder = kpMap['left_shoulder'];
                const rightShoulder = kpMap['right_shoulder'];
                const leftElbow = kpMap['left_elbow'];
                const rightElbow = kpMap['right_elbow'];
                const leftWrist = kpMap['left_wrist'];
                const rightWrist = kpMap['right_wrist'];
                const leftHip = kpMap['left_hip'];
                const rightHip = kpMap['right_hip'];
                const leftKnee = kpMap['left_knee'];
                const rightKnee = kpMap['right_knee'];
                const leftAnkle = kpMap['left_ankle'];
                const rightAnkle = kpMap['right_ankle'];

                // Centroid & adaptive scale calculation
                let centerX = 0, centerY = 0;
                let shoulderWidth = 80;

                if (leftShoulder && rightShoulder && leftShoulder.score > 0.08 && rightShoulder.score > 0.08) {
                    centerX = (leftShoulder.x + rightShoulder.x) / 2;
                    centerY = (leftShoulder.y + rightShoulder.y) / 2;
                    shoulderWidth = Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y);
                } else if (nose && nose.score > 0.08) {
                    centerX = nose.x;
                    centerY = nose.y + 45;
                } else if (p.box) {
                    centerX = p.box.xMin + p.box.width / 2;
                    centerY = p.box.yMin + p.box.height * 0.35;
                    shoulderWidth = p.box.width * 0.45;
                } else {
                    const validPts = p.keypoints.filter(k => k.score > 0.08);
                    if (validPts.length > 0) {
                        centerX = validPts.reduce((acc, k) => acc + k.x, 0) / validPts.length;
                        centerY = validPts.reduce((acc, k) => acc + k.y, 0) / validPts.length;
                    }
                }

                shoulderWidth = Math.max(shoulderWidth, 60);

                const headX = (nose && nose.score > 0.08) ? nose.x : centerX;
                const headY = (nose && nose.score > 0.08) ? nose.y : (centerY - shoulderWidth * 0.45);

                const hipY = (leftHip && rightHip && leftHip.score > 0.08 && rightHip.score > 0.08)
                    ? (leftHip.y + rightHip.y) / 2
                    : (centerY + shoulderWidth * 0.95);

                // Robust limb extrapolation: If wrist confidence drops during fast motion but elbow and shoulder are confident,
                // extrapolate hand position along the forearm vector!
                let effLeftWrist = (leftWrist && leftWrist.score > 0.03) ? leftWrist : null;
                if (!effLeftWrist && leftElbow && leftElbow.score > 0.12 && leftShoulder && leftShoulder.score > 0.12) {
                    effLeftWrist = {
                        name: 'left_wrist',
                        x: leftElbow.x + (leftElbow.x - leftShoulder.x) * 0.85,
                        y: leftElbow.y + (leftElbow.y - leftShoulder.y) * 0.85,
                        score: 0.22,
                        isExtrapolated: true
                    };
                }

                let effRightWrist = (rightWrist && rightWrist.score > 0.03) ? rightWrist : null;
                if (!effRightWrist && rightElbow && rightElbow.score > 0.12 && rightShoulder && rightShoulder.score > 0.12) {
                    effRightWrist = {
                        name: 'right_wrist',
                        x: rightElbow.x + (rightElbow.x - rightShoulder.x) * 0.85,
                        y: rightElbow.y + (rightElbow.y - rightShoulder.y) * 0.85,
                        score: 0.22,
                        isExtrapolated: true
                    };
                }

                return {
                    id: idx + 1,
                    pose: p,
                    keypoints: p.keypoints,
                    kpMap,
                    centerX,
                    centerY,
                    headX,
                    headY,
                    hipY,
                    shoulderWidth,
                    nose, leftShoulder, rightShoulder, leftElbow, rightElbow,
                    leftWrist: effLeftWrist,
                    rightWrist: effRightWrist,
                    leftHip, rightHip, leftKnee, rightKnee, leftAnkle, rightAnkle,
                    state: 'NORMAL',
                    statusLabel: 'Normal',
                    threatScore: 0,
                    strikingTargetId: null,
                    strikingLimb: null,
                    targetZone: '',
                    armedWeapon: null,
                    vLeftWrist: 0,
                    vRightWrist: 0,
                    vLeftElbow: 0,
                    vRightElbow: 0,
                    vLeftAnkle: 0,
                    vRightAnkle: 0,
                    vLeftKnee: 0,
                    vRightKnee: 0,
                    vHead: 0,
                    armExtL: 0,
                    armExtR: 0,
                    dExtL: 0,
                    dExtR: 0
                };
            });

            // 1. Temporal Motion Tracking & Kinetic Velocity Calculation (Wrists, Elbows, Head, Knees, Ankles)
            const currentTime = Date.now();
            const prevHistory = poseHistoryRef.current || [];
            const updatedHistory = [];

            personEntities.forEach(pe => {
                let bestMatch = null;
                let minCentroidDist = Infinity;

                prevHistory.forEach(prev => {
                    const dist = Math.hypot(pe.centerX - prev.centerX, pe.centerY - prev.centerY);
                    if (dist < minCentroidDist) {
                        minCentroidDist = dist;
                        bestMatch = prev;
                    }
                });

                let dt = 0.16;
                let vLW = 0, vRW = 0, vLE = 0, vRE = 0, vHead = 0;
                let vLA = 0, vRA = 0, vLK = 0, vRK = 0;
                let dExtL = 0, dExtR = 0;

                const shoulderPtL = pe.leftShoulder || { x: pe.centerX, y: pe.centerY };
                const shoulderPtR = pe.rightShoulder || { x: pe.centerX, y: pe.centerY };
                const armExtL = pe.leftWrist ? Math.hypot(pe.leftWrist.x - shoulderPtL.x, pe.leftWrist.y - shoulderPtL.y) : 0;
                const armExtR = pe.rightWrist ? Math.hypot(pe.rightWrist.x - shoulderPtR.x, pe.rightWrist.y - shoulderPtR.y) : 0;
                pe.armExtL = Math.round(armExtL);
                pe.armExtR = Math.round(armExtR);

                if (bestMatch && minCentroidDist < pe.shoulderWidth * 3.5) {
                    dt = Math.max(0.05, (currentTime - bestMatch.timestamp) / 1000);

                    // Wrists velocity (Punches)
                    if (pe.leftWrist && bestMatch.leftWrist) {
                        vLW = Math.hypot(pe.leftWrist.x - bestMatch.leftWrist.x, pe.leftWrist.y - bestMatch.leftWrist.y) / dt;
                    }
                    if (pe.rightWrist && bestMatch.rightWrist) {
                        vRW = Math.hypot(pe.rightWrist.x - bestMatch.rightWrist.x, pe.rightWrist.y - bestMatch.rightWrist.y) / dt;
                    }
                    // Elbows velocity (Forearm thrusts)
                    if (pe.leftElbow && pe.leftElbow.score > 0.08 && bestMatch.leftElbow) {
                        vLE = Math.hypot(pe.leftElbow.x - bestMatch.leftElbow.x, pe.leftElbow.y - bestMatch.leftElbow.y) / dt;
                    }
                    if (pe.rightElbow && pe.rightElbow.score > 0.08 && bestMatch.rightElbow) {
                        vRE = Math.hypot(pe.rightElbow.x - bestMatch.rightElbow.x, pe.rightElbow.y - bestMatch.rightElbow.y) / dt;
                    }
                    // Extension rate of change (Thrust acceleration)
                    if (bestMatch.armExtL !== undefined) {
                        dExtL = Math.abs(armExtL - bestMatch.armExtL) / dt;
                    }
                    if (bestMatch.armExtR !== undefined) {
                        dExtR = Math.abs(armExtR - bestMatch.armExtR) / dt;
                    }
                    // Ankles velocity (Kicks)
                    if (pe.leftAnkle && pe.leftAnkle.score > 0.08 && bestMatch.leftAnkle) {
                        vLA = Math.hypot(pe.leftAnkle.x - bestMatch.leftAnkle.x, pe.leftAnkle.y - bestMatch.leftAnkle.y) / dt;
                    }
                    if (pe.rightAnkle && pe.rightAnkle.score > 0.08 && bestMatch.rightAnkle) {
                        vRA = Math.hypot(pe.rightAnkle.x - bestMatch.rightAnkle.x, pe.rightAnkle.y - bestMatch.rightAnkle.y) / dt;
                    }
                    // Knees velocity (Knee strikes)
                    if (pe.leftKnee && pe.leftKnee.score > 0.08 && bestMatch.leftKnee) {
                        vLK = Math.hypot(pe.leftKnee.x - bestMatch.leftKnee.x, pe.leftKnee.y - bestMatch.leftKnee.y) / dt;
                    }
                    if (pe.rightKnee && pe.rightKnee.score > 0.08 && bestMatch.rightKnee) {
                        vRK = Math.hypot(pe.rightKnee.x - bestMatch.rightKnee.x, pe.rightKnee.y - bestMatch.rightKnee.y) / dt;
                    }

                    const dHeadX = pe.headX - bestMatch.headX;
                    const dHeadY = pe.headY - bestMatch.headY;
                    vHead = Math.hypot(dHeadX, dHeadY) / dt;
                }

                pe.vLeftWrist = Math.round(vLW);
                pe.vRightWrist = Math.round(vRW);
                pe.vLeftElbow = Math.round(vLE);
                pe.vRightElbow = Math.round(vRE);
                pe.dExtL = Math.round(dExtL);
                pe.dExtR = Math.round(dExtR);
                pe.vLeftAnkle = Math.round(vLA);
                pe.vRightAnkle = Math.round(vRA);
                pe.vLeftKnee = Math.round(vLK);
                pe.vRightKnee = Math.round(vRK);
                pe.vHead = Math.round(vHead);

                updatedHistory.push({
                    id: pe.id,
                    centerX: pe.centerX,
                    centerY: pe.centerY,
                    headX: pe.headX,
                    headY: pe.headY,
                    leftWrist: pe.leftWrist ? { x: pe.leftWrist.x, y: pe.leftWrist.y } : null,
                    rightWrist: pe.rightWrist ? { x: pe.rightWrist.x, y: pe.rightWrist.y } : null,
                    leftElbow: pe.leftElbow ? { x: pe.leftElbow.x, y: pe.leftElbow.y } : null,
                    rightElbow: pe.rightElbow ? { x: pe.rightElbow.x, y: pe.rightElbow.y } : null,
                    armExtL,
                    armExtR,
                    leftAnkle: pe.leftAnkle ? { x: pe.leftAnkle.x, y: pe.leftAnkle.y } : null,
                    rightAnkle: pe.rightAnkle ? { x: pe.rightAnkle.x, y: pe.rightAnkle.y } : null,
                    leftKnee: pe.leftKnee ? { x: pe.leftKnee.x, y: pe.leftKnee.y } : null,
                    rightKnee: pe.rightKnee ? { x: pe.rightKnee.x, y: pe.rightKnee.y } : null,
                    timestamp: currentTime
                });
            });

            poseHistoryRef.current = updatedHistory;

            // 2. Firearm / Gun Aiming Stance Recognition (Two-Handed Shooting Stance)
            personEntities.forEach(pe => {
                const wL = pe.leftWrist;
                const wR = pe.rightWrist;
                if (wL && wR) {
                    const wristDist = Math.hypot(wL.x - wR.x, wL.y - wR.y);
                    const shoulderL = pe.leftShoulder || { x: pe.centerX, y: pe.centerY };
                    const shoulderR = pe.rightShoulder || { x: pe.centerX, y: pe.centerY };
                    const extL = Math.hypot(wL.x - shoulderL.x, wL.y - shoulderL.y);
                    const extR = Math.hypot(wR.x - shoulderR.x, wR.y - shoulderR.y);
                    const avgExt = (extL + extR) / 2;

                    // Both hands locked together in front of body, pushed outward at chest/shoulder level
                    const isHandsTogether = wristDist < pe.shoulderWidth * 0.65;
                    const isArmsExtended = avgExt > pe.shoulderWidth * 0.45;
                    const isChestHeight = Math.abs(wL.y - pe.centerY) < pe.shoulderWidth * 0.85;

                    if (isHandsTogether && isArmsExtended && isChestHeight) {
                        pe.state = 'ARMED';
                        pe.armedWeapon = 'FIREARM / GUN AIMING';
                        pe.statusLabel = `⚠️ WEAPON: FIREARM AIMING`;
                        pe.threatScore = 0.95;
                    }
                }
            });

            // 3. Object Detection Weapon Binding with closest person
            detectedWeapons.forEach(w => {
                const [wX, wY, wW, wH] = w.bbox;
                const wCenterX = wX + wW / 2;
                const wCenterY = wY + wH / 2;

                let closestPerson = null;
                let minDist = Infinity;

                personEntities.forEach(pe => {
                    const dL = pe.leftWrist ? Math.hypot(pe.leftWrist.x - wCenterX, pe.leftWrist.y - wCenterY) : Infinity;
                    const dR = pe.rightWrist ? Math.hypot(pe.rightWrist.x - wCenterX, pe.rightWrist.y - wCenterY) : Infinity;
                    const dC = Math.hypot(pe.centerX - wCenterX, pe.centerY - wCenterY);
                    const d = Math.min(dL, dR, dC);
                    if (d < minDist) {
                        minDist = d;
                        closestPerson = pe;
                    }
                });

                if (closestPerson && minDist < closestPerson.shoulderWidth * 2.5) {
                    closestPerson.state = 'ARMED';
                    closestPerson.armedWeapon = w.class;
                    closestPerson.statusLabel = `ARMED: ${w.class.toUpperCase()}`;
                    closestPerson.threatScore = Math.max(closestPerson.threatScore, w.score, 0.92);
                }
            });

            // 4. PUNCH & PHYSICAL STRIKE DETECTION (Works for SOLO punches in front of webcam and multi-person strikes)
            personEntities.forEach(pe => {
                if (pe.state === 'ARMED') return;

                const shoulderPtL = pe.leftShoulder || { x: pe.centerX, y: pe.centerY };
                const shoulderPtR = pe.rightShoulder || { x: pe.centerX, y: pe.centerY };

                const armExtL = pe.leftWrist ? Math.hypot(pe.leftWrist.x - shoulderPtL.x, pe.leftWrist.y - shoulderPtL.y) : 0;
                const armExtR = pe.rightWrist ? Math.hypot(pe.rightWrist.x - shoulderPtR.x, pe.rightWrist.y - shoulderPtR.y) : 0;

                const distCenterL = pe.leftWrist ? Math.hypot(pe.leftWrist.x - pe.centerX, pe.leftWrist.y - pe.centerY) / pe.shoulderWidth : 0;
                const distCenterR = pe.rightWrist ? Math.hypot(pe.rightWrist.x - pe.centerX, pe.rightWrist.y - pe.centerY) / pe.shoulderWidth : 0;

                // Sensitive, robust multi-criteria punch detection:
                // 1) Outward extension thrust (> 0.40 * shoulderWidth) + elevated arm
                // 2) Kinetic velocity strike (wrist >= 20 px/s OR elbow >= 18 px/s)
                // 3) Rapid extension rate of change (thrust snap >= 14 px/s)
                // 4) Z-axis forward punch straight at camera (distCenter < 0.78 & velocity/thrust >= 16)
                // 5) High snap speed (wrist >= 30 px/s OR elbow >= 26 px/s)
                const activeLimbL = pe.leftWrist || pe.leftElbow;
                const isPunchL = activeLimbL && (
                    (pe.vLeftWrist >= 20 && armExtL > pe.shoulderWidth * 0.28) ||
                    (armExtL > pe.shoulderWidth * 0.40 && (pe.vLeftWrist >= 14 || pe.dExtL >= 12)) ||
                    (pe.vLeftElbow >= 18 && (pe.leftElbow ? pe.leftElbow.y < pe.centerY + 45 : true)) ||
                    (pe.vLeftWrist >= 30) ||
                    (pe.vLeftElbow >= 26) ||
                    (distCenterL < 0.78 && (pe.vLeftWrist >= 16 || pe.vLeftElbow >= 16 || pe.dExtL >= 14))
                );

                const activeLimbR = pe.rightWrist || pe.rightElbow;
                const isPunchR = activeLimbR && (
                    (pe.vRightWrist >= 20 && armExtR > pe.shoulderWidth * 0.28) ||
                    (armExtR > pe.shoulderWidth * 0.40 && (pe.vRightWrist >= 14 || pe.dExtR >= 12)) ||
                    (pe.vRightElbow >= 18 && (pe.rightElbow ? pe.rightElbow.y < pe.centerY + 45 : true)) ||
                    (pe.vRightWrist >= 30) ||
                    (pe.vRightElbow >= 26) ||
                    (distCenterR < 0.78 && (pe.vRightWrist >= 16 || pe.vRightElbow >= 16 || pe.dExtR >= 14))
                );

                if (isPunchL || isPunchR) {
                    const maxV = Math.max(pe.vLeftWrist, pe.vRightWrist, pe.vLeftElbow, pe.vRightElbow, 35);
                    pe.state = 'AGGRESSOR';
                    pe.statusLabel = `🥊 Punch Strike (${maxV} px/s)`;
                    pe.threatScore = Math.min(0.98, 0.86 + (maxV / 300) * 0.12);
                    pe.strikingLimb = isPunchR ? (pe.rightWrist || pe.rightElbow) : (pe.leftWrist || pe.leftElbow);
                    pe.targetZone = 'Fist';

                    const assaultData = {
                        timestamp: currentTime,
                        state: 'AGGRESSOR',
                        statusLabel: pe.statusLabel,
                        threatScore: pe.threatScore,
                        strikingLimb: pe.strikingLimb,
                        targetZone: 'Fist'
                    };
                    recentAssaultRef.current[pe.id] = assaultData;
                    lastGlobalAssaultRef.current = assaultData;
                }
            });

            // 5. KICK DETECTION (Ankle / Knee elevation + explosive kinetic velocity)
            personEntities.forEach(pe => {
                if (pe.state === 'ARMED' || pe.state === 'AGGRESSOR') return;

                const isAnkleElevatedL = pe.leftAnkle && pe.leftAnkle.score > 0.07 && (pe.leftAnkle.y < pe.hipY + 50 || Math.abs(pe.leftAnkle.x - pe.centerX) > pe.shoulderWidth * 0.85);
                const isAnkleElevatedR = pe.rightAnkle && pe.rightAnkle.score > 0.07 && (pe.rightAnkle.y < pe.hipY + 50 || Math.abs(pe.rightAnkle.x - pe.centerX) > pe.shoulderWidth * 0.85);

                const isKneeElevatedL = pe.leftKnee && pe.leftKnee.score > 0.07 && (pe.leftKnee.y < pe.hipY + 35);
                const isKneeElevatedR = pe.rightKnee && pe.rightKnee.score > 0.07 && (pe.rightKnee.y < pe.hipY + 35);

                const isKickMotionL = (isAnkleElevatedL && pe.vLeftAnkle >= 40) || (isKneeElevatedL && pe.vLeftKnee >= 35);
                const isKickMotionR = (isAnkleElevatedR && pe.vRightAnkle >= 40) || (isKneeElevatedR && pe.vRightKnee >= 35);

                if (isKickMotionL || isKickMotionR) {
                    const kickV = Math.max(pe.vLeftAnkle, pe.vRightAnkle, pe.vLeftKnee, pe.vRightKnee, 40);
                    pe.state = 'AGGRESSOR';
                    pe.statusLabel = `🥋 Kick Strike (${kickV} px/s)`;
                    pe.threatScore = Math.min(0.99, 0.88 + (kickV / 400) * 0.11);
                    pe.strikingLimb = isKickMotionR ? (pe.rightAnkle || pe.rightKnee) : (pe.leftAnkle || pe.leftKnee);
                    pe.targetZone = 'Leg';

                    const kickData = {
                        timestamp: currentTime,
                        state: 'AGGRESSOR',
                        statusLabel: pe.statusLabel,
                        threatScore: pe.threatScore,
                        strikingLimb: pe.strikingLimb,
                        targetZone: 'Leg'
                    };
                    recentAssaultRef.current[pe.id] = kickData;
                    lastGlobalAssaultRef.current = kickData;
                }
            });

            // 6. BOXING / FIGHTING GUARD STANCE RECOGNITION (Fists or forearms held up between chest & chin in defensive/combat position)
            personEntities.forEach(pe => {
                if (pe.state === 'NORMAL') {
                    const wL = pe.leftWrist;
                    const wR = pe.rightWrist;
                    const eL = pe.leftElbow;
                    const eR = pe.rightElbow;

                    const checkGuardHand = (w, e) => {
                        const limb = w || e;
                        if (!limb) return false;
                        const isElevated = limb.y < pe.centerY + 45 && limb.y > pe.headY - 80;
                        const isInFront = Math.abs(limb.x - pe.centerX) < pe.shoulderWidth * 1.45;
                        return isElevated && isInFront;
                    };

                    const isFistGuardL = checkGuardHand(wL, eL);
                    const isFistGuardR = checkGuardHand(wR, eR);

                    const areElbowsRaised = eL && eR && eL.score > 0.08 && eR.score > 0.08 &&
                        (eL.y < pe.centerY + 45 && eR.y < pe.centerY + 45) &&
                        (Math.abs(eL.x - eR.x) < pe.shoulderWidth * 1.6);

                    let guardDetected = false;
                    let label = '';
                    let score = 0.84;

                    if (isFistGuardL && isFistGuardR) {
                        guardDetected = true;
                        label = `🥊 Boxing Guard / Fighting Stance`;
                        score = 0.90;
                    } else if (isFistGuardL || isFistGuardR) {
                        guardDetected = true;
                        label = `🥊 Fighting Guard Stance`;
                        score = 0.85;
                    } else if (areElbowsRaised) {
                        guardDetected = true;
                        label = `🥊 Combat Ready Guard`;
                        score = 0.82;
                    }

                    if (guardDetected) {
                        pe.state = 'COMBAT_POSE';
                        pe.statusLabel = label;
                        pe.threatScore = score;

                        recentGuardRef.current[pe.id] = {
                            timestamp: currentTime,
                            state: 'COMBAT_POSE',
                            statusLabel: label,
                            threatScore: score
                        };
                    }
                }
            });

            // Apply Assault & Guard Memory (Assault held for 2.8s, Guard held for 1.8s so detection doesn't flicker away!)
            personEntities.forEach(pe => {
                const pastAssault = recentAssaultRef.current[pe.id] || (personEntities.length === 1 ? lastGlobalAssaultRef.current : null);
                if (pastAssault && (currentTime - pastAssault.timestamp) < 2800) {
                    pe.state = pastAssault.state;
                    pe.statusLabel = pastAssault.statusLabel;
                    pe.threatScore = Math.max(pe.threatScore, pastAssault.threatScore);
                    pe.strikingLimb = pastAssault.strikingLimb;
                    pe.targetZone = pastAssault.targetZone;
                } else if (pe.state === 'NORMAL') {
                    const pastGuard = recentGuardRef.current[pe.id];
                    if (pastGuard && (currentTime - pastGuard.timestamp) < 1800) {
                        pe.state = pastGuard.state;
                        pe.statusLabel = pastGuard.statusLabel;
                        pe.threatScore = Math.max(pe.threatScore, pastGuard.threatScore);
                    }
                }
            });

            // 7. MULTI-PERSON TARGETING & BRAWL CONFRONTATION
            const strikes = [];
            if (personEntities.length >= 2) {
                for (let i = 0; i < personEntities.length; i++) {
                    const p1 = personEntities[i];
                    for (let j = 0; j < personEntities.length; j++) {
                        if (i === j) continue;
                        const p2 = personEntities[j];

                        const distCenters = Math.hypot(p1.centerX - p2.centerX, p1.centerY - p2.centerY);
                        const avgScale = (p1.shoulderWidth + p2.shoulderWidth) / 2;

                        // Check if Person 1's wrists or elbows reach into Person 2's head/chest area
                        const checkWristStrike = (wrist) => {
                            if (!wrist) return false;
                            const dHead = Math.hypot(wrist.x - p2.headX, wrist.y - p2.headY);
                            const dChest = Math.hypot(wrist.x - p2.centerX, wrist.y - p2.centerY);
                            return dHead < p2.shoulderWidth * 0.95 || dChest < p2.shoulderWidth * 0.95;
                        };

                        const isWristStrikeL = checkWristStrike(p1.leftWrist);
                        const isWristStrikeR = checkWristStrike(p1.rightWrist);
                        const isDirectPhysicalContact = isWristStrikeL || isWristStrikeR;

                        if (distCenters < avgScale * 3.2 && (p1.state === 'AGGRESSOR' || isDirectPhysicalContact)) {
                            const limbPt = isWristStrikeR ? (p1.rightWrist || p1.strikingLimb) : (p1.leftWrist || p1.strikingLimb || { x: p1.centerX, y: p1.centerY });
                            const victimPt = { x: p2.centerX, y: p2.headY || p2.centerY };
                            
                            strikes.push({
                                attackerId: p1.id,
                                victimId: p2.id,
                                attackerLimb: limbPt,
                                victimTarget: victimPt,
                                type: p1.targetZone === 'Leg' ? 'KICK' : 'PUNCH',
                                speed: p1.statusLabel,
                                confidence: Math.max(0.92, p1.threatScore)
                            });

                            p1.state = 'AGGRESSOR';
                            p1.statusLabel = `${p1.targetZone === 'Leg' ? '🥋 KICKING' : '🥊 PUNCHING'} Person #${p2.id}`;
                            p1.strikingTargetId = p2.id;
                            p1.threatScore = Math.max(0.95, p1.threatScore);

                            if (p2.state !== 'AGGRESSOR' && p2.state !== 'ARMED') {
                                p2.state = 'VICTIM';
                                p2.statusLabel = `UNDER ATTACK by Person #${p1.id}`;
                            }
                        } else if (distCenters < avgScale * 2.4 && (p1.state === 'COMBAT_POSE' && p2.state === 'COMBAT_POSE')) {
                            // Two people in close proximity in fighting guards = Mutual Altercation / Brawl!
                            p1.state = 'AGGRESSOR';
                            p2.state = 'AGGRESSOR';
                            p1.statusLabel = `🥊 Brawling with Person #${p2.id}`;
                            p2.statusLabel = `🥊 Brawling with Person #${p1.id}`;
                            p1.threatScore = 0.95;
                            p2.threatScore = 0.95;
                            strikes.push({
                                attackerId: p1.id,
                                victimId: p2.id,
                                attackerLimb: { x: p1.centerX, y: p1.centerY },
                                victimTarget: { x: p2.centerX, y: p2.centerY },
                                type: 'BRAWL',
                                speed: 'Hostile Altercation',
                                confidence: 0.95
                            });
                        }
                    }
                }
            }

            // 8. Threat Prioritization & Primary Alert String (Direct Weapon Detection + Solo/Multi Assault)
            let primaryAlertMsg = null;
            let maxConfidence = 0;

            const armedPerson = personEntities.find(p => p.state === 'ARMED');
            const aggressor = personEntities.find(p => p.state === 'AGGRESSOR');
            const combatStance = personEntities.find(p => p.state === 'COMBAT_POSE');
            const activeStrike = strikes.length > 0 ? strikes[0] : null;

            if (detectedWeapons.length > 0) {
                const topW = detectedWeapons[0];
                const weaponName = (topW.displayClass || topW.class).toUpperCase();
                const personId = armedPerson ? ` (Person #${armedPerson.id})` : '';
                primaryAlertMsg = `ARMED THREAT: ${weaponName} DETECTED${personId}`;
                maxConfidence = Math.max(topW.score, 0.94);
            } else if (armedPerson && armedPerson.threatScore >= 0.15) {
                primaryAlertMsg = `ARMED SUSPECT: Person #${armedPerson.id} holding ${armedPerson.armedWeapon.toUpperCase()}`;
                maxConfidence = armedPerson.threatScore;
            } else if (activeStrike) {
                primaryAlertMsg = `PHYSICAL ASSAULT: Person #${activeStrike.attackerId} striking Person #${activeStrike.victimId} (${activeStrike.type})`;
                maxConfidence = activeStrike.confidence;
            } else if (aggressor) {
                primaryAlertMsg = `PHYSICAL ASSAULT DETECTED: Person #${aggressor.id} ${aggressor.statusLabel.toUpperCase()}`;
                maxConfidence = aggressor.threatScore;
            } else if (combatStance) {
                primaryAlertMsg = `COMBAT ALERT: Hostile Boxing / Fighting Guard Detected (Person #${combatStance.id})`;
                maxConfidence = combatStance.threatScore;
            }

            // Crowd & Sound threshold breaches (if not overridden by a violent threat):
           if (!primaryAlertMsg) {
               if (isSustainedNoiseBreach) {
                   primaryAlertMsg = `HIGH NOISE / AUDIO DISTRESS DETECTED (${currentSound} dB / Limit: ${soundThreshold} dB)`;
                   maxConfidence = 0.93;
               } else if (isOvercrowded) {
                   primaryAlertMsg = `CROWD GATHERING LIMIT EXCEEDED (${currentGatheringCount}/${gatheringThreshold} People)`;
                   maxConfidence = 0.95;
               }
           }

           // Canvas Drawing: Body Frames, Skeletons, Keypoints, HUD Badges & Strike Vectors for EVERY Person
           if (ctx) {
               const SKELETON_CONNECTIONS = [
                   ['nose', 'left_eye'], ['nose', 'right_eye'], ['left_eye', 'left_ear'], ['right_eye', 'right_ear'],
                   ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['right_shoulder', 'right_elbow'],
                   ['left_elbow', 'left_wrist'], ['right_elbow', 'right_wrist'], ['left_shoulder', 'left_hip'],
                   ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'], ['left_hip', 'left_knee'],
                   ['right_hip', 'right_knee'], ['left_knee', 'left_ankle'], ['right_knee', 'right_ankle']
               ];

               // 1. Draw each person's tactical bounding box frame, skeleton, and HUD badge
               personEntities.forEach(pe => {
                   let themeColor = '#06b6d4'; // Cool Cyan (Normal)
                   let glowColor = 'rgba(6, 182, 212, 0.4)';
                   let badgeBg = 'rgba(15, 23, 42, 0.88)';
                   let badgeBorder = '#06b6d4';
                   let badgeIcon = '👤';

                   if (pe.state === 'ARMED') {
                       themeColor = '#dc2626';
                       glowColor = 'rgba(220, 38, 38, 0.8)';
                       badgeBg = 'rgba(153, 27, 27, 0.95)';
                       badgeBorder = '#ef4444';
                       badgeIcon = '⚠️';
                   } else if (pe.state === 'AGGRESSOR') {
                       themeColor = '#ef4444'; // Bright Red
                       glowColor = 'rgba(239, 68, 68, 0.9)';
                       badgeBg = 'rgba(185, 28, 28, 0.95)';
                       badgeBorder = '#ff0000';
                       badgeIcon = '🥊';
                   } else if (pe.state === 'VICTIM') {
                       themeColor = '#f97316'; // Vibrant Orange
                       glowColor = 'rgba(249, 115, 22, 0.8)';
                       badgeBg = 'rgba(194, 65, 12, 0.95)';
                       badgeBorder = '#fb923c';
                       badgeIcon = '⚠️';
                   } else if (pe.state === 'COMBAT_POSE') {
                       themeColor = '#f59e0b'; // Amber Guard
                       glowColor = 'rgba(245, 158, 11, 0.7)';
                       badgeBg = 'rgba(180, 83, 9, 0.92)';
                       badgeBorder = '#f59e0b';
                       badgeIcon = '🥊';
                   }

                   // A. Calculate Tactical Bounding Box Frame (Always guarantees a valid box for EVERY person)
                   let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                   let validKpCount = 0;
                   pe.keypoints.forEach(k => {
                       if (k.score > 0.08) {
                           validKpCount++;
                           if (k.x < minX) minX = k.x;
                           if (k.y < minY) minY = k.y;
                           if (k.x > maxX) maxX = k.x;
                           if (k.y > maxY) maxY = k.y;
                       }
                   });

                   let boxX = 0, boxY = 0, boxW = 0, boxH = 0;
                   if (pe.pose.box && typeof pe.pose.box.xMin === 'number') {
                       boxX = Math.max(4, pe.pose.box.xMin);
                       boxY = Math.max(4, pe.pose.box.yMin);
                       boxW = Math.min(canvas.width - boxX - 4, pe.pose.box.width);
                       boxH = Math.min(canvas.height - boxY - 4, pe.pose.box.height);
                   } else if (validKpCount >= 2 && maxX > minX && maxY > minY) {
                       const padX = Math.max(pe.shoulderWidth * 0.32, 22);
                       const padYTop = Math.max(pe.shoulderWidth * 0.38, 26);
                       const padYBottom = Math.max(pe.shoulderWidth * 0.36, 26);

                       boxX = Math.max(4, minX - padX);
                       boxY = Math.max(4, minY - padYTop);
                       boxW = Math.min(canvas.width - boxX - 4, (maxX - minX) + padX * 2);
                       boxH = Math.min(canvas.height - boxY - 4, (maxY - minY) + padYTop + padYBottom);
                   } else {
                       const fallbackW = Math.max(pe.shoulderWidth * 2.2, 130);
                       const fallbackH = Math.max(pe.shoulderWidth * 3.6, 210);
                       boxX = Math.max(4, pe.centerX - fallbackW / 2);
                       boxY = Math.max(4, pe.headY - 20);
                       boxW = Math.min(canvas.width - boxX - 4, fallbackW);
                       boxH = Math.min(canvas.height - boxY - 4, fallbackH);
                   }

                   ctx.save();
                   ctx.strokeStyle = themeColor;
                   ctx.lineWidth = (pe.state === 'AGGRESSOR' || pe.state === 'ARMED') ? 3 : 2;
                   ctx.shadowColor = glowColor;
                   ctx.shadowBlur = (pe.state === 'AGGRESSOR' || pe.state === 'ARMED') ? 14 : 6;

                   // High-tech Tactical Corner Brackets
                   const cLen = Math.min(24, boxW / 4, boxH / 4);

                   // Top-Left
                   ctx.beginPath();
                   ctx.moveTo(boxX, boxY + cLen);
                   ctx.lineTo(boxX, boxY);
                   ctx.lineTo(boxX + cLen, boxY);
                   ctx.stroke();

                   // Top-Right
                   ctx.beginPath();
                   ctx.moveTo(boxX + boxW - cLen, boxY);
                   ctx.lineTo(boxX + boxW);
                   ctx.lineTo(boxX + boxW, boxY + cLen);
                   ctx.stroke();

                   // Bottom-Left
                   ctx.beginPath();
                   ctx.moveTo(boxX, boxY + boxH - cLen);
                   ctx.lineTo(boxX, boxY + boxH);
                   ctx.lineTo(boxX + cLen, boxY + boxH);
                   ctx.stroke();

                   // Bottom-Right
                   ctx.beginPath();
                   ctx.moveTo(boxX + boxW - cLen, boxY + boxH);
                   ctx.lineTo(boxX + boxW, boxY + boxH);
                   ctx.lineTo(boxX + boxW, boxY + boxH - cLen);
                   ctx.stroke();

                   // Subtle dashed boundary box
                   ctx.setLineDash([4, 4]);
                   ctx.strokeRect(boxX, boxY, boxW, boxH);
                   ctx.setLineDash([]);

                   // Subtle transparent body fill
                   ctx.fillStyle = (pe.state === 'AGGRESSOR' || pe.state === 'ARMED') ? 'rgba(239, 68, 68, 0.12)' : 'rgba(6, 182, 212, 0.05)';
                   ctx.fillRect(boxX, boxY, boxW, boxH);
                   ctx.restore();

                   // B. Skeleton Connections
                   ctx.save();
                   ctx.lineWidth = (pe.state === 'AGGRESSOR' || pe.state === 'ARMED' || pe.state === 'COMBAT_POSE') ? 4 : 2.5;
                   ctx.strokeStyle = themeColor;
                   ctx.shadowColor = glowColor;
                   ctx.shadowBlur = (pe.state === 'AGGRESSOR' || pe.state === 'ARMED' || pe.state === 'COMBAT_POSE') ? 10 : 4;

                   SKELETON_CONNECTIONS.forEach(([p1Name, p2Name]) => {
                       const pt1 = pe.kpMap[p1Name];
                       const pt2 = pe.kpMap[p2Name];
                       if (pt1 && pt2 && pt1.score > 0.10 && pt2.score > 0.10) {
                           ctx.beginPath();
                           ctx.moveTo(pt1.x, pt1.y);
                           ctx.lineTo(pt2.x, pt2.y);
                           ctx.stroke();
                       }
                   });

                   // C. Keypoints (Fists and Feet highlighted in red during strikes)
                   pe.keypoints.forEach(k => {
                       if (k.score > 0.10) {
                           const isFist = (k.name === 'left_wrist' || k.name === 'right_wrist');
                           const isFoot = (k.name === 'left_ankle' || k.name === 'right_ankle');
                           ctx.beginPath();
                           ctx.arc(k.x, k.y, ((isFist || isFoot) && pe.state === 'AGGRESSOR') ? 7 : 4.5, 0, 2 * Math.PI);
                           ctx.fillStyle = (pe.state === 'AGGRESSOR' && (isFist || isFoot)) ? '#ff0000' : themeColor;
                           ctx.fill();
                           ctx.strokeStyle = '#ffffff';
                           ctx.lineWidth = 1.5;
                           ctx.stroke();
                       }
                   });
                   ctx.restore();

                   // D. HUD Nameplate above head / above box
                   ctx.save();
                   ctx.font = 'bold 12px sans-serif';
                   const fullBadgeText = `${badgeIcon} Person #${pe.id} • ${pe.statusLabel}`;
                   const textWidth = ctx.measureText(fullBadgeText).width;
                   const badgeW = textWidth + 18;
                   const badgeH = 24;
                   const badgeX = Math.max(10, Math.min(pe.headX - badgeW / 2, canvas.width - badgeW - 10));
                   const badgeY = boxY > 32 ? (boxY - 26) : Math.max(10, pe.headY - 34);

                   ctx.fillStyle = badgeBg;
                   ctx.strokeStyle = badgeBorder;
                   ctx.lineWidth = 1.5;
                   ctx.beginPath();
                   if (ctx.roundRect) {
                       ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
                   } else {
                       ctx.rect(badgeX, badgeY, badgeW, badgeH);
                   }
                   ctx.fill();
                   ctx.stroke();

                   ctx.fillStyle = '#ffffff';
                   ctx.fillText(fullBadgeText, badgeX + 9, badgeY + 16);
                   ctx.restore();

                   // E. Kinetic Velocity Speed Indicators
                   const maxWristV = Math.max(pe.vLeftWrist, pe.vRightWrist);
                   if (maxWristV >= 90) {
                       const activeW = pe.vLeftWrist > pe.vRightWrist ? pe.leftWrist : pe.rightWrist;
                       if (activeW && activeW.score > 0.10) {
                           ctx.save();
                           ctx.font = 'bold 11px monospace';
                           const vTxt = `⚡ Fist: ${maxWristV} px/s`;
                           const vW = ctx.measureText(vTxt).width + 10;
                           ctx.fillStyle = 'rgba(239, 68, 68, 0.92)';
                           ctx.fillRect(activeW.x + 8, activeW.y - 12, vW, 18);
                           ctx.fillStyle = '#ffffff';
                           ctx.fillText(vTxt, activeW.x + 12, activeW.y + 1);
                           ctx.restore();
                       }
                   }

                   const maxLegV = Math.max(pe.vLeftAnkle, pe.vRightAnkle, pe.vLeftKnee, pe.vRightKnee);
                   if (maxLegV >= 90) {
                       const activeLeg = (pe.vRightAnkle > pe.vLeftAnkle || pe.vRightKnee > pe.vLeftKnee) ? (pe.rightAnkle || pe.rightKnee) : (pe.leftAnkle || pe.leftKnee);
                       if (activeLeg && activeLeg.score > 0.10) {
                           ctx.save();
                           ctx.font = 'bold 11px monospace';
                           const legTxt = `⚡ Leg: ${maxLegV} px/s`;
                           const legW = ctx.measureText(legTxt).width + 10;
                           ctx.fillStyle = 'rgba(239, 68, 68, 0.92)';
                           ctx.fillRect(activeLeg.x + 8, activeLeg.y - 12, legW, 18);
                           ctx.fillStyle = '#ffffff';
                           ctx.fillText(legTxt, activeLeg.x + 12, activeLeg.y + 1);
                           ctx.restore();
                       }
                   }

                   // Solo Strike Highlight Reticle
                   if (pe.state === 'AGGRESSOR' && personEntities.length === 1 && pe.strikingLimb) {
                       ctx.save();
                       ctx.beginPath();
                       ctx.arc(pe.strikingLimb.x, pe.strikingLimb.y, 22, 0, 2 * Math.PI);
                       ctx.strokeStyle = '#ef4444';
                       ctx.lineWidth = 3;
                       ctx.setLineDash([4, 4]);
                       ctx.stroke();
                       ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
                       ctx.fill();
                       ctx.restore();
                   }
               });

               // 2. Draw Strike Action Vectors between Attacker and Victim (Multi-person combat)
               strikes.forEach(s => {
                   const limb = s.attackerLimb || s.attackerWrist;
                   if (limb && s.victimTarget) {
                       ctx.save();
                       ctx.setLineDash([6, 4]);
                       ctx.strokeStyle = '#ef4444';
                       ctx.lineWidth = 3.5;
                       ctx.shadowColor = '#ff0000';
                       ctx.shadowBlur = 12;

                       ctx.beginPath();
                       ctx.moveTo(limb.x, limb.y);
                       ctx.lineTo(s.victimTarget.x, s.victimTarget.y);
                       ctx.stroke();

                       // Impact circle on victim
                       ctx.beginPath();
                       ctx.arc(s.victimTarget.x, s.victimTarget.y, 16, 0, 2 * Math.PI);
                       ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
                       ctx.fill();
                       ctx.strokeStyle = '#ff0000';
                       ctx.lineWidth = 2.5;
                       ctx.stroke();

                       // Midpoint strike badge
                       const midX = (limb.x + s.victimTarget.x) / 2;
                       const midY = (limb.y + s.victimTarget.y) / 2;

                       ctx.setLineDash([]);
                       ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
                       ctx.strokeStyle = '#ef4444';
                       ctx.lineWidth = 1.5;
                       const strikeLabel = `💥 ${s.type} STRIKE (${Math.round(s.confidence * 100)}%) • ${s.speed}`;
                       ctx.font = 'bold 11px sans-serif';
                       const strkW = ctx.measureText(strikeLabel).width + 14;

                       ctx.beginPath();
                       if (ctx.roundRect) ctx.roundRect(midX - strkW / 2, midY - 12, strkW, 24, 4);
                       else ctx.rect(midX - strkW / 2, midY - 12, strkW, 24);
                       ctx.fill();
                       ctx.stroke();

                       ctx.fillStyle = '#ff4444';
                       ctx.fillText(strikeLabel, midX - strkW / 2 + 7, midY + 4);
                       ctx.restore();
                   }
               });

               // 3. Top Active Incident Banner on Canvas
               if (primaryAlertMsg) {
                   ctx.save();
                   const bannerText = `🚨 THREAT DETECTED: ${primaryAlertMsg.toUpperCase()}`;
                   ctx.font = 'bold 13px sans-serif';
                   const bW = ctx.measureText(bannerText).width + 24;
                   const bH = 28;
                   const bX = (canvas.width - bW) / 2;
                   const bY = 12;

                   ctx.fillStyle = 'rgba(185, 28, 28, 0.94)';
                   ctx.strokeStyle = '#ef4444';
                   ctx.lineWidth = 2;
                   ctx.shadowColor = '#ff0000';
                   ctx.shadowBlur = 12;

                   ctx.beginPath();
                   if (ctx.roundRect) ctx.roundRect(bX, bY, bW, bH, 6);
                   else ctx.rect(bX, bY, bW, bH);
                   ctx.fill();
                   ctx.stroke();

                   ctx.fillStyle = '#ffffff';
                   ctx.fillText(bannerText, bX + 12, bY + 19);
                   ctx.restore();
               } else {
                   // Tactical Scanning Matrix indicator
                   ctx.save();
                   const scanText = `🟢 AI THREAT ENGINE: ACTIVE • ${personEntities.length} PERSON(S) TRACKED`;
                   ctx.font = 'bold 11px monospace';
                   const sW = ctx.measureText(scanText).width + 16;
                   ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
                   ctx.strokeStyle = '#06b6d4';
                   ctx.lineWidth = 1;
                   ctx.beginPath();
                   if (ctx.roundRect) ctx.roundRect(10, 10, sW, 22, 4);
                   else ctx.rect(10, 10, sW, 22);
                   ctx.fill();
                   ctx.stroke();
                   ctx.fillStyle = '#38bdf8';
                   ctx.fillText(scanText, 18, 25);
                   ctx.restore();
               }

               // 4. Live Gathering Count & Noise Level HUD on Canvas
               ctx.save();
               ctx.font = 'bold 11px sans-serif';
               const gHudText = `👥 GATHERING: ${currentGatheringCount}/${gatheringThreshold}`;
               const gHudW = ctx.measureText(gHudText).width + 16;
               const hudH = 22;
               const hudX = canvas.width - gHudW - 10;
               const gHudY = 10;

               ctx.fillStyle = isOvercrowded ? 'rgba(185, 28, 28, 0.9)' : 'rgba(15, 23, 42, 0.88)';
               ctx.strokeStyle = isOvercrowded ? '#ef4444' : 'rgba(56, 189, 248, 0.4)';
               ctx.lineWidth = 1.2;
               ctx.beginPath();
               if (ctx.roundRect) ctx.roundRect(hudX, gHudY, gHudW, hudH, 4);
               else ctx.rect(hudX, gHudY, gHudW, hudH);
               ctx.fill();
               ctx.stroke();
               ctx.fillStyle = '#ffffff';
               ctx.fillText(gHudText, hudX + 8, gHudY + 15);

               const soundHudText = `🔊 NOISE: ${currentSound} dB`;
               const sHudW = ctx.measureText(soundHudText).width + 16;
               const sHudX = canvas.width - sHudW - 10;
               const sHudY = gHudY + hudH + 6;

               ctx.fillStyle = isNoiseOverLimit ? 'rgba(194, 65, 12, 0.9)' : 'rgba(15, 23, 42, 0.88)';
               ctx.strokeStyle = isNoiseOverLimit ? '#ea580c' : 'rgba(234, 179, 8, 0.4)';
               ctx.lineWidth = 1.2;
               ctx.beginPath();
               if (ctx.roundRect) ctx.roundRect(sHudX, sHudY, sHudW, hudH, 4);
               else ctx.rect(sHudX, sHudY, sHudW, hudH);
               ctx.fill();
               ctx.stroke();
               ctx.fillStyle = '#ffffff';
               ctx.fillText(soundHudText, sHudX + 8, sHudY + 15);
               ctx.restore();
           }

           // Real-time Multi-Device Live Stream Relay Broadcast (emits current composited frame to Socket.IO)
           if (socketRef.current && activeCam && isProcessingRef.current) {
               window.lastRelayBroadcast = window.lastRelayBroadcast || 0;
               if (Date.now() - window.lastRelayBroadcast > 180) {
                   window.lastRelayBroadcast = Date.now();
                   const liveSnapshot = captureScreenshot();
                   if (liveSnapshot) {
                       socketRef.current.emit('broadcast_camera_frame', {
                           camera_id: activeCam.camera_id,
                           frame: liveSnapshot,
                           gathering_count: currentGatheringCount,
                           sound_level: currentSound,
                           threat: primaryAlertMsg,
                           area: activeCam.area || 'Command Station'
                       });
                   }
               }
           }

           // Trigger real alert to police dashboard & play sound (executed AFTER canvas rendering so screenshot has all labels, bodies, and skeletons!)
           const isViolentThreat = aggressor || armedPerson || activeStrike || combatStance;
           if (primaryAlertMsg) {
               window.activeThreatStreak = (window.activeThreatStreak || 0) + 1;
               if (isViolentThreat || window.activeThreatStreak >= 2) {
                   triggerRealAlert(primaryAlertMsg, maxConfidence);
               }
           } else {
               window.activeThreatStreak = 0;
           }
        }
     }, 125); // Scan at 125ms (~8 FPS) for ultra-responsive strike & combat detection
     } catch (e) {
         console.error("AI Initialization Error:", e);
         setIsProcessing(false);
     }
  };

  const stopVideoProcessing = () => {
    isProcessingRef.current = false;
    if (aiIntervalRef.current) clearInterval(aiIntervalRef.current);
    poseHistoryRef.current = [];
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
                          Gathering: {liveGatheringCounts[cam.camera_id] !== undefined ? liveGatheringCounts[cam.camera_id] : (cam.stream_url === 'LOCAL_WEBCAM' ? (isProcessing ? 0 : 'Idle') : '1')} / Limit: {cam.gathering_threshold || 5}
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
                          (isLocalBroadcaster || !relayFeeds[cam.camera_id]?.frame) ? (
                            <>
                              <LocalWebcam ref={laptopVideoRef} onAudioLevel={handleAudioLevel} />
                              <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0, zIndex: 3, pointerEvents: 'none' }} />
                            </>
                          ) : (
                            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                              <img 
                                src={relayFeeds[cam.camera_id].frame} 
                                alt="Live Relay Stream" 
                                style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'relative', zIndex: 2 }} 
                              />
                              <div style={{ 
                                position: 'absolute', bottom: 8, left: 8, zIndex: 10,
                                background: 'rgba(16, 185, 129, 0.95)', color: '#fff',
                                fontSize: '0.72rem', fontWeight: 'bold', padding: '3px 8px',
                                borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px',
                                boxShadow: '0 0 10px rgba(16, 185, 129, 0.6)'
                              }}>
                                <span>📡 LIVE SATELLITE RELAY • SYNCED ACROSS DEVICES</span>
                              </div>
                            </div>
                          )
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
