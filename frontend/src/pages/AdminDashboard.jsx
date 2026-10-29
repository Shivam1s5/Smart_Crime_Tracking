import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  ShieldCheck, 
  LogOut, 
  Video, 
  Users, 
  AlertTriangle, 
  Plus, 
  Trash2, 
  Edit3, 
  Eye, 
  X, 
  CheckCircle2, 
  Activity, 
  SlidersHorizontal,
  Maximize2,
  Camera,
  Volume2
} from 'lucide-react';

export default function AdminDashboard() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const [cameras, setCameras] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [liveFeeds, setLiveFeeds] = useState({});
  const [viewMode, setViewMode] = useState('WALL'); // 'WALL' | 'TABLE'
  const [selectedFeedCam, setSelectedFeedCam] = useState(null);

  // Modals & Forms
  const [showAddModal, setShowAddModal] = useState(false);
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [selectedCameraForThreshold, setSelectedCameraForThreshold] = useState(null);
  const [newGatheringThresholdValue, setNewGatheringThresholdValue] = useState(5);
  const [newSoundThresholdValue, setNewSoundThresholdValue] = useState(75);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);

  // New Camera Form
  const [newCam, setNewCam] = useState({
    name: '',
    area: '',
    stream_url: '',
    gathering_threshold: 5,
    sound_threshold: 75
  });

  // Filter for alerts
  const [alertFilter, setAlertFilter] = useState('ALL');

  const API_BASE = import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com';

  useEffect(() => {
    fetchInitialData();

    // Socket.io for live updates
    const socket = io(API_BASE);
    socket.on('red_alert', (data) => {
      setAlerts((prev) => [data, ...prev]);
    });
    socket.on('camera_updated', (updatedCam) => {
      setCameras((prev) => prev.map(c => c.camera_id === updatedCam.camera_id ? updatedCam : c));
    });



    return () => socket.disconnect();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [camsRes, alertsRes, usersRes] = await Promise.all([
        axios.get(`${API_BASE}/api/cameras`, { headers }),
        axios.get(`${API_BASE}/api/alerts`, { headers }),
        axios.get(`${API_BASE}/api/users`, { headers }).catch(() => ({ data: [] }))
      ]);

      setCameras(camsRes.data || []);
      setAlerts(alertsRes.data || []);
      setUsersList(usersRes.data || []);


    } catch (err) {
      console.error("Failed to load admin data:", err);
    }
    setLoading(false);
  };

  const handleAddCamera = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('token');
      const payload = {
        name: newCam.name,
        area: newCam.area,
        stream_url: newCam.stream_url,
        gathering_threshold: parseInt(newCam.gathering_threshold, 10) || 5,
        sound_threshold: parseInt(newCam.sound_threshold, 10) || 75
      };

      const res = await axios.post(`${API_BASE}/api/cameras`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data && res.data.camera) {
        setCameras([...cameras, res.data.camera]);
      } else {
        fetchInitialData();
      }

      setShowAddModal(false);
      setNewCam({ name: '', area: '', stream_url: '', gathering_threshold: 5, sound_threshold: 75 });
    } catch (err) {
      console.error("Error creating camera:", err);
      alert("Failed to create camera. Please check logs.");
    }
  };

  const handleDeleteCamera = async (cameraId) => {
    if (!window.confirm(`Are you sure you want to delete camera: ${cameraId}?`)) return;
    try {
      setCameras(prev => prev.filter(c => c.camera_id !== cameraId && c._id !== cameraId));
      if (cameraId !== 'CAM-LAPTOP' && cameraId !== 'CAM-LAPTOP-LOCAL' && cameraId !== 'default_local_cam') {
        const token = localStorage.getItem('token');
        try {
          await axios.delete(`${API_BASE}/api/cameras/${cameraId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
        } catch (apiErr) {
          console.warn("Camera deletion backend notice:", apiErr);
        }
      }
    } catch (err) {
      console.error("Error deleting camera:", err);
    }
  };

  const handleOpenThresholdModal = (cam) => {
    setSelectedCameraForThreshold(cam);
    setNewGatheringThresholdValue(cam.gathering_threshold || 5);
    setNewSoundThresholdValue(cam.sound_threshold || 75);
    setShowThresholdModal(true);
  };

  const handleSaveThreshold = async (e) => {
    e.preventDefault();
    if (!selectedCameraForThreshold) return;
    try {
      const token = localStorage.getItem('token');
      const gathering_threshold = Math.max(1, parseInt(newGatheringThresholdValue, 10) || 5);
      const sound_threshold = Math.max(1, parseInt(newSoundThresholdValue, 10) || 75);

      await axios.put(`${API_BASE}/api/cameras/${selectedCameraForThreshold.camera_id}`, {
        gathering_threshold,
        sound_threshold
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setCameras(cameras.map(c => 
        c.camera_id === selectedCameraForThreshold.camera_id 
          ? { ...c, gathering_threshold, sound_threshold } 
          : c
      ));

      setShowThresholdModal(false);
      setSelectedCameraForThreshold(null);
    } catch (err) {
      console.error("Error updating threshold:", err);
      alert("Failed to update threshold.");
    }
  };

  const handleDeleteAlert = async (alertId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE}/api/alerts/${alertId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAlerts(alerts.filter(a => a._id !== alertId));
    } catch (err) {
      console.error("Error deleting alert:", err);
    }
  };

  // Metrics
  const totalCameras = cameras.length;
  const totalAlerts = alerts.length;
  const crowdAlertsCount = alerts.filter(a => a.type && a.type.toUpperCase().includes('GATHERING')).length;
  const noiseAlertsCount = alerts.filter(a => a.type && (a.type.toUpperCase().includes('NOISE') || a.type.toUpperCase().includes('AUDIO'))).length;
  const threatAlertsCount = alerts.filter(a => {
    const t = (a.type || '').toUpperCase();
    return !t.includes('GATHERING') && !t.includes('NOISE') && !t.includes('AUDIO');
  }).length;
  const totalOperators = usersList.length;

  const filteredAlerts = alerts.filter(a => {
    const t = (a.type || '').toUpperCase();
    if (alertFilter === 'ALL') return true;
    if (alertFilter === 'CROWD') return t.includes('GATHERING');
    if (alertFilter === 'NOISE') return t.includes('NOISE') || t.includes('AUDIO');
    if (alertFilter === 'THREATS') return !t.includes('GATHERING') && !t.includes('NOISE') && !t.includes('AUDIO');
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', padding: '20px', gap: '20px', background: '#090d16', color: '#f8fafc' }}>
      
      {/* Evidence Fullscreen Modal */}
      {selectedScreenshot && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.92)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000
        }}>
          <div style={{ position: 'relative', maxWidth: '85%', maxHeight: '85%' }}>
            <button onClick={() => setSelectedScreenshot(null)} style={{ position: 'absolute', top: -38, right: 0, background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
              <X size={32} />
            </button>
            <img src={selectedScreenshot} alt="Threat Evidence" style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '8px', border: '2px solid #ef4444' }} />
          </div>
        </div>
      )}

      {/* Fullscreen Live Camera Monitor Modal */}
      {selectedFeedCam && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.94)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10000,
          backdropFilter: 'blur(8px)'
        }}>
          <div style={{ position: 'relative', width: '90%', maxWidth: '1000px', background: '#090d16', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.4)', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ background: '#10b981', color: '#090d16', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>LIVE</span>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>{selectedFeedCam.name} ({selectedFeedCam.area})</h3>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{selectedFeedCam.camera_id}</span>
              </div>
              <button onClick={() => setSelectedFeedCam(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
                <X size={26} />
              </button>
            </div>
            
            <div style={{ width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: '8px', overflow: 'hidden', position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              {liveFeeds[selectedFeedCam.camera_id]?.frame ? (
                <img src={liveFeeds[selectedFeedCam.camera_id].frame} alt="Live Stream" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : selectedFeedCam.stream_url && selectedFeedCam.stream_url.includes('youtube.com') ? (
                <iframe src={selectedFeedCam.stream_url} frameBorder="0" allow="autoplay; encrypted-media" style={{ width: '100%', height: '100%' }}></iframe>
              ) : selectedFeedCam.stream_url && selectedFeedCam.stream_url !== 'LOCAL_WEBCAM' ? (
                <img src={selectedFeedCam.stream_url} alt="Live Stream" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <div style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                  <Activity size={32} color="#38bdf8" style={{ marginBottom: '8px' }} />
                  <div>Tactical Camera Node Standby</div>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Waiting for operator stream relay to broadcast</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
              <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem' }}>
                <span style={{ color: '#38bdf8' }}>👥 Gathering Limit: <strong>{selectedFeedCam.gathering_threshold || 5} Persons</strong></span>
                <span style={{ color: '#eab308' }}>🔊 Sound Threshold: <strong>{selectedFeedCam.sound_threshold || 75} dB</strong></span>
              </div>
              <button 
                onClick={() => { setSelectedFeedCam(null); handleOpenThresholdModal(selectedFeedCam); }}
                className="btn-primary" 
                style={{ padding: '6px 14px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <SlidersHorizontal size={14} /> Adjust Thresholds
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Gathering & Sound Threshold Modal */}
      {showThresholdModal && selectedCameraForThreshold && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div className="glass-panel" style={{ padding: '32px', width: '420px', background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SlidersHorizontal size={20} color="var(--accent)" /> Configure Camera Limits
              </h3>
              <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowThresholdModal(false)} />
            </div>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              Configure gathering and sound safety thresholds for <strong>{selectedCameraForThreshold.name}</strong> ({selectedCameraForThreshold.area}).
            </p>
            <form onSubmit={handleSaveThreshold} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.88rem', color: '#cbd5e1' }}>
                  <span style={{ fontWeight: 600 }}>👥 Gathering Limit</span>
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
                    value={newGatheringThresholdValue} 
                    onChange={(e) => setNewGatheringThresholdValue(e.target.value)} 
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
                      onClick={() => setNewGatheringThresholdValue(val)}
                      style={{
                        background: Number(newGatheringThresholdValue) === val ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${Number(newGatheringThresholdValue) === val ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
                        color: Number(newGatheringThresholdValue) === val ? 'var(--accent)' : '#94a3b8',
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
                    onClick={() => setNewGatheringThresholdValue(prev => Math.max(1, (parseInt(prev, 10) || 0) + 5))}
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
                  <span style={{ fontWeight: 600 }}>🔊 Sound / Noise Limit</span>
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
                    value={newSoundThresholdValue} 
                    onChange={(e) => setNewSoundThresholdValue(e.target.value)} 
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
                      onClick={() => setNewSoundThresholdValue(p.val)}
                      style={{
                        background: Number(newSoundThresholdValue) === p.val ? 'rgba(234, 179, 8, 0.25)' : 'rgba(255,255,255,0.06)',
                        border: `1px solid ${Number(newSoundThresholdValue) === p.val ? '#eab308' : 'rgba(255,255,255,0.1)'}`,
                        color: Number(newSoundThresholdValue) === p.val ? '#eab308' : '#94a3b8',
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
                    onClick={() => setNewSoundThresholdValue(prev => Math.max(1, (parseInt(prev, 10) || 0) + 5))}
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    +5 dB
                  </button>
                </div>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'block', marginTop: '4px' }}>
                  Alert triggers automatically if noise exceeds this limit for &gt; 1.5s.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '10px' }}>
                  Save & Apply Limits
                </button>
                <button type="button" onClick={() => setShowThresholdModal(false)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '6px', padding: '10px 16px', cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Camera Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div className="glass-panel" style={{ padding: '32px', width: '420px', background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Camera size={20} color="var(--accent)" /> Deploy New Camera Feed
              </h3>
              <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowAddModal(false)} />
            </div>
            <form onSubmit={handleAddCamera} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#cbd5e1' }}>Camera Label / Name</label>
                <input 
                  type="text" 
                  className="input-glass" 
                  placeholder="e.g. Metro Station Gate 3" 
                  value={newCam.name} 
                  onChange={(e) => setNewCam({ ...newCam, name: e.target.value })} 
                  required 
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#cbd5e1' }}>Zone / Area</label>
                <input 
                  type="text" 
                  className="input-glass" 
                  placeholder="e.g. Central Sector 18" 
                  value={newCam.area} 
                  onChange={(e) => setNewCam({ ...newCam, area: e.target.value })} 
                  required 
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#cbd5e1' }}>Live Stream URL (MJPEG / RTSP / Video)</label>
                <input 
                  type="url" 
                  className="input-glass" 
                  placeholder="http://192.168.1.100:8080/video" 
                  value={newCam.stream_url} 
                  onChange={(e) => setNewCam({ ...newCam, stream_url: e.target.value })} 
                  required 
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#cbd5e1' }}>Max Gathering Limit (Persons)</label>
                <input 
                  type="number" 
                  min="1" 
                  className="input-glass" 
                  placeholder="e.g. 5, 25, 100 (Operator Defined)"
                  value={newCam.gathering_threshold} 
                  onChange={(e) => setNewCam({ ...newCam, gathering_threshold: e.target.value })} 
                  required 
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Alert fires when person count surpasses this operator limit.</span>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#cbd5e1' }}>Sound / Noise Limit (dB)</label>
                <input 
                  type="number" 
                  min="1" 
                  className="input-glass" 
                  placeholder="e.g. 75, 85, 110 (Operator Defined)"
                  value={newCam.sound_threshold} 
                  onChange={(e) => setNewCam({ ...newCam, sound_threshold: e.target.value })} 
                  required 
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Custom limit in dB. Alerts if sustained over 1.5 seconds.</span>
              </div>
              <button type="submit" className="btn-primary" style={{ marginTop: '8px', padding: '12px' }}>
                Deploy Camera
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Top Header Navbar */}
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderRadius: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ background: 'rgba(56, 189, 248, 0.15)', padding: '10px', borderRadius: '10px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
            <ShieldCheck color="#38bdf8" size={28} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 600, letterSpacing: '-0.02em' }}>
              Administrator Command Portal
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span style={{ background: '#38bdf8', color: '#090d16', fontSize: '0.75rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '4px' }}>
                ADMIN ROLE
              </span>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                System-wide surveillance oversight & gathering limit management
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            onClick={() => navigate('/dashboard')}
            className="btn-primary" 
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)', padding: '8px 16px', fontSize: '0.9rem' }}
          >
            <Video size={16} color="var(--accent)" /> Switch to Tactical Police Feed
          </button>
          
          <button 
            onClick={logout} 
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px' }}
          >
            <LogOut size={18} /> Logout
          </button>
        </div>
      </div>

      {/* Metric KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '20px', borderRadius: '10px', borderLeft: '4px solid #38bdf8' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Active Camera Fleet</span>
            <Video size={18} color="#38bdf8" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '8px', color: '#fff' }}>
            {totalCameras}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
            <Activity size={13} /> Feeds streaming continuously
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '20px', borderRadius: '10px', borderLeft: '4px solid #f59e0b' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Gathering Limit Alerts</span>
            <Users size={18} color="#f59e0b" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '8px', color: '#f59e0b' }}>
            {crowdAlertsCount}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
            Overcrowding breaches
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '20px', borderRadius: '10px', borderLeft: '4px solid #eab308' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Noise Threshold Alerts</span>
            <Volume2 size={18} color="#eab308" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '8px', color: '#eab308' }}>
            {noiseAlertsCount}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
            Audio distress breaches
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '20px', borderRadius: '10px', borderLeft: '4px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Combat & Weapon Threats</span>
            <AlertTriangle size={18} color="#ef4444" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '8px', color: '#ef4444' }}>
            {threatAlertsCount}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
            AI Pose & Weapon detections
          </span>
        </div>

        <div className="glass-panel" style={{ padding: '20px', borderRadius: '10px', borderLeft: '4px solid #8b5cf6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Authorized Personnel</span>
            <Users size={18} color="#8b5cf6" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '8px', color: '#fff' }}>
            {totalOperators}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
            Police Operators & Admins
          </span>
        </div>
      </div>

      {/* Main 2-Column Administrative Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', gap: '20px', flex: 1 }}>
        
        {/* Left Column: Camera Fleet & Live Gathering Threshold Management */}
        <div className="glass-panel" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Video size={20} color="var(--accent)" /> Real-Time Surveillance & Safety Grid
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Live multi-camera fleet stream feeds with real-time crowd and acoustic monitoring.
              </p>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* View Mode Toggle */}
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', padding: '3px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                <button
                  type="button"
                  onClick={() => setViewMode('WALL')}
                  style={{
                    background: viewMode === 'WALL' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'WALL' ? '#090d16' : '#cbd5e1',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '5px 12px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Video size={14} /> Video Wall Grid
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('TABLE')}
                  style={{
                    background: viewMode === 'TABLE' ? 'var(--accent)' : 'transparent',
                    color: viewMode === 'TABLE' ? '#090d16' : '#cbd5e1',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '5px 12px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <SlidersHorizontal size={14} /> Fleet Table
                </button>
              </div>

              <button 
                className="btn-primary" 
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '0.88rem' }}
                onClick={() => setShowAddModal(true)}
              >
                <Plus size={16} /> Deploy Camera
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {cameras.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                No cameras currently configured. Click "Deploy Camera" to add.
              </div>
            ) : viewMode === 'WALL' ? (
              /* REAL-TIME CCTV VIDEO WALL GRID FOR ALL CAMERAS */
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {cameras.map((cam) => {
                  const feed = liveFeeds[cam.camera_id];
                  const isRelaying = feed && feed.frame;
                  const isExternalStream = cam.stream_url && cam.stream_url !== 'LOCAL_WEBCAM';
                  const liveGathering = feed?.gathering_count !== undefined ? feed.gathering_count : 0;
                  const liveSound = feed?.sound_level !== undefined ? feed.sound_level : 42;
                  const isGatheringBreached = liveGathering > (cam.gathering_threshold || 5);
                  const isSoundBreached = liveSound > (cam.sound_threshold || 75);

                  return (
                    <div 
                      key={cam._id || cam.camera_id} 
                      style={{
                        background: 'rgba(15, 23, 42, 0.85)',
                        border: isGatheringBreached || isSoundBreached ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: isGatheringBreached || isSoundBreached ? '0 0 14px rgba(239, 68, 68, 0.35)' : 'none',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {/* Video Feed Monitor Display */}
                      <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', overflow: 'hidden' }}>
                        {/* Top Bar on Live Monitor */}
                        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, display: 'flex', gap: '6px' }}>
                          {isRelaying ? (
                            <span style={{ 
                              background: '#10b981', color: '#090d16', fontSize: '0.68rem', fontWeight: 'bold', 
                              padding: '2px 8px', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '5px',
                              boxShadow: '0 0 8px rgba(16, 185, 129, 0.8)'
                            }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#090d16' }}></span>
                              LIVE STREAM
                            </span>
                          ) : isExternalStream ? (
                            <span style={{ background: '#38bdf8', color: '#090d16', fontSize: '0.68rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '4px' }}>
                              ACTIVE FEED
                            </span>
                          ) : (
                            <span style={{ background: 'rgba(71, 85, 105, 0.85)', color: '#fff', fontSize: '0.68rem', padding: '2px 8px', borderRadius: '4px' }}>
                              STANDBY / READY
                            </span>
                          )}
                        </div>

                        {/* Top Right Quick Controls */}
                        <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: '6px' }}>
                          <button 
                            onClick={() => setSelectedFeedCam(cam)}
                            style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '4px', borderRadius: '4px', cursor: 'pointer' }}
                            title="Fullscreen Surveillance Monitor"
                          >
                            <Maximize2 size={13} />
                          </button>
                          <button 
                            onClick={() => handleOpenThresholdModal(cam)}
                            style={{ background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)', color: '#38bdf8', padding: '4px', borderRadius: '4px', cursor: 'pointer' }}
                            title="Configure Safety Limits"
                          >
                            <SlidersHorizontal size={13} />
                          </button>
                          <button 
                            onClick={() => handleDeleteCamera(cam.camera_id)}
                            style={{ background: 'rgba(239, 68, 68, 0.85)', border: 'none', color: '#fff', padding: '4px', borderRadius: '4px', cursor: 'pointer' }}
                            title="Delete Camera"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        {/* Live Feed Video Element */}
                        {isRelaying ? (
                          <img src={feed.frame} alt="Live Stream" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : cam.stream_url && cam.stream_url.includes('youtube.com') ? (
                          <iframe src={cam.stream_url} frameBorder="0" allow="autoplay; encrypted-media" style={{ width: '100%', height: '100%' }}></iframe>
                        ) : cam.stream_url && cam.stream_url !== 'LOCAL_WEBCAM' ? (
                          <img src={cam.stream_url} alt="Live Stream" style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: '0.78rem' }}>
                            <Camera size={26} color="#38bdf8" style={{ marginBottom: '6px', opacity: 0.7 }} />
                            <span>Operator Camera Node</span>
                            <span style={{ fontSize: '0.68rem', color: '#475569' }}>Real-time relay starts when operator is live</span>
                          </div>
                        )}
                      </div>

                      {/* Card Info & Live Metrics Footer */}
                      <div style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <div>
                            <h4 style={{ margin: 0, fontSize: '0.92rem', color: '#f8fafc', fontWeight: 600 }}>{cam.name}</h4>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{cam.area} • {cam.camera_id}</span>
                          </div>
                        </div>

                        {/* Live Safety Limit Meters */}
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <div style={{
                            flex: 1, minWidth: '100px',
                            background: isGatheringBreached ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.1)',
                            border: isGatheringBreached ? '1px solid #ef4444' : '1px solid rgba(56, 189, 248, 0.25)',
                            borderRadius: '6px', padding: '6px 8px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: isGatheringBreached ? '#ef4444' : '#38bdf8', fontWeight: 'bold' }}>
                              <span>👥 Crowd</span>
                              <span>{liveGathering} / {cam.gathering_threshold || 5}</span>
                            </div>
                          </div>

                          <div style={{
                            flex: 1, minWidth: '100px',
                            background: isSoundBreached ? 'rgba(239, 68, 68, 0.2)' : 'rgba(234, 179, 8, 0.1)',
                            border: isSoundBreached ? '1px solid #ef4444' : '1px solid rgba(234, 179, 8, 0.25)',
                            borderRadius: '6px', padding: '6px 8px'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: isSoundBreached ? '#ef4444' : '#eab308', fontWeight: 'bold' }}>
                              <span>🔊 Sound</span>
                              <span>{liveSound} dB / {cam.sound_threshold || 75} dB</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* FLEET TABLE VIEW */
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                    <th style={{ padding: '10px 8px' }}>Camera</th>
                    <th style={{ padding: '10px 8px' }}>Zone</th>
                    <th style={{ padding: '10px 8px' }}>Safety Limits (Crowd & Sound)</th>
                    <th style={{ padding: '10px 8px' }}>Status</th>
                    <th style={{ padding: '10px 8px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cameras.map((cam) => (
                    <tr key={cam._id || cam.camera_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ fontWeight: 600, color: '#f8fafc' }}>{cam.name}</div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>{cam.camera_id}</div>
                      </td>
                      <td style={{ padding: '12px 8px', color: '#cbd5e1' }}>
                        {cam.area}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ 
                            background: 'rgba(56, 189, 248, 0.15)', 
                            color: '#38bdf8', 
                            padding: '4px 8px', 
                            borderRadius: '12px', 
                            fontWeight: 'bold',
                            border: '1px solid rgba(56, 189, 248, 0.3)',
                            fontSize: '0.8rem'
                          }}>
                            👥 {cam.gathering_threshold || 5} Persons
                          </span>
                          <span style={{ 
                            background: 'rgba(234, 179, 8, 0.15)', 
                            color: '#eab308', 
                            padding: '4px 8px', 
                            borderRadius: '12px', 
                            fontWeight: 'bold',
                            border: '1px solid rgba(234, 179, 8, 0.3)',
                            fontSize: '0.8rem'
                          }}>
                            🔊 {cam.sound_threshold || 75} dB
                          </span>
                          <button 
                            onClick={() => handleOpenThresholdModal(cam)}
                            style={{ 
                              background: 'transparent', 
                              border: 'none', 
                              color: 'var(--accent)', 
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center'
                            }}
                            title="Configure Safety Limits"
                          >
                            <Edit3 size={15} />
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <span style={{ 
                          background: 'rgba(16, 185, 129, 0.15)', 
                          color: '#10b981', 
                          padding: '3px 8px', 
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 500
                        }}>
                          ● Active
                        </span>
                      </td>
                      <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                        <button 
                          onClick={() => handleDeleteCamera(cam.camera_id)}
                          style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#ef4444', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer' }}
                          title="Remove Camera"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Registered Security Personnel Directory */}
          <div style={{ marginTop: '24px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={18} color="#8b5cf6" /> System Users & Active Operators ({usersList.length})
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
              {usersList.map((u, i) => (
                <div key={u._id || i} style={{ background: 'rgba(255,255,255,0.04)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{u.username}</div>
                    <div style={{ fontSize: '0.74rem', color: u.role === 'Admin' ? '#38bdf8' : '#10b981' }}>
                      {u.role === 'Admin' ? 'Administrator' : 'Police Operator'}
                    </div>
                  </div>
                  <CheckCircle2 size={16} color="var(--success)" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Alerts & Incident Audit Feed */}
        <div className="glass-panel" style={{ padding: '24px', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444' }}>
              <AlertTriangle size={20} /> Threat & Incident Audit Log
            </h3>
            <span style={{ fontSize: '0.8rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '2px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
              {filteredAlerts.length} Recorded
            </span>
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {['ALL', 'CROWD', 'NOISE', 'THREATS'].map(filter => (
              <button
                key={filter}
                onClick={() => setAlertFilter(filter)}
                style={{
                  background: alertFilter === filter ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                  color: alertFilter === filter ? '#090d16' : '#94a3b8',
                  border: 'none',
                  padding: '5px 12px',
                  borderRadius: '14px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {filter === 'ALL' ? 'All Incidents' : filter === 'CROWD' ? 'Overcrowding' : filter === 'NOISE' ? 'High Noise' : 'Weapons & Combat'}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredAlerts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                No recorded threats in this category.
              </div>
            ) : (
              filteredAlerts.map((alert, i) => {
                const isCrowd = alert.type && alert.type.toUpperCase().includes('GATHERING');
                const isNoise = alert.type && (alert.type.toUpperCase().includes('NOISE') || alert.type.toUpperCase().includes('AUDIO'));
                const alertColor = isCrowd ? '#f59e0b' : isNoise ? '#eab308' : '#ef4444';
                const alertBg = isCrowd ? 'rgba(245, 158, 11, 0.08)' : isNoise ? 'rgba(234, 179, 8, 0.08)' : 'rgba(239, 68, 68, 0.08)';

                return (
                  <div 
                    key={alert._id || i} 
                    style={{ 
                      background: alertBg,
                      borderLeft: `4px solid ${alertColor}`,
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderLeftWidth: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <strong style={{ color: alertColor, fontSize: '0.88rem' }}>
                        {alert.type}
                      </strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                          {alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Live'}
                        </span>
                        <X 
                          size={15} 
                          style={{ cursor: 'pointer', color: '#94a3b8' }} 
                          onClick={() => handleDeleteAlert(alert._id)} 
                        />
                      </div>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '4px' }}>
                      Area: <strong>{alert.area}</strong> | Source: <strong>{alert.camera_id}</strong>
                    </div>

                    {alert.image_url && (
                      <div 
                        style={{ marginTop: '8px', borderRadius: '4px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', position: 'relative' }}
                        onClick={() => setSelectedScreenshot(alert.image_url)}
                      >
                        <div style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', padding: '2px 4px', borderRadius: '4px', color: 'white' }}>
                          <Maximize2 size={13} />
                        </div>
                        <img src={alert.image_url} alt="Incident Evidence" style={{ width: '100%', maxHeight: '110px', objectFit: 'cover', display: 'block' }} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

    </div>
  );
}
