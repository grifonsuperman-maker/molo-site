import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import {
  clearAccessToken,
  getAccessToken,
  api,
} from '../api/client';
import {
  StaffAuthUser,
  StaffLoginOption,
  staffApi,
} from '../api/staff';

type AdminAuthGateProps = {
  children: ReactNode;
};

type AuthState = 'checking' | 'guest' | 'authenticated';

export default function AdminAuthGate({ children }: AdminAuthGateProps) {
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [user, setUser] = useState<StaffAuthUser | null>(null);
  const [options, setOptions] = useState<StaffLoginOption[]>([]);
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const adminOptions = useMemo(
    () => options.filter((option) => option.role === 'admin'),
    [options],
  );

  const loadLoginOptions = useCallback(async () => {
    setLoadingOptions(true);
    setError('');

    try {
      const result = await staffApi.getLoginOptions();
      const managers = result.filter((option) => option.role === 'admin');

      setOptions(result);
      setStaffId((current) => {
        if (current && managers.some((option) => option.id === current)) {
          return current;
        }

        return managers[0]?.id || '';
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Не вдалося завантажити список адміністраторів',
      );
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const token = getAccessToken();

      if (!token) {
        if (!cancelled) {
          setAuthState('guest');
          await loadLoginOptions();
        }
        return;
      }

      try {
        const currentUser = await api.get<StaffAuthUser>('/auth/me');

        if (currentUser.role !== 'admin') {
          clearAccessToken();

          if (!cancelled) {
            setUser(null);
            setAuthState('guest');
            setError('Для входу потрібні права адміністратора');
            await loadLoginOptions();
          }
          return;
        }

        if (!cancelled) {
          setUser(currentUser);
          setAuthState('authenticated');
        }
      } catch {
        clearAccessToken();

        if (!cancelled) {
          setUser(null);
          setAuthState('guest');
          await loadLoginOptions();
        }
      }
    }

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [loadLoginOptions]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!staffId) {
      setError('Оберіть адміністратора');
      return;
    }

    if (!/^\d{6}$/.test(pin)) {
      setError('PIN має містити рівно 6 цифр');
      return;
    }

    setSubmitting(true);

    try {
      const result = await staffApi.loginWithPin(staffId, pin);

      if (result.user.role !== 'admin') {
        clearAccessToken();
        throw new Error('Для входу потрібні права адміністратора');
      }

      setUser(result.user);
      setPin('');
      setAuthState('authenticated');
    } catch (loginError) {
      clearAccessToken();
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'Не вдалося виконати вхід',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    clearAccessToken();
    setUser(null);
    setPin('');
    setError('');
    setAuthState('guest');
    void loadLoginOptions();
  }

  if (authState === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
        <div className="rounded-3xl border border-white/10 bg-neutral-950 px-6 py-8 text-center shadow-2xl">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-amber-300" />
          <p className="mt-4 text-sm text-white/60">Перевіряємо доступ…</p>
        </div>
      </div>
    );
  }

  if (authState === 'authenticated' && user) {
    return (
      <>
        <div className="border-b border-white/10 bg-neutral-950 px-4 py-3 text-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-black">
                {user.name || 'Адміністратор'}
              </p>
              <p className="text-xs text-white/50">Адміністратор</p>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white/80 transition hover:bg-white/10 active:scale-[0.98]"
            >
              Вийти
            </button>
          </div>
        </div>

        {children}
      </>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 py-10 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-neutral-950 p-5 shadow-2xl sm:p-7">
        <div className="mb-6">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-amber-300">
            MOLO
          </p>
          <h1 className="mt-2 text-2xl font-black">Вхід до адмінпанелі</h1>
          <p className="mt-2 text-sm leading-6 text-white/55">
            Оберіть адміністратора та введіть особистий шестизначний PIN.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-bold text-white/75">
              Адміністратор
            </span>

            <select
              value={staffId}
              onChange={(event) => {
                setStaffId(event.target.value);
                setError('');
              }}
              disabled={loadingOptions || submitting}
              className="w-full rounded-2xl border border-white/10 bg-neutral-900 px-4 py-3 text-base font-semibold text-white outline-none transition focus:border-amber-300 disabled:opacity-50"
            >
              {adminOptions.length === 0 ? (
                <option value="">
                  {loadingOptions
                    ? 'Завантаження…'
                    : 'Адміністратора не знайдено'}
                </option>
              ) : (
                adminOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.fullName}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-bold text-white/75">
              PIN
            </span>

            <input
              value={pin}
              onChange={(event) => {
                setPin(event.target.value.replace(/\D/g, '').slice(0, 6));
                setError('');
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="••••••"
              disabled={submitting}
              className="w-full rounded-2xl border border-white/10 bg-neutral-900 px-4 py-3 text-center text-2xl font-black tracking-[0.4em] text-white outline-none transition placeholder:text-white/20 focus:border-amber-300 disabled:opacity-50"
            />
          </label>

          {error ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-semibold text-red-200">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={
              submitting ||
              loadingOptions ||
              !staffId ||
              adminOptions.length === 0
            }
            className="w-full rounded-2xl bg-amber-300 px-4 py-3 font-black text-neutral-950 transition hover:bg-amber-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Входимо…' : 'Увійти'}
          </button>

          <button
            type="button"
            onClick={() => void loadLoginOptions()}
            disabled={loadingOptions || submitting}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/75 transition hover:bg-white/10 active:scale-[0.98] disabled:opacity-50"
          >
            {loadingOptions ? 'Оновлюємо…' : 'Оновити список'}
          </button>
        </form>
      </div>
    </div>
  );
}
