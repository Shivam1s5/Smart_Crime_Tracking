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

  return <video ref={ref} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain', position: 'relative', zIndex: 2 }} />;
});

export default function PoliceDashboard() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
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
  const aiIntervalRef = useRef(null);

  useEffect(() => {
    // Pre-load AI models for instant responsiveness
    const loadModels = async () => {
      try {
        await tf.ready();
        const loadedObject = await cocossd.load();
        setModel(loadedObject);
        const detectorConfig = {
          modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
          enableSmoothing: true,
          minPoseScore: 0.15
        };
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

  const handleAudioLevel = useCallback((db) => {
    const activeCam = cameras.find(c => c.stream_url === 'LOCAL_WEBCAM');
    const camId = activeCam ? activeCam.camera_id : 'LOCAL_WEBCAM';
    currentSoundLevelRef.current = db;
    setLiveSoundLevels(prev => {
      if (prev[camId] && Math.abs(prev[camId] - db) < 2) return prev;
      return { ...prev, [camId]: db };
    });
  }, [cameras]);

  // Ambient sound fluctuation for external/remote streams
  useEffect(() => {
    const timer = setInterval(() => {
      setLiveSoundLevels(prev => {
        let changed = false;
        const next = { ...prev };
        cameras.forEach(cam => {
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
  }, [cameras]);

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
        sound_threshold: Math.max(30, Math.min(120, parseInt(newCameraData.sound_threshold, 10) || 75))
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
      const gathering_threshold = Math.max(1, parseInt(editGatheringThresholdValue, 10));
      const sound_threshold = Math.max(30, Math.min(120, parseInt(editSoundThresholdValue, 10)));
      await axios.put(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/cameras/${editingCamera.camera_id}`, {
        gathering_threshold,
        sound_threshold
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setCameras(cameras.map(c => c.camera_id === editingCamera.camera_id ? { ...c, gathering_threshold, sound_threshold } : c));
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
           const detectedWeapons = [];

           for (let p of predictions) {
               if (dangerousObjects.includes(p.class) && p.score >= 0.55) {
                   detectedWeapons.push(p);
                   if (ctx) {
                       ctx.save();
                       ctx.strokeStyle = '#ef4444';
                       ctx.lineWidth = 3;
                       ctx.shadowColor = '#ef4444';
                       ctx.shadowBlur = 10;
                       ctx.strokeRect(...p.bbox);

                       ctx.fillStyle = 'rgba(239, 68, 68, 0.88)';
                       const labelY = p.bbox[1] > 26 ? p.bbox[1] - 24 : p.bbox[1];
                       ctx.fillRect(p.bbox[0], labelY, Math.max(p.bbox[2], 150), 22);

                       ctx.fillStyle = '#ffffff';
                       ctx.font = 'bold 12px sans-serif';
                       ctx.fillText(`⚠️ WEAPON: ${p.class.toUpperCase()} (${Math.round(p.score * 100)}%)`, p.bbox[0] + 6, labelY + 16);
                       ctx.restore();
                   }
               }
           }
           
           // B. Multi-Person Pose Detection & Combat / Assault Analysis
           const poses = await poseModel.estimatePoses(video, {
               maxPoses: 6,
               flipHorizontal: false
           });
           
           // Filter all valid persons detected in the frame (score threshold 0.18 ensures all subjects get skeleton tracking)
           const validPoses = (poses || []).filter(p => {
               if (!p.keypoints) return false;
               const highConfPoints = p.keypoints.filter(k => k.score > 0.18);
               return (p.score && p.score > 0.15) || highConfPoints.length >= 3;
           });

           // C. Live Crowd / Gathering Count & Threshold Breach Check
           const detectedPersons = predictions.filter(p => p.class === 'person' && p.score >= 0.35);
           const currentGatheringCount = Math.max(validPoses.length, detectedPersons.length);

           const activeCam = cameras.find(c => c.stream_url === 'LOCAL_WEBCAM');
           const gatheringThreshold = (activeCam && activeCam.gathering_threshold) ? activeCam.gathering_threshold : 5;
           const soundThreshold = (activeCam && activeCam.sound_threshold) ? activeCam.sound_threshold : 75;

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

           // Exceeding limit for sustained time period (>= 1.5s) triggers alert
           const sustainedNoiseDuration = highNoiseStartRef.current ? (Date.now() - highNoiseStartRef.current) : 0;
           const isSustainedNoiseBreach = isNoiseOverLimit && sustainedNoiseDuration >= 1500;

           // Sort persons Left-to-Right for stable Person 1, Person 2... labeling
           validPoses.sort((a, b) => {
               const getX = (pose) => {
                   if (pose.box && typeof pose.box.xMin === 'number') return pose.box.xMin;
                   const nose = pose.keypoints.find(k => k.name === 'nose');
                   if (nose && nose.score > 0.2) return nose.x;
                   const shoulder = pose.keypoints.find(k => k.name === 'left_shoulder' || k.name === 'right_shoulder');
                   if (shoulder && shoulder.score > 0.2) return shoulder.x;
                   const first = pose.keypoints.find(k => k.score > 0.2);
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

               // Centroid & adaptive scale calculation
               let centerX = 0, centerY = 0;
               let shoulderWidth = 75;

               if (leftShoulder && rightShoulder && leftShoulder.score > 0.25 && rightShoulder.score > 0.25) {
                   centerX = (leftShoulder.x + rightShoulder.x) / 2;
                   centerY = (leftShoulder.y + rightShoulder.y) / 2;
                   shoulderWidth = Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y);
               } else if (nose && nose.score > 0.25) {
                   centerX = nose.x;
                   centerY = nose.y + 45;
               } else {
                   const validPts = p.keypoints.filter(k => k.score > 0.25);
                   if (validPts.length > 0) {
                       centerX = validPts.reduce((acc, k) => acc + k.x, 0) / validPts.length;
                       centerY = validPts.reduce((acc, k) => acc + k.y, 0) / validPts.length;
                   }
               }

               const headX = (nose && nose.score > 0.25) ? nose.x : centerX;
               const headY = (nose && nose.score > 0.25) ? nose.y : (centerY - shoulderWidth * 0.45);

               return {
                   id: idx + 1,
                   pose: p,
                   keypoints: p.keypoints,
                   kpMap,
                   centerX,
                   centerY,
                   headX,
                   headY,
                   shoulderWidth: Math.max(shoulderWidth, 60),
                   nose, leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist,
                   state: 'NORMAL',
                   statusLabel: 'Normal',
                   threatScore: 0,
                   strikingTargetId: null,
                   strikingWrist: null,
                   targetZone: '',
                   armedWeapon: null
               };
           });

           // Associate detected weapons with the closest person (high confidence only)
           detectedWeapons.forEach(w => {
               const [wX, wY, wW, wH] = w.bbox;
               const wCenterX = wX + wW / 2;
               const wCenterY = wY + wH / 2;

               let closestPerson = null;
               let minDist = Infinity;

               personEntities.forEach(pe => {
                   const dL = pe.leftWrist && pe.leftWrist.score > 0.3 ? Math.hypot(pe.leftWrist.x - wCenterX, pe.leftWrist.y - wCenterY) : Infinity;
                   const dR = pe.rightWrist && pe.rightWrist.score > 0.3 ? Math.hypot(pe.rightWrist.x - wCenterX, pe.rightWrist.y - wCenterY) : Infinity;
                   const dC = Math.hypot(pe.centerX - wCenterX, pe.centerY - wCenterY);
                   const d = Math.min(dL, dR, dC);
                   if (d < minDist) {
                       minDist = d;
                       closestPerson = pe;
                   }
               });

               if (closestPerson && minDist < closestPerson.shoulderWidth * 1.8 && w.score >= 0.55) {
                   closestPerson.state = 'ARMED';
                   closestPerson.armedWeapon = w.class;
                   closestPerson.statusLabel = `ARMED: ${w.class.toUpperCase()}`;
                   closestPerson.threatScore = w.score;
               }
           });

           // 1. Detect Dancing / Celebration / Peaceful Gestures to eliminate false alarms
           personEntities.forEach(pe => {
               if (pe.state !== 'ARMED') {
                   const noseY = (pe.nose && pe.nose.score > 0.20) ? pe.nose.y : (pe.centerY - pe.shoulderWidth * 0.4);
                   const leftWrist = pe.leftWrist;
                   const rightWrist = pe.rightWrist;

                   // Both hands high in the air above head level (classic dancing, waving, celebration)
                   const leftHigh = leftWrist && leftWrist.score > 0.25 && leftWrist.y < noseY - 15;
                   const rightHigh = rightWrist && rightWrist.score > 0.25 && rightWrist.y < noseY - 15;

                   // Arms wide swaying overhead
                   const armSpan = (leftWrist && rightWrist && leftWrist.score > 0.25 && rightWrist.score > 0.25)
                       ? Math.abs(leftWrist.x - rightWrist.x) : 0;
                   const wideArms = (leftHigh || rightHigh) && armSpan > pe.shoulderWidth * 1.25;

                   // Single hand waving or pointing high overhead with no defensive or combat guard
                   const singleHighWave = (leftHigh && (!rightWrist || rightWrist.y > pe.centerY)) ||
                                          (rightHigh && (!leftWrist || leftWrist.y > pe.centerY));

                   if ((leftHigh && rightHigh) || wideArms || singleHighWave) {
                       pe.state = 'DANCING';
                       pe.statusLabel = 'Dancing / Celebrating';
                       pe.threatScore = 0;
                   }
               }
           });

           // 2. Detect Defensive Guard / Covering Face (e.g., person covering face or guarding head)
           personEntities.forEach(pe => {
               if (pe.state === 'NORMAL') {
                   const checkCovering = (w) => w && w.score > 0.22 && Math.hypot(w.x - pe.headX, w.y - pe.headY) < pe.shoulderWidth * 0.75;
                   if (checkCovering(pe.leftWrist) || checkCovering(pe.rightWrist)) {
                       pe.state = 'DEFENDING';
                       pe.statusLabel = 'Defending / Guarding';
                       pe.threatScore = 0;
                   }
               }
           });

           // 3. Analyze Physical Strikes: Attacker extending fist into Target's head/torso
           const strikes = [];

           for (let i = 0; i < personEntities.length; i++) {
               const p1 = personEntities[i];
               for (let j = 0; j < personEntities.length; j++) {
                   if (i === j) continue;
                   const p2 = personEntities[j];

                   // If either is clearly dancing/celebrating, do not classify as strike
                   if (p1.state === 'DANCING' || p2.state === 'DANCING') continue;

                   const avgScale = (p1.shoulderWidth + p2.shoulderWidth) / 2;

                   const evaluateWristStrike = (wrist, shoulder) => {
                       if (!wrist || wrist.score < 0.32) return null;

                       // Self-touch check: closer to own body than target
                       const distToOwnHead = Math.hypot(wrist.x - p1.headX, wrist.y - p1.headY);
                       const distToTargetHead = Math.hypot(wrist.x - p2.headX, wrist.y - p2.headY);
                       const distToOwnTorso = Math.hypot(wrist.x - p1.centerX, wrist.y - p1.centerY);
                       const distToTargetTorso = Math.hypot(wrist.x - p2.centerX, wrist.y - p2.centerY);

                       if (distToOwnHead < distToTargetHead && distToOwnTorso < distToTargetTorso) {
                           return null; // Touching own face/chest
                       }

                       // Strike height: Upper body level
                       const isAtHitHeight = wrist.y >= (p2.headY - 35) && wrist.y <= (p2.centerY + 65);
                       if (!isAtHitHeight) return null;

                       // Arm extension outward towards target
                       const shoulderPt = shoulder || { x: p1.centerX, y: p1.centerY };
                       const armExtension = Math.hypot(wrist.x - shoulderPt.x, wrist.y - shoulderPt.y);
                       if (armExtension < p1.shoulderWidth * 0.50) return null;

                       // Proximity to victim's vital points
                       const strikeThreshold = Math.max(avgScale * 0.90, 75);

                       if (distToTargetHead < strikeThreshold || distToTargetTorso < strikeThreshold) {
                           return {
                               targetZone: distToTargetHead <= distToTargetTorso ? 'Head' : 'Torso',
                               wrist,
                               confidence: Math.max(wrist.score, 0.78)
                           };
                       }
                       return null;
                   };

                   const hit = evaluateWristStrike(p1.leftWrist, p1.leftShoulder) || 
                               evaluateWristStrike(p1.rightWrist, p1.rightShoulder);

                   if (hit) {
                       strikes.push({
                           attackerId: p1.id,
                           victimId: p2.id,
                           attackerWrist: hit.wrist,
                           victimTarget: hit.targetZone === 'Head' ? { x: p2.headX, y: p2.headY } : { x: p2.centerX, y: p2.centerY },
                           targetZone: hit.targetZone,
                           confidence: hit.confidence
                       });

                       p1.state = 'AGGRESSOR';
                       p1.statusLabel = `STRIKING Person #${p2.id} (${hit.targetZone})`;
                       p1.strikingTargetId = p2.id;
                       p1.strikingWrist = hit.wrist;
                       p1.targetZone = hit.targetZone;
                       p1.threatScore = Math.max(p1.threatScore, hit.confidence);

                       if (p2.state !== 'AGGRESSOR' && p2.state !== 'ARMED') {
                           p2.state = 'VICTIM';
                           p2.statusLabel = `UNDER ATTACK by Person #${p1.id}`;
                       }
                   }
               }
           }

           // 4. Fighting Pose & Combat Stance Detection (Directly addressing user feedback!)
           personEntities.forEach(pe => {
               if (pe.state === 'NORMAL' || pe.state === 'DEFENDING') {
                   const noseY = (pe.nose && pe.nose.score > 0.20) ? pe.nose.y : (pe.centerY - pe.shoulderWidth * 0.4);
                   const leftWrist = pe.leftWrist;
                   const rightWrist = pe.rightWrist;

                   // A wrist is at chin/chest height (classic guard/punch position between chin and chest)
                   const isGuardHeight = (w) => w && w.score > 0.25 && w.y >= (noseY - 15) && w.y <= (pe.centerY + pe.shoulderWidth * 0.55);

                   // Check both arms
                   const leftInGuard = isGuardHeight(leftWrist);
                   const rightInGuard = isGuardHeight(rightWrist);

                   // Fists / hands raised in combat ready position
                   // In boxing/street fight: both hands up in guard, OR one hand extended as punch/jab and other at chin
                   const bothHandsUp = leftInGuard && rightInGuard;
                   const oneHandLeadPunch = (leftInGuard && (!rightWrist || rightWrist.score < 0.25)) ||
                                            (rightInGuard && (!leftWrist || leftWrist.score < 0.25));

                   if (bothHandsUp || oneHandLeadPunch) {
                       // Check if another person is present in interactive combat range (< 3.6 * shoulderWidth)
                       const nearbyOther = personEntities.find(other => other.id !== pe.id && 
                           Math.hypot(pe.centerX - other.centerX, pe.centerY - other.centerY) < Math.max(pe.shoulderWidth, other.shoulderWidth) * 3.6);

                       if (nearbyOther) {
                           pe.state = 'COMBAT_POSE';
                           pe.statusLabel = `🥊 Combat Stance (vs Person #${nearbyOther.id})`;
                           pe.threatScore = 0.85; // High priority threat!
                       } else {
                           pe.state = 'COMBAT_POSE';
                           pe.statusLabel = '🥊 Fighting Posture / Guard';
                           pe.threatScore = 0.78; // Threat detected!
                       }
                   }
               }
           });

           // 5. Mutual Brawl Detection (Multiple subjects aggressively engaging)
           const brawls = [];
           for (let i = 0; i < personEntities.length; i++) {
               for (let j = i + 1; j < personEntities.length; j++) {
                   const p1 = personEntities[i];
                   const p2 = personEntities[j];

                   if (p1.state === 'DANCING' || p2.state === 'DANCING') continue;

                   const distCenters = Math.hypot(p1.centerX - p2.centerX, p1.centerY - p2.centerY);
                   const avgScale = (p1.shoulderWidth + p2.shoulderWidth) / 2;

                   if ((p1.strikingTargetId === p2.id && p2.strikingTargetId === p1.id) ||
                       (distCenters < avgScale * 2.2 && p1.state === 'COMBAT_POSE' && (p2.state === 'COMBAT_POSE' || p2.state === 'DEFENDING'))) {
                       p1.state = 'BRAWL';
                       p2.state = 'BRAWL';
                       p1.statusLabel = `BRAWLING with Person #${p2.id}`;
                       p2.statusLabel = `BRAWLING with Person #${p1.id}`;
                       p1.threatScore = Math.max(p1.threatScore, 0.90);
                       p2.threatScore = Math.max(p2.threatScore, 0.90);
                       brawls.push({ p1: p1.id, p2: p2.id });
                   }
               }
           }

           // 6. Real-time Threat Prioritization & Alert Dispatch
           let primaryAlertMsg = null;
           let maxConfidence = 0;

           const armedPerson = personEntities.find(p => p.state === 'ARMED');
           const brawlIncident = brawls.length > 0;
           const combatPerson = personEntities.find(p => p.state === 'COMBAT_POSE');

           if (armedPerson && armedPerson.threatScore >= 0.55) {
               primaryAlertMsg = `Weapon Detected: Person #${armedPerson.id} holding ${armedPerson.armedWeapon}`;
               maxConfidence = armedPerson.threatScore;
           } else if (strikes.length > 0) {
               const s = strikes[0];
               primaryAlertMsg = `Assault: Person #${s.attackerId} striking Person #${s.victimId} (${s.targetZone})`;
               maxConfidence = s.confidence;
           } else if (brawlIncident) {
               primaryAlertMsg = `Physical Brawl: Altercation between multiple subjects`;
               maxConfidence = 0.90;
           } else if (combatPerson && combatPerson.threatScore >= 0.75) {
               primaryAlertMsg = `Hostile Threat: ${combatPerson.statusLabel}`;
               maxConfidence = combatPerson.threatScore;
           } else if (isSustainedNoiseBreach) {
               primaryAlertMsg = `HIGH NOISE / AUDIO DISTRESS DETECTED (${currentSound} dB / Limit: ${soundThreshold} dB)`;
               maxConfidence = 0.93;
           } else if (isOvercrowded) {
               primaryAlertMsg = `CROWD GATHERING LIMIT EXCEEDED (${currentGatheringCount}/${gatheringThreshold} People)`;
               maxConfidence = 0.95;
           }

           // Streak confirmation filter (2 cycles = ~0.4s) to eliminate momentary noise
           if (primaryAlertMsg) {
               window.activeThreatStreak = (window.activeThreatStreak || 0) + 1;
           } else {
               window.activeThreatStreak = 0;
           }

           // Trigger real alert to police dashboard & play sound
           if (primaryAlertMsg && window.activeThreatStreak >= 2) {
               triggerRealAlert(primaryAlertMsg, maxConfidence);
           }

           // Canvas Drawing: Skeletons, Keypoints, HUD Badges & Strike Vectors for EVERY Person
           if (ctx) {
               const SKELETON_CONNECTIONS = [
                   ['nose', 'left_eye'], ['nose', 'right_eye'], ['left_eye', 'left_ear'], ['right_eye', 'right_ear'],
                   ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['right_shoulder', 'right_elbow'],
                   ['left_elbow', 'left_wrist'], ['right_elbow', 'right_wrist'], ['left_shoulder', 'left_hip'],
                   ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'], ['left_hip', 'left_knee'],
                   ['right_hip', 'right_knee'], ['left_knee', 'left_ankle'], ['right_knee', 'right_ankle']
               ];

               // 1. Draw each person's skeleton and status badge
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
                       badgeIcon = '🔪';
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
                   } else if (pe.state === 'BRAWL') {
                       themeColor = '#e11d48';
                       glowColor = 'rgba(225, 29, 72, 0.9)';
                       badgeBg = 'rgba(159, 18, 57, 0.95)';
                       badgeBorder = '#f43f5e';
                       badgeIcon = '⚔️';
                   } else if (pe.state === 'COMBAT_POSE') {
                       themeColor = '#f97316'; // Vibrant Combat Orange
                       glowColor = 'rgba(249, 115, 22, 0.7)';
                       badgeBg = 'rgba(194, 65, 12, 0.92)';
                       badgeBorder = '#f97316';
                       badgeIcon = '🥊';
                   } else if (pe.state === 'DEFENDING') {
                       themeColor = '#f59e0b'; // Amber Guard
                       glowColor = 'rgba(245, 158, 11, 0.5)';
                       badgeBg = 'rgba(180, 83, 9, 0.9)';
                       badgeBorder = '#fbbf24';
                       badgeIcon = '🛡️';
                   } else if (pe.state === 'DANCING') {
                       themeColor = '#06b6d4';
                       glowColor = 'rgba(6, 182, 212, 0.4)';
                       badgeBg = 'rgba(15, 23, 42, 0.88)';
                       badgeBorder = '#06b6d4';
                       badgeIcon = '🎵';
                   }

                   // Skeleton Lines (drawn for all subjects with score > 0.18)
                   ctx.save();
                   ctx.lineWidth = (pe.state === 'AGGRESSOR' || pe.state === 'ARMED' || pe.state === 'BRAWL' || pe.state === 'COMBAT_POSE') ? 4 : 2.5;
                   ctx.strokeStyle = themeColor;
                   ctx.shadowColor = glowColor;
                   ctx.shadowBlur = (pe.state === 'AGGRESSOR' || pe.state === 'ARMED' || pe.state === 'COMBAT_POSE') ? 10 : 4;

                   SKELETON_CONNECTIONS.forEach(([p1Name, p2Name]) => {
                       const pt1 = pe.kpMap[p1Name];
                       const pt2 = pe.kpMap[p2Name];
                       if (pt1 && pt2 && pt1.score > 0.18 && pt2.score > 0.18) {
                           ctx.beginPath();
                           ctx.moveTo(pt1.x, pt1.y);
                           ctx.lineTo(pt2.x, pt2.y);
                           ctx.stroke();
                       }
                   });

                   // Keypoints
                   pe.keypoints.forEach(k => {
                       if (k.score > 0.18) {
                           const isFist = (k.name === 'left_wrist' || k.name === 'right_wrist');
                           ctx.beginPath();
                           ctx.arc(k.x, k.y, (isFist && (pe.state === 'AGGRESSOR' || pe.state === 'COMBAT_POSE')) ? 7 : 4.5, 0, 2 * Math.PI);
                           ctx.fillStyle = ((pe.state === 'AGGRESSOR' || pe.state === 'COMBAT_POSE') && isFist) ? '#ff0000' : themeColor;
                           ctx.fill();
                           ctx.strokeStyle = '#ffffff';
                           ctx.lineWidth = 1.5;
                           ctx.stroke();
                       }
                   });
                   ctx.restore();

                   // HUD Nameplate above head
                   ctx.save();
                   ctx.font = 'bold 12px sans-serif';
                   const fullBadgeText = `${badgeIcon} Person #${pe.id} • ${pe.statusLabel}`;
                   const textWidth = ctx.measureText(fullBadgeText).width;
                   const badgeW = textWidth + 18;
                   const badgeH = 24;
                   const badgeX = Math.max(10, Math.min(pe.headX - badgeW / 2, canvas.width - badgeW - 10));
                   const badgeY = Math.max(10, pe.headY - 34);

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
               });

               // 2. Draw Strike Action Vectors between Attacker and Victim
               strikes.forEach(s => {
                   if (s.attackerWrist && s.victimTarget) {
                       ctx.save();
                       ctx.setLineDash([6, 4]);
                       ctx.strokeStyle = '#ef4444';
                       ctx.lineWidth = 3.5;
                       ctx.shadowColor = '#ff0000';
                       ctx.shadowBlur = 10;

                       ctx.beginPath();
                       ctx.moveTo(s.attackerWrist.x, s.attackerWrist.y);
                       ctx.lineTo(s.victimTarget.x, s.victimTarget.y);
                       ctx.stroke();

                       // Impact circle on victim
                       ctx.beginPath();
                       ctx.arc(s.victimTarget.x, s.victimTarget.y, 14, 0, 2 * Math.PI);
                       ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
                       ctx.fill();
                       ctx.strokeStyle = '#ff0000';
                       ctx.lineWidth = 2;
                       ctx.stroke();

                       // Midpoint strike badge
                       const midX = (s.attackerWrist.x + s.victimTarget.x) / 2;
                       const midY = (s.attackerWrist.y + s.victimTarget.y) / 2;

                       ctx.setLineDash([]);
                       ctx.fillStyle = 'rgba(0, 0, 0, 0.88)';
                       ctx.strokeStyle = '#ef4444';
                       ctx.lineWidth = 1.5;
                       const strikeLabel = `💥 STRIKE (${Math.round(s.confidence * 100)}%)`;
                       ctx.font = 'bold 11px sans-serif';
                       const strkW = ctx.measureText(strikeLabel).width + 12;

                       ctx.beginPath();
                       if (ctx.roundRect) ctx.roundRect(midX - strkW / 2, midY - 10, strkW, 20, 4);
                       else ctx.rect(midX - strkW / 2, midY - 10, strkW, 20);
                       ctx.fill();
                       ctx.stroke();

                       ctx.fillStyle = '#ff4444';
                       ctx.fillText(strikeLabel, midX - strkW / 2 + 6, midY + 4);
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

                   ctx.fillStyle = 'rgba(185, 28, 28, 0.92)';
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
               }

               // 4. Live Gathering Count & Noise Level HUD on Canvas
               ctx.save();
               ctx.font = 'bold 12px sans-serif';

               // Box 1: Gathering Count
               const hudText = isOvercrowded
                   ? `⚠️ OVERCROWDED: ${currentGatheringCount} PERSONS (SAFE LIMIT: ${gatheringThreshold})`
                   : `👥 GATHERING: ${currentGatheringCount} / ${gatheringThreshold} PERSONS (NORMAL)`;
               const hudW = ctx.measureText(hudText).width + 20;
               const hudH = 26;
               const hudX = 12;
               const hudY = 12;

               ctx.fillStyle = isOvercrowded ? 'rgba(220, 38, 38, 0.95)' : 'rgba(15, 23, 42, 0.88)';
               ctx.strokeStyle = isOvercrowded ? '#ef4444' : '#06b6d4';
               ctx.lineWidth = 1.5;
               if (isOvercrowded) {
                   ctx.shadowColor = '#ef4444';
                   ctx.shadowBlur = 10;
               }
               ctx.beginPath();
               if (ctx.roundRect) ctx.roundRect(hudX, hudY, hudW, hudH, 6);
               else ctx.rect(hudX, hudY, hudW, hudH);
               ctx.fill();
               ctx.stroke();

               ctx.fillStyle = '#ffffff';
               ctx.fillText(hudText, hudX + 10, hudY + 17);

               // Box 2: Acoustic Noise Level
               const soundHudText = isNoiseOverLimit
                   ? (isSustainedNoiseBreach
                       ? `🚨 NOISE DISTRESS: ${currentSound} dB (LIMIT: ${soundThreshold} dB)`
                       : `⚠️ HIGH NOISE: ${currentSound} dB [${(sustainedNoiseDuration / 1000).toFixed(1)}s / 1.5s]`)
                   : `🔊 SOUND: ${currentSound} dB / ${soundThreshold} dB (NORMAL)`;
               const sHudW = ctx.measureText(soundHudText).width + 20;
               const sHudY = hudY + hudH + 6;

               ctx.fillStyle = isNoiseOverLimit ? 'rgba(234, 88, 12, 0.95)' : 'rgba(15, 23, 42, 0.88)';
               ctx.strokeStyle = isNoiseOverLimit ? '#ea580c' : 'rgba(234, 179, 8, 0.6)';
               ctx.lineWidth = 1.5;
               if (isNoiseOverLimit) {
                   ctx.shadowColor = '#ea580c';
                   ctx.shadowBlur = 10;
               }
               ctx.beginPath();
               if (ctx.roundRect) ctx.roundRect(hudX, sHudY, sHudW, hudH, 6);
               else ctx.rect(hudX, sHudY, sHudW, hudH);
               ctx.fill();
               ctx.stroke();

               ctx.fillStyle = '#ffffff';
               ctx.fillText(soundHudText, hudX + 10, sHudY + 17);
               ctx.restore();
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
                <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem', color: '#cbd5e1' }}>
                  <span>👥 Maximum Gathering Limit</span>
                  <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>{editGatheringThresholdValue} Persons</span>
                </label>
                <input 
                  type="range" 
                  min="1" 
                  max="50" 
                  value={editGatheringThresholdValue} 
                  onChange={(e) => setEditGatheringThresholdValue(e.target.value)} 
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                  <span>1 Person</span>
                  <span>25 Persons</span>
                  <span>50 Persons</span>
                </div>
              </div>

              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem', color: '#cbd5e1' }}>
                  <span>🔊 Noise / Sound Limit</span>
                  <span style={{ color: '#eab308', fontWeight: 'bold' }}>{editSoundThresholdValue} dB</span>
                </label>
                <input 
                  type="range" 
                  min="30" 
                  max="110" 
                  value={editSoundThresholdValue} 
                  onChange={(e) => setEditSoundThresholdValue(e.target.value)} 
                  style={{ width: '100%', accentColor: '#eab308' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#64748b', marginTop: '2px' }}>
                  <span>45 dB (Quiet)</span>
                  <span>75 dB (Street/Default)</span>
                  <span>95 dB (High Distress)</span>
                </div>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                  Automatic alert triggers if noise stays above {editSoundThresholdValue} dB for more than 1.5 seconds.
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
                  type="number" min="1" max="50" className="input-glass" required
                  value={newCameraData.gathering_threshold} onChange={e => setNewCameraData({...newCameraData, gathering_threshold: e.target.value})}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Automatic alert will trigger if gathering exceeds this threshold.</span>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Sound / Noise Limit (dB)</label>
                <input 
                  type="number" min="30" max="110" className="input-glass" required
                  value={newCameraData.sound_threshold} onChange={e => setNewCameraData({...newCameraData, sound_threshold: e.target.value})}
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Default 75 dB. Alerts if sustained over 1.5 seconds.</span>
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
                          <>
                            <LocalWebcam ref={laptopVideoRef} onAudioLevel={handleAudioLevel} />
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
