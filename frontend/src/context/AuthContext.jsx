// src/context/AuthContext.jsx
import React, { createContext, useContext } from 'react';
import useUserAuth from '../hooks/useUserAuth';

// Create the auth context
const AuthContext = createContext({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
});

// Provider component
export function AuthProvider({ children }) {
  const auth = useUserAuth();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

// Custom hook to use auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}