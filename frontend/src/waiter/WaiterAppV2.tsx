import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { bookingsApi } from '../api/bookings';
import { clearAccessToken } from '../api/client';
import { staffApi, type StaffMember } from '../api/staff';
import { tablesApi } from '../api/tables';
import {
  waiterCallsApi,
  type WaiterAssignment,
  type WaiterCall,
} from '../api/waiterCalls';
import type { Booking } from '../api/types';
import WaiterTablesByLocation from './WaiterTablesByLocation';

const SESSION_KEY = 'molo_waiter_staff';
const SHIFT_ENDED_KEY = 'molo_waiter_shift_ended_name';
const ACTIVE = new Set(['pending', 'approved']);

const STATUS_LABELS: Record<string, string> = {
  pending: 'Очікує',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  cancelled: 'Скасовано',
  completed: 'Завершено',
  free: 'Вільний',
  reserved: 'Заброньований',
  occupied: 'Зайнятий',
  cleaning: 'Готується',
  closed: 'Закритий',
};

const LOCATIONS = [
  { key: 'hall', label: 'Зал ресторану', range: '1–14', accepts: (number: number) => number >= 1 && number <= 14 },
  { key: 'canopy', label: 'Навіс', range: '15–20', accepts: (number: number) => number >= 15 && number <= 20 },
  { key: 'gazebo', label: 'Велика альтанка', range: '21–36', accepts: (number: number) => number >= 21 && number <= 36 },
  { key: 'rotang', label: 'Ротанг', range: '37–39', accepts: (number: number) => number >= 37 && number <= 39 },
  { key: 'embankment', label: 'Набережна', range: '40–44', accepts: (number: number) => number >= 40 && number <= 44 },
  { key: 'glass_gazebo', label: 'Скляна альтанка', range: '45–50', accepts: (number: number) => number >= 45 && number <= 50 },
  { key: 'water_gazebo', label: 'Альтанка на воді', range: '100–109', accepts: (number: number) => number >= 100 && number <= 109 },
] as const;

function locationForTable(tableNumber: string | number | null | undefined) {
  const number = Number(tableNumber || 0);
  return LOCATIONS.find((location) => location.accepts(number)) || null;
}

function time(value?: string | null) {
  return String(value || '--:--').slice(0, 5);
}

function Login({ onLogin }: { onLogin: (staff: StaffMember) => void }) {
  const endedName = localStorage.getItem(SHIFT_ENDED_KEY);
  const [options, setOptions] = useState<{ id: string; fullName: string; role: string; isOnShift: boolean }[]>([]);
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    staffApi.getLoginOptions().then((value) => {
      const waiters = value.filter((person) => person.role === 'waiter');
      setOptions(waiters);
      setStaffId(waiters.find((person) => person.isOnShift)?.id || waiters[0]?.id || '');
    }).catch(() => setError('Не вдалося завантажити працівників.'));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) {
      setError('PIN має містити 4–6 цифр.');
      return;
    }

    try {
      setBusy(true);
      setError('');
      const result = await staffApi.loginWithPin(staffId, pin);
      if (result.staff.role !== 'waiter') throw new Error('Для пульта доступний лише Офіціант.');
      localStorage.removeItem(SHIFT_ENDED_KEY);
      localStorage.setItem(SESSION_KEY, JSON.stringify(result.staff));
      onLogin(result.staff);
    } catch (loginError: any) {
      setError(loginError?.message || 'Не вдалося увійти.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#020607] px-4 py-8 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(250,204,21,.16),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,.12),transparent_42%)]" />
      <div className="relative mx-auto max-w-md">
        {endedName && (
          <section className="mb-4 rounded-[28px] border border-amber-200/35 bg-black/50 p-5 text-center shadow-[0_0_34px_rgba(250,204,21,.10)] backdrop-blur-xl">
            <p className="text-xl font-black">Дякуємо за зміну, {endedName} 🤍</p>
            <p className="mt-2 text-sm text-white/55">Новий вхід доступний після відкриття зміни Адміністратором.</p>
          </section>
        )}

        <form onSubmit={submit} className="rounded-[32px] border border-amber-200/30 bg-black/55 p-6 shadow-[0_0_48px_rgba(250,204,21,.10)] backdrop-blur-xl">
          <p className="text-xs tracking-[.30em] text-amber-200">MOLO</p>
          <h1 className="mt-2 text-3xl font-black">Пульт Офіціанта</h1>
          <label className="mt-7 block text-sm text-white/65">Офіціант
            <select value={staffId} onChange={(event) => setStaffId(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/15 bg-black/70 p-4 text-white outline-none focus:border-amber-200/55">
              {options.map((option) => <option key={option.id} value={option.id} disabled={!option.isOnShift}>{option.fullName}{option.isOnShift ? '' : ' — не на зміні'}</option>)}
            </select>
          </label>
          <label className="mt-4 block text-sm text-white/65">PIN
            <input inputMode="numeric" pattern="[0-9]*" maxLength={6} type="password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} className="mt-2 w-full rounded-2xl border border-white/15 bg-black/70 p-4 text-xl tracking-[.4em] text-white outline-none focus:border-amber-200/55" />
          </label>
          {error && <p className="mt-3 rounded-xl border border-red-300/25 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}
          <button disabled={busy || !staffId} className="mt-6 w-full rounded-2xl border border-amber-200/65 bg-amber-300/15 p-4 font-black text-amber-100 shadow-[0_0_28px_rgba(250,204,21,.16)] transition active:scale-[.98] disabled:opacity-40">{busy ? 'Входимо…' : 'Увійти'}</button>
        </form>
      </div>
    </main>
  );
}

export default function WaiterAppV2() {
  const [staff, setStaff] = useState<StaffMember | null>(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  });
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [calls, setCalls] = useState<WaiterCall[]>([]);
  const [assignments, setAssignments] = useState<WaiterAssignment[]>([]);
  const [tab, setTab] = useState<'calls' | 'mine' | 'all' | 'history'>('calls');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [showTables, setShowTables] = useState(false);

  const logout = () => {
    localStorage.setItem(SHIFT_ENDED_KEY, staff?.fullName || '');
    localStorage.removeItem(SESSION_KEY);
    clearAccessToken();
    setStaff(null);
  };

  async function load() {
    if (!staff) return;
    try {
      const [bookingResult, callResult, assignmentResult] = await Promise.all([
        bookingsApi.getToday(), waiterCallsApi.list(), waiterCallsApi.assignments(),
      ]);
      setBookings(bookingResult);
      setCalls(callResult);
      setAssignments(assignmentResult);
      setError('');
    } catch (loadError: any) {
      if (/зміну|заблокований|архівований|авторизац/i.test(loadError?.message || '')) logout();
      else setError(loadError?.message || 'Не вдалося оновити дані.');
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [staff?.id]);

  const active = useMemo(() => bookings.filter((booking) => ACTIVE.has(booking.status)), [bookings]);
  const mine = useMemo(() => {
    const ids = new Set(assignments.filter((assignment) => assignment.waiterId === staff?.id).map((assignment) => assignment.bookingId));
    return active.filter((booking) => ids.has(booking.id));
  }, [active, assignments, staff?.id]);

  async function act(key: string, job: () => Promise<unknown>, success?: string) {
    try {
      setBusy(key);
      setError('');
      setNotice('');
      await job();
      if (success) setNotice(success);
      await load();
    } catch (actionError: any) {
      setError(actionError?.message || 'Дію не виконано.');
    } finally {
      setBusy('');
    }
  }

  if (!staff) return <Login onLogin={setStaff} />;

  const cards = tab === 'mine' ? mine : tab === 'history' ? bookings.filter((booking) => !ACTIVE.has(booking.status)) : active;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#020607] px-4 py-5 pb-28 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(250,204,21,.14),transparent_34%),radial-gradient(circle_at_90%_30%,rgba(34,211,238,.10),transparent_36%),linear-gradient(180deg,#020607,#071011_55%,#020607)]" />
      <div className="relative mx-auto max-w-4xl">
        <header className="rounded-[30px] border border-amber-200/25 bg-black/55 p-5 shadow-[0_0_46px_rgba(250,204,21,.08)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs tracking-[.28em] text-amber-200">MOLO</p><h1 className="mt-1 text-3xl font-black">Пульт Офіціанта</h1><p className="mt-2 text-white/60">Офіціант: {staff.fullName}</p></div>
            <button type="button" onClick={() => void load()} className="grid h-12 w-12 place-items-center rounded-2xl border border-amber-200/35 bg-amber-300/10 text-amber-100 shadow-[0_0_20px_rgba(250,204,21,.10)]"><RefreshCw size={19} /></button>
          </div>
          <nav className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([['calls', 'Виклики'], ['mine', 'Мої столи'], ['all', 'Усі бронювання'], ['history', 'Історія']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-2xl border px-3 py-3 font-black transition active:scale-[.98] ${tab === key ? 'border-amber-200/65 bg-amber-300/15 text-amber-100 shadow-[0_0_20px_rgba(250,204,21,.12)]' : 'border-white/10 bg-white/[.035] text-white/60'}`}>{label}{key === 'calls' && calls.length > 0 && <span className="ml-2 rounded-full border border-orange-300/60 px-2 py-1 text-xs text-orange-100">{calls.length}</span>}</button>
            ))}
          </nav>
          <button type="button" onClick={() => setShowTables(true)} className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[.035] px-3 py-3 font-black text-white/60 transition active:scale-[.98]">Столи</button>
        </header>

        {(error || notice) && <div className={`mt-4 rounded-2xl border p-3 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100'}`}>{error || notice}</div>}

        {tab === 'calls' ? (
          <section className="mt-4 grid gap-3">
            {calls.length > 0 ? calls.map((call) => (
              <article key={call.id} className={`rounded-[28px] border bg-black/55 p-4 backdrop-blur-xl ${call.status === 'new' ? 'animate-pulse border-orange-300/65 shadow-[0_0_28px_rgba(251,146,60,.24)]' : 'border-emerald-300/40'}`}>
                <div className="flex justify-between gap-3"><div><p className="text-sm text-white/55">Виклик Офіціанта</p><h2 className="text-2xl font-black">Стіл №{call.tableNumber || '—'}</h2><p className="text-white/60">{call.clientName || 'Гість'} · {new Date(call.createdAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}</p></div><span className="h-fit rounded-full border border-amber-200/45 px-3 py-1 text-xs text-amber-100">{call.status === 'accepted' ? 'Прийнято' : 'Новий'}</span></div>
                <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={Boolean(busy) || call.status === 'accepted'} onClick={() => void act(`accept:${call.id}`, () => waiterCallsApi.accept(call.id), 'Виклик прийнято')} className="rounded-2xl border border-amber-200/55 bg-amber-300/10 p-3 font-black text-amber-100 disabled:opacity-35">Прийняв</button><button type="button" disabled={Boolean(busy) || call.status !== 'accepted'} onClick={() => void act(`close:${call.id}`, () => waiterCallsApi.close(call.id), 'Виклик закрито')} className="rounded-2xl border border-emerald-200/50 bg-emerald-300/10 p-3 font-black text-emerald-100 disabled:opacity-35">Закрити виклик</button></div>
              </article>
            )) : <p className="rounded-[24px] border border-white/10 bg-black/45 p-6 text-center text-white/50">Нових викликів немає.</p>}
          </section>
        ) : (
          <section className="mt-4 grid gap-3">
            {cards.length > 0 ? cards.map((booking) => {
              const tableStatus = booking.table?.status;
              const checkedIn = Boolean(booking.checkedInAt);
              const displayStatus = booking.status === 'approved' && checkedIn && (tableStatus === 'occupied' || tableStatus === 'cleaning') ? tableStatus : booking.status;
              const primaryAction = booking.status !== 'approved' || !booking.table ? null
                : checkedIn && tableStatus === 'occupied'
                  ? { label: 'Гості пішли, почати прибирання', run: () => tablesApi.cleaning(booking.table!.id), tone: 'cyan' }
                  : checkedIn && tableStatus === 'cleaning'
                    ? { label: 'Стіл готовий', run: () => bookingsApi.complete(booking.id), tone: 'green' }
                    : !checkedIn && tableStatus !== 'occupied' && tableStatus !== 'cleaning' && tableStatus !== 'closed'
                      ? { label: 'Гість прийшов', run: () => bookingsApi.checkIn(booking.id).then(() => waiterCallsApi.assign({ bookingId: booking.id, tableId: booking.table?.id, tableNumber: booking.table?.tableNumber })), tone: 'gold' }
                      : null;
              return (
                <article key={booking.id} className="rounded-[28px] border border-white/12 bg-black/50 p-4 shadow-[0_0_30px_rgba(255,255,255,.03)] backdrop-blur-xl">
                  <div className="flex justify-between gap-3"><div><h2 className="text-2xl font-black">Стіл №{booking.table?.tableNumber || '—'}</h2><p className="mt-1 text-lg">{time(booking.bookingTime)} · {booking.client?.fullName || 'Гість'}</p><p className="text-sm text-white/50">{locationForTable(booking.table?.tableNumber)?.label || booking.table?.zone?.name || 'Без локації'} · {booking.guestsCount} гостей</p></div><span className="h-fit rounded-full border border-white/15 bg-white/[.04] px-3 py-1 text-sm text-white/65">{STATUS_LABELS[displayStatus || ''] || displayStatus}</span></div>
                  {booking.wishes && <p className="mt-3 rounded-xl border border-white/8 bg-white/[.025] p-3 text-sm text-white/55">{booking.wishes}</p>}
                  {primaryAction && <div className="mt-4 grid gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => window.confirm(`${primaryAction.label}?`) && void act(`primary:${booking.id}`, primaryAction.run, 'Статус столу оновлено')} className={`rounded-2xl border bg-white/[.03] p-3 font-black transition active:scale-[.98] ${primaryAction.tone === 'gold' ? 'border-amber-200/60 text-amber-100' : primaryAction.tone === 'cyan' ? 'border-cyan-200/55 text-cyan-100' : 'border-emerald-200/55 text-emerald-100'}`}>{primaryAction.label}</button></div>}
                </article>
              );
            }) : <p className="rounded-[24px] border border-white/10 bg-black/45 p-6 text-center text-white/50">Бронювань немає.</p>}
          </section>
        )}

        <button type="button" onClick={logout} className="mt-5 w-full rounded-2xl border border-white/10 bg-white/[.03] p-3 text-sm font-bold text-white/45">Завершити зміну</button>
      </div>

      {showTables && <WaiterTablesByLocation onClose={() => setShowTables(false)} />}
    </main>
  );
}
