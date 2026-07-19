import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import RiskMap from '../components/Map';
import { ShieldAlert, LogOut, Video, Search, AlertTriangle } from 'lucide-react';

export default function PoliceDashboard() {
  const { logout } = useAuth();
  const [alerts, setAlerts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Connect to WebSocket
    const socket = io('http://localhost:5000');
    
    socket.on('new_alert', (data) => {
      setAlerts((prev) => [data, ...prev]);
    });

    return () => socket.disconnect();
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    try {
      const res = await axios.get(`http://localhost:5000/api/records/search?q=${searchQuery}`);
      setSearchResults(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const startVideoProcessing = async () => {
    try {
      setIsProcessing(true);
      await axios.post('http://localhost:5000/api/video/start');
      // The backend will now stream alerts via websocket if a crime is detected
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '16px', gap: '16px' }}>
      
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
        
        {/* Left Column: Map & ML Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
          {/* Map */}
          <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '8px' }}>
            <RiskMap />
          </div>

          {/* ML Controls & Search */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div className="glass-panel" style={{ padding: '24px' }}>
              <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Video size={20} color="var(--accent)" /> ML Camera Feed
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
                Activate the CNN+LSTM Action Recognition pipeline.
              </p>
              <button 
                className="btn-primary" 
                onClick={startVideoProcessing}
                disabled={isProcessing}
                style={{ background: isProcessing ? 'var(--success)' : 'var(--accent)' }}
              >
                {isProcessing ? 'Engine Active & Monitoring...' : 'Start Real-Time Detection'}
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
                  <div key={r.id} style={{ fontSize: '0.9rem', padding: '8px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
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
                  <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>Location: {alert.location}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ height: '6px', background: 'rgba(255,255,255,0.2)', borderRadius: '3px', flex: 1 }}>
                      <div style={{ height: '100%', background: 'var(--danger)', borderRadius: '3px', width: `${alert.confidence}%` }}></div>
                    </div>
                    <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{alert.confidence}%</span>
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
