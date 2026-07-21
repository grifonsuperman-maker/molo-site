import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { bookingsApi } from '../api/bookings';
import { tablesApi } from '../api/tables';
import { waiterCallsApi } from '../api/waiterCalls';
import type { WaiterAssignment, WaiterCall } from '../api/waiterCalls';
import type { Booking } from '../api/types';
import { usePersistentState } from '../hooks/usePersistentState';
import { clearAccessToken } from '../api/client';
import { staffApi, type StaffLoginOption } from '../api/staff';

type LocationKey =
  | 'hall'
  | 'canopy'
  | 'gazebo'
  | 'rotang'
  | 'embankment'
  | 'glass_gazebo'
  | 'water_gazebo'
  | 'other';

type WaiterView =
  | { kind: 'calls' }
  | { kind: 'my_tables' }
  | { kind: 'all_locations' }
  | { kind: 'location'; location: LocationKey }
  | { kind: 'history' };

type LocationInfo = {
  key: LocationKey;
  label: string;
  description: string;
};

type BookingAction = {
  key: 'arrived' | 'cleaning' | 'ready';
  label: string;
  confirmText: string;
  tone: 'amber' | 'cyan' | 'green';
};

const LOCATIONS: LocationInfo[] = [
  { key: 'hall', label: 'Зал ресторану', description: 'Столи 1–14' },
  { key: 'canopy', label: 'Навіс', description: 'Столи 15–20' },
  { key: 'gazebo', label: 'Велика альтанка', description: 'Столи 21–36' },
  { key: 'rotang', label: 'Ротанг', description: 'Столи 37–39' },
  { key: 'embankment', label: 'Набережна', description: 'Столи 40–44' },
  { key: 'glass_gazebo', label: 'Скляна альтанка', description: 'Столи 45–50' },
  { key: 'water_gazebo', label: 'Альтанка на воді', description: 'Столи 100–109' },
  { key: 'other', label: 'Інші столи', description: 'Столи без локації' },
];

const STATUS_LABELS: Record<string, string> = {
  pending: 'Очікує',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  cancelled: 'Скасовано',
  completed: 'Завершено',
  free: 'Вільний',
  reserved: 'Підтверджено',
  occupied: 'Зайнятий',
  cleaning: 'Готується',
  closed: 'Закритий',
};

const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);
const HISTORY_BOOKING_STATUSES = new Set(['completed', 'cancelled', 'rejected']);

function todayInKyiv() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';

  return `${year}-${month}-${day}`;
}

function normalizeDate(value: string) {
  return String(value || '').slice(0, 10);
}

