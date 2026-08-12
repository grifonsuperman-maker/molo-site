import { useEffect, useState, type FormEvent } from 'react';

import {
  staffApi,
  type StaffAuthUser,
  type TelegramStaffInviteInfo,
} from '../api/staff';
import { getTelegramWebApp } from './telegramRuntime';

export function readTelegramStaffInviteToken() {
  const value = new URLSearchParams(window.location.search).get(
    'tgWebAppStartParam',
  );

  if (!value?.startsWith('staff_')) return null;
  return value;
}

type Props = {
  token: string;
  onLinked: (user: StaffAuthUser) => void;
};

function roleLabel(role: TelegramStaffInviteInfo['role']) {
  if (role === 'owner') return 'Директор';
  if (role === 'admin') return 'Адміністратор';
  if (role === 'hookah') return 'Кальянник';
  return 'Офіціант';
}

export default function TelegramStaffLinkGate({ token, onLinked }: Props) {
  const [info, setInfo] = useState<TelegramStaffInviteInfo | null>(null);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await staffApi.getTelegramInviteInfo(token);
        if (!cancelled) setInfo(result);
      } catch (cause: any) {
        if (!cancelled) {
          setError(cause?.message || 'Посилання для прив’язки недійсне');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();

    const telegram = getTelegramWebApp();
    const initData = telegram?.initData;

    if (!initData) {
      setError('Відкрийте це посилання саме в Telegram');
      return;
    }

    if (!info) return;

    try {
      setSubmitting(true);
      setError(null);
      const result = await staffApi.confirmTelegramInvite({
        token,
        initData,
        ...(info.authType === 'pin' ? { pin } : { password }),
      });
      onLinked(result.user);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося прив’язати Telegram');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-[#080808] px-4 py-8 text-white">
      <div className="w-full max-w-md rounded-[30px] border border-sky-300/20 bg-neutral-950 p-5 shadow-[0_0_60px_rgba(56,189,248,.10)]">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-200/60">
          MOLO · Telegram
        </p>
        <h1 className="mt-2 text-2xl font-black">Прив’язка робочого акаунта</h1>

        {loading && (
          <p className="mt-5 text-sm text-white/55">Перевіряємо посилання…</p>
        )}

        {!loading && error && !info && (
          <div className="mt-5 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        {!loading && info && (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="font-black">{info.fullName}</p>
              <p className="mt-1 text-sm text-white/50">{roleLabel(info.role)}</p>
            </div>

            {info.authType === 'pin' ? (
              <label className="block text-sm font-bold text-white/70">
                Ваш робочий PIN
                <input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  placeholder="4–6 цифр"
                  className="mt-2 w-full rounded-2xl border border-white/12 bg-black/50 px-4 py-3 text-center text-xl font-black tracking-[0.3em] outline-none focus:border-sky-200/45"
                />
              </label>
            ) : (
              <label className="block text-sm font-bold text-white/70">
                Пароль Директора
                <input
                  autoFocus
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-white/12 bg-black/50 px-4 py-3 outline-none focus:border-sky-200/45"
                />
              </label>
            )}

            {error && (
              <div className="rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={
                submitting ||
                (info.authType === 'pin'
                  ? !/^\d{4,6}$/.test(pin)
                  : !password.trim())
              }
              className="w-full rounded-2xl bg-sky-200 px-4 py-3 font-black text-neutral-950 transition active:scale-[0.98] disabled:opacity-40"
            >
              {submitting ? 'Прив’язуємо…' : 'Підтвердити та прив’язати Telegram'}
            </button>

            <p className="text-center text-xs leading-relaxed text-white/35">
              Після підтвердження це посилання більше не працюватиме.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
