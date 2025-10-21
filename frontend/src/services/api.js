// src/services/api.js
// Vite-compatible API client for Flask backend

const isDev = import.meta.env.DEV;
const BASE = (import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

// Default user ID for demo/dev mode
const DEFAULT_USER_ID = 'demo';

/**
 * Get user ID (from localStorage, context, or fallback)
 * In production, this should come from real auth (e.g., JWT, session)
 */
function getUserId() {
  // Example: read from localStorage if you store it
  // return localStorage.getItem('userId') || DEFAULT_USER_ID;
  return DEFAULT_USER_ID; // For now, hardcode to 'demo' to match Flask
}

/**
 * Build headers with x-user-id
 */
function getHeaders(extraHeaders = {}) {
  return {
    'Content-Type': 'application/json',
    'x-user-id': getUserId(),
    ...extraHeaders,
  };
}

/**
 * Wrapper for JSON fetch with error handling
 */
async function jsonFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: getHeaders(options.headers),
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
  const res = await fetch(`${BASE}/api/ai/health`);
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

  const res = await fetch(`${BASE}/functions/processReport`, {
    method: 'POST',
    headers: { 'x-user-id': getUserId() }, // multipart/form-data doesn't need Content-Type
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) {}

  if (!res.ok) {
    const msg = json?.error || json?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Progress-capable upload (unchanged logic, but simplified headers)
export function processReportWithProgress(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);

    xhr.open('POST', `${BASE}/functions/processReport`, true);
    xhr.setRequestHeader('x-user-id', getUserId());

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

export async function fetchRiskSeries(userId = getUserId()) {
  const url = new URL(`${BASE}/functions/riskSeries`);
  url.searchParams.set('userId', String(userId));
  return jsonFetch(url.toString());
}

// New: fetch user check-ins from Flask
export async function fetchCheckins(userId = getUserId(), limit = 30) {
  const url = new URL(`${BASE}/api/checkins`);
  url.searchParams.set('userId', String(userId));
  url.searchParams.set('limit', String(limit));
  return jsonFetch(url.toString());
}

export async function generateReportSummary(extractedData, ocrText) {
  return jsonFetch(`${BASE}/functions/generateReportSummary`, {
    method: 'POST',
    body: JSON.stringify({ extractedData, ocrText }),
  });
}