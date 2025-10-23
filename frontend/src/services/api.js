// src/services/api.js
// Vite-compatible API client for Flask backend (SESSION-BASED AUTH)

const isDev = import.meta.env.DEV;
const BASE = (import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

/**
 * Wrapper for JSON fetch with session credentials and error handling
 */
async function jsonFetch(url, options = {}) {
  // ALWAYS include credentials for session-based auth
  const res = await fetch(url, {
    ...options,
    credentials: 'include', // ← CRITICAL: sends session cookie
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    data = { error: 'Invalid JSON response' };
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

// --- Public API functions ---

export async function analyze(body) {
  return jsonFetch(`${BASE}/api/analyze`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function aiHealth() {
  const res = await fetch(`${BASE}/api/ai/health`, {
    credentials: 'include', // ← Include for consistency
  });
  return res.json();
}

export async function pdfExtract(url, { useOcr = false, lang = 'en' } = {}) {
  return jsonFetch(`${BASE}/api/pdf-extract`, {
    method: 'POST',
    body: JSON.stringify({ url, useOcr, lang }),
  });
}

export async function processReport(file) {
  const formData = new FormData();
  formData.append('file', file);

  // For multipart/form-data, DON'T set Content-Type (browser sets it with boundary)
  const res = await fetch(`${BASE}/functions/processReport`, {
    method: 'POST',
    credentials: 'include', // ← CRITICAL
    // No Content-Type header for FormData
  });

  const text = await res.text();
  let json = {};
  try { 
    json = text ? JSON.parse(text) : {}; 
  } catch (_) {}

  if (!res.ok) {
    const msg = json?.error || json?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Progress-capable upload with session credentials
export function processReportWithProgress(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);

    xhr.open('POST', `${BASE}/functions/processReport`, true);
    xhr.withCredentials = true; // ← Equivalent to credentials: 'include' for XHR

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable) {
          const percent = Math.min(99, Math.round((evt.loaded / evt.total) * 100));
          onProgress(percent);
        }
      };
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const json = JSON.parse(xhr.responseText || '{}');
            resolve(json);
          } catch {
            resolve({ ok: true });
          }
        } else {
          let message = 'Upload failed';
          try {
            const err = JSON.parse(xhr.responseText || '{}');
            message = err?.error || err?.message || message;
            const error = new Error(message);
            error.status = xhr.status;
            error.body = err;
            reject(error);
          } catch {
            reject(new Error(message));
          }
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.onabort = () => reject(new Error('Upload canceled'));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
      } else {
        const onAbort = () => xhr.abort();
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    xhr.send(form);
  });
}

export async function analyzeCheckinApi(payload) {
  return jsonFetch(`${BASE}/functions/analyzeCheckin`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function findNearbyAmbulance(lat, lng, radiusMeters = 5000) {
  const url = new URL(`${BASE}/functions/findNearbyAmbulance`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('radiusMeters', String(radiusMeters));
  return jsonFetch(url.toString());
}

export async function submitFeedback(feedback) {
  return jsonFetch(`${BASE}/functions/submitFeedback`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  });
}

export async function chatWithGeminiApi(payload, { signal } = {}) {
  return jsonFetch(`${BASE}/functions/chat`, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  });
}

export async function fetchRiskSeries() {
  // No userId needed - Flask gets it from session
  return jsonFetch(`${BASE}/functions/riskSeries`);
}

// Fetch user check-ins (no userId needed - Flask uses session)
export async function fetchCheckins(limit = 30) {
  const url = new URL(`${BASE}/api/checkins`);
  url.searchParams.set('limit', String(limit));
  return jsonFetch(url.toString());
}

export async function generateReportSummary(extractedData, ocrText) {
  return jsonFetch(`${BASE}/functions/generateReportSummary`, {
    method: 'POST',
    body: JSON.stringify({ extractedData, ocrText }),
  });
}

// --- Auth-specific functions ---
export async function login(email, password) {
  return jsonFetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function signup(email, password) {
  return jsonFetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function logout() {
  return jsonFetch(`${BASE}/api/auth/logout`, {
    method: 'POST',
  });
}

export async function getCurrentUser() {
  return jsonFetch(`${BASE}/api/auth/me`);
}