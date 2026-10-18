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
  Camera
} from 'lucide-react';

export default function AdminDashboard() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const [cameras, setCameras] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals & Forms
  const [showAddModal, setShowAddModal] = useState(false);
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [selectedCameraForThreshold, setSelectedCameraForThreshold] = useState(null);
  const [newThresholdValue, setNewThresholdValue] = useState(5);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);

  // New Camera Form
  const [newCam, setNewCam] = useState({
    name: '',
    area: '',
    stream_url: '',
    gathering_threshold: 5
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
        gathering_threshold: parseInt(newCam.gathering_threshold, 10) || 5
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
      setNewCam({ name: '', area: '', stream_url: '', gathering_threshold: 5 });
    } catch (err) {
      console.error("Error creating camera:", err);
      alert("Failed to create camera. Please check logs.");
    }
  };

  const handleDeleteCamera = async (cameraId) => {
    if (!window.confirm(`Are you sure you want to delete camera: ${cameraId}?`)) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_BASE}/api/cameras/${cameraId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCameras(cameras.filter(c => c.camera_id !== cameraId));
    } catch (err) {
      console.error("Error deleting camera:", err);
      alert("Failed to delete camera.");
    }
  };

  const handleOpenThresholdModal = (cam) => {
    setSelectedCameraForThreshold(cam);
    setNewThresholdValue(cam.gathering_threshold || 5);
    setShowThresholdModal(true);
  };

  const handleSaveThreshold = async (e) => {
    e.preventDefault();
    if (!selectedCameraForThreshold) return;
    try {
      const token = localStorage.getItem('token');
      const threshold = Math.max(1, parseInt(newThresholdValue, 10));

      await axios.put(`${API_BASE}/api/cameras/${selectedCameraForThreshold.camera_id}`, {
        gathering_threshold: threshold
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setCameras(cameras.map(c => 
        c.camera_id === selectedCameraForThreshold.camera_id 
          ? { ...c, gathering_threshold: threshold } 
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
  const threatAlertsCount = alerts.filter(a => !a.type || !a.type.toUpperCase().includes('GATHERING')).length;
  const totalOperators = usersList.length;

  const filteredAlerts = alerts.filter(a => {
    if (alertFilter === 'ALL') return true;
    if (alertFilter === 'CROWD') return a.type && a.type.toUpperCase().includes('GATHERING');
    if (alertFilter === 'THREATS') return !a.type || !a.type.toUpperCase().includes('GATHERING');
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

      {/* Edit Gathering Threshold Modal */}
      {showThresholdModal && selectedCameraForThreshold && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
          background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999
        }}>
          <div className="glass-panel" style={{ padding: '32px', width: '380px', background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SlidersHorizontal size={20} color="var(--accent)" /> Configure Gathering Limit
              </h3>
              <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowThresholdModal(false)} />
            </div>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Set maximum permitted gathering density for <strong>{selectedCameraForThreshold.name}</strong> ({selectedCameraForThreshold.area}). An automatic red alert will trigger if person count exceeds this limit.
            </p>
            <form onSubmit={handleSaveThreshold}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: '#cbd5e1' }}>
                  Maximum Gathering Limit (Persons)
                </label>
                <input 
                  type="number" 
                  min="1" 
                  max="50" 
                  className="input-glass" 
                  value={newThresholdValue} 
                  onChange={(e) => setNewThresholdValue(e.target.value)} 
                  required 
                  style={{ width: '100%', padding: '12px', fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent)' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1, padding: '10px' }}>
                  Save & Apply Limit
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
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.85rem', color: '#cbd5e1' }}>Max Gathering Limit (Threshold)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="50" 
                  className="input-glass" 
                  value={newCam.gathering_threshold} 
                  onChange={(e) => setNewCam({ ...newCam, gathering_threshold: e.target.value })} 
                  required 
                />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Alert fires when person count surpasses this threshold.</span>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
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
            <span style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 500 }}>Gathering Threshold Alerts</span>
            <Users size={18} color="#f59e0b" />
          </div>
          <div style={{ fontSize: '2rem', fontWeight: 'bold', marginTop: '8px', color: '#f59e0b' }}>
            {crowdAlertsCount}
          </div>
          <span style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
            Overcrowding threshold breaches
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Video size={20} color="var(--accent)" /> Camera Network & Gathering Limits
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Configure safe person capacity limits per surveillance area. AI automatically dispatches alert when limit is broken.
              </p>
            </div>
            <button 
              className="btn-primary" 
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '0.88rem' }}
              onClick={() => setShowAddModal(true)}
            >
              <Plus size={16} /> Deploy Camera
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {cameras.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-secondary)' }}>
                No cameras currently configured. Click "Deploy Camera" to add.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                    <th style={{ padding: '10px 8px' }}>Camera</th>
                    <th style={{ padding: '10px 8px' }}>Zone</th>
                    <th style={{ padding: '10px 8px' }}>Gathering Limit</th>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ 
                            background: 'rgba(56, 189, 248, 0.15)', 
                            color: '#38bdf8', 
                            padding: '4px 10px', 
                            borderRadius: '14px', 
                            fontWeight: 'bold',
                            border: '1px solid rgba(56, 189, 248, 0.3)',
                            fontSize: '0.82rem'
                          }}>
                            👥 Max {cam.gathering_threshold || 5} Persons
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
                            title="Edit Gathering Limit"
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
            {['ALL', 'CROWD', 'THREATS'].map(filter => (
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
                {filter === 'ALL' ? 'All Incidents' : filter === 'CROWD' ? 'Overcrowding' : 'Weapons & Combat'}
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
                return (
                  <div 
                    key={alert._id || i} 
                    style={{ 
                      background: isCrowd ? 'rgba(245, 158, 11, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                      borderLeft: isCrowd ? '4px solid #f59e0b' : '4px solid #ef4444',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderLeftWidth: '4px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <strong style={{ color: isCrowd ? '#f59e0b' : '#ef4444', fontSize: '0.88rem' }}>
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
