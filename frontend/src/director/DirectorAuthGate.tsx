import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';

import { clearAccessToken, getAccessToken } from '../api/client';
import { staffApi } from '../api/staff';
import type { StaffLoginOption } from '../api/staff';

type Props = {
  children: ReactNode;
};

type TokenPayload = {
  role?: string;
  exp?: number;
};

function readTokenPayload(): TokenPayload | null {
  const token = getAccessToken();
  if (!token) return null;

  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as TokenPayload;
  } catch {
    return null;
  }
}

function hasValidOwnerToken(): boolean {
  const payload = readTokenPayload();
  if (!payload || payload.role !== 'owner') return false;
  if (payload.exp && payload.exp * 1000 <= Date.now()) return false;
  return true;
}

export default function DirectorAuthGate({ children }: Props) {
  const [options, setOptions] = useState<StaffLoginOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const directors = useMemo(
    () => options.filter((option) => option.role === 'owner'),
    [options],
  );

  useEffect(() => {
    let active = true;

    async function initialize() {
      if (hasValidOwnerToken()) {
        try {
          await staffApi.getAll();
          if (active) {
            setAuthenticated(true);
            setChecking(false);
          }
          return;
        } catch {
          clearAccessToken();
        }
      } else {
        clearAccessToken();
      }

      try {
        const values = await staffApi.getLoginOptions();
        if (!active) return;
        setOptions(values);
        const firstDirector = values.find((option) => option.role === 'owner');
        setSelectedId(firstDirector?.id || '');
      } catch (cause: any) {
        if (active) setError(cause?.message || 'Не вдалося завантажити вхід Директора');
      } finally {
        if (active) setChecking(false);
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !pin.trim()) {
      setError('Оберіть Директора та введіть PIN');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await staffApi.loginWithPin(selectedId, pin.trim());
      if (result.user.role !== 'owner') {
        clearAccessToken();
        throw new Error('Цей доступ не належить Директору');
      }
      setAuthenticated(true);
    } catch (cause: any) {
      setError(cause?.message || 'Невірний PIN');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center bg-black p-5 text-white">
        <LoaderCircle className="animate-spin text-amber-200" size={28} />
      </div>
    );
  }

  if (authenticated) return <>{children}</>;

  return (
    <div className="grid min-h-screen place-items-center bg-black p-4 text-white">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-[28px] border border-amber-200/25 bg-neutral-950 p-5 shadow-[0_0_45px_rgba(251,191,36,.08)]"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-amber-200/35 bg-amber-300/10 text-amber-100">
            <ShieldCheck size={23} />
          </span>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-100/50">MOLO</p>
            <h1 className="mt-1 text-2xl font-black">Вхід Директора</h1>
          </div>
        </div>

        <label className="mt-6 block text-xs font-bold text-white/45">Директор</label>
        <select
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/40 px-4 text-sm outline-none focus:border-amber-200/40"
        >
          <option value="">Оберіть Директора</option>
          {directors.map((option) => (
            <option key={option.id} value={option.id}>{option.fullName}</option>
          ))}
        </select>

        <label className="mt-4 block text-xs font-bold text-white/45">Особистий PIN</label>
        <div className="relative mt-2">
          <KeyRound size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
            inputMode="numeric"
            type="password"
            autoComplete="current-password"
            placeholder="Введіть PIN"
            className="h-12 w-full rounded-2xl border border-white/10 bg-black/40 pl-11 pr-4 text-sm outline-none focus:border-amber-200/40"
          />
        </div>

        {error && <div className="mt-4 rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}

        <button
          type="submit"
          disabled={submitting || directors.length === 0}
          className="mt-5 w-full rounded-2xl border border-amber-200/45 bg-amber-300/15 px-4 py-3 text-sm font-black text-amber-100 shadow-[0_0_24px_rgba(251,191,36,.1)] disabled:opacity-40"
        >
          {submitting ? 'Перевіряємо...' : 'Увійти до пульта'}
        </button>
      </form>
    </div>
  );
}
