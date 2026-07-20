import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, LogOut, Video, Search, AlertTriangle, AlertOctagon, X, MapPin, Plus, Camera } from 'lucide-react';

export default function PoliceDashboard() {
  const { logout } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [redAlert, setRedAlert] = useState(null);
  
  // Geolocation and Add Camera State
  const [policeLocation, setPoliceLocation] = useState({ lat: null, lng: null });
  const [policeAddress, setPoliceAddress] = useState('');
  const [showAddCameraModal, setShowAddCameraModal] = useState(false);
  const [newCameraData, setNewCameraData] = useState({ name: '', stream_url: '', location: '' });

  useEffect(() => {
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
    try {
      const payload = {
        name: newCameraData.name,
        stream_url: newCameraData.stream_url,
        area: newCameraData.location,
        lat: policeLocation.lat,
        lng: policeLocation.lng
      };
      await axios.post(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/cameras`, payload, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setShowAddCameraModal(false);
      setNewCameraData({ name: '', stream_url: '', location: '' });
      fetchCameras(); // Refresh cameras
    } catch (err) {
      console.error("Failed to add camera", err);
      alert("Failed to add camera. Check console.");
    }
  };

  const startVideoProcessing = async () => {
    try {
      setIsProcessing(true);
      await axios.post(`${import.meta.env.VITE_API_URL || 'https://smart-crime-tracking.onrender.com'}/api/video/start`, {}, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '16px', gap: '16px', position: 'relative' }}>
      
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
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem' }}>Live Stream URL (IP Webcam link)</label>
                <input 
                  type="url" className="input-glass" required placeholder="http://192.168.x.x:8080/video"
                  value={newCameraData.stream_url} onChange={e => setNewCameraData({...newCameraData, stream_url: e.target.value})}
                />
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Use any IP Webcam app on your phone to get an MJPEG stream URL and paste it here.
                </p>
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
                  <div key={cam._id} style={{ minWidth: '400px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ width: '100%', flex: 1, background: '#000', borderRadius: '4px', marginBottom: '8px', position: 'relative', overflow: 'hidden' }}>
                      <span style={{ position: 'absolute', top: 8, right: 8, background: 'red', color: 'white', fontSize: '0.7rem', padding: '3px 8px', borderRadius: '4px', fontWeight: 'bold', zIndex: 10, animation: 'pulse 2s infinite' }}>LIVE REC</span>
                      
                      {cam.stream_url ? (
                        // If user provided a real IP stream, use img tag (best for MJPEG) or iframe
                        cam.stream_url.includes('youtube.com') ? (
                          <iframe src={cam.stream_url} frameBorder="0" allow="autoplay; encrypted-media" style={{ width: '100%', height: '100%' }}></iframe>
                        ) : (
                          <img src={cam.stream_url} alt="Live Stream" style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                            onError={(e) => { e.target.onerror = null; e.target.src = "https://via.placeholder.com/400x200?text=Camera+Offline"; }}
                          />
                        )
                      ) : (
                        // Default simulation
                        <iframe 
                          src={`https://www.youtube.com/embed/1EiC9bvVGnk?autoplay=1&mute=1&controls=0&showinfo=0&loop=1&playlist=1EiC9bvVGnk`}
                          title="Simulated Camera" frameBorder="0" allow="autoplay"
                          style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
                        ></iframe>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ paddingRight: '8px' }}>
                        <strong style={{ display: 'block', fontSize: '1.05rem', color: 'var(--accent)' }}>{cam.name}</strong>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{cam.area}</span>
                      </div>
                      {cam.lat && (
                        <div style={{ fontSize: '0.75rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                          {parseFloat(cam.lat).toFixed(4)}, {parseFloat(cam.lng).toFixed(4)}
                        </div>
                      )}
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
              <button 
                className="btn-primary" 
                onClick={startVideoProcessing}
                disabled={isProcessing}
                style={{ background: isProcessing ? 'var(--success)' : 'var(--accent)' }}
              >
                {isProcessing ? 'AI Engine Linked & Monitoring Active' : 'Start Background AI Monitoring'}
              </button>
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
                <div key={i} className="alert-card animate-fade-in">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong style={{ color: 'var(--danger)' }}>{alert.type.toUpperCase()}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>Area: {alert.area}</p>
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>Cam: {alert.camera_id}</p>
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
