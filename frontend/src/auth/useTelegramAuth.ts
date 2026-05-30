import { useEffect, useState } from 'react';
import { authApi, AuthUser } from '../api/auth';

export function useTelegramAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const telegram = (window as any).Telegram?.WebApp;
        const initData = telegram?.initData;

        if (initData) {
          telegram.ready?.();
          const result = await authApi.telegram(initData);
          if (!cancelled) setUser(result.user);
          return;
        }

        // Локальна розробка без Telegram Mini App.
        // Працює тільки якщо backend ALLOW_DEV_AUTH=true.
        const result = await authApi.devLogin('111111111', 'Local Test');
        if (!cancelled) setUser(result.user);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Помилка авторизації');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading, error };
}
