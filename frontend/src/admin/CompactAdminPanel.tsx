import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutDashboard,
  MapPinned,
  MessageSquareText,
  MoreHorizontal,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Table2,
  UserRound,
  UsersRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

import { adminBookingEventsApi, type AdminBookingEvent } from '../api/adminBookingEvents';
import { bookingsApi, type TableStatusesResponse } from '../api/bookings';
import { broadcastsApi } from '../api/broadcasts';
import { clientsApi } from '../api/clients';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { tablesApi } from '../api/tables';
import type { Booking, Client, FullMapResponse, Restaurant, TableItem, TableStatus } from '../api/types';
import AdminPanel from './AdminPanel';

type Tab = 'home' | 'bookings' | 'tables' | 'guests' | 'more';
type BookingAction = 'approve' | 'reject' | 'cancel' | 'checkIn' | 'complete' | 'prepare';
type UrgentItem =
  | { id: string; type: 'event'; event: AdminBookingEvent; priority: number }
  | { id: string; type: 'booking'; booking: Booking; priority: number };

const ACKNOWLEDGED_EVENTS_KEY = 'molo_admin_acknowledged_events_v1';
const SOUND_ENABLED_KEY = 'molo_admin_sound_enabled_v1';
const POLLING_MS = 15_000;
const SOUND_REPEAT_MS = 5_000;

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
  closed: 'Недоступний',
};

function kyivToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function offsetDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function formatDate(date: string): string {
  const [year, month, day] = String(date || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : date || '-';
}

function formatTime(time: string | null | undefined): string {
  const [hours = '00', minutes = '00'] = String(time || '').split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function bookingSort(left: Booking, right: Booking) {
  return `${left.bookingDate}T${left.bookingTime}`.localeCompare(`${right.bookingDate}T${right.bookingTime}`);
}

function tableTone(status: TableStatus) {
  return {
    free: 'border-white/10 bg-white/[0.03] text-white/75',
    pending: 'border-sky-300/35 bg-sky-400/10 text-sky-100',
    reserved: 'border-orange-300/35 bg-orange-400/10 text-orange-100',
    occupied: 'border-red-300/45 bg-red-500/15 text-red-100',
    cleaning: 'border-cyan-200/35 bg-cyan-300/10 text-cyan-100',
    closed: 'border-neutral-400/30 bg-neutral-500/10 text-neutral-200',
  }[status];
}

function eventPriority(action: AdminBookingEvent['action']) {
  return {
    guest_cancelled: 1,
    guest_changed_table: 2,
    guest_reported_lateness: 3,
    booking_created: 4,
  }[action];
}

function eventTitle(event: AdminBookingEvent) {
  return {
    guest_cancelled: 'Бронювання скасовано гостем',
    guest_changed_table: 'Гість змінив стіл',
    guest_reported_lateness: 'Гість запізнюється',
    booking_created: 'Нове бронювання',
  }[event.action];
}

function eventAccent(event: AdminBookingEvent) {
  return {
    guest_cancelled: 'border-red-300/70 bg-red-500/15 shadow-[0_0_40px_rgba(248,113,113,.2)]',
    guest_changed_table: 'border-fuchsia-300/60 bg-fuchsia-500/10 shadow-[0_0_40px_rgba(232,121,249,.16)]',
    guest_reported_lateness: 'border-amber-200/65 bg-amber-400/10 shadow-[0_0_40px_rgba(251,191,36,.18)]',
    booking_created: 'border-sky-300/65 bg-sky-400/10 shadow-[0_0_40px_rgba(56,189,248,.18)]',
  }[event.action];
}

function readAcknowledgedEvents(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(ACKNOWLEDGED_EVENTS_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}

export default function CompactAdminPanel() {
  const today = useMemo(kyivToday, []);
  const [tab, setTab] = useState<Tab>('home');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedTime, setSelectedTime] = useState('19:00');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [events, setEvents] = useState<AdminBookingEvent[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [fullMap, setFullMap] = useState<FullMapResponse | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [tableStatuses, setTableStatuses] = useState<TableStatusesResponse | null>(null);
  const [acknowledgedEvents, setAcknowledgedEvents] = useState<Set<string>>(readAcknowledgedEvents);
  const [urgentIndex, setUrgentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
    } catch {
      return true;
    }
  });
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [guestSearch, setGuestSearch] = useState('');
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [composerOpen, setComposerOpen] = useState(false);
  const [sendToAll, setSendToAll] = useState(false);
  const [message, setMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  async function loadAll(silent = false) {
    if (!silent) setLoading(true);
    setError(null);

    const [bookingResult, eventResult, restaurantResult, mapResult, clientResult, statusResult] = await Promise.allSettled([
      bookingsApi.getByDate(selectedDate),
      adminBookingEventsApi.getRecent(150),
      restaurantApi.get(),
      mapApi.get(),
      clientsApi.getAll(),
      bookingsApi.tableStatuses({ bookingDate: selectedDate, bookingTime: selectedTime, durationMinutes: 120 }),
    ]);

    if (bookingResult.status === 'fulfilled') setBookings(bookingResult.value);
    if (eventResult.status === 'fulfilled') setEvents(eventResult.value);
    if (restaurantResult.status === 'fulfilled') setRestaurant(restaurantResult.value);
    if (mapResult.status === 'fulfilled') setFullMap(mapResult.value);
    if (clientResult.status === 'fulfilled') setClients(clientResult.value);
    if (statusResult.status === 'fulfilled') setTableStatuses(statusResult.value);

    const failed = [bookingResult, eventResult, restaurantResult, mapResult, clientResult, statusResult].find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult | undefined;
    if (failed) setError(failed.reason?.message || 'Не вдалося оновити пульт');
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    const timer = window.setInterval(() => void loadAll(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, [selectedDate, selectedTime]);

  const sortedBookings = useMemo(() => [...bookings].sort(bookingSort), [bookings]);

  const urgentItems = useMemo<UrgentItem[]>(() => {
    const now = Date.now();
    const freshLimit = now - 72 * 60 * 60 * 1000;
    const items: UrgentItem[] = [];
    const eventBookingIds = new Set<string>();

    events.forEach((event) => {
      if (!event.booking) return;
      if (event.action === 'booking_created') {
        if (event.booking.status !== 'pending') return;
        eventBookingIds.add(event.booking.id);
      } else {
        const createdAt = new Date(event.createdAt).getTime();
        if (!Number.isFinite(createdAt) || createdAt < freshLimit || acknowledgedEvents.has(event.id)) return;
      }
      items.push({ id: `event:${event.id}`, type: 'event', event, priority: eventPriority(event.action) });
    });

    sortedBookings
      .filter((booking) => booking.status === 'pending' && !eventBookingIds.has(booking.id))
      .forEach((booking) => items.push({ id: `booking:${booking.id}`, type: 'booking', booking, priority: 4 }));

    return items.sort((left, right) => left.priority - right.priority);
  }, [events, sortedBookings, acknowledgedEvents]);

  useEffect(() => {
    if (urgentIndex >= urgentItems.length) setUrgentIndex(0);
  }, [urgentItems.length, urgentIndex]);

  function playAlertSound() {
    if (!soundEnabled || !audioUnlocked) return;
    try {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(720, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(940, context.currentTime + 0.16);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.3);
    } catch {
      // Браузер може блокувати звук до першого натискання користувача.
    }
  }

  useEffect(() => {
    if (!urgentItems.length || !soundEnabled || !audioUnlocked) return;
    playAlertSound();
    const timer = window.setInterval(playAlertSound, SOUND_REPEAT_MS);
    return () => window.clearInterval(timer);
  }, [urgentItems.map((item) => item.id).join('|'), soundEnabled, audioUnlocked]);

  function toggleSound() {
    const next = !soundEnabled || !audioUnlocked;
    setSoundEnabled(next);
    setAudioUnlocked(next);
    try {
      localStorage.setItem(SOUND_ENABLED_KEY, String(next));
    } catch {}
    if (next) window.setTimeout(playAlertSound, 0);
  }

  function acknowledgeEvent(id: string) {
    setAcknowledgedEvents((current) => {
      const next = new Set(current);
      next.add(id);
      try {
        localStorage.setItem(ACKNOWLEDGED_EVENTS_KEY, JSON.stringify([...next].slice(-500)));
      } catch {}
      return next;
    });
  }

  async function runBookingAction(booking: Booking, action: BookingAction) {
    const key = `${booking.id}:${action}`;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      if (action === 'approve') await bookingsApi.approve(booking.id);
      if (action === 'reject') await bookingsApi.reject(booking.id);
      if (action === 'cancel') await bookingsApi.cancel(booking.id);
      if (action === 'checkIn') await bookingsApi.checkIn(booking.id);
      if (action === 'complete') await bookingsApi.complete(booking.id);
      if (action === 'prepare') {
        if (!booking.table?.id) throw new Error('Стіл не прив’язано до бронювання');
        await tablesApi.cleaning(booking.table.id);
      }
      setNotice('Дію виконано');
      await loadAll(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося виконати дію');
    } finally {
      setBusy(null);
    }
  }

  async function runTableAction(table: TableItem, status: 'free' | 'occupied' | 'cleaning' | 'closed') {
    if (selectedDate !== today) return;
    const key = `table:${table.id}:${status}`;
    setBusy(key);
    setError(null);
    try {
      if (status === 'free') await tablesApi.free(table.id);
      if (status === 'occupied') await tablesApi.occupied(table.id);
      if (status === 'cleaning') await tablesApi.cleaning(table.id);
      if (status === 'closed') await tablesApi.close(table.id);
      setNotice(`Стіл №${table.tableNumber} оновлено`);
      await loadAll(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося змінити стіл');
    } finally {
      setBusy(null);
    }
  }

  const eligibleClients = useMemo(() => clients.filter((client) => !client.isBlacklisted), [clients]);
  const visibleClients = useMemo(() => {
    const search = guestSearch.trim().toLowerCase();
    if (!search) return clients;
    return clients.filter((client) => `${client.fullName} ${client.phone}`.toLowerCase().includes(search));
  }, [clients, guestSearch]);

  function toggleClient(id: string) {
    setSendToAll(false);
    setSelectedClientIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllGuests() {
    setSendToAll(true);
    setSelectedClientIds(new Set(eligibleClients.map((client) => client.id)));
  }

  async function sendBroadcast() {
    const ids = [...selectedClientIds];
    if (!message.trim() || !ids.length) return;
    setBusy('broadcast');
    setError(null);
    setNotice(null);
    try {
      const result = await broadcastsApi.sendNow({
        message: message.trim(),
        target: sendToAll ? 'all_clients' : 'selected_clients',
        clientIds: sendToAll ? undefined : ids,
      });
      setNotice(`Розсилку оброблено: доставлено ${result.deliveredCount}, без доступного Telegram — ${result.unreachableCount}`);
      setMessage('');
      setSelectedClientIds(new Set());
      setSendToAll(false);
      setComposerOpen(false);
    } catch (sendError: any) {
      setError(sendError?.message || 'Не вдалося надіслати повідомлення');
    } finally {
      setBusy(null);
    }
  }

  const stats = useMemo(() => ({
    pending: sortedBookings.filter((booking) => booking.status === 'pending').length,
    approved: sortedBookings.filter((booking) => booking.status === 'approved').length,
    occupied: (fullMap?.tables || []).filter((table) => table.status === 'occupied').length,
    cleaning: (fullMap?.tables || []).filter((table) => table.status === 'cleaning').length,
  }), [sortedBookings, fullMap]);

  const currentUrgent = urgentItems[urgentIndex] || null;
  const selectedTable = (fullMap?.tables || []).find((table) => table.id === selectedTableId) || null;

  return (
    <main className="mx-auto min-h-screen max-w-7xl bg-black px-3 pb-28 pt-3 text-white sm:px-4 lg:px-8">
      <header className="sticky top-[73px] z-40 mb-3 rounded-[24px] border border-white/10 bg-black/90 p-3 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-amber-100/55">MOLO · Адміністратор</p>
            <div className="mt-1 flex items-center gap-2 text-sm text-white/70">
              <span className={`h-2 w-2 rounded-full ${restaurant?.status === 'open' ? 'bg-emerald-400' : 'bg-amber-300'}`} />
              <span className="truncate">{restaurant?.status === 'open' ? 'Ресторан відкритий' : restaurant?.status || 'Статус завантажується'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleSound}
              className={`inline-flex h-11 items-center gap-2 rounded-2xl border px-3 text-xs font-black transition active:scale-95 ${soundEnabled && audioUnlocked ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100' : 'border-red-300/35 bg-red-500/10 text-red-100'}`}
              title={soundEnabled && audioUnlocked ? 'Вимкнути звук' : 'Увімкнути звук'}
            >
              {soundEnabled && audioUnlocked ? <Volume2 size={18} /> : <VolumeX size={18} />}
              <span className="hidden sm:inline">{soundEnabled && audioUnlocked ? 'Звук' : 'Увімкнути звук'}</span>
            </button>
            <button type="button" onClick={() => void loadAll()} disabled={loading} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/70 transition active:scale-95 disabled:opacity-50">
              <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        {(notice || error) && (
          <div className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border px-3 py-2 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100'}`}>
            <span>{error || notice}</span>
            <button type="button" onClick={() => { setError(null); setNotice(null); }}><X size={16} /></button>
          </div>
        )}
      </header>

      {tab === 'home' && (
        <section className="space-y-3">
          {currentUrgent ? (
            <UrgentCard
              item={currentUrgent}
              position={urgentIndex + 1}
              total={urgentItems.length}
              busy={busy}
              onPrevious={() => setUrgentIndex((current) => (current - 1 + urgentItems.length) % urgentItems.length)}
              onNext={() => setUrgentIndex((current) => (current + 1) % urgentItems.length)}
              onOpen={(booking) => { setSelectedDate(booking.bookingDate); setTab('bookings'); setExpandedBookingId(booking.id); }}
              onAcknowledge={(event) => acknowledgeEvent(event.id)}
              onAction={runBookingAction}
            />
          ) : (
            <div className="rounded-[26px] border border-emerald-300/20 bg-emerald-400/[0.06] p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-200"><Check size={22} /></span>
                <div><p className="font-black">Усе спокійно</p><p className="text-sm text-white/45">Подій, що потребують реакції, немає.</p></div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Очікують" value={stats.pending} tone="sky" />
            <StatCard label="Підтверджено" value={stats.approved} tone="amber" />
            <StatCard label="Зайняті столи" value={stats.occupied} tone="red" />
            <StatCard label="Готуються" value={stats.cleaning} tone="cyan" />
          </div>

          <div className="rounded-[26px] border border-white/10 bg-neutral-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <div><p className="font-black">Найближчі · {selectedDate === today ? 'сьогодні' : formatDate(selectedDate)}</p><p className="text-xs text-white/40">Лише три найближчі бронювання</p></div>
              <button type="button" onClick={() => setTab('bookings')} className="rounded-xl border border-amber-200/30 bg-amber-300/10 px-3 py-2 text-xs font-bold text-amber-100">Усі</button>
            </div>
            <div className="mt-3 space-y-2">
              {sortedBookings.filter((booking) => ['pending', 'approved'].includes(booking.status)).slice(0, 3).map((booking) => (
                <button key={booking.id} type="button" onClick={() => { setTab('bookings'); setExpandedBookingId(booking.id); }} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition active:scale-[0.99]">
                  <div><p className="font-bold">{formatTime(booking.bookingTime)} · Стіл №{booking.table?.tableNumber || '-'}</p><p className="text-xs text-white/45">{booking.client?.fullName || '-'} · {booking.guestsCount} гостей</p></div>
                  <span className="text-xs text-white/35">{STATUS_LABELS[booking.status]}</span>
                </button>
              ))}
              {!sortedBookings.some((booking) => ['pending', 'approved'].includes(booking.status)) && <Empty text="Активних бронювань немає." />}
            </div>
          </div>
        </section>
      )}

      {tab === 'bookings' && (
        <section className="space-y-3">
          <DateToolbar date={selectedDate} today={today} onChange={setSelectedDate} />
          <div className="space-y-2">
            {sortedBookings.map((booking) => (
              <CompactBookingCard
                key={booking.id}
                booking={booking}
                expanded={expandedBookingId === booking.id}
                busy={busy}
                isToday={booking.bookingDate === today}
                onToggle={() => setExpandedBookingId((current) => current === booking.id ? null : booking.id)}
                onAction={(action) => runBookingAction(booking, action)}
              />
            ))}
            {!sortedBookings.length && <Empty text="На цю дату бронювань немає." />}
          </div>
        </section>
      )}

      {tab === 'tables' && (
        <section className="space-y-3">
          <div className="rounded-[24px] border border-white/10 bg-neutral-950 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/45">Дата
                <input type="date" min={today} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-bold text-white outline-none" />
              </label>
              <label className="rounded-2xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/45">Час перевірки
                <input type="time" value={selectedTime} onChange={(event) => setSelectedTime(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-bold text-white outline-none" />
              </label>
            </div>
            <p className="mt-2 text-xs text-white/40">{selectedDate === today ? 'Сьогодні доступні робочі статуси столів.' : 'На майбутню дату показується стан бронювання, без зміни фізичного статусу сьогодні.'}</p>
          </div>

          {selectedTable && (
            <div className="rounded-[24px] border border-amber-200/35 bg-amber-300/[0.07] p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-xl font-black">Стіл №{selectedTable.tableNumber}</p><p className="text-sm text-white/50">{selectedTable.zone?.name || 'Без локації'} · {selectedTable.seats} місць</p></div>
                <button type="button" onClick={() => setSelectedTableId(null)} className="rounded-xl border border-white/10 p-2 text-white/50"><X size={17} /></button>
              </div>
              {selectedDate === today ? (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <TableAction label="Вільний" disabled={Boolean(busy)} onClick={() => runTableAction(selectedTable, 'free')} />
                  <TableAction label="Зайнятий" disabled={Boolean(busy)} onClick={() => runTableAction(selectedTable, 'occupied')} />
                  <TableAction label="Готується" disabled={Boolean(busy)} onClick={() => runTableAction(selectedTable, 'cleaning')} />
                  <TableAction label="Закрити" danger disabled={Boolean(busy)} onClick={() => runTableAction(selectedTable, 'closed')} />
                </div>
              ) : (
                <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-sm text-white/60">Для цієї дати доступність визначається бронюваннями та закриттям столу або локації.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {(fullMap?.tables || []).map((table) => {
              const runtime = tableStatuses?.statuses?.[String(table.tableNumber)];
              const status = (runtime?.status || table.status) as TableStatus;
              return (
                <button key={table.id} type="button" onClick={() => setSelectedTableId(table.id)} className={`rounded-[20px] border p-3 text-left transition active:scale-[0.98] ${tableTone(status)} ${selectedTableId === table.id ? 'ring-2 ring-amber-300/70' : ''}`}>
                  <p className="text-lg font-black">№{table.tableNumber}</p>
                  <p className="mt-1 text-xs opacity-75">{TABLE_STATUS_LABELS[status]}</p>
                  <p className="mt-2 truncate text-[10px] opacity-45">{table.zone?.name || 'Без локації'}</p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'guests' && (
        <section className="space-y-3">
          <div className="rounded-[24px] border border-white/10 bg-neutral-950 p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-black/30 px-3 py-3"><Search size={17} className="text-white/35" /><input value={guestSearch} onChange={(event) => setGuestSearch(event.target.value)} placeholder="Ім’я або телефон" className="w-full bg-transparent text-sm outline-none" /></label>
              <button type="button" onClick={() => setComposerOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-fuchsia-300/35 bg-fuchsia-400/10 px-4 py-3 text-sm font-black text-fuchsia-100"><MessageSquareText size={18} />Обрати гостей</button>
            </div>
          </div>

          {composerOpen && (
            <div className="rounded-[26px] border border-fuchsia-300/35 bg-fuchsia-500/[0.07] p-4 shadow-[0_0_36px_rgba(217,70,239,.1)]">
              <div className="flex items-center justify-between gap-3"><div><p className="font-black">Нова розсилка</p><p className="text-xs text-white/45">Обрано: {selectedClientIds.size}</p></div><button type="button" onClick={() => setComposerOpen(false)} className="rounded-xl border border-white/10 p-2"><X size={17} /></button></div>
              <button type="button" onClick={selectAllGuests} className={`mt-3 w-full rounded-2xl border px-4 py-3 text-sm font-black transition ${sendToAll ? 'border-amber-200/60 bg-amber-300/20 text-amber-100' : 'border-white/10 bg-black/20 text-white/70'}`}>Усім гостям · {eligibleClients.length}</button>
              <label className="mt-3 block text-xs uppercase tracking-[0.16em] text-white/45">Текст повідомлення
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={3500} placeholder="Напишіть повідомлення гостям" className="mt-2 min-h-32 w-full resize-y rounded-2xl border border-white/10 bg-black/30 p-3 text-base normal-case tracking-normal text-white outline-none focus:border-fuchsia-300/45" />
              </label>
              <button type="button" onClick={() => void sendBroadcast()} disabled={!message.trim() || !selectedClientIds.size || busy === 'broadcast'} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-fuchsia-300 px-4 py-4 font-black text-neutral-950 transition active:scale-[0.99] disabled:opacity-40"><Send size={18} />{busy === 'broadcast' ? 'Надсилаємо...' : sendToAll ? 'Надіслати усім гостям' : `Надіслати ${selectedClientIds.size} гостям`}</button>
            </div>
          )}

          <div className="space-y-2">
            {visibleClients.map((client) => (
              <label key={client.id} className={`flex items-center gap-3 rounded-[22px] border p-3 ${client.isBlacklisted ? 'border-red-300/20 bg-red-500/[0.05] opacity-55' : selectedClientIds.has(client.id) ? 'border-fuchsia-300/45 bg-fuchsia-400/10' : 'border-white/10 bg-neutral-950'}`}>
                {composerOpen && <input type="checkbox" disabled={client.isBlacklisted} checked={selectedClientIds.has(client.id)} onChange={() => toggleClient(client.id)} className="h-5 w-5 accent-fuchsia-300" />}
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white/5 text-white/60"><UserRound size={18} /></span>
                <span className="min-w-0 flex-1"><span className="block truncate font-bold">{client.fullName}</span><span className="block text-xs text-white/45">{client.phone} · {client.visitsCount} візитів</span></span>
                {client.isBlacklisted && <span className="text-[10px] font-bold uppercase text-red-200">Чорний список</span>}
              </label>
            ))}
            {!visibleClients.length && <Empty text="Гостей не знайдено." />}
          </div>
        </section>
      )}

      {tab === 'more' && (
        <section className="space-y-3">
          <button type="button" onClick={() => setShowAdvanced((current) => !current)} className="flex w-full items-center justify-between rounded-[24px] border border-white/10 bg-neutral-950 p-4 text-left">
            <span className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-300/10 text-amber-100"><Settings2 size={20} /></span><span><span className="block font-black">Розширене керування</span><span className="block text-xs text-white/45">Ресторан, локації, оформлення та додаткові права</span></span></span>
            <span className="text-xs text-white/40">{showAdvanced ? 'Сховати' : 'Відкрити'}</span>
          </button>
          {showAdvanced && <AdminPanel />}
        </section>
      )}

      <nav className="fixed inset-x-3 bottom-3 z-50 mx-auto grid max-w-xl grid-cols-5 gap-1 rounded-[24px] border border-white/10 bg-neutral-950/95 p-2 shadow-2xl backdrop-blur-xl">
        <NavButton active={tab === 'home'} label="Головна" icon={<LayoutDashboard size={18} />} onClick={() => setTab('home')} />
        <NavButton active={tab === 'bookings'} label="Броні" icon={<CalendarDays size={18} />} badge={stats.pending} onClick={() => setTab('bookings')} />
        <NavButton active={tab === 'tables'} label="Столи" icon={<Table2 size={18} />} onClick={() => setTab('tables')} />
        <NavButton active={tab === 'guests'} label="Гості" icon={<UsersRound size={18} />} onClick={() => setTab('guests')} />
        <NavButton active={tab === 'more'} label="Ще" icon={<MoreHorizontal size={18} />} onClick={() => setTab('more')} />
      </nav>
    </main>
  );
}

function UrgentCard({ item, position, total, busy, onPrevious, onNext, onOpen, onAcknowledge, onAction }: {
  item: UrgentItem;
  position: number;
  total: number;
  busy: string | null;
  onPrevious: () => void;
  onNext: () => void;
  onOpen: (booking: Booking) => void;
  onAcknowledge: (event: AdminBookingEvent) => void;
  onAction: (booking: Booking, action: BookingAction) => void;
}) {
  const event = item.type === 'event' ? item.event : null;
  const booking = item.type === 'event' ? item.event.booking : item.booking;
  const accent = event ? eventAccent(event) : 'border-sky-300/65 bg-sky-400/10 shadow-[0_0_40px_rgba(56,189,248,.18)]';
  const title = event ? eventTitle(event) : 'Нове бронювання';
  const lateness = event?.action === 'guest_reported_lateness'
    ? Number(event.booking.latenessHours || 0) * 60 + Number(event.booking.latenessMinutes || 0)
    : 0;

  return (
    <article className={`animate-pulse rounded-[28px] border p-4 ${accent}`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em]"><BellRing size={16} />Потребує уваги</p><h2 className="mt-2 text-xl font-black">{title}</h2></div>
        {total > 1 && <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 p-1"><button type="button" onClick={onPrevious} className="p-1"><ChevronLeft size={17} /></button><span className="px-1 text-xs">{position}/{total}</span><button type="button" onClick={onNext} className="p-1"><ChevronRight size={17} /></button></div>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Info label="Стіл" value={`№${booking.table?.tableNumber || '-'}`} />
        <Info label="Гість" value={booking.client?.fullName || '-'} />
        <Info label="Дата і час" value={`${formatDate(booking.bookingDate)} · ${formatTime(booking.bookingTime)}`} />
        <Info label="Гостей" value={String(booking.guestsCount || 0)} />
      </div>
      {lateness > 0 && <p className="mt-3 rounded-2xl border border-amber-200/25 bg-black/20 p-3 text-sm font-bold">Запізнення: {lateness} хв</p>}
      {event?.action === 'guest_changed_table' && <p className="mt-3 rounded-2xl border border-fuchsia-200/25 bg-black/20 p-3 text-sm">Новий стіл: №{booking.table?.tableNumber || '-'}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {(event?.action === 'booking_created' || item.type === 'booking') ? (
          <>
            <button type="button" disabled={Boolean(busy)} onClick={() => onAction(booking, 'approve')} className="rounded-2xl bg-emerald-300 px-4 py-3 font-black text-neutral-950 disabled:opacity-50">Підтвердити</button>
            <button type="button" onClick={() => onOpen(booking)} className="rounded-2xl border border-white/20 bg-black/25 px-4 py-3 font-black">Відкрити</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => event && onAcknowledge(event)} className="rounded-2xl bg-white px-4 py-3 font-black text-neutral-950">Зрозуміло</button>
            <button type="button" onClick={() => onOpen(booking)} className="rounded-2xl border border-white/20 bg-black/25 px-4 py-3 font-black">Відкрити</button>
          </>
        )}
      </div>
    </article>
  );
}

function CompactBookingCard({ booking, expanded, busy, isToday, onToggle, onAction }: {
  booking: Booking;
  expanded: boolean;
  busy: string | null;
  isToday: boolean;
  onToggle: () => void;
  onAction: (action: BookingAction) => void;
}) {
  const pending = booking.status === 'pending';
  const approved = booking.status === 'approved';
  return (
    <article className={`rounded-[24px] border p-3 ${pending ? 'border-sky-300/30 bg-sky-400/[0.07]' : 'border-white/10 bg-neutral-950'}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 text-left">
        <span><span className="block text-lg font-black">{formatTime(booking.bookingTime)} · Стіл №{booking.table?.tableNumber || '-'}</span><span className="block text-xs text-white/45">{booking.client?.fullName || '-'} · {booking.guestsCount} гостей · {booking.table?.zone?.name || 'Без локації'}</span></span>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${pending ? 'bg-sky-400/15 text-sky-100' : approved ? 'bg-orange-400/15 text-orange-100' : 'bg-white/5 text-white/55'}`}>{STATUS_LABELS[booking.status] || booking.status}</span>
      </button>
      {expanded && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><Info label="Дата" value={formatDate(booking.bookingDate)} /><Info label="Телефон" value={booking.client?.phone || '-'} /><Info label="Час" value={formatTime(booking.bookingTime)} /><Info label="Статус" value={STATUS_LABELS[booking.status] || booking.status} /></div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {pending && <button type="button" disabled={Boolean(busy)} onClick={() => onAction('approve')} className="rounded-2xl bg-emerald-300 px-3 py-3 text-sm font-black text-neutral-950 disabled:opacity-50">Підтвердити</button>}
            {(pending || approved) && <button type="button" disabled={Boolean(busy)} onClick={() => onAction('reject')} className="rounded-2xl border border-red-300/35 bg-red-500/10 px-3 py-3 text-sm font-black text-red-100 disabled:opacity-50">Відхилити</button>}
            {approved && isToday && <button type="button" disabled={Boolean(busy)} onClick={() => onAction('checkIn')} className="rounded-2xl border border-sky-300/35 bg-sky-500/10 px-3 py-3 text-sm font-black text-sky-100 disabled:opacity-50">Гість прийшов</button>}
            {approved && isToday && <button type="button" disabled={Boolean(busy)} onClick={() => onAction('prepare')} className="rounded-2xl border border-cyan-300/35 bg-cyan-500/10 px-3 py-3 text-sm font-black text-cyan-100 disabled:opacity-50">Стіл готується</button>}
            {approved && isToday && <button type="button" disabled={Boolean(busy)} onClick={() => onAction('complete')} className="rounded-2xl border border-white/15 bg-white/5 px-3 py-3 text-sm font-black disabled:opacity-50">Завершити</button>}
            {(pending || approved) && <button type="button" disabled={Boolean(busy)} onClick={() => onAction('cancel')} className="rounded-2xl border border-red-300/20 bg-black/20 px-3 py-3 text-sm text-red-100 disabled:opacity-50">Скасувати</button>}
          </div>
        </div>
      )}
    </article>
  );
}

function DateToolbar({ date, today, onChange }: { date: string; today: string; onChange: (date: string) => void }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-neutral-950 p-3">
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={() => onChange(today)} className={`rounded-2xl px-3 py-3 text-sm font-black ${date === today ? 'bg-amber-300 text-neutral-950' : 'border border-white/10 bg-white/[0.03] text-white/65'}`}>Сьогодні</button>
        <button type="button" onClick={() => onChange(offsetDate(today, 1))} className={`rounded-2xl px-3 py-3 text-sm font-black ${date === offsetDate(today, 1) ? 'bg-amber-300 text-neutral-950' : 'border border-white/10 bg-white/[0.03] text-white/65'}`}>Завтра</button>
        <label className="rounded-2xl border border-white/10 bg-white/[0.03] px-2 py-2 text-[10px] text-white/40">Дата<input type="date" min={today} value={date} onChange={(event) => onChange(event.target.value)} className="block w-full bg-transparent text-sm font-bold text-white outline-none" /></label>
      </div>
    </div>
  );
}

function NavButton({ active, label, icon, badge, onClick }: { active: boolean; label: string; icon: React.ReactNode; badge?: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`relative flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2 text-[10px] font-bold transition active:scale-95 ${active ? 'bg-amber-300 text-neutral-950 shadow-[0_0_22px_rgba(251,191,36,.16)]' : 'text-white/55'}`}>{icon}<span className="truncate">{label}</span>{Boolean(badge) && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-red-500 px-1 text-[9px] text-white">{badge}</span>}</button>;
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'sky' | 'amber' | 'red' | 'cyan' }) {
  const classes = { sky: 'border-sky-300/20 bg-sky-400/[0.06]', amber: 'border-amber-200/20 bg-amber-400/[0.06]', red: 'border-red-300/20 bg-red-500/[0.06]', cyan: 'border-cyan-200/20 bg-cyan-400/[0.06]' }[tone];
  return <div className={`rounded-[20px] border p-3 ${classes}`}><p className="text-[11px] text-white/45">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></div>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-white/35">{label}</p><p className="mt-1 truncate font-bold">{value}</p></div>;
}

function TableAction({ label, danger = false, disabled, onClick }: { label: string; danger?: boolean; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-2xl border px-3 py-3 text-sm font-black disabled:opacity-45 ${danger ? 'border-red-300/35 bg-red-500/10 text-red-100' : 'border-white/15 bg-black/20 text-white/75'}`}>{label}</button>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/40">{text}</div>;
}
