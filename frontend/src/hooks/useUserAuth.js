// src/hooks/useUserAuth.js
import { useState, useEffect, useCallback } from 'react';

// Demo user ID — matches Flask's fallback in get_user_id()
const DEMO_USER_ID = 'demo';

/**
 * Simple auth hook for demo mode.
 * In production, this would integrate with a real auth system (e.g., JWT via /login).
 */
export default function useUserAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Initialize auth (auto-login as demo user)
  useEffect(() => {
    const initAuth = () => {
      try {
        // Simulate async check (e.g., validate stored session)
        const timer = setTimeout(() => {
          setUser({ uid: DEMO_USER_ID });
          setLoading(false);
        }, 200); // Small delay to simulate network

        return () => clearTimeout(timer);
      } catch (err) {
        console.error('Auth init error:', err);
        setUser(null);
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  // Login: in demo mode, just sets user to 'demo'
  const login = useCallback(async ({ email, password }) => {
    // Optional: validate email/password if you want basic demo login
    // For now: accept any non-empty credentials
    if (!email || !password) {
      throw new Error('Email and password are required');
    }
    const demoUser = { uid: DEMO_USER_ID, email };
    setUser(demoUser);
    return demoUser;
  }, []);

  // Signup: same as login in demo mode
  const signup = useCallback(async ({ email, password, name }) => {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }
    const demoUser = { uid: DEMO_USER_ID, email, displayName: name || email.split('@')[0] };
    setUser(demoUser);
    return demoUser;
  }, []);

  // Logout: clear user
  const logout = useCallback(async () => {
    setUser(null);
  }, []);

  // getIdToken: returns null (not used in Flask demo mode)
  const getIdToken = useCallback(async () => {
    return null; // Flask uses x-user-id, not Bearer tokens
  }, []);

  return { user, loading, login, signup, logout, getIdToken };
}