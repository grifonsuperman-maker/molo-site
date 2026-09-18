export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const TOKEN_KEY = 'molo_access_token';

// A successful credential rotation must not be reported as a failed PATCH just
// because the browser disallows persistent storage. The current tab can still
// use the new token; sessionStorage is a best-effort reload fallback.
let inMemoryAccessToken: string | null = null;

export function setAccessToken(token: string) {
  inMemoryAccessToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage may be unavailable in Telegram WebViews or private browsing.
    }
  } catch {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Keep the token in memory for this tab; a reload will require login.
    }
  }
}

export function getAccessToken() {
  if (inMemoryAccessToken !== null) return inMemoryAccessToken;
  try {
    const sessionToken = sessionStorage.getItem(TOKEN_KEY);
    if (sessionToken) return sessionToken;
  } catch {
    // Fall back to localStorage when sessionStorage cannot be read.
  }
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearAccessToken() {
  inMemoryAccessToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Clearing the in-memory token must always succeed.
  }
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Clearing the in-memory token must always succeed.
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAccessToken();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let data: any = null;
    try {
      data = await res.json();
    } catch {}

    const message = Array.isArray(data?.message)
      ? data.message.join('\n')
      : data?.message || 'Помилка сервера';

    throw new Error(message);
  }

  return res.json();
}

export const api = {
  get: <T>(p: string, options?: RequestInit) => request<T>(p, options),
  post: <T>(p: string, b?: unknown, options?: RequestInit) =>
    request<T>(p, { ...options, method: 'POST', body: b ? JSON.stringify(b) : undefined }),
  patch: <T>(p: string, b?: unknown, options?: RequestInit) =>
    request<T>(p, { ...options, method: 'PATCH', body: b ? JSON.stringify(b) : undefined }),
  delete: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};
