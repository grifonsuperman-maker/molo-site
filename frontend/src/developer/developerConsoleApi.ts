import { API_URL } from '../api/client';

export type DeveloperSession = {
  user: { role: 'developer'; name: string };
  sessionExpiresAt: string;
  version: string | null;
};
export type DeveloperLogin = DeveloperSession & { accessToken: string };

export class DeveloperApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function developerRequest(path: string, options: RequestInit, signal: AbortSignal) {
  const response = await fetch(`${API_URL}/developer${path}`, {
    ...options, signal, cache: 'no-store', credentials: 'omit',
  });
  if (!response.ok) {
    const messages: Record<number, string> = {
      400: 'Перевірте логін і пароль.',
      401: 'Невірні дані входу або сеанс завершено.',
      403: 'Недостатньо прав для пульта розробника.',
      429: 'Забагато спроб входу. Спробуйте пізніше.',
      503: 'Вхід розробника поки недоступний.',
    };
    throw new DeveloperApiError(response.status, messages[response.status] || 'Не вдалося зв’язатися із сервером.');
  }
  const data = await response.json();
  if (data?.user?.role !== 'developer' || !Number.isFinite(Date.parse(data?.sessionExpiresAt)) ||
      Date.parse(data.sessionExpiresAt) <= Date.now() ||
      (data.version !== null && !/^[a-f0-9]{7}$/i.test(data.version))) {
    throw new Error('Не вдалося підтвердити доступ. Спробуйте увійти знову.');
  }
  return data;
}

export const developerConsoleApi = {
  async login(login: string, password: string, signal: AbortSignal): Promise<DeveloperLogin> {
    const data = await developerRequest('/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    }, signal);
    if (typeof data.accessToken !== 'string' || !data.accessToken) throw new Error('Не вдалося підтвердити доступ.');
    return data;
  },
  async session(token: string, signal: AbortSignal): Promise<DeveloperSession> {
    return developerRequest('/session', { headers: { Authorization: `Bearer ${token}` } }, signal);
  },
};