function timeLabel(value: string | null | undefined) {
  if (!value) return '--:--';
  const [hours = '00', minutes = '00'] = String(value).split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function tableNumber(booking: Booking) {
  return Number(booking.table?.tableNumber || 0);
}

function getLocationKeyByTableNumber(value: number): LocationKey {
  if (value >= 1 && value <= 14) return 'hall';
  if (value >= 15 && value <= 20) return 'canopy';
  if (value >= 21 && value <= 36) return 'gazebo';
  if (value >= 37 && value <= 39) return 'rotang';
  if (value >= 40 && value <= 44) return 'embankment';
  if (value >= 45 && value <= 50) return 'glass_gazebo';
  if (value >= 100 && value <= 109) return 'water_gazebo';
  return 'other';
}

function getBookingLocationKey(booking: Booking): LocationKey {
  return getLocationKeyByTableNumber(tableNumber(booking));
}

function sortBookings(a: Booking, b: Booking) {
  const byTime = String(a.bookingTime || '').localeCompare(String(b.bookingTime || ''));
  if (byTime !== 0) return byTime;
  return tableNumber(a) - tableNumber(b);
}

function statusClass(status: string) {
  if (status === 'pending') return 'border-sky-300/40 bg-sky-400/10 text-sky-100';
  if (status === 'approved' || status === 'reserved') {
    return 'border-amber-300/40 bg-amber-400/10 text-amber-100';
  }
  if (status === 'occupied') return 'border-red-300/40 bg-red-400/10 text-red-100';
  if (status === 'cleaning') return 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100';
  if (status === 'completed') return 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100';
  if (status === 'rejected' || status === 'cancelled') {
    return 'border-neutral-500/40 bg-neutral-500/10 text-neutral-300';
  }
  return 'border-white/15 bg-white/5 text-white/70';
}

type WaiterSession = { waiterId: string; waiterName: string };
const WAITER_SESSION_KEY = 'molo_waiter_staff_session';

function readWaiterSession(): WaiterSession | null {
  try {
    const value = window.localStorage.getItem(WAITER_SESSION_KEY);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
}

function LoginScreen({ onLogin }: { onLogin: (session: WaiterSession) => void }) {
  const [options, setOptions] = useState<StaffLoginOption[]>([]);
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { staffApi.getLoginOptions().then((items) => setOptions(items.filter((item) => item.role === 'waiter'))).catch((e) => setError(e.message || 'Не вдалося завантажити список офіціантів')); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) { setError('PIN має містити від 4 до 6 цифр'); return; }
    try { setBusy(true); setError(null); const result = await staffApi.loginWithPin(staffId, pin); const session = { waiterId: result.staff.id, waiterName: result.staff.fullName }; window.localStorage.setItem(WAITER_SESSION_KEY, JSON.stringify(session)); onLogin(session); } catch (e: any) { setError(e.message || 'Не вдалося увійти'); } finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-[#10100f] px-4 py-8 text-white"><form onSubmit={submit} className="mx-auto max-w-md rounded-[30px] border border-amber-200/30 bg-neutral-900/90 p-6 shadow-[0_0_36px_rgba(251,191,36,.08)]"><p className="text-xs uppercase tracking-[.28em] text-amber-200/70">MOLO Restaurant</p><h1 className="mt-3 text-3xl font-black">Вхід офіціанта</h1><p className="mt-2 text-sm text-white/60">Оберіть себе та введіть PIN. Вхід доступний лише під час відкритої зміни.</p>{error && <p className="mt-4 rounded-2xl border border-red-300/35 p-3 text-sm text-red-100">{error}</p>}<label className="mt-5 block text-sm font-semibold">Офіціант<select required value={staffId} onChange={(e) => setStaffId(e.target.value)} className="mt-2 w-full rounded-2xl border border-white/15 bg-black/30 p-3 text-white"><option value="">Оберіть офіціанта</option>{options.map((item) => <option key={item.id} value={item.id} disabled={!item.isOnShift}>{item.fullName}{item.isOnShift ? '' : ' — не на зміні'}</option>)}</select></label><label className="mt-4 block text-sm font-semibold">PIN<input required inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="mt-2 w-full rounded-2xl border border-white/15 bg-black/30 p-3 text-xl tracking-[.45em] text-white" /></label><button disabled={busy || !staffId} className="mt-6 w-full rounded-2xl border border-amber-200/60 bg-amber-300/10 p-3 font-black text-amber-100 transition duration-150 active:scale-[.98] disabled:opacity-40">{busy ? 'Входимо...' : 'Увійти'}</button></form></main>;
}

function isValidView(value: WaiterView) {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;

  if (
    value.kind === 'calls' ||
    value.kind === 'my_tables' ||
    value.kind === 'all_locations' ||
    value.kind === 'history'
  ) {
    return true;
  }

  return (
    value.kind === 'location' &&
    LOCATIONS.some((location) => location.key === value.location)
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  tone: 'amber' | 'cyan' | 'green';
}) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-200/60 bg-amber-300/15 text-amber-100 active:bg-amber-300/25'
      : tone === 'cyan'
        ? 'border-cyan-200/50 bg-cyan-300/12 text-cyan-100 active:bg-cyan-300/20'
        : 'border-emerald-200/50 bg-emerald-400/15 text-emerald-100 active:bg-emerald-400/25';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-2xl border px-4 py-3 text-sm font-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-white/15 bg-white/[0.03] p-6 text-center text-sm text-white/55">
      {text}
    </div>
  );
}

export default function WaiterApp() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [calls, setCalls] = useState<WaiterCall[]>([]);
  const [assignments, setAssignments] = useState<WaiterAssignment[]>([]);
  const [view, setView] = usePersistentState<WaiterView>('molo_waiter_view', {
    kind: 'calls',
  });
  const [today, setToday] = useState(() => todayInKyiv());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [waiter, setWaiter] = useState<WaiterSession | null>(() => readWaiterSession());
  const [shiftEnded, setShiftEnded] = useState<string | null>(null);
  const [transferBooking, setTransferBooking] = useState<Booking | null>(null);
  const [transferTables, setTransferTables] = useState<Record<string, { tableId: string; tableNumber: string; status: string }>>({});
  const currentWaiter = waiter || { waiterId: '', waiterName: '' };

  function endSession(name: string) {
    window.localStorage.removeItem(WAITER_SESSION_KEY);
    clearAccessToken();
    setWaiter(null);
    setShiftEnded(name);
  }

  useEffect(() => {
    if (!isValidView(view)) {
      setView({ kind: 'calls' });
    }
  }, [setView, view]);

  const todayBookings = useMemo(() => {
    return bookings
      .filter((booking) => normalizeDate(booking.bookingDate) === today)
      .sort(sortBookings);
  }, [bookings, today]);

  const activeTodayBookings = useMemo(
    () => todayBookings.filter((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status)),
    [todayBookings],
  );

  const historyTodayBookings = useMemo(
    () => todayBookings.filter((booking) => HISTORY_BOOKING_STATUSES.has(booking.status)),
    [todayBookings],
  );

  const myTableNumbers = useMemo(() => {
    return new Set(
      assignments
        .map((assignment) => String(assignment.tableNumber || ''))
        .filter(Boolean),
    );
  }, [assignments]);

  const myBookings = useMemo(() => {
    return activeTodayBookings.filter((booking) =>
      myTableNumbers.has(String(booking.table?.tableNumber || '')),
    );
  }, [activeTodayBookings, myTableNumbers]);

  const myCalls = useMemo(
    () => calls.filter((call) => call.waiterId === currentWaiter.waiterId),
    [calls, currentWaiter.waiterId],
  );

  const commonCalls = useMemo(
    () => calls.filter((call) => !call.waiterId),
    [calls],
  );

  const selectedLocation =
    view.kind === 'location'
      ? LOCATIONS.find((location) => location.key === view.location) || null
      : null;

  const selectedLocationBookings = useMemo(() => {
    if (view.kind !== 'location') return [];

    return activeTodayBookings.filter(
      (booking) => getBookingLocationKey(booking) === view.location,
    );
  }, [activeTodayBookings, view]);

  async function load() {
    if (!waiter) return;
    try {
      setLoading(true);
      setError(null);

      const kyivToday = todayInKyiv();
      setToday(kyivToday);

      const [staff, bookingsResult, callsResult, assignmentsResult] = await Promise.all([
        staffApi.getOne(currentWaiter.waiterId),
        bookingsApi.getToday(),
        waiterCallsApi.list(currentWaiter.waiterId),
        waiterCallsApi.assignments(currentWaiter.waiterId),
      ]);

      if (!staff.active || staff.isArchived || !staff.isOnShift) { endSession(currentWaiter.waiterName); return; }

      setBookings(bookingsResult);
      setCalls(callsResult);
      setAssignments(assignmentsResult);
    } catch (loadError: any) {
      setError(loadError?.message || 'Не вдалося завантажити дані офіціанта');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 15000);
    return () => window.clearInterval(interval);
  }, [waiter?.waiterId]);

  async function runAction(
    actionKey: string,
    successMessage: string,
    action: () => Promise<unknown>,
  ) {
    if (busyAction) return;

    try {
      setBusyAction(actionKey);
      setError(null);
      setSuccess(null);

      await action();
      await load();

      setSuccess(successMessage);
      window.setTimeout(() => setSuccess(null), 2500);
    } catch (actionError: any) {
      setError(actionError?.message || 'Дія не виконана');
    } finally {
      setBusyAction(null);
    }
  }

  async function openTransfer(booking: Booking) {
    try {
      setTransferBooking(booking); setError(null);
      const result = await bookingsApi.tableStatuses({ bookingDate: booking.bookingDate, bookingTime: booking.bookingTime, durationMinutes: booking.durationMinutes });
      setTransferTables(result.statuses);
    } catch (e: any) { setTransferBooking(null); setError(e.message || 'Не вдалося завантажити столи'); }
  }

  function transferTo(tableId: string) {
    if (!transferBooking) return;
    const oldNumber = transferBooking.table?.tableNumber || '-';
    const newNumber = transferTables[tableId]?.tableNumber || '-';
    if (!window.confirm(`Пересадити гостей зі столу №${oldNumber} на стіл №${newNumber}?`)) return;
    runAction(`${transferBooking.id}:transfer`, `Гостей пересаджено за стіл №${newNumber}`, async () => { await bookingsApi.waiterChangeTable(transferBooking.id, tableId); setTransferBooking(null); });
  }

  function getBookingAction(booking: Booking): BookingAction | null {
    if (booking.status !== 'approved' || !booking.table?.id) return null;

    if (booking.table.status === 'occupied') {
      return {
        key: 'cleaning',
        label: 'Гості пішли, почати прибирання',
        confirmText: 'Гості пішли та можна починати прибирання?',
        tone: 'cyan',
      };
    }

    if (booking.table.status === 'cleaning') {
      return {
        key: 'ready',
        label: 'Стіл готовий',
        confirmText: 'Прибирання завершено і стіл готовий?',
        tone: 'green',
      };
    }

    if (booking.table.status === 'reserved' || booking.table.status === 'free') {
      return {
        key: 'arrived',
        label: 'Гість прийшов',
        confirmText: 'Гість уже прийшов?',
        tone: 'amber',
      };
    }

    return null;
  }

  function performBookingAction(booking: Booking, action: BookingAction) {
    const number = booking.table?.tableNumber || '-';
    const confirmed = window.confirm(
      `Стіл №${number}\n\n${action.confirmText}`,
    );

    if (!confirmed) return;

    if (action.key === 'arrived') {
      runAction(`${booking.id}:arrived`, `Стіл №${number}: гість прийшов`, async () => {
        await bookingsApi.checkIn(booking.id);
        await waiterCallsApi.assign({
          bookingId: booking.id,
          tableId: booking.table?.id || null,
          tableNumber: booking.table?.tableNumber || null,
          waiterId: currentWaiter.waiterId,
          waiterName: currentWaiter.waiterName,
        });
      });
      return;
    }

    if (action.key === 'cleaning') {
      runAction(
        `${booking.id}:cleaning`,
        `Стіл №${number}: розпочато прибирання`,
        () => tablesApi.cleaning(booking.table!.id),
      );
      return;
    }

    runAction(
      `${booking.id}:ready`,
      `Стіл №${number}: готовий`,
      () => bookingsApi.complete(booking.id),
    );
  }

  function acceptCall(call: WaiterCall) {
    runAction(
      `call:${call.id}:accept`,
      `Виклик столу №${call.tableNumber || '-'} прийнято`,
      () =>
        waiterCallsApi.accept(call.id, {
          waiterId: currentWaiter.waiterId,
          waiterName: currentWaiter.waiterName,
        }),
    );
  }

  function closeCall(call: WaiterCall) {
    runAction(
      `call:${call.id}:close`,
      `Виклик столу №${call.tableNumber || '-'} закрито`,
      () => waiterCallsApi.close(call.id),
    );
  }

  function renderCallCard(call: WaiterCall) {
    const assignedToMe = call.waiterId === currentWaiter.waiterId;

    return (
      <article
        key={call.id}
        className="rounded-[28px] border border-amber-200/35 bg-amber-300/10 p-4 text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.08)]"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-amber-100/65">
              Виклик офіціанта
            </p>

            <h2 className="mt-1 text-2xl font-black">
              Стіл №{call.tableNumber || '-'}
            </h2>

            <p className="mt-1 text-sm text-white/70">
              Гість: {call.clientName || '-'} ·{' '}
              {new Date(call.createdAt).toLocaleTimeString('uk-UA', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>

            <p className="mt-1 text-xs text-white/50">
              {assignedToMe
                ? 'Це твій стіл'
                : call.waiterName
                  ? `Закріплено: ${call.waiterName}`
                  : 'Загальний виклик без офіціанта'}
            </p>
          </div>

          <span
            className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${
              call.status === 'accepted'
                ? 'border-emerald-200/35 bg-emerald-400/10 text-emerald-100'
                : 'border-amber-200/45 bg-black/20 text-amber-100'
            }`}
          >
            {call.status === 'accepted' ? 'Прийнято' : 'Новий'}
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => acceptCall(call)}
            disabled={Boolean(busyAction) || call.status === 'accepted'}
            className="rounded-2xl border border-amber-200/60 bg-amber-300/15 px-3 py-3 text-sm font-semibold text-amber-100 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === `call:${call.id}:accept` ? 'Зачекайте...' : 'Прийняв'}
          </button>

          <button
            type="button"
            onClick={() => closeCall(call)}
            disabled={Boolean(busyAction)}
            className="rounded-2xl border border-emerald-200/50 bg-emerald-400/15 px-3 py-3 text-sm font-semibold text-emerald-100 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busyAction === `call:${call.id}:close`
              ? 'Закриваємо...'
              : 'Закрити виклик'}
          </button>
        </div>
      </article>
    );
  }

  function renderBookingCard(booking: Booking) {
    const location = LOCATIONS.find(
      (item) => item.key === getBookingLocationKey(booking),
    );
    const isMyTable = myTableNumbers.has(
      String(booking.table?.tableNumber || ''),
    );
    const action = getBookingAction(booking);
    const visibleStatus =
      booking.status === 'approved'
        ? booking.table?.status || booking.status
        : booking.status;
    const actionKey = action ? `${booking.id}:${action.key}` : null;

    return (
      <article
        key={booking.id}
        className={`rounded-[30px] border p-4 shadow-[0_0_34px_rgba(0,0,0,.18)] ${
          isMyTable
            ? 'border-emerald-300/35 bg-emerald-400/10'
            : 'border-white/10 bg-neutral-900/90'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-2xl border border-amber-200/40 bg-amber-300/12 px-3 py-1 text-sm font-black text-amber-100">
                Стіл №{booking.table?.tableNumber || '-'}
              </span>

              <span
                className={`rounded-2xl border px-3 py-1 text-xs font-semibold ${statusClass(
                  visibleStatus,
                )}`}
              >
                {STATUS_LABELS[visibleStatus] || visibleStatus}
              </span>

              {isMyTable && (
                <span className="rounded-2xl border border-emerald-200/40 bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                  Мій стіл
                </span>
              )}
            </div>

            <h2 className="mt-3 text-xl font-semibold text-white">
              {timeLabel(booking.bookingTime)} ·{' '}
              {booking.client?.fullName || 'Гість'}
            </h2>

            <p className="mt-1 text-sm text-white/60">
              {location?.label || 'Локація не визначена'} · {booking.guestsCount}{' '}
              гостей
            </p>

          </div>
        </div>

        {booking.wishes && (
          <p className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm leading-snug text-white/70">
            {booking.wishes}
          </p>
        )}

        {action && actionKey && (
          <div className="mt-4">
            <ActionButton
              tone={action.tone}
              onClick={() => performBookingAction(booking, action)}
              disabled={Boolean(busyAction)}
            >
              {busyAction === actionKey ? 'Зачекайте...' : action.label}
            </ActionButton>
          </div>
        )}

        {booking.status === 'approved' && (
          <button type="button" onClick={() => openTransfer(booking)} disabled={Boolean(busyAction)} className="mt-3 w-full rounded-2xl border border-amber-100/65 bg-white/[.03] px-4 py-3 text-sm font-black text-amber-50 shadow-[0_0_20px_rgba(251,191,36,.12)] transition duration-150 active:scale-[.98] disabled:opacity-40">Змінити стіл</button>
        )}

        {!action && ACTIVE_BOOKING_STATUSES.has(booking.status) && (
          <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/55">
            {booking.status === 'pending'
              ? 'Очікує підтвердження Адміністратора.'
              : 'Для цього стану дій Офіціанта немає.'}
          </p>
        )}
      </article>
    );
  }

  function renderPrimaryTabs() {
    return (
      <div className="grid grid-cols-2 gap-2 rounded-[24px] border border-white/10 bg-black/25 p-2">
        <button
          type="button"
          onClick={() => setView({ kind: 'calls' })}
          className={`rounded-2xl px-4 py-3 text-sm font-black transition ${
            view.kind === 'calls'
              ? 'bg-amber-300 text-neutral-950'
              : 'bg-white/5 text-white/75'
          }`}
        >
          Виклики{calls.length > 0 ? ` · ${calls.length}` : ''}
        </button>

        <button
          type="button"
          onClick={() => setView({ kind: 'my_tables' })}
          className={`rounded-2xl px-4 py-3 text-sm font-black transition ${
            view.kind === 'my_tables'
              ? 'bg-emerald-300 text-neutral-950'
              : 'bg-white/5 text-white/75'
          }`}
        >
          Мої столи{myBookings.length > 0 ? ` · ${myBookings.length}` : ''}
        </button>
      </div>
    );
  }

  if (!waiter) {
    if (shiftEnded) return <main className="min-h-screen bg-[#10100f] px-4 py-8 text-white"><section className="mx-auto max-w-md rounded-[30px] border border-white/15 bg-neutral-900/90 p-6 text-center shadow-[0_0_34px_rgba(255,255,255,.06)]"><h1 className="text-2xl font-black">Дякуємо за сьогоднішню зміну, {shiftEnded} 🤍</h1><p className="mt-4 text-white/75">Гарного вечора та приємного відпочинку.</p><p className="mt-3 text-sm text-white/55">Наступний вхід буде доступний після відкриття нової зміни Адміністратором.</p><button onClick={() => setShiftEnded(null)} className="mt-6 rounded-2xl border border-white/20 px-4 py-3 text-sm font-bold">До входу</button></section></main>;
    return <LoginScreen onLogin={setWaiter} />;
  }

  return (
    <div className="min-h-screen bg-[#10100f] px-4 py-5 pb-28 text-white lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 rounded-[32px] border border-white/10 bg-neutral-900 p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-amber-300/75">
                MOLO Restaurant
              </p>

              <h1 className="mt-2 text-3xl font-black tracking-tight">
                Пульт офіціанта
              </h1>

              <p className="mt-3 rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/70">
                Офіціант: {currentWaiter.waiterName}
              </p>
            </div>

            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded-2xl border border-amber-200/40 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 transition active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Оновлюємо...' : 'Оновити'}
            </button>
          </div>

          <div className="mt-5">{renderPrimaryTabs()}</div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setView({ kind: 'all_locations' })}
              className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
                view.kind === 'all_locations' || view.kind === 'location'
                  ? 'border-amber-200/55 bg-amber-300/15 text-amber-100'
                  : 'border-white/15 bg-white/5 text-white/70'
              }`}
            >
              Усі бронювання · {activeTodayBookings.length}
            </button>

            <button
              type="button"
              onClick={() => setView({ kind: 'history' })}
              className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition ${
                view.kind === 'history'
                  ? 'border-white/35 bg-white/10 text-white'
                  : 'border-white/15 bg-white/5 text-white/60'
              }`}
            >
              Історія · {historyTodayBookings.length}
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-3xl border border-red-300/30 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-3xl border border-emerald-300/30 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-100">
            {success}
          </div>
        )}

        {transferBooking && (
          <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-3 sm:items-center sm:justify-center">
            <section className="max-h-[82vh] w-full max-w-lg overflow-auto rounded-[30px] border border-amber-100/35 bg-[#151515] p-5 shadow-[0_0_42px_rgba(251,191,36,.14)]">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[.2em] text-amber-200/65">Пересадка гостей</p><h2 className="mt-1 text-2xl font-black">Оберіть вільний стіл</h2><p className="mt-1 text-sm text-white/60">Для бронювання зі столу №{transferBooking.table?.tableNumber || '-'}</p></div><button onClick={() => setTransferBooking(null)} className="rounded-2xl border border-white/15 px-3 py-2 text-sm">Закрити</button></div>
              <div className="mt-5 grid grid-cols-2 gap-3">{Object.values(transferTables).filter((table) => table.status === 'free' && table.tableId !== transferBooking.table?.id).map((table) => <button key={table.tableId} onClick={() => transferTo(table.tableId)} className="rounded-[24px] border border-white/15 bg-white/[.03] p-4 text-left transition duration-150 active:scale-[.98]"><p className="text-lg font-black">Стіл №{table.tableNumber}</p><p className="mt-1 text-xs text-emerald-200">Вільний</p></button>)}</div>
              {Object.values(transferTables).filter((table) => table.status === 'free' && table.tableId !== transferBooking.table?.id).length === 0 && <EmptyState text="Немає вільних столів без конфлікту часу." />}
            </section>
          </div>
        )}

        {view.kind === 'calls' && (
          <section className="space-y-3">
            {calls.length > 0 ? (
              <>
                {myCalls.map((call) => renderCallCard(call))}
                {commonCalls.map((call) => renderCallCard(call))}
              </>
            ) : (
              <EmptyState text="Нових викликів немає." />
            )}
          </section>
        )}

        {view.kind === 'my_tables' && (
          <section className="grid gap-3">
            {myBookings.length > 0 ? (
              myBookings.map((booking) => renderBookingCard(booking))
            ) : (
              <EmptyState text="За тобою поки не закріплено активних столів." />
            )}
          </section>
        )}

        {view.kind === 'all_locations' && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LOCATIONS.map((location) => {
              const locationBookings = activeTodayBookings.filter(
                (booking) => getBookingLocationKey(booking) === location.key,
              );

              return (
                <button
                  key={location.key}
                  type="button"
                  onClick={() =>
                    setView({ kind: 'location', location: location.key })
                  }
                  className="rounded-[30px] border border-white/10 bg-neutral-900 p-5 text-left shadow-xl transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-black text-white">
                        {location.label}
                      </h2>
                      <p className="mt-1 text-sm text-white/50">
                        {location.description}
                      </p>
                    </div>

                    <span className="min-w-12 rounded-2xl border border-amber-200/45 bg-amber-300/15 px-3 py-2 text-center text-xl font-black text-amber-100">
                      {locationBookings.length}
                    </span>
                  </div>

                  <p className="mt-4 text-sm font-semibold text-amber-100/85">
                    Відкрити бронювання
                  </p>
                </button>
              );
            })}
          </section>
        )}

        {view.kind === 'location' && (
          <section>
            <div className="mb-4 flex items-center justify-between gap-3 rounded-[28px] border border-white/10 bg-neutral-900 p-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">
                  {selectedLocation?.description}
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {selectedLocation?.label}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setView({ kind: 'all_locations' })}
                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80"
              >
                Назад
              </button>
            </div>

            <div className="grid gap-3">
              {selectedLocationBookings.length > 0 ? (
                selectedLocationBookings.map((booking) =>
                  renderBookingCard(booking),
                )
              ) : (
                <EmptyState text="У цій локації активних бронювань немає." />
              )}
            </div>
          </section>
        )}

        {view.kind === 'history' && (
          <section className="grid gap-3">
            {historyTodayBookings.length > 0 ? (
              historyTodayBookings.map((booking) => renderBookingCard(booking))
            ) : (
              <EmptyState text="Завершених або скасованих бронювань сьогодні немає." />
            )}
          </section>
        )}
      </div>
    </div>
  );
}
