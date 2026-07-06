import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import type { Booking, FullMapResponse, Restaurant, TableItem, TableStatus } from '../api/types';

type Tab = 'dashboard' | 'bookings' | 'tables' | 'clients' | 'settings';
type BookingAction = 'approve' | 'reject' | 'cancel';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Очікує',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  cancelled: 'Скасовано',
  completed: 'Завершено',
};

const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  free: 'Вільний',
  pending: 'Очікує',
  reserved: 'Заброньований',
  occupied: 'Зайнятий',
  cleaning: 'Готується',
  closed: 'Закритий',
};

const TABLE_STATUS_DOT: Record<TableStatus, string> = {
  free: 'bg-white',
  pending: 'bg-sky-400',
  reserved: 'bg-orange-400',
  occupied: 'bg-red-500',
  cleaning: 'bg-cyan-300',
  closed: 'bg-neutral-400',
};

const BOOKING_STATUS_STYLES: Record<string, string> = {
  pending: 'border-sky-300/35 bg-sky-400/10 text-sky-100',
  approved: 'border-orange-300/35 bg-orange-400/10 text-orange-100',
  rejected: 'border-red-300/35 bg-red-400/10 text-red-100',
  cancelled: 'border-neutral-400/25 bg-neutral-500/10 text-neutral-200',
  completed: 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100',
};

const BOOKING_FILTERS = [
  { key: 'all', label: 'Всі' },
  { key: 'pending', label: 'Очікують' },
  { key: 'approved', label: 'Підтверджені' },
  { key: 'rejected', label: 'Відхилені' },
  { key: 'completed', label: 'Завершені' },
];

function unwrapData<T>(value: T | { data?: T }): T {
  if (value && typeof value === 'object' && 'data' in value && (value as { data?: T }).data) {
    return (value as { data: T }).data;
  }

  return value as T;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '-';
  const [hours = '00', minutes = '00'] = String(value).split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';

  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return String(value);

  return `${day}.${month}.${year}`;
}

