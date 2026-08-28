export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const TOKEN_KEY = 'molo_access_token';

export function setAccessToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getAccessToken() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function clearAccessToken() {
  localStorage.removeItem(TOKEN_KEY);
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
