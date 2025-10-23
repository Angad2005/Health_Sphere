// src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  login as apiLogin,
  signup as apiSignup,
  logout as apiLogout,
  getCurrentUser
} from '@/services/api';

const AuthContext = createContext();

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
    } catch (err) {
      console.error("Auth check failed:", err);
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = async (credentials) => {
    try {
      const user = await apiLogin(credentials.email, credentials.password);
      setCurrentUser(user);
      return user;
    } catch (error) {
      setCurrentUser(null);
      throw error; // Re-throw for component-level error handling
    }
  };

  const signup = async (credentials) => {
    try {
      const user = await apiSignup(credentials.email, credentials.password);
      setCurrentUser(user);
      return user;
    } catch (error) {
      setCurrentUser(null);
      throw error; // Re-throw for component-level error handling
    }
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (err) {
      console.error("Logout failed:", err);
      // Continue with logout even if API fails
    } finally {
      setCurrentUser(null);
    }
  };

  useEffect(() => {
    fetchCurrentUser();
  }, [fetchCurrentUser]);

  const value = {
    currentUser,
    login,
    signup,
    logout,
    loading,
    isAuthenticated: !!currentUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}