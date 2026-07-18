import { useCallback, useEffect, useMemo, useState } from 'react';

import { clearAccessToken } from '../api/client';
import {
  hookahCallsApi,
  type HookahCall,
} from '../api/hookah-calls';
import {
  staffApi,
  type StaffLoginOption,
  type StaffMember,
} from '../api/staff';

type Tab = 'new' | 'mine';

const STAFF_STORAGE_KEY = 'molo_hookah_staff';

function readSavedStaff(): StaffMember | null {
  try {
    const raw = window.localStorage.getItem(STAFF_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StaffMember) : null;
  } catch {
    return null;
  }
}

function saveStaff(staff: StaffMember) {
  window.localStorage.setItem(STAFF_STORAGE_KEY, JSON.stringify(staff));
}

function removeSavedStaff() {
  window.localStorage.removeItem(STAFF_STORAGE_KEY);
}

function minutesSince(value: string) {
  const startedAt = new Date(value).getTime();
  if (!Number.isFinite(startedAt)) return 0;

  return Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
}

function formatTime(value: string | null) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function callLocation(call: HookahCall) {
  const table = call.tableNumber ? `Стіл ${call.tableNumber}` : 'Стіл не вказано';
  return call.zoneName ? `${table} · ${call.zoneName}` : table;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Сталася невідома помилка';
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-white/15 bg-white/[0.03] p-7 text-center text-sm text-white/55">
      {children}
    </div>
  );
}

function LoginScreen({
  onLoggedIn,
}: {
  onLoggedIn: (staff: StaffMember) => void;
}) {
  const [options, setOptions] = useState<StaffLoginOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [pin, setPin] = useState('');
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoadingOptions(true);
        setError(null);

        const result = await staffApi.getLoginOptions();
        const hookahWorkers = result.filter((item) => item.role === 'hookah');

        if (!active) return;

        setOptions(hookahWorkers);
        setSelectedId((current) => current || hookahWorkers[0]?.id || '');
      } catch (loadError) {
        if (active) setError(errorText(loadError));
      } finally {
        if (active) setLoadingOptions(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!selectedId) {
      setError('Оберіть кальянника');
      return;
    }

    if (!/^\d{4,6}$/.test(pin)) {
      setError('PIN має містити від 4 до 6 цифр');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const result = await staffApi.loginWithPin(selectedId, pin);

      if (result.staff.role !== 'hookah') {
        clearAccessToken();
        throw new Error('Цей профіль не є профілем кальянника');
      }

      saveStaff(result.staff);
      onLoggedIn(result.staff);
    } catch (loginError) {
      setError(errorText(loginError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <form
        onSubmit={submit}
        className="w-full rounded-[32px] border border-white/10 bg-neutral-950/90 p-5 shadow-2xl backdrop-blur"
      >
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-200/70">
            MOLO
          </p>
          <h1 className="mt-2 text-3xl font-black text-white">
            Вхід кальянника
          </h1>
          <p className="mt-2 text-sm leading-6 text-white/55">
            Оберіть свій профіль і введіть особистий PIN.
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <label className="block text-sm font-bold text-white/75">
          Кальянник
          <select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={loadingOptions || submitting}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-neutral-900 px-4 py-3 text-base text-white outline-none focus:border-amber-300/60"
          >
            {options.length === 0 && (
              <option value="">
                {loadingOptions
                  ? 'Завантаження…'
                  : 'Немає доступних профілів'}
              </option>
            )}

            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.fullName}
                {option.isOnShift ? ' · на зміні' : ' · не на зміні'}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block text-sm font-bold text-white/75">
          PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="••••"
            disabled={submitting}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-neutral-900 px-4 py-3 text-center text-2xl font-black tracking-[0.35em] text-white outline-none focus:border-amber-300/60"
          />
        </label>

        <button
          type="submit"
          disabled={
            submitting ||
            loadingOptions ||
            options.length === 0 ||
            !selectedId
          }
          className="mt-5 w-full rounded-2xl bg-amber-300 px-4 py-3 font-black text-neutral-950 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Вхід…' : 'Увійти'}
        </button>
      </form>
    </section>
  );
}

function NewCallCard({
  call,
  busy,
  onAccept,
}: {
  call: HookahCall;
  busy: boolean;
  onAccept: (call: HookahCall, etaMinutes: number) => void;
}) {
  const [eta, setEta] = useState(15);

  return (
    <article className="rounded-[28px] border border-amber-300/25 bg-amber-300/[0.06] p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-black text-white">
            {callLocation(call)}
          </p>
          <p className="mt-1 text-sm text-white/55">
            Очікує {minutesSince(call.createdAt)} хв · з {formatTime(call.createdAt)}
          </p>
        </div>

        <span className="rounded-full border border-amber-200/30 bg-amber-300/10 px-3 py-1 text-xs font-black text-amber-100">
          Новий
        </span>
      </div>

      {call.clientName && (
        <p className="mt-3 text-sm text-white/70">
          Гість: <span className="font-bold text-white">{call.clientName}</span>
        </p>
      )}

      <div className="mt-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-white/45">
          Час очікування
        </p>

        <div className="grid grid-cols-4 gap-2">
          {[10, 15, 20, 30].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setEta(value)}
              disabled={busy}
              className={`rounded-xl border px-2 py-2 text-sm font-black transition ${
                eta === value
                  ? 'border-amber-200 bg-amber-300 text-neutral-950'
                  : 'border-white/10 bg-white/5 text-white/70'
              }`}
            >
              {value} хв
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onAccept(call, eta)}
        disabled={busy}
        className="mt-4 w-full rounded-2xl bg-amber-300 px-4 py-3 font-black text-neutral-950 transition active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? 'Приймаю…' : `Прийняти · ${eta} хв`}
      </button>
    </article>
  );
}

