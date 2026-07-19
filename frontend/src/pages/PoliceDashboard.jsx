import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import RiskMap from '../components/Map';
import { ShieldAlert, LogOut, Video, Search, AlertTriangle, AlertOctagon, X } from 'lucide-react';

export default function PoliceDashboard() {
  const { logout } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [selectedArea, setSelectedArea] = useState('Downtown');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [redAlert, setRedAlert] = useState(null);

  useEffect(() => {
    // Fetch Cameras for this area (Mocking 'Downtown' area for now)
    const fetchCameras = async () => {
      try {
        const res = await axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/cameras?area=${selectedArea}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });
        setCameras(res.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchCameras();

    // Connect to WebSocket
    const socketUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000';
    const socket = io(socketUrl);
    
    socket.on('red_alert', (data) => {
      setRedAlert(data);
      setAlerts((prev) => [data, ...prev]);
    });

    return () => socket.disconnect();
  }, [selectedArea]);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    try {
      const res = await axios.get(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/records/search?q=${searchQuery}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setSearchResults(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const startVideoProcessing = async () => {
    try {
      setIsProcessing(true);
      await axios.post(`${import.meta.env.VITE_API_URL || 'http://localhost:5000'}/api/video/start`, {}, {
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
          background: 'rgba(220, 38, 38, 0.2)', backdropFilter: 'blur(10px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999,
          animation: 'pulse 1s infinite'
        }}>
          <div className="glass-panel" style={{ background: 'rgba(0,0,0,0.8)', border: '2px solid red', padding: '40px', maxWidth: '600px', textAlign: 'center', position: 'relative' }}>
            <button onClick={() => setRedAlert(null)} style={{ position: 'absolute', top: 10, right: 10, background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>
              <X size={24} />
            </button>
            <AlertOctagon size={80} color="red" style={{ margin: '0 auto 20px auto' }} />
            <h1 style={{ color: 'red', fontSize: '2.5rem', margin: '0 0 10px 0', textTransform: 'uppercase' }}>CRITICAL ALERT!</h1>
            <h2 style={{ margin: '0 0 20px 0' }}>{redAlert.type} Detected in {redAlert.area}</h2>
            <p style={{ fontSize: '1.2rem', color: '#ccc' }}>Confidence: <strong>{(redAlert.confidence * 100).toFixed(1)}%</strong></p>
            <p style={{ fontSize: '1.1rem', color: '#ccc' }}>Camera: <strong>{redAlert.camera_id}</strong></p>
            
            <button className="btn-primary" onClick={() => setRedAlert(null)} style={{ marginTop: '30px', background: 'red', fontSize: '1.2rem', padding: '12px 30px' }}>
              ACKNOWLEDGE
            </button>
          </div>
        </div>
      )}

      {/* Top Navbar */}
      <div className="glass-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ShieldAlert color="var(--accent)" size={28} />
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Patrol Analytics Command Center</h2>
        </div>
        <button onClick={logout} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <LogOut size={18} /> Logout
        </button>
      </div>

      {/* Main Content Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Column: Map, Cameras & ML Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
          
          {/* Top Half: Cameras (New) */}
          <div className="glass-panel animate-fade-in" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Video size={20} color="var(--accent)" /> Live Area Cameras
              </h3>
              <select 
                className="input-glass" 
                style={{ width: 'auto', margin: 0, backgroundColor: 'rgba(15,23,42,0.9)' }}
                value={selectedArea}
                onChange={(e) => setSelectedArea(e.target.value)}
              >
                <option value="Downtown">Downtown</option>
                <option value="North Side">North Side</option>
                <option value="West End">West End</option>
                <option value="South Central">South Central</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '8px' }}>
              {cameras.length === 0 ? (
                 <p style={{ color: 'var(--text-secondary)' }}>No cameras linked to this area.</p>
              ) : (
                cameras.map((cam) => (
                  <div key={cam._id} style={{ minWidth: '300px', background: 'rgba(255,255,255,0.05)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ width: '100%', height: '170px', background: '#000', borderRadius: '4px', marginBottom: '8px', position: 'relative', overflow: 'hidden' }}>
                      {/* Live Video Feed Simulation */}
                      <span style={{ position: 'absolute', top: 8, right: 8, background: 'red', color: 'white', fontSize: '0.7rem', padding: '3px 8px', borderRadius: '4px', fontWeight: 'bold', zIndex: 10, animation: 'pulse 2s infinite' }}>LIVE</span>
                      <iframe 
                        src={`https://www.youtube.com/embed/1EiC9bvVGnk?autoplay=1&mute=1&controls=0&showinfo=0&loop=1&playlist=1EiC9bvVGnk`}
                        title="Live Traffic Camera"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
                      ></iframe>
                    </div>
                    <strong style={{ display: 'block', fontSize: '0.95rem' }}>{cam.name}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>ID: {cam.camera_id}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Bottom Half: ML Controls & Search */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1 }}>
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={20} color="var(--accent)" /> ML Surveillance Link
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
                Connect to the AI Microservice for real-time weapon and anomaly detection on connected cameras.
              </p>
              <button 
                className="btn-primary" 
                onClick={startVideoProcessing}
                disabled={isProcessing}
                style={{ background: isProcessing ? 'var(--success)' : 'var(--accent)' }}
              >
                {isProcessing ? 'Engine Linked & Monitoring...' : 'Link AI Detection Engine'}
              </button>
            </div>

            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={20} color="var(--accent)" /> Criminal Records DB
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
            <AlertTriangle size={20} /> Live Alerts
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
