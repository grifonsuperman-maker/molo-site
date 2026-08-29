import { useEffect, useState } from 'react';
import { authApi, AuthUser } from '../api/auth';
import { linkKnownGuestBookingsToTelegram } from '../api/guestBookingAccess';
import {
  expandTelegramWebApp,
  getTelegramWebApp,
} from '../telegram/telegramRuntime';

export function useTelegramAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTelegram, setIsTelegram] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const telegram = getTelegramWebApp();
        const initData = telegram?.initData;

        if (initData) {
          setIsTelegram(true);
          telegram.ready?.();
          expandTelegramWebApp(telegram);
          telegram.setHeaderColor?.('#10100f');
          telegram.setBackgroundColor?.('#10100f');
          const result = await authApi.telegram(initData);
          if (result.user.role === 'guest') {
            void linkKnownGuestBookingsToTelegram();
          }
          if (!cancelled) setUser(result.user);
          return;
        }

        if (
          import.meta.env.DEV &&
          import.meta.env.VITE_ALLOW_DEV_TELEGRAM_AUTH === 'true'
        ) {
          const result = await authApi.devLogin('111111111', 'Local Test');
          if (!cancelled) setUser(result.user);
        }
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

  return { user, loading, error, isTelegram };
}
