import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { tablesApi } from '../api/tables';
import type { Booking, FullMapResponse, Restaurant, TableItem, TableStatus } from '../api/types';

type Tab = 'dashboard' | 'bookings' | 'tables' | 'clients' | 'settings';
type BookingAction = 'approve' | 'reject' | 'cancel' | 'checkIn' | 'complete' | 'noShow' | 'prepareTable';
type TableAction = 'free' | 'occupied' | 'cleaning' | 'close' | 'open';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Очікує підтвердження',
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
  no_show: 'border-red-300/45 bg-red-500/15 text-red-100',
};

const PENDING_REMINDER_MINUTES = 15;

const BOOKING_FILTERS = [
  { key: 'all', label: 'Всі' },
  { key: 'pending', label: 'Очікують' },
  { key: 'approved', label: 'Підтверджені' },
  { key: 'completed', label: 'Завершені' },
  { key: 'cancelled', label: 'Скасовані' },
  { key: 'rejected', label: 'Відхилені' },
  { key: 'no_show', label: 'No-show' },
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

function hourWord(hours: number): string {
  if (hours === 1) return 'година';
  if (hours >= 2 && hours <= 4) return 'години';
  return 'годин';
}

function durationLabel(minutes: number): string {
  if (!minutes || !Number.isFinite(minutes)) return '-';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours} ${hourWord(hours)} ${rest} хв`;
  if (hours > 0) return `${hours} ${hourWord(hours)}`;
  return `${minutes} хв`;
}

function isNoShow(booking: Booking): boolean {
  return String(booking.wishes || '').includes('[NO_SHOW]');
}

function bookingAgeMinutes(booking: Booking): number {
  if (!booking.createdAt) return 0;
  const createdAt = new Date(booking.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt) / 60000));
}

function isPendingTooLong(booking: Booking): boolean {
  return booking.status === 'pending' && bookingAgeMinutes(booking) >= PENDING_REMINDER_MINUTES;
}

function bookingViewStatus(booking: Booking): string {
  if (isNoShow(booking)) return 'no_show';
  return booking.status;
}

function parseBookingDetails(booking: Booking) {
  const lines = uniqueLines(splitLines(booking.wishes));
  const durationLines = lines.filter((line) => /^Час відпочинку:/i.test(line));
  const cleanupLines = lines.filter((line) => /^Підготовка столу/i.test(line));

  const durationLine = durationLines[0] || '';
  const cleanupLine = cleanupLines[0] || '';

  const rangeMatch = durationLine.match(/\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/);
  const durationMinutesMatch = durationLine.match(/Час відпочинку:\s*(\d+)\s*хв/i);
  const availableFromMatch = cleanupLine.match(/наступний гість з\s+(\d{2}:\d{2})/i);
  const durationMinutes = booking.durationMinutes || (durationMinutesMatch ? Number(durationMinutesMatch[1]) : 0);

  const durationText = durationLine
    .replace(/^Час відпочинку:\s*/i, '')
    .replace(/\s*\(.+\)\s*$/, '')
    .trim();

  const cleanupText = cleanupLine.replace(/^Підготовка столу після гостей:\s*/i, '').trim();

  const guestWishes = lines.filter(
    (line) =>
      !/^Час відпочинку:/i.test(line) &&
      !/^Підготовка столу/i.test(line) &&
      !line.includes('[NO_SHOW]'),
  );

  return {
    period: rangeMatch ? `${rangeMatch[1]} — ${rangeMatch[2]}` : `${formatTime(booking.bookingTime)} — -`,
    durationText: durationText || durationLabel(durationMinutes),
    cleanupText: cleanupText || '-',
    availableFrom: availableFromMatch?.[1] || '-',
    durationMinutes,
    guestWishes,
    isLong: Number(durationMinutes || 0) > 180,
  };
}

function bookingStatusLabel(booking: Booking): string {
  const status = bookingViewStatus(booking);
  if (status === 'no_show') return 'No-show';
  return STATUS_LABELS[status] || status;
}

function tableStatusLabel(status: TableStatus): string {
  return TABLE_STATUS_LABELS[status] || status;
}

function bookingStatusClass(booking: Booking): string {
  return BOOKING_STATUS_STYLES[bookingViewStatus(booking)] || 'border-white/15 bg-white/5 text-white/80';
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

function actionText(action: BookingAction): string {
  return {
    approve: 'Бронювання підтверджено',
    reject: 'Бронювання відхилено',
    cancel: 'Бронювання скасовано',
    checkIn: 'Гість прийшов, стіл зайнятий',
    complete: 'Бронювання завершено, стіл вільний',
    noShow: 'No-show: бронь знято',
    prepareTable: 'Стіл відправлено на підготовку',
  }[action];
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
  const [dateFilter, setDateFilter] = useState('');

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
    () => bookings.filter((booking) => booking.status !== 'cancelled' && booking.status !== 'rejected' && !isNoShow(booking)),
    [bookings],
  );


  const pendingReminders = useMemo(
    () => bookings.filter(isPendingTooLong),
    [bookings],
  );

  const stats = useMemo(() => {
    const pending = bookings.filter((booking) => booking.status === 'pending').length;
    const approved = bookings.filter((booking) => booking.status === 'approved').length;
    const completed = bookings.filter((booking) => booking.status === 'completed').length;
    const noShow = bookings.filter(isNoShow).length;
    const longBookings = bookings.filter((booking) => parseBookingDetails(booking).isLong).length;
    const pendingLong = pendingReminders.length;
    const guests = activeBookings.reduce((sum, booking) => sum + Number(booking.guestsCount || 0), 0);

    return { bookings: bookings.length, active: activeBookings.length, pending, pendingLong, approved, completed, noShow, longBookings, guests };
  }, [bookings, activeBookings, pendingReminders]);

  const tables = useMemo<TableItem[]>(() => {
    return [...(fullMap?.tables || [])].sort((a, b) => {
      const statusDiff = statusOrder(a.status) - statusOrder(b.status);
      if (statusDiff !== 0) return statusDiff;
      return Number(a.tableNumber) - Number(b.tableNumber);
    });
  }, [fullMap]);

  const tableStats = useMemo(() => {
    const initial: Record<TableStatus, number> = { free: 0, pending: 0, reserved: 0, occupied: 0, cleaning: 0, closed: 0 };
    tables.forEach((table) => {
      initial[table.status] = (initial[table.status] || 0) + 1;
    });
    return initial;
  }, [tables]);

  const clients = useMemo(() => {
    const map = new Map<string, { name: string; phone: string; bookings: number; guests: number; lastDate: string }>();

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
      if (booking.bookingDate > current.lastDate) current.lastDate = booking.bookingDate;
      map.set(phone, current);
    });

    return Array.from(map.values()).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    return bookings.filter((booking) => {
      if (bookingFilter !== 'all') {
        if (bookingFilter === 'no_show') {
          if (!isNoShow(booking)) return false;
        } else if (booking.status !== bookingFilter) {
          return false;
        }
      }

      if (dateFilter && booking.bookingDate !== dateFilter) return false;
      if (!searchValue) return true;

      const haystack = [
        booking.table?.tableNumber,
        booking.table?.zone?.name,
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
  }, [bookings, bookingFilter, search, dateFilter]);

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

  async function runBookingAction(booking: Booking, action: BookingAction) {
    const key = `${booking.id}:${action}`;
    setBusyAction(key);
    setNotice(null);
    setError(null);

    try {
      if (action === 'approve') await bookingsApi.approve(booking.id);
      if (action === 'reject') await bookingsApi.reject(booking.id);
      if (action === 'cancel') await bookingsApi.cancel(booking.id);
      if (action === 'checkIn') await bookingsApi.checkIn(booking.id);
      if (action === 'complete') await bookingsApi.complete(booking.id);
      if (action === 'noShow') await bookingsApi.noShow(booking.id);

      if (action === 'prepareTable') {
        if (!booking.table?.id) throw new Error('Стіл не привʼязаний до бронювання');
        await tablesApi.cleaning(booking.table.id);
      }

      setNotice(actionText(action));
      setFlashId(booking.id);
      await load();
      window.setTimeout(() => setFlashId((current) => (current === booking.id ? null : current)), 1600);
    } catch (err: any) {
      setError(err?.message || 'Помилка бронювання');
    } finally {
      setBusyAction(null);
    }
  }

  async function runTableAction(table: TableItem, action: TableAction) {
    const key = `table:${table.id}:${action}`;
    setBusyAction(key);
    setNotice(null);
    setError(null);

    try {
      if (action === 'free') await tablesApi.free(table.id);
      if (action === 'occupied') await tablesApi.occupied(table.id);
      if (action === 'cleaning') await tablesApi.cleaning(table.id);
      if (action === 'close') await tablesApi.close(table.id);
      if (action === 'open') await tablesApi.open(table.id);

      const nextStatus: TableStatus =
        action === 'open' ? 'free' : action === 'close' ? 'closed' : action;

      setNotice(`Стіл №${table.tableNumber}: ${tableStatusLabel(nextStatus)}`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося змінити статус столу');
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
            <h1 className="mt-2 text-3xl font-black tracking-tight">Панель адміністратора</h1>
            <p className="mt-2 text-sm text-white/55">Бронювання, гості, статуси столів та швидкі дії зміни.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <RestaurantButton label="Відкрити" tone="green" busy={busyAction === 'restaurant:open'} onClick={() => runRestaurantAction('open')} />
            <RestaurantButton label="Закрити бронь" tone="yellow" busy={busyAction === 'restaurant:closeBooking'} onClick={() => runRestaurantAction('closeBooking')} />
            <RestaurantButton label="Закрити ресторан" tone="red" busy={busyAction === 'restaurant:close'} onClick={() => runRestaurantAction('close')} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
            Статус: <b className="text-white">{restaurant?.status || '-'}</b>
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
            Заявок: <b className="text-white">{bookings.length}</b>
          </span>
          <button type="button" onClick={load} disabled={loading} className="rounded-full border border-amber-200/40 bg-amber-300/10 px-3 py-1 font-semibold text-amber-100 transition active:scale-95 disabled:opacity-50">
            {loading ? 'Оновлюємо...' : 'Оновити'}
          </button>
        </div>

        {(notice || error) && (
          <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100'}`}>
            {error || notice}
          </div>
        )}
      </header>

      <nav className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">
        {(['dashboard', 'bookings', 'tables', 'clients', 'settings'] as Tab[]).map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} className={`rounded-2xl px-4 py-4 text-sm font-semibold transition active:scale-[0.97] ${tab === item ? 'bg-amber-300 text-neutral-950 shadow-[0_0_26px_rgba(251,191,36,.18)]' : 'bg-neutral-900 text-white/80'}`}>
            {label(item)}
          </button>
        ))}
      </nav>


      {pendingReminders.length > 0 && (
        <section className="mb-5 rounded-[28px] border border-amber-200/35 bg-amber-300/10 p-4 text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.08)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-amber-100/65">Завислі заявки</p>
              <h2 className="mt-1 text-xl font-black">{pendingReminders.length} заявк(и) очікують понад {PENDING_REMINDER_MINUTES} хв</h2>
              <p className="mt-1 text-sm text-white/70">Потрібно підтвердити, відхилити або подзвонити гостю.</p>
            </div>
            <button type="button" onClick={() => { setTab('bookings'); setBookingFilter('pending'); }} className="rounded-2xl border border-amber-200/55 bg-black/25 px-4 py-3 text-sm font-bold text-amber-100 transition active:scale-95">
              Відкрити заявки
            </button>
          </div>
        </section>
      )}

      {tab === 'dashboard' && (
        <section className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <Stat label="Усього заявок" value={stats.bookings} />
            <Stat label="Активних" value={stats.active} />
            <Stat label="Гостей" value={stats.guests} />
            <Stat label="Очікують" value={stats.pending} tone="blue" />
            <Stat label="Чекають 15+ хв" value={stats.pendingLong} tone="yellow" />
            <Stat label="Підтверджені" value={stats.approved} tone="orange" />
            <Stat label="Завершені" value={stats.completed} tone="green" />
            <Stat label="No-show" value={stats.noShow} tone="red" />
            <Stat label="Довгі броні" value={stats.longBookings} tone="purple" />
          </div>

          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Останні заявки</h2>
                <p className="mt-1 text-sm text-white/45">Швидкий перегляд останніх бронювань.</p>
              </div>
              <button type="button" onClick={() => setTab('bookings')} className="rounded-2xl border border-amber-200/40 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100 transition active:scale-95">
                Всі броні
              </button>
            </div>

            <div className="grid gap-3">
              {bookings.slice(0, 5).map((booking) => <SmallBookingRow key={booking.id} booking={booking} />)}
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
                <p className="mt-1 text-sm text-white/45">Підтвердження, відхилення, дзвінок, no-show, прихід гостя та стіл.</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[520px]">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Пошук: стіл, імʼя, телефон..." className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none" />
                <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none" />
              </div>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {BOOKING_FILTERS.map((filter) => (
                <button key={filter.key} type="button" onClick={() => setBookingFilter(filter.key)} className={`flex-none rounded-2xl border px-4 py-2 text-sm font-semibold transition active:scale-95 ${bookingFilter === filter.key ? 'border-amber-200 bg-amber-300/20 text-amber-100' : 'border-white/10 bg-white/[0.03] text-white/65'}`}>
                  {filter.label}
                </button>
              ))}
              {dateFilter && (
                <button type="button" onClick={() => setDateFilter('')} className="flex-none rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-white/65 transition active:scale-95">
                  Скинути дату
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-4">
            {filteredBookings.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                flash={flashId === booking.id}
                busyAction={busyAction}
                onAction={(action) => runBookingAction(booking, action)}
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
            <p className="mt-2 text-sm text-white/45">Тут адмін може вручну змінити стан столу на зміні.</p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tables.map((table) => (
              <TableCard key={table.id} table={table} busyAction={busyAction} onAction={(action) => runTableAction(table, action)} />
            ))}
            {!tables.length && <EmptyState text="Столи ще не завантажились або їх немає в базі." />}
          </div>
        </section>
      )}

      {tab === 'clients' && (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <h2 className="text-2xl font-black">Клієнти</h2>
            <p className="mt-2 text-sm text-white/45">Поки список формується з бронювань. Повну базу гостей зробимо в пульті директора.</p>
          </div>

          <div className="grid gap-3">
            {clients.map((client) => (
              <div key={client.phone} className="rounded-[24px] border border-white/10 bg-neutral-950 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xl font-bold">{client.name}</p>
                    <a className="mt-1 block text-sm text-amber-100" href={`tel:${normalizePhone(client.phone)}`}>{client.phone}</a>
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
            <p className="mt-2 text-sm text-white/45">Тут поки основні перемикачі статусу. Повні правила буде змінювати директор.</p>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <label>
              <span className="text-sm uppercase tracking-[0.18em] text-white/45">Повідомлення при закритті</span>
              <textarea value={closeMessage} onChange={(event) => setCloseMessage(event.target.value)} className="mt-3 min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none" />
            </label>

            <button type="button" onClick={saveSettings} disabled={busyAction === 'settings:save'} className="mt-4 rounded-2xl bg-amber-300 px-5 py-4 font-bold text-neutral-950 transition active:scale-95 disabled:opacity-60">
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
  onAction,
}: {
  booking: Booking;
  flash: boolean;
  busyAction: string | null;
  onAction: (action: BookingAction) => void;
}) {
  const details = parseBookingDetails(booking);
  const phone = booking.client?.phone || '-';
  const tableStatus = booking.table?.status;
  const busyPrefix = `${booking.id}:`;
  const isBusy = Boolean(busyAction?.startsWith(busyPrefix));
  const viewStatus = bookingViewStatus(booking);
  const canApprove = booking.status === 'pending' || booking.status === 'rejected';
  const canReject = booking.status === 'pending' || booking.status === 'approved';
  const canWork = booking.status === 'approved' && viewStatus !== 'no_show';
  const canNoShow = (booking.status === 'pending' || booking.status === 'approved') && viewStatus !== 'no_show';
  const canCancel = booking.status !== 'cancelled' && booking.status !== 'completed' && booking.status !== 'rejected';
  const pendingTooLong = isPendingTooLong(booking);
  const pendingAge = bookingAgeMinutes(booking);

  return (
    <article className={`rounded-[28px] border p-4 shadow-2xl transition ${flash ? 'border-emerald-300/45 bg-emerald-400/10' : 'border-white/10 bg-neutral-950'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-2xl font-black">Стіл №{booking.table?.tableNumber || '-'}</h3>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${bookingStatusClass(booking)}`}>{bookingStatusLabel(booking)}</span>
            {tableStatus && (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">
                <span className={`h-2.5 w-2.5 rounded-full ${TABLE_STATUS_DOT[tableStatus]}`} />
                {tableStatusLabel(tableStatus)}
              </span>
            )}
            {details.isLong && <span className="rounded-full border border-purple-300/30 bg-purple-400/10 px-3 py-1 text-xs font-semibold text-purple-100">Довга бронь</span>}
            {pendingTooLong && <span className="rounded-full border border-amber-200/40 bg-amber-300/15 px-3 py-1 text-xs font-semibold text-amber-100">Чекає {pendingAge} хв</span>}
          </div>

          <p className="mt-2 text-sm text-white/50">{formatDate(booking.bookingDate)} · {details.period} · {booking.guestsCount} гостей</p>
          <p className="mt-1 text-xs text-white/35">Зона: {booking.table?.zone?.name || 'без зони'}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex">
          <ActionButton label="✅ Прийняти" busyLabel="Приймаємо..." busy={busyAction === `${booking.id}:approve`} tone="green" disabled={!canApprove || Boolean(busyAction)} onClick={() => onAction('approve')} />
          <ActionButton label="❌ Відхилити" busyLabel="Відхиляємо..." busy={busyAction === `${booking.id}:reject`} tone="red" disabled={!canReject || Boolean(busyAction)} onClick={() => onAction('reject')} />
        </div>
      </div>

      {pendingTooLong && (
        <div className="mt-4 rounded-2xl border border-amber-200/35 bg-amber-300/10 p-4 text-amber-100">
          <p className="font-bold">Заявка очікує понад {PENDING_REMINDER_MINUTES} хв</p>
          <p className="mt-1 text-sm text-white/70">Підтвердь, відхили або подзвони гостю, щоб заявка не висіла.</p>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <InfoBox label="Гість" value={booking.client?.fullName || '-'} />
        <InfoBox label="Телефон" value={<a className="text-amber-100 underline decoration-amber-200/30" href={`tel:${normalizePhone(phone)}`}>{phone}</a>} />
        <InfoBox label="Дата" value={formatDate(booking.bookingDate)} />
        <InfoBox label="Час" value={details.period} />
        <InfoBox label="Відпочинок" value={details.durationText} />
        <InfoBox label="Вільний з" value={details.availableFrom} />
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Побажання гостя</p>
        {details.guestWishes.length ? (
          <div className="mt-2 space-y-1 text-sm text-white/75">
            {details.guestWishes.map((line, index) => <p key={`${booking.id}-wish-${index}`}>{line}</p>)}
          </div>
        ) : (
          <p className="mt-2 text-sm text-white/35">Без побажань</p>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <a href={`tel:${normalizePhone(phone)}`} className="rounded-2xl border border-amber-200/35 bg-amber-300/10 px-4 py-3 text-center text-sm font-semibold text-amber-100 transition active:scale-95">📞 Подзвонити</a>
        <ActionButton label="👋 Гість прийшов" busyLabel="Відмічаємо..." busy={busyAction === `${booking.id}:checkIn`} tone="blue" disabled={!canWork || Boolean(busyAction)} onClick={() => onAction('checkIn')} />
        <ActionButton label="🧽 Готується" busyLabel="Ставимо..." busy={busyAction === `${booking.id}:prepareTable`} tone="cyan" disabled={!booking.table?.id || Boolean(busyAction)} onClick={() => onAction('prepareTable')} />
        <ActionButton label="✅ Стіл вільний" busyLabel="Завершуємо..." busy={busyAction === `${booking.id}:complete`} tone="neutral" disabled={!canWork || Boolean(busyAction)} onClick={() => onAction('complete')} />
        <ActionButton label="🚫 No-show" busyLabel="Знімаємо..." busy={busyAction === `${booking.id}:noShow`} tone="red" disabled={!canNoShow || Boolean(busyAction)} onClick={() => onAction('noShow')} />
        <ActionButton label="Скасувати" busyLabel="Скасовуємо..." busy={busyAction === `${booking.id}:cancel`} tone="neutral" disabled={!canCancel || Boolean(busyAction)} onClick={() => onAction('cancel')} />
        {isBusy && <span className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-center text-sm text-white/50">Дія виконується...</span>}
      </div>
    </article>
  );
}

function TableCard({
  table,
  busyAction,
  onAction,
}: {
  table: TableItem;
  busyAction: string | null;
  onAction: (action: TableAction) => void;
}) {
  const busyPrefix = `table:${table.id}:`;
  const isBusy = Boolean(busyAction?.startsWith(busyPrefix));

  return (
    <div className="rounded-[24px] border border-white/10 bg-neutral-950 p-4">
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

      <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white/55">Зона: {table.zone?.name || 'без зони'}</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <ActionButton label="Вільний" busyLabel="..." busy={busyAction === `${busyPrefix}free`} tone="neutral" disabled={Boolean(busyAction)} onClick={() => onAction('free')} />
        <ActionButton label="Зайнятий" busyLabel="..." busy={busyAction === `${busyPrefix}occupied`} tone="red" disabled={Boolean(busyAction)} onClick={() => onAction('occupied')} />
        <ActionButton label="Готується" busyLabel="..." busy={busyAction === `${busyPrefix}cleaning`} tone="cyan" disabled={Boolean(busyAction)} onClick={() => onAction('cleaning')} />
        {table.status === 'closed' ? (
          <ActionButton label="Відкрити" busyLabel="..." busy={busyAction === `${busyPrefix}open`} tone="green" disabled={Boolean(busyAction)} onClick={() => onAction('open')} />
        ) : (
          <ActionButton label="Закрити" busyLabel="..." busy={busyAction === `${busyPrefix}close`} tone="red" disabled={Boolean(busyAction)} onClick={() => onAction('close')} />
        )}
      </div>

      {isBusy && <p className="mt-3 text-center text-xs text-white/40">Змінюємо статус...</p>}
    </div>
  );
}

function SmallBookingRow({ booking }: { booking: Booking }) {
  const details = parseBookingDetails(booking);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">№{booking.table?.tableNumber || '-'} · {booking.client?.fullName || '-'}</p>
          <p className="mt-1 text-sm text-white/45">{formatDate(booking.bookingDate)} · {details.period}</p>
          {isPendingTooLong(booking) && <p className="mt-1 text-xs font-semibold text-amber-100">Чекає {bookingAgeMinutes(booking)} хв — треба дія</p>}
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${bookingStatusClass(booking)}`}>{bookingStatusLabel(booking)}</span>
      </div>
    </div>
  );
}

function RestaurantButton({ label, tone, busy, onClick }: { label: string; tone: 'green' | 'yellow' | 'red'; busy: boolean; onClick: () => void }) {
  const classes = { green: 'bg-emerald-500 text-white', yellow: 'bg-amber-400 text-neutral-950', red: 'bg-red-600 text-white' }[tone];

  return (
    <button type="button" onClick={onClick} disabled={busy} className={`rounded-2xl px-4 py-3 text-sm font-bold transition active:scale-95 disabled:opacity-60 ${classes}`}>
      {busy ? '...' : label}
    </button>
  );
}

function ActionButton({
  label,
  busyLabel,
  tone,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busyLabel: string;
  tone: 'green' | 'red' | 'blue' | 'cyan' | 'neutral';
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const classes = {
    green: 'border-emerald-300/25 bg-emerald-500/90 text-white',
    red: 'border-red-300/25 bg-red-600/90 text-white',
    blue: 'border-sky-300/25 bg-sky-500/90 text-white',
    cyan: 'border-cyan-200/25 bg-cyan-400/90 text-neutral-950',
    neutral: 'border-white/10 bg-white/[0.05] text-white/75',
  }[tone];

  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={`rounded-2xl border px-4 py-3 text-sm font-bold transition active:scale-95 disabled:opacity-35 ${classes}`}>
      {busy ? busyLabel : label}
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

function Stat({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'blue' | 'yellow' | 'orange' | 'red' | 'green' | 'purple' }) {
  const toneClass = {
    default: 'border-white/10 bg-neutral-950',
    blue: 'border-sky-300/25 bg-sky-400/10',
    yellow: 'border-amber-300/25 bg-amber-400/10',
    orange: 'border-orange-300/25 bg-orange-400/10',
    red: 'border-red-300/25 bg-red-400/10',
    green: 'border-emerald-300/25 bg-emerald-400/10',
    purple: 'border-purple-300/25 bg-purple-400/10',
  }[tone];

  return (
    <div className={`rounded-[26px] border p-5 ${toneClass}`}>
      <p className="text-sm text-white/45">{label}</p>
      <p className="mt-3 text-4xl font-black">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-white/45">{text}</div>;
}

function label(tab: Tab) {
  return { dashboard: 'Головна', bookings: 'Бронювання', tables: 'Столи', clients: 'Клієнти', settings: 'Налаштування' }[tab];
}
