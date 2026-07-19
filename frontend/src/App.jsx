import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Auth from './pages/Auth';
import CitizenPortal from './pages/CitizenPortal';
import PoliceDashboard from './pages/PoliceDashboard';

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
        path="/citizen" 
        element={
          <PrivateRoute roles={['Citizen']}>
            <CitizenPortal />
          </PrivateRoute>
        } 
      />
      <Route 
        path="/dashboard" 
        element={
          <PrivateRoute roles={['Police', 'Admin']}>
            <PoliceDashboard />
          </PrivateRoute>
        } 
      />
      <Route 
        path="*" 
        element={<Navigate to={user ? (user.role === 'Citizen' ? '/citizen' : '/dashboard') : '/auth'} />} 
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
