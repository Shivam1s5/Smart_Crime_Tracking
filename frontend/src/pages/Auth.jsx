import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Shield, Lock } from 'lucide-react';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Police');
  const [adminKey, setAdminKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    if (isLogin) {
      const success = await login(username, password);
      if (success) {
        navigate('/'); // App.jsx will route to appropriate dashboard based on role
      } else {
        setError('Invalid username or password');
      }
    } else {
      if (role === 'Admin' && !adminKey.trim()) {
        setError('Admin Security Key is strictly required for Administrator accounts.');
        setLoading(false);
        return;
      }
      const res = await register(username, password, role, adminKey);
      if (res.success) {
        setIsLogin(true);
        setError('Registration successful! Please login.');
      } else {
        setError(res.message || 'Registration failed. Username may exist or Admin Key is invalid.');
      }
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px' }}>
      <div className="glass-panel animate-fade-in" style={{ padding: '40px', width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <Shield size={48} color="var(--accent)" style={{ marginBottom: '16px' }} />
          <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>Smart Crime System</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
            {isLogin ? 'Login to access your dashboard' : 'Create an account to get started'}
          </p>
        </div>

        {error && (
          <div className="alert-card" style={{ padding: '12px', fontSize: '0.9rem', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <input
            className="input-glass"
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            className="input-glass"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          
          {!isLogin && (
            <>
              <select 
                className="input-glass"
                value={role} 
                onChange={(e) => setRole(e.target.value)}
                style={{ backgroundColor: 'rgba(15,23,42,0.9)' }}
              >
                <option value="Police">Police Operator</option>
                <option value="Admin">Administrator (Core Team Only)</option>
              </select>

              {role === 'Admin' && (
                <div style={{ marginTop: '4px', marginBottom: '8px', textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#f59e0b', marginBottom: '6px', fontWeight: 600 }}>
                    <Lock size={14} /> Team Master Security Passkey
                  </div>
                  <input
                    className="input-glass"
                    type="password"
                    placeholder="Enter Master Admin Passkey"
                    value={adminKey}
                    onChange={(e) => setAdminKey(e.target.value)}
                    required
                    style={{ borderColor: 'rgba(245, 158, 11, 0.5)', background: 'rgba(245, 158, 11, 0.08)' }}
                  />
                  <span style={{ fontSize: '0.74rem', color: '#94a3b8', display: 'block', marginTop: '-4px' }}>
                    Restricted: Only core developers with the team key can register as Admin.
                  </span>
                </div>
              )}
            </>
          )}

          <button type="submit" className="btn-primary" style={{ marginTop: '16px' }} disabled={loading}>
            {loading ? 'Please wait...' : (isLogin ? 'Sign In' : 'Sign Up')}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <span 
            style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
          >
            {isLogin ? 'Register' : 'Login'}
          </span>
        </p>
      </div>
    </div>
  );
}
