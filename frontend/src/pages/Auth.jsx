import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('Citizen');
  const [error, setError] = useState('');
  
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (isLogin) {
      const success = await login(username, password);
      if (success) {
        navigate('/'); // App.jsx will route to appropriate dashboard based on role
      } else {
        setError('Invalid username or password');
      }
    } else {
      const success = await register(username, password, role);
      if (success) {
        setIsLogin(true);
        setError('Registration successful! Please login.');
      } else {
        setError('Registration failed. Username may exist.');
      }
    }
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
            <select 
              className="input-glass"
              value={role} 
              onChange={(e) => setRole(e.target.value)}
              style={{ backgroundColor: 'rgba(15,23,42,0.9)' }}
            >
              <option value="Citizen">Citizen</option>
              <option value="Police">Police Operator</option>
              <option value="Admin">Administrator</option>
            </select>
          )}

          <button type="submit" className="btn-primary" style={{ marginTop: '16px' }}>
            {isLogin ? 'Sign In' : 'Sign Up'}
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
