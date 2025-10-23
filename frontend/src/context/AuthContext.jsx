// src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // ✅ Remove navigate here — we'll handle redirects in components
  // const navigate = useNavigate(); ← REMOVE THIS LINE

  const fetchCurrentUser = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8080/api/auth/me', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(data.user);
      } else {
        setCurrentUser(null);
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = async (credentials) => {
    const res = await fetch('http://localhost:8080/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setCurrentUser(data.user);
    return data.user;
  };

  const signup = async (credentials) => {
    const res = await fetch('http://localhost:8080/api/auth/signup', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Signup failed');
    setCurrentUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await fetch('http://localhost:8080/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error("Logout failed:", err);
    } finally {
      setCurrentUser(null);
      // ✅ We'll handle redirect in LoginPage/SignupPage — NOT here
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
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}