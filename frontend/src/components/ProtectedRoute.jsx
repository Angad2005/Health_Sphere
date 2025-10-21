// src/components/ProtectedRoute.jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from './ui/Spinner';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // While auth is initializing, show loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size={24} className="text-blue-600 dark:text-blue-400" />
      </div>
    );
  }

  // If not authenticated, redirect to login and remember where user came from
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Authenticated → render children
  return <>{children}</>;
}