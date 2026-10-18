import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Auth from './pages/Auth';
import PoliceDashboard from './pages/PoliceDashboard';
import AdminDashboard from './pages/AdminDashboard';

const PrivateRoute = ({ children, roles }) => {
  const { user } = useAuth();
  
  if (!user) return <Navigate to="/auth" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/auth" />;
  
  return children;
};

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route 
        path="/dashboard" 
        element={
          <PrivateRoute roles={['Police', 'Admin']}>
            <PoliceDashboard />
          </PrivateRoute>
        } 
      />
      <Route 
        path="/admin" 
        element={
          <PrivateRoute roles={['Admin']}>
            <AdminDashboard />
          </PrivateRoute>
        } 
      />
      <Route 
        path="*" 
        element={
          <Navigate 
            to={
              user 
                ? (user.role === 'Admin' ? '/admin' : '/dashboard') 
                : '/auth'
            } 
          />
        } 
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="layout">
          <AppRoutes />
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