function MyCallCard({
  call,
  busy,
  onComplete,
}: {
  call: HookahCall;
  busy: boolean;
  onComplete: (call: HookahCall) => void;
}) {
  return (
    <article className="rounded-[28px] border border-emerald-300/20 bg-emerald-300/[0.05] p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-black text-white">
            {callLocation(call)}
          </p>
          <p className="mt-1 text-sm text-white/55">
            Прийнято о {formatTime(call.acceptedAt)}
          </p>
        </div>

        <span className="rounded-full border border-emerald-200/30 bg-emerald-300/10 px-3 py-1 text-xs font-black text-emerald-100">
          {call.etaMinutes ? `${call.etaMinutes} хв` : 'У роботі'}
        </span>
      </div>

      {call.clientName && (
        <p className="mt-3 text-sm text-white/70">
          Гість: <span className="font-bold text-white">{call.clientName}</span>
        </p>
      )}

      <button
        type="button"
        onClick={() => onComplete(call)}
        disabled={busy}
        className="mt-4 w-full rounded-2xl border border-emerald-200/40 bg-emerald-300/15 px-4 py-3 font-black text-emerald-100 transition active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? 'Завершення…' : 'Виконано'}
      </button>
    </article>
  );
}

export default function HookahApp() {
  const [staff, setStaff] = useState<StaffMember | null>(() => readSavedStaff());
  const [tab, setTab] = useState<Tab>('new');
  const [activeCalls, setActiveCalls] = useState<HookahCall[]>([]);
  const [myCalls, setMyCalls] = useState<HookahCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const newCalls = useMemo(
    () => activeCalls.filter((call) => call.status === 'new'),
    [activeCalls],
  );

  const loadCalls = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      const [active, mine] = await Promise.all([
        hookahCallsApi.getActive(),
        hookahCallsApi.getMine(),
      ]);

      setActiveCalls(active);
      setMyCalls(mine);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!staff) return;

    void loadCalls();

    const interval = window.setInterval(() => {
      void loadCalls(true);
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [loadCalls, staff]);

  useEffect(() => {
    if (!success) return;

    const timeout = window.setTimeout(() => setSuccess(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [success]);

  function logout() {
    clearAccessToken();
    removeSavedStaff();
    setStaff(null);
    setActiveCalls([]);
    setMyCalls([]);
    setError(null);
    setSuccess(null);
  }

  async function acceptCall(call: HookahCall, etaMinutes: number) {
    try {
      setBusyId(call.id);
      setError(null);

      const result = await hookahCallsApi.accept(call.id, etaMinutes);
      setSuccess(result.message);
      setTab('mine');
      await loadCalls(true);
    } catch (acceptError) {
      setError(errorText(acceptError));
      await loadCalls(true);
    } finally {
      setBusyId(null);
    }
  }

  async function completeCall(call: HookahCall) {
    const confirmed = window.confirm(
      `Позначити виклик для ${callLocation(call)} як виконаний?`,
    );

    if (!confirmed) return;

    try {
      setBusyId(call.id);
      setError(null);

      const result = await hookahCallsApi.complete(call.id);
      setSuccess(result.message);
      await loadCalls(true);
    } catch (completeError) {
      setError(errorText(completeError));
    } finally {
      setBusyId(null);
    }
  }

  if (!staff) {
    return <LoginScreen onLoggedIn={setStaff} />;
  }

  return (
    <section className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-28 pt-5">
      <header className="rounded-[30px] border border-white/10 bg-neutral-950/85 p-4 shadow-xl backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200/65">
              Кальянна служба
            </p>
            <h1 className="mt-1 text-2xl font-black text-white">
              {staff.fullName}
            </h1>
            <p className="mt-1 text-sm text-white/50">
              {staff.isOnShift ? 'Зміна активна' : 'Зміна не активна'}
            </p>
          </div>

          <button
            type="button"
            onClick={logout}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white/65"
          >
            Вийти
          </button>
        </div>

        {!staff.isOnShift && (
          <div className="mt-4 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            Ви не на зміні. Приймати нові виклики не можна.
          </div>
        )}
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-neutral-950/80 p-2">
        <button
          type="button"
          onClick={() => setTab('new')}
          className={`rounded-xl px-3 py-3 text-sm font-black ${
            tab === 'new'
              ? 'bg-amber-300 text-neutral-950'
              : 'bg-white/5 text-white/65'
          }`}
        >
          Нові виклики · {newCalls.length}
        </button>

        <button
          type="button"
          onClick={() => setTab('mine')}
          className={`rounded-xl px-3 py-3 text-sm font-black ${
            tab === 'mine'
              ? 'bg-emerald-300 text-neutral-950'
              : 'bg-white/5 text-white/65'
          }`}
        >
          Мої виклики · {myCalls.length}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-red-300/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-4 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          {success}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {loading ? (
          <EmptyState>Завантаження викликів…</EmptyState>
        ) : tab === 'new' ? (
          newCalls.length > 0 ? (
            newCalls.map((call) => (
              <NewCallCard
                key={call.id}
                call={call}
                busy={busyId === call.id || !staff.isOnShift}
                onAccept={acceptCall}
              />
            ))
          ) : (
            <EmptyState>Нових викликів немає</EmptyState>
          )
        ) : myCalls.length > 0 ? (
          myCalls.map((call) => (
            <MyCallCard
              key={call.id}
              call={call}
              busy={busyId === call.id}
              onComplete={completeCall}
            />
          ))
        ) : (
          <EmptyState>У вас немає активних викликів</EmptyState>
        )}
      </div>

      <button
        type="button"
        onClick={() => void loadCalls()}
        disabled={loading}
        className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/65 transition active:scale-[0.98] disabled:opacity-40"
      >
        Оновити
      </button>
    </section>
  );
}
