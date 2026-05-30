import { api, setAccessToken, clearAccessToken } from './client';

export type AuthRole = 'guest' | 'waiter' | 'admin' | 'owner';

export type AuthUser = {
  sub: string;
  telegramId: string;
  role: AuthRole;
  staffId?: string | null;
  name?: string | null;
};

export type AuthResponse = {
  accessToken: string;
  user: AuthUser;
};

export const authApi = {
  telegram: async (initData: string) => {
    const result = await api.post<AuthResponse>('/auth/telegram', { initData });
    setAccessToken(result.accessToken);
    return result;
  },

  devLogin: async (devTelegramId: string, devName = 'Dev User') => {
    const result = await api.post<AuthResponse>('/auth/telegram', { devTelegramId, devName });
    setAccessToken(result.accessToken);
    return result;
  },

  me: () => api.get<AuthUser>('/auth/me'),

  logout: () => clearAccessToken(),
};