function normalizePhone(phone: string | null | undefined): string {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function splitLines(value: string | null | undefined): string[] {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();

  return lines.filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseBookingDetails(booking: Booking) {
  const lines = uniqueLines(splitLines(booking.wishes));
  const durationLines = lines.filter((line) => /^Час відпочинку:/i.test(line));
  const cleanupLines = lines.filter((line) => /^Підготовка столу/i.test(line));

  const durationLine = durationLines[0] || '';
  const cleanupLine = cleanupLines[0] || '';

  const rangeMatch = durationLine.match(/\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/);
  const durationText = durationLine.replace(/^Час відпочинку:\s*/i, '').replace(/\s*\(.+\)\s*$/, '').trim();

  const cleanupText = cleanupLine.replace(/^Підготовка столу після гостей:\s*/i, '').trim();

  const guestWishes = lines.filter(
    (line) => !/^Час відпочинку:/i.test(line) && !/^Підготовка столу/i.test(line),
  );

  return {
    period: rangeMatch ? `${rangeMatch[1]} — ${rangeMatch[2]}` : `${formatTime(booking.bookingTime)} — -`,
    durationText: durationText || (booking.durationMinutes ? `${booking.durationMinutes} хв` : '-'),
    cleanupText: cleanupText || '-',
    guestWishes,
  };
}

function bookingStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

function tableStatusLabel(status: TableStatus): string {
  return TABLE_STATUS_LABELS[status] || status;
}

function bookingStatusClass(status: string): string {
  return BOOKING_STATUS_STYLES[status] || 'border-white/15 bg-white/5 text-white/80';
}

function statusOrder(status: TableStatus): number {
  return {
    pending: 1,
    reserved: 2,
    occupied: 3,
    cleaning: 4,
    closed: 5,
    free: 6,
  }[status];
}

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [fullMap, setFullMap] = useState<FullMapResponse | null>(null);
  const [closeMessage, setCloseMessage] = useState('Ресторан зараз зачинений. Ми працюємо з 10:00 до 23:00.');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [bookingFilter, setBookingFilter] = useState('all');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError(null);

    const [bookingsResult, restaurantResult, mapResult] = await Promise.allSettled([
      bookingsApi.getToday(),
      restaurantApi.get(),
      mapApi.get(),
    ]);

    if (bookingsResult.status === 'fulfilled') {
      setBookings(unwrapData<Booking[]>(bookingsResult.value));
    } else {
      setError(bookingsResult.reason?.message || 'Не вдалося завантажити бронювання');
    }

    if (restaurantResult.status === 'fulfilled') {
      const value = unwrapData<Restaurant>(restaurantResult.value);
      setRestaurant(value);
      if (value?.closeMessage) setCloseMessage(value.closeMessage);
    }

    if (mapResult.status === 'fulfilled') {
      setFullMap(unwrapData<FullMapResponse>(mapResult.value));
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const activeBookings = useMemo(
    () => bookings.filter((booking) => booking.status !== 'cancelled' && booking.status !== 'rejected'),
    [bookings],
  );

  const stats = useMemo(() => {
    const pending = bookings.filter((booking) => booking.status === 'pending').length;
    const approved = bookings.filter((booking) => booking.status === 'approved').length;
    const rejected = bookings.filter((booking) => booking.status === 'rejected').length;
    const guests = activeBookings.reduce((sum, booking) => sum + Number(booking.guestsCount || 0), 0);

    return {
      bookings: bookings.length,
      active: activeBookings.length,
      pending,
      approved,
      rejected,
      guests,
    };
  }, [bookings, activeBookings]);

  const tables = useMemo<TableItem[]>(() => {
    return [...(fullMap?.tables || [])].sort((a, b) => {
      const statusDiff = statusOrder(a.status) - statusOrder(b.status);
      if (statusDiff !== 0) return statusDiff;
      return Number(a.tableNumber) - Number(b.tableNumber);
    });
  }, [fullMap]);

  const tableStats = useMemo(() => {
    const initial: Record<TableStatus, number> = {
      free: 0,
      pending: 0,
      reserved: 0,
      occupied: 0,
      cleaning: 0,
      closed: 0,
    };

    tables.forEach((table) => {
      initial[table.status] = (initial[table.status] || 0) + 1;
    });

    return initial;
  }, [tables]);

  const clients = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        phone: string;
        bookings: number;
        guests: number;
        lastDate: string;
      }
    >();

    bookings.forEach((booking) => {
      const phone = booking.client?.phone || '-';
      const current = map.get(phone) || {
        name: booking.client?.fullName || '-',
        phone,
        bookings: 0,
        guests: 0,
        lastDate: booking.bookingDate,
      };

      current.bookings += 1;
      current.guests += Number(booking.guestsCount || 0);

      if (booking.bookingDate > current.lastDate) {
        current.lastDate = booking.bookingDate;
      }

      map.set(phone, current);
    });

    return Array.from(map.values()).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    return bookings.filter((booking) => {
      if (bookingFilter !== 'all' && booking.status !== bookingFilter) return false;

      if (!searchValue) return true;

      const haystack = [
        booking.table?.tableNumber,
        booking.client?.fullName,
        booking.client?.phone,
        booking.bookingDate,
        booking.bookingTime,
        booking.status,
        booking.wishes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(searchValue);
    });
  }, [bookings, bookingFilter, search]);

  async function runRestaurantAction(action: 'open' | 'closeBooking' | 'close') {
    const key = `restaurant:${action}`;
    setBusyAction(key);
    setNotice(null);
    setError(null);

    try {
      if (action === 'open') {
        await restaurantApi.open();
        setNotice('Ресторан відкрито');
      }

      if (action === 'closeBooking') {
        await restaurantApi.closeBooking();
        setNotice('Онлайн-бронювання закрито');
      }

      if (action === 'close') {
        await restaurantApi.close(closeMessage);
        setNotice('Ресторан закрито');
      }

      await load();
    } catch (err: any) {
      setError(err?.message || 'Помилка дії');
    } finally {
      setBusyAction(null);
    }
  }

  async function saveSettings() {
    setBusyAction('settings:save');
    setNotice(null);
    setError(null);

    try {
      await restaurantApi.update({ closeMessage });
      setNotice('Налаштування збережено');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося зберегти');
    } finally {
      setBusyAction(null);
    }
  }

  async function runBookingAction(id: string, action: BookingAction) {
    const key = `${id}:${action}`;
    setBusyAction(key);
    setNotice(null);
    setError(null);

    try {
      if (action === 'approve') {
        await bookingsApi.approve(id);
        setNotice('Бронювання підтверджено');
      }

      if (action === 'reject') {
        await bookingsApi.reject(id);
        setNotice('Бронювання відхилено');
      }

      if (action === 'cancel') {
        await bookingsApi.cancel(id);
        setNotice('Бронювання скасовано');
      }

      setFlashId(id);
      await load();

      window.setTimeout(() => {
        setFlashId((current) => (current === id ? null : current));
      }, 1600);
    } catch (err: any) {
      setError(err?.message || 'Помилка бронювання');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="min-h-screen bg-black p-4 pb-28 text-white lg:p-8">
      <header className="mb-5 rounded-[32px] border border-white/10 bg-neutral-950/90 p-5 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-amber-100/55">MOLO Restaurant</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Панель керування</h1>
            <p className="mt-2 text-sm text-white/55">
              Бронювання, статус ресторану, столи, клієнти та швидкі дії.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <RestaurantButton
              label="Відкрити"
              tone="green"
              busy={busyAction === 'restaurant:open'}
              onClick={() => runRestaurantAction('open')}
            />
            <RestaurantButton
              label="Закрити бронювання"
              tone="yellow"
              busy={busyAction === 'restaurant:closeBooking'}
              onClick={() => runRestaurantAction('closeBooking')}
            />
            <RestaurantButton
              label="Закрити ресторан"
              tone="red"
              busy={busyAction === 'restaurant:close'}
              onClick={() => runRestaurantAction('close')}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
            Статус: <b className="text-white">{restaurant?.status || '-'}</b>
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
            Заявок: <b className="text-white">{bookings.length}</b>
          </span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-full border border-amber-200/40 bg-amber-300/10 px-3 py-1 font-semibold text-amber-100 transition active:scale-95 disabled:opacity-50"
          >
            {loading ? 'Оновлюємо...' : 'Оновити'}
          </button>
        </div>

        {(notice || error) && (
          <div
            className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
              error
                ? 'border-red-300/30 bg-red-500/10 text-red-100'
                : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100'
            }`}
          >
            {error || notice}
          </div>
        )}
      </header>

      <nav className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">
        {(['dashboard', 'bookings', 'tables', 'clients', 'settings'] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`rounded-2xl px-4 py-4 text-sm font-semibold transition active:scale-[0.97] ${
              tab === item
                ? 'bg-amber-300 text-neutral-950 shadow-[0_0_26px_rgba(251,191,36,.18)]'
                : 'bg-neutral-900 text-white/80'
            }`}
          >
            {label(item)}
          </button>
        ))}
      </nav>

      {tab === 'dashboard' && (
        <section className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            <Stat label="Усього заявок" value={stats.bookings} />
            <Stat label="Активних броней" value={stats.active} />
            <Stat label="Гостей" value={stats.guests} />
            <Stat label="Очікують" value={stats.pending} tone="blue" />
            <Stat label="Підтверджені" value={stats.approved} tone="orange" />
            <Stat label="Відхилені" value={stats.rejected} tone="red" />
          </div>

          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Останні заявки</h2>
                <p className="mt-1 text-sm text-white/45">Швидкий перегляд останніх бронювань.</p>
              </div>

              <button
                type="button"
                onClick={() => setTab('bookings')}
                className="rounded-2xl border border-amber-200/40 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100 transition active:scale-95"
              >
                Всі броні
              </button>
            </div>

            <div className="grid gap-3">
              {bookings.slice(0, 5).map((booking) => (
                <SmallBookingRow key={booking.id} booking={booking} />
              ))}

              {!bookings.length && <EmptyState text="Поки немає бронювань." />}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <h2 className="text-xl font-bold">Статуси столів</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-6">
              {(Object.keys(tableStats) as TableStatus[]).map((status) => (
                <div key={status} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full ${TABLE_STATUS_DOT[status]}`} />
                    <span className="text-xs text-white/55">{tableStatusLabel(status)}</span>
                  </div>
                  <p className="mt-3 text-2xl font-black">{tableStats[status]}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'bookings' && (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-2xl font-black">Бронювання</h2>
                <p className="mt-1 text-sm text-white/45">
                  Підтвердження, відхилення, дзвінок гостю, час та побажання.
                </p>
              </div>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Пошук: стіл, імʼя, телефон..."
                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none lg:max-w-[320px]"
              />
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {BOOKING_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setBookingFilter(filter.key)}
                  className={`flex-none rounded-2xl border px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                    bookingFilter === filter.key
                      ? 'border-amber-200 bg-amber-300/20 text-amber-100'
                      : 'border-white/10 bg-white/[0.03] text-white/65'
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            {filteredBookings.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                flash={flashId === booking.id}
                busyAction={busyAction}
                onApprove={() => runBookingAction(booking.id, 'approve')}
                onReject={() => runBookingAction(booking.id, 'reject')}
                onCancel={() => runBookingAction(booking.id, 'cancel')}
              />
            ))}

            {!filteredBookings.length && <EmptyState text="За цим фільтром бронювань немає." />}
          </div>
        </section>
      )}

      {tab === 'tables' && (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <h2 className="text-2xl font-black">Столи і статуси</h2>
            <p className="mt-2 text-sm text-white/45">
              Це контрольний список столів з бази. Повне керування зонами та позиціями буде в конструкторі.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tables.map((table) => (
              <div key={table.id} className="rounded-[24px] border border-white/10 bg-neutral-950 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-2xl font-black">Стіл №{table.tableNumber}</p>
                    <p className="mt-1 text-sm text-white/45">до {table.seats} гостей</p>
                  </div>

                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">
                    <span className={`h-2.5 w-2.5 rounded-full ${TABLE_STATUS_DOT[table.status]}`} />
                    {tableStatusLabel(table.status)}
                  </span>
                </div>

                <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white/55">
                  Зона: {table.zone?.name || 'без зони'}
                </p>
              </div>
            ))}

            {!tables.length && <EmptyState text="Столи ще не завантажились або їх немає в базі." />}
          </div>
        </section>
      )}

      {tab === 'clients' && (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <h2 className="text-2xl font-black">Клієнти</h2>
            <p className="mt-2 text-sm text-white/45">
              Поки список формується з бронювань. Окрему клієнтську базу зробимо пізніше.
            </p>
          </div>

          <div className="grid gap-3">
            {clients.map((client) => (
              <div key={client.phone} className="rounded-[24px] border border-white/10 bg-neutral-950 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xl font-bold">{client.name}</p>
                    <a className="mt-1 block text-sm text-amber-100" href={`tel:${normalizePhone(client.phone)}`}>
                      {client.phone}
                    </a>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[280px]">
                    <MiniStat label="Броні" value={client.bookings} />
                    <MiniStat label="Гості" value={client.guests} />
                    <MiniStat label="Останній" value={formatDate(client.lastDate)} />
                  </div>
                </div>
              </div>
            ))}

            {!clients.length && <EmptyState text="Клієнтів поки немає." />}
          </div>
        </section>
      )}

      {tab === 'settings' && (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <h2 className="text-2xl font-black">Налаштування ресторану</h2>
            <p className="mt-2 text-sm text-white/45">
              Тут поки основні перемикачі статусу. Повні налаштування додамо після пультів.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <label>
              <span className="text-sm uppercase tracking-[0.18em] text-white/45">Повідомлення при закритті</span>
              <textarea
                value={closeMessage}
                onChange={(event) => setCloseMessage(event.target.value)}
                className="mt-3 min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none"
              />
            </label>

            <button
              type="button"
              onClick={saveSettings}
              disabled={busyAction === 'settings:save'}
              className="mt-4 rounded-2xl bg-amber-300 px-5 py-4 font-bold text-neutral-950 transition active:scale-95 disabled:opacity-60"
            >
              {busyAction === 'settings:save' ? 'Зберігаємо...' : '💾 Зберегти'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function BookingCard({
  booking,
  flash,
  busyAction,
  onApprove,
  onReject,
  onCancel,
}: {
  booking: Booking;
  flash: boolean;
  busyAction: string | null;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const details = parseBookingDetails(booking);
  const phone = booking.client?.phone || '-';
  const canApprove = booking.status === 'pending' || booking.status === 'rejected';
  const canReject = booking.status === 'pending' || booking.status === 'approved';

  return (
    <article
      className={`rounded-[28px] border p-4 shadow-2xl transition ${
        flash
          ? 'border-emerald-300/45 bg-emerald-400/10'
          : 'border-white/10 bg-neutral-950'
      }`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-2xl font-black">Стіл №{booking.table?.tableNumber || '-'}</h3>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${bookingStatusClass(booking.status)}`}>
              {bookingStatusLabel(booking.status)}
            </span>
          </div>

          <p className="mt-2 text-sm text-white/50">
            {formatDate(booking.bookingDate)} · {details.period} · {booking.guestsCount} гостей
          </p>
        </div>

        <div className="flex gap-2">
          <ActionButton
            label={busyAction === `${booking.id}:approve` ? '...' : '✅'}
            title="Підтвердити"
            tone="green"
            disabled={!canApprove || Boolean(busyAction)}
            onClick={onApprove}
          />
          <ActionButton
            label={busyAction === `${booking.id}:reject` ? '...' : '❌'}
            title="Відхилити"
            tone="red"
            disabled={!canReject || Boolean(busyAction)}
            onClick={onReject}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <InfoBox label="Гість" value={booking.client?.fullName || '-'} />
        <InfoBox
          label="Телефон"
          value={
            <a className="text-amber-100 underline decoration-amber-200/30" href={`tel:${normalizePhone(phone)}`}>
              {phone}
            </a>
          }
        />
        <InfoBox label="Відпочинок" value={details.durationText} />
        <InfoBox label="Підготовка" value={details.cleanupText} />
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Побажання гостя</p>
        {details.guestWishes.length ? (
          <div className="mt-2 space-y-1 text-sm text-white/75">
            {details.guestWishes.map((line, index) => (
              <p key={`${booking.id}-wish-${index}`}>{line}</p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-white/35">Без побажань</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={`tel:${normalizePhone(phone)}`}
          className="rounded-2xl border border-amber-200/35 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100 transition active:scale-95"
        >
          📞 Подзвонити
        </a>

        {booking.status !== 'cancelled' && booking.status !== 'completed' && (
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={onCancel}
            className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white/65 transition active:scale-95 disabled:opacity-50"
          >
            {busyAction === `${booking.id}:cancel` ? '...' : 'Скасувати'}
          </button>
        )}
      </div>
    </article>
  );
}

function SmallBookingRow({ booking }: { booking: Booking }) {
  const details = parseBookingDetails(booking);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            №{booking.table?.tableNumber || '-'} · {booking.client?.fullName || '-'}
          </p>
          <p className="mt-1 text-sm text-white/45">
            {formatDate(booking.bookingDate)} · {details.period}
          </p>
        </div>

        <span className={`rounded-full border px-3 py-1 text-xs ${bookingStatusClass(booking.status)}`}>
          {bookingStatusLabel(booking.status)}
        </span>
      </div>
    </div>
  );
}

function RestaurantButton({
  label,
  tone,
  busy,
  onClick,
}: {
  label: string;
  tone: 'green' | 'yellow' | 'red';
  busy: boolean;
  onClick: () => void;
}) {
  const classes = {
    green: 'bg-emerald-500 text-white',
    yellow: 'bg-amber-400 text-neutral-950',
    red: 'bg-red-600 text-white',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded-2xl px-4 py-3 text-sm font-bold transition active:scale-95 disabled:opacity-60 ${classes}`}
    >
      {busy ? '...' : label}
    </button>
  );
}

function ActionButton({
  label,
  title,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  tone: 'green' | 'red';
  disabled: boolean;
  onClick: () => void;
}) {
  const classes = tone === 'green' ? 'bg-emerald-500' : 'bg-red-600';

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`h-12 min-w-12 rounded-2xl px-4 text-lg font-black text-white shadow-lg transition active:scale-90 disabled:opacity-35 ${classes}`}
    >
      {label}
    </button>
  );
}

function InfoBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-white/40">{label}</p>
      <div className="mt-2 text-base font-semibold text-white">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-white/35">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  tone?: 'default' | 'blue' | 'orange' | 'red';
}) {
  const toneClass = {
    default: 'border-white/10 bg-neutral-950',
    blue: 'border-sky-300/25 bg-sky-400/10',
    orange: 'border-orange-300/25 bg-orange-400/10',
    red: 'border-red-300/25 bg-red-400/10',
  }[tone];

  return (
    <div className={`rounded-[26px] border p-5 ${toneClass}`}>
      <p className="text-sm text-white/45">{label}</p>
      <p className="mt-3 text-4xl font-black">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-white/45">
      {text}
    </div>
  );
}

function label(tab: Tab) {
  return {
    dashboard: 'Головна',
    bookings: 'Бронювання',
    tables: 'Столи',
    clients: 'Клієнти',
    settings: 'Налаштування',
  }[tab];
}
