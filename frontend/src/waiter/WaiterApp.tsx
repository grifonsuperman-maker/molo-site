import { useEffect, useMemo, useState } from 'react';

import { bookingsApi } from '../api/bookings';
import { tablesApi } from '../api/tables';
import type { Booking } from '../api/types';

type LocationKey =
  | 'hall'
  | 'canopy'
  | 'gazebo'
  | 'rotang'
  | 'embankment'
  | 'glass_gazebo'
  | 'water_gazebo'
  | 'other';

type ViewMode = 'locations' | 'all' | LocationKey;

type LocationInfo = {
  key: LocationKey;
  label: string;
  description: string;
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
};

const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);

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

function isActiveBooking(booking: Booking) {
  return ACTIVE_BOOKING_STATUSES.has(booking.status);
}

function statusClass(status: string) {
  if (status === 'pending') return 'border-sky-300/40 bg-sky-400/10 text-sky-100';
  if (status === 'approved') return 'border-amber-300/40 bg-amber-400/10 text-amber-100';
  if (status === 'completed') return 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100';
  if (status === 'rejected' || status === 'cancelled') return 'border-neutral-500/40 bg-neutral-500/10 text-neutral-300';
  return 'border-white/15 bg-white/5 text-white/70';
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'amber' | 'cyan' | 'green';
}) {
  const toneClass =
    tone === 'amber'
      ? 'border-amber-200/60 bg-amber-300/15 text-amber-100 active:bg-amber-300/25'
      : tone === 'cyan'
        ? 'border-cyan-200/50 bg-cyan-300/12 text-cyan-100 active:bg-cyan-300/20'
        : tone === 'green'
          ? 'border-emerald-200/50 bg-emerald-400/15 text-emerald-100 active:bg-emerald-400/25'
          : 'border-white/15 bg-white/5 text-white/80 active:bg-white/10';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${toneClass}`}
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
  const [view, setView] = useState<ViewMode>('locations');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const today = useMemo(() => todayInKyiv(), []);

  const todayBookings = useMemo(() => {
    return bookings
      .filter((booking) => normalizeDate(booking.bookingDate) === today)
      .sort(sortBookings);
  }, [bookings, today]);

  const activeTodayBookings = useMemo(() => todayBookings.filter(isActiveBooking), [todayBookings]);

  const selectedLocation = LOCATIONS.find((location) => location.key === view) || null;

  const visibleBookings = useMemo(() => {
    if (view === 'all') return todayBookings;
    if (view === 'locations') return [];
    return activeTodayBookings.filter((booking) => getBookingLocationKey(booking) === view);
  }, [activeTodayBookings, todayBookings, view]);

  const totalActiveCount = activeTodayBookings.length;
  const totalAllCount = todayBookings.length;

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const result = await bookingsApi.getToday();
      setBookings(result);
    } catch (loadError: any) {
      setError(loadError?.message || 'Не вдалося завантажити бронювання');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 30000);
    return () => window.clearInterval(interval);
  }, []);

  async function runAction(actionKey: string, action: () => Promise<unknown>) {
    try {
      setBusyAction(actionKey);
      setError(null);
      await action();
      await load();
    } catch (actionError: any) {
      setError(actionError?.message || 'Дія не виконана');
    } finally {
      setBusyAction(null);
    }
  }

  function markGuestArrived(booking: Booking) {
    runAction(`${booking.id}:arrived`, () => bookingsApi.checkIn(booking.id));
  }

  function markTableCleaning(booking: Booking) {
    if (!booking.table?.id) return;
    runAction(`${booking.id}:cleaning`, () => tablesApi.cleaning(booking.table!.id));
  }

  function markTableFree(booking: Booking) {
    runAction(`${booking.id}:free`, () => bookingsApi.complete(booking.id));
  }

  function isBusy(booking: Booking, action: string) {
    return busyAction === `${booking.id}:${action}`;
  }

  function renderBookingCard(booking: Booking) {
    const inactive = !isActiveBooking(booking);
    const hasTable = Boolean(booking.table?.id);
    const location = LOCATIONS.find((item) => item.key === getBookingLocationKey(booking));

    return (
      <article
        key={booking.id}
        className="rounded-[30px] border border-white/10 bg-neutral-900/90 p-4 shadow-[0_0_34px_rgba(0,0,0,.18)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-2xl border border-amber-200/40 bg-amber-300/12 px-3 py-1 text-sm font-black text-amber-100">
                Стіл №{booking.table?.tableNumber || '-'}
              </span>

              <span className={`rounded-2xl border px-3 py-1 text-xs font-semibold ${statusClass(booking.status)}`}>
                {STATUS_LABELS[booking.status] || booking.status}
              </span>
            </div>

            <h2 className="mt-3 text-xl font-semibold text-white">
              {timeLabel(booking.bookingTime)} · {booking.client?.fullName || 'Гість'}
            </h2>

            <p className="mt-1 text-sm text-white/60">
              {location?.label || 'Локація не визначена'} · {booking.guestsCount} гостей
            </p>
          </div>
        </div>

        {booking.wishes && (
          <p className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm leading-snug text-white/70">
            {booking.wishes}
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ActionButton
            tone="amber"
            onClick={() => markGuestArrived(booking)}
            disabled={inactive || isBusy(booking, 'arrived')}
          >
            {isBusy(booking, 'arrived') ? 'Зачекайте...' : 'Гість прийшов'}
          </ActionButton>

          <ActionButton
            tone="cyan"
            onClick={() => markTableCleaning(booking)}
            disabled={inactive || !hasTable || isBusy(booking, 'cleaning')}
          >
            {isBusy(booking, 'cleaning') ? 'Зачекайте...' : 'Стіл готується'}
          </ActionButton>

          <ActionButton
            tone="green"
            onClick={() => markTableFree(booking)}
            disabled={inactive || isBusy(booking, 'free')}
          >
            {isBusy(booking, 'free') ? 'Зачекайте...' : 'Стіл вільний'}
          </ActionButton>
        </div>
      </article>
    );
  }

  return (
    <div className="min-h-screen bg-[#10100f] px-4 py-5 pb-28 text-white lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 rounded-[32px] border border-white/10 bg-neutral-900 p-5 shadow-2xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-amber-300/75">MOLO Restaurant</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight">Пульт офіціанта</h1>
              <p className="mt-2 text-sm text-neutral-400">
                Локації, бронювання на сьогодні та швидкі дії по столах.
              </p>
            </div>

            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded-2xl border border-amber-200/40 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100 transition active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Оновлюємо...' : 'Оновити'}
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-white/45">Активні броні</p>
              <p className="mt-2 text-3xl font-black text-amber-100">{totalActiveCount}</p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-white/45">Всього сьогодні</p>
              <p className="mt-2 text-3xl font-black text-white">{totalAllCount}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setView('all')}
            className="mt-5 w-full rounded-[24px] border border-amber-200/55 bg-amber-300/15 px-5 py-4 text-base font-black text-amber-100 shadow-[0_0_30px_rgba(251,191,36,.08)] transition active:scale-[0.99]"
          >
            Відкрити весь список броней на сьогодні
          </button>
        </header>

        {error && (
          <div className="mb-4 rounded-3xl border border-red-300/30 bg-red-500/10 p-4 text-sm text-red-100">
            {error}
          </div>
        )}

        {view === 'locations' && (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LOCATIONS.map((location) => {
              const count = activeTodayBookings.filter((booking) => getBookingLocationKey(booking) === location.key).length;

              return (
                <button
                  key={location.key}
                  type="button"
                  onClick={() => setView(location.key)}
                  className="rounded-[30px] border border-white/10 bg-neutral-900 p-5 text-left shadow-xl transition active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-black text-white">{location.label}</h2>
                      <p className="mt-1 text-sm text-white/50">{location.description}</p>
                    </div>

                    <span className="min-w-12 rounded-2xl border border-amber-200/45 bg-amber-300/15 px-3 py-2 text-center text-xl font-black text-amber-100">
                      {count}
                    </span>
                  </div>

                  <p className="mt-4 text-sm font-semibold text-amber-100/85">
                    Відкрити локацію
                  </p>
                </button>
              );
            })}
          </section>
        )}

        {view !== 'locations' && (
          <section>
            <div className="mb-4 flex flex-col gap-3 rounded-[28px] border border-white/10 bg-neutral-900 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-white/45">
                  {view === 'all' ? 'Всі броні на сьогодні' : selectedLocation?.description}
                </p>

                <h2 className="mt-1 text-2xl font-black">
                  {view === 'all' ? 'Список броней' : selectedLocation?.label}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setView('locations')}
                className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition active:scale-[0.98]"
              >
                Назад до локацій
              </button>
            </div>

            <div className="grid gap-3">
              {visibleBookings.length > 0
                ? visibleBookings.map((booking) => renderBookingCard(booking))
                : <EmptyState text="На сьогодні в цій локації активних броней немає." />}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
