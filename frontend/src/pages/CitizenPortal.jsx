import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { FileText, LogOut, Send } from 'lucide-react';

export default function CitizenPortal() {
  const { logout } = useAuth();
  const [complaints, setComplaints] = useState([]);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchComplaints();
  }, []);

  const fetchComplaints = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/complaints');
      setComplaints(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post('http://localhost:5000/api/complaints', {
        description,
        location,
        lat: 28.6 + Math.random() * 0.1, // Mock GPS coords based on location text in a real app
        lng: 77.2 + Math.random() * 0.1
      });
      setDescription('');
      setLocation('');
      fetchComplaints();
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  return (
    <>
      <nav className="navbar glass-panel" style={{ margin: '16px', borderBottom: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <FileText color="var(--accent)" />
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Citizen Portal</h2>
        </div>
        <button 
          onClick={logout}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <LogOut size={18} /> Logout
        </button>
      </nav>

      <div className="content animate-fade-in" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '32px' }}>
        
        {/* Register Complaint Form */}
        <div className="glass-panel" style={{ padding: '32px', height: 'fit-content' }}>
          <h3 style={{ marginTop: 0, marginBottom: '24px' }}>Register Complaint</h3>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>Incident Location</label>
              <input
                className="input-glass"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Central Market, Street 5"
                required
              />
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>Description</label>
              <textarea
                className="input-glass"
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happened..."
                required
                style={{ resize: 'none' }}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={loading} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
              <Send size={18} /> {loading ? 'Submitting...' : 'Submit Complaint'}
            </button>
          </form>
        </div>

        {/* Complaint History */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <h3 style={{ marginTop: 0, marginBottom: '24px' }}>My Complaints</h3>
          {complaints.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>You haven't filed any complaints yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {complaints.map(c => (
                <div key={c.id} style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <span style={{ fontWeight: 600 }}>{c.location}</span>
                    <span style={{ 
                      padding: '4px 12px', 
                      borderRadius: '16px', 
                      fontSize: '0.8rem',
                      background: c.status === 'Pending' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                      color: c.status === 'Pending' ? 'var(--warning)' : 'var(--success)'
                    }}>
                      {c.status}
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: '0 0 12px 0', fontSize: '0.9rem' }}>{c.description}</p>
                  <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
                    Filed on: {new Date(c.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </>
  );
}
