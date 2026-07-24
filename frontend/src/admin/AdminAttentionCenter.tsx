import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageSquareText,
  RefreshCw,
  Table2,
  UserRound,
  X,
} from 'lucide-react';

import {
  adminAttentionApi,
  type AdminAttentionFeed,
  type AdminGuestReview,
  type AdminRescheduleRequest,
  type AdminTableChangeRequest,
} from '../api/adminAttention';
import type { AdminBookingEvent } from '../api/adminBookingEvents';
import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import type { Booking, TableItem } from '../api/types';

const POLLING_MS = 15_000;
const SOUND_REPEAT_MS = 5_000;
const FRESH_EVENT_MS = 72 * 60 * 60 * 1000;
const EVENT_ACK_KEY = 'molo_admin_acknowledged_events_v1';
const REVIEW_ACK_KEY = 'molo_admin_acknowledged_reviews_v1';
const SOUND_ENABLED_KEY = 'molo_admin_sound_enabled_v1';
const LOCATION_ORDER = [
  'Зал ресторану',
  'Навіс',
  'Велика альтанка',
  'Ротанг',
  'Набережна',
  'Скляна альтанка',
  'Альтанка на воді',
];

type UrgentItem =
  | { id: string; type: 'booking-event'; event: AdminBookingEvent; createdAt: string; priority: number }
  | { id: string; type: 'reschedule'; request: AdminRescheduleRequest; createdAt: string; priority: number }
  | { id: string; type: 'table-change'; request: AdminTableChangeRequest; createdAt: string; priority: number }
  | { id: string; type: 'review'; review: AdminGuestReview; createdAt: string; priority: number };

type Props = {
  onOpenBookings: () => void;
  onOpenGuests: () => void;
};

function emptyFeed(): AdminAttentionFeed {
  return { bookingEvents: [], reschedules: [], tableChanges: [], reviews: [] };
}

function readSet(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function saveSet(key: string, value: Set<string>) {
  try {
    window.localStorage.setItem(key, JSON.stringify([...value].slice(-500)));
  } catch {}
}

function formatDate(value: string) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : value || '—';
}

function formatTime(value: string | null | undefined) {
  const [hours = '00', minutes = '00'] = String(value || '').split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function minutesSince(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
}

function bookingLabel(booking: Booking) {
  return `${formatDate(booking.bookingDate)} · ${formatTime(booking.bookingTime)} · Стіл №${booking.table?.tableNumber || '—'}`;
}

function bookingEventPriority(action: AdminBookingEvent['action']) {
  return {
    guest_cancelled: 5,
    guest_changed_table: 7,
    guest_reported_lateness: 6,
    booking_created: 8,
  }[action];
}

function bookingEventTitle(action: AdminBookingEvent['action']) {
  return {
    guest_cancelled: 'Гість скасував бронювання',
    guest_changed_table: 'Стіл бронювання змінено',
    guest_reported_lateness: 'Гість повідомив про запізнення',
    booking_created: 'Нове бронювання',
  }[action];
}

function itemBooking(item: UrgentItem): Booking {
  if (item.type === 'booking-event') return item.event.booking;
  if (item.type === 'reschedule') return item.request.booking;
  if (item.type === 'table-change') return item.request.booking;
  return item.review.booking;
}

function itemTone(item: UrgentItem) {
  if (item.type === 'table-change') return 'border-fuchsia-300/60 shadow-[0_0_36px_rgba(217,70,239,.16)]';
  if (item.type === 'reschedule') return 'border-sky-300/60 shadow-[0_0_36px_rgba(56,189,248,.16)]';
  if (item.type === 'review') return 'border-amber-200/60 shadow-[0_0_36px_rgba(251,191,36,.16)]';
  return {
    guest_cancelled: 'border-red-300/55 shadow-[0_0_32px_rgba(248,113,113,.13)]',
    guest_changed_table: 'border-fuchsia-300/55 shadow-[0_0_32px_rgba(217,70,239,.13)]',
    guest_reported_lateness: 'border-amber-200/55 shadow-[0_0_32px_rgba(251,191,36,.13)]',
    booking_created: 'border-sky-300/55 shadow-[0_0_32px_rgba(56,189,248,.13)]',
  }[item.event.action];
}

export default function AdminAttentionCenter({ onOpenBookings, onOpenGuests }: Props) {
  const [feed, setFeed] = useState<AdminAttentionFeed>(emptyFeed);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [acknowledgedEvents, setAcknowledgedEvents] = useState(() => readSet(EVENT_ACK_KEY));
  const [acknowledgedReviews, setAcknowledgedReviews] = useState(() => readSet(REVIEW_ACK_KEY));
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [pickerRequestId, setPickerRequestId] = useState<string | null>(null);
  const [candidateTables, setCandidateTables] = useState<TableItem[]>([]);
  const [selectedTableId, setSelectedTableId] = useState('');
  const [pickerLoading, setPickerLoading] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setFeed(await adminAttentionApi.getFeed(180));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не вдалося оновити події');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const urgentItems = useMemo<UrgentItem[]>(() => {
    const freshLimit = Date.now() - FRESH_EVENT_MS;
    const items: UrgentItem[] = [];

    feed.bookingEvents.forEach((event) => {
      if (!event.booking) return;
      if (event.action === 'booking_created') {
        if (event.booking.status !== 'pending') return;
      } else {
        const createdAt = new Date(event.createdAt).getTime();
        if (!Number.isFinite(createdAt) || createdAt < freshLimit || acknowledgedEvents.has(event.id)) return;
      }
      items.push({
        id: `event:${event.id}`,
        type: 'booking-event',
        event,
        createdAt: event.createdAt,
        priority: bookingEventPriority(event.action),
      });
    });

    feed.reschedules
      .filter((request) => request.status === 'pending')
      .forEach((request) => items.push({
        id: `reschedule:${request.id}`,
        type: 'reschedule',
        request,
        createdAt: request.createdAt,
        priority: 3,
      }));

    feed.tableChanges
      .filter((request) => request.status === 'pending')
      .forEach((request) => items.push({
        id: `table-change:${request.id}`,
        type: 'table-change',
        request,
        createdAt: request.createdAt,
        priority: 2,
      }));

    feed.reviews.forEach((review) => {
      const createdAt = new Date(review.createdAt).getTime();
      if (Number.isFinite(createdAt) && createdAt >= freshLimit && !acknowledgedReviews.has(review.id)) {
        items.push({
          id: `review:${review.id}`,
          type: 'review',
          review,
          createdAt: review.createdAt,
          priority: 4,
        });
      }
    });

    return items.sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    });
  }, [feed, acknowledgedEvents, acknowledgedReviews]);

  useEffect(() => {
    if (index >= urgentItems.length) setIndex(0);
  }, [index, urgentItems.length]);

  const soundItemIds = useMemo(
    () => urgentItems
      .filter((item) => item.type === 'reschedule' || item.type === 'table-change' || item.type === 'review')
      .map((item) => item.id),
    [urgentItems],
  );

  useEffect(() => {
    const unlock = () => {
      audioUnlockedRef.current = true;
      const AudioContextClass = window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === 'suspended') void context.resume();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const playAttentionSound = useCallback(() => {
    if (!audioUnlockedRef.current) return;
    try {
      if (window.localStorage.getItem(SOUND_ENABLED_KEY) === 'false') return;
      const context = audioContextRef.current;
      if (!context) return;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 10;
      compressor.ratio.value = 8;
      compressor.connect(context.destination);
      [740, 930, 1120].forEach((frequency, noteIndex) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startAt = context.currentTime + noteIndex * 0.14;
        oscillator.type = noteIndex === 1 ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.34, startAt + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.19);
        oscillator.connect(gain);
        gain.connect(compressor);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.21);
      });
    } catch {}
  }, []);

  useEffect(() => {
    if (!soundItemIds.length) return;
    playAttentionSound();
    const timer = window.setInterval(playAttentionSound, SOUND_REPEAT_MS);
    return () => window.clearInterval(timer);
  }, [playAttentionSound, soundItemIds.join('|')]);

  function acknowledgeEvent(id: string) {
    setAcknowledgedEvents((current) => {
      const next = new Set(current);
      next.add(id);
      saveSet(EVENT_ACK_KEY, next);
      return next;
    });
  }

  function acknowledgeReview(id: string) {
    setAcknowledgedReviews((current) => {
      const next = new Set(current);
      next.add(id);
      saveSet(REVIEW_ACK_KEY, next);
      return next;
    });
  }

  async function runAction(key: string, action: () => Promise<{ message: string }>) {
    try {
      setBusy(key);
      setError(null);
      setNotice(null);
      const result = await action();
      setNotice(result.message || 'Дію виконано');
      setPickerRequestId(null);
      setCandidateTables([]);
      setSelectedTableId('');
      await load(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Не вдалося виконати дію');
    } finally {
      setBusy(null);
    }
  }

  async function openTablePicker(request: AdminTableChangeRequest) {
    try {
      setPickerRequestId(request.id);
      setPickerLoading(true);
      setSelectedTableId('');
      setError(null);
      const [map, statuses] = await Promise.all([
        mapApi.get(),
        bookingsApi.tableStatuses({
          bookingDate: request.booking.bookingDate,
          bookingTime: request.booking.bookingTime,
          durationMinutes: request.booking.durationMinutes || 120,
        }),
      ]);
      setCandidateTables(map.tables
        .filter((table) => {
          const runtime = statuses.statuses[String(table.tableNumber)];
          return table.isVisible &&
            table.id !== request.booking.table?.id &&
            Number(table.seats) >= Number(request.booking.guestsCount) &&
            runtime?.status === 'free' &&
            table.zone?.isClosed !== true &&
            table.zone?.isVisible !== false;
        })
        .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber)));
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : 'Не вдалося знайти вільні столи');
    } finally {
      setPickerLoading(false);
    }
  }

  const groupedCandidates = useMemo(() => {
    const groups = new Map<string, TableItem[]>();
    candidateTables.forEach((table) => {
      const name = table.zone?.name || 'Без локації';
      groups.set(name, [...(groups.get(name) || []), table]);
    });
    return [...groups.entries()].sort(([left], [right]) => {
      const leftIndex = LOCATION_ORDER.indexOf(left);
      const rightIndex = LOCATION_ORDER.indexOf(right);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    });
  }, [candidateTables]);

  const current = urgentItems[index] || null;

  return (
    <section className="mx-auto max-w-7xl px-3 pt-3 sm:px-4 lg:px-8" aria-label="Потребує уваги">
      <div className="rounded-[28px] border border-amber-200/25 bg-black/80 p-3 shadow-[0_0_34px_rgba(251,191,36,.08)] backdrop-blur-xl sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-200/35 bg-transparent text-amber-100 shadow-[0_0_20px_rgba(251,191,36,.12)]"><BellRing size={20} /></span>
            <div><p className="font-black">Потребує уваги</p><p className="text-xs text-white/45">{urgentItems.length ? `${urgentItems.length} активних подій` : 'Термінових подій немає'}</p></div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setReviewsOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-fuchsia-300/35 bg-transparent px-3 text-xs font-black text-fuchsia-100"><MessageSquareText size={16} /><span className="hidden sm:inline">Відгуки</span><span>{feed.reviews.length}</span></button>
            <button type="button" onClick={() => void load()} disabled={loading} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/20 bg-transparent text-white/70 disabled:opacity-40"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          </div>
        </div>

        {(notice || error) && <div className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border bg-transparent px-3 py-2 text-sm ${error ? 'border-red-300/40 text-red-100' : 'border-emerald-300/40 text-emerald-100'}`}><span>{error || notice}</span><button type="button" onClick={() => { setError(null); setNotice(null); }}><X size={16} /></button></div>}

        {current ? (
          <article className={`mt-3 rounded-[26px] border bg-transparent p-4 ${itemTone(current)}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">{minutesSince(current.createdAt)} хв тому</p>
                <h2 className="mt-1 text-xl font-black">
                  {current.type === 'booking-event' && bookingEventTitle(current.event.action)}
                  {current.type === 'reschedule' && 'Гість просить змінити час'}
                  {current.type === 'table-change' && 'Гість просить змінити стіл'}
                  {current.type === 'review' && 'Новий внутрішній відгук MOLO'}
                </h2>
                <p className="mt-1 text-xs text-white/50">{bookingLabel(itemBooking(current))}</p>
              </div>
              {urgentItems.length > 1 && <div className="flex items-center gap-1 rounded-xl border border-white/15 bg-transparent p-1"><button type="button" onClick={() => setIndex((value) => (value - 1 + urgentItems.length) % urgentItems.length)} className="p-1"><ChevronLeft size={17} /></button><span className="px-1 text-xs">{index + 1}/{urgentItems.length}</span><button type="button" onClick={() => setIndex((value) => (value + 1) % urgentItems.length)} className="p-1"><ChevronRight size={17} /></button></div>}
            </div>

            <UrgentDetails item={current} />

            {current.type === 'booking-event' && <div className="mt-4 grid grid-cols-2 gap-2">{current.event.action === 'booking_created' ? <><OutlineButton tone="emerald" disabled={Boolean(busy)} onClick={() => void runAction(`approve:${current.event.booking.id}`, () => bookingsApi.approve(current.event.booking.id))}>Підтвердити</OutlineButton><OutlineButton onClick={onOpenBookings}>Відкрити бронь</OutlineButton></> : <><OutlineButton tone="amber" onClick={() => acknowledgeEvent(current.event.id)}>Зрозуміло</OutlineButton><OutlineButton onClick={onOpenBookings}>Відкрити бронь</OutlineButton></>}</div>}

            {current.type === 'reschedule' && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"><OutlineButton tone="emerald" disabled={Boolean(busy)} onClick={() => void runAction(`reschedule-approve:${current.request.id}`, () => adminAttentionApi.approveReschedule(current.request.id))}>Підтвердити</OutlineButton><OutlineButton tone="red" disabled={Boolean(busy)} onClick={() => { const comment = window.prompt('Причина відмови для гостя', '') || undefined; void runAction(`reschedule-reject:${current.request.id}`, () => adminAttentionApi.rejectReschedule(current.request.id, comment)); }}>Відхилити</OutlineButton><OutlineButton onClick={onOpenBookings}>Відкрити бронь</OutlineButton></div>}

            {current.type === 'table-change' && <><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"><OutlineButton tone="fuchsia" disabled={pickerLoading || Boolean(busy)} onClick={() => void openTablePicker(current.request)}>Підібрати стіл</OutlineButton><OutlineButton tone="red" disabled={Boolean(busy)} onClick={() => { const comment = window.prompt('Причина відмови для гостя', '') || undefined; void runAction(`table-reject:${current.request.id}`, () => adminAttentionApi.rejectTableChange(current.request.id, comment)); }}>Відхилити</OutlineButton><OutlineButton onClick={onOpenBookings}>Відкрити бронь</OutlineButton></div>{pickerRequestId === current.request.id && <div className="mt-4 rounded-[24px] border border-fuchsia-300/30 bg-transparent p-3"><p className="font-black">Вільні відповідні столи</p><p className="mt-1 text-xs text-white/45">Лише столи без конфлікту, достатнього розміру та у відкритій локації.</p>{pickerLoading ? <p className="mt-3 text-sm text-white/50">Шукаємо столи…</p> : groupedCandidates.length ? <div className="mt-3 space-y-3">{groupedCandidates.map(([location, tables]) => <div key={location}><p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-fuchsia-100/60">{location}</p><div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{tables.map((table) => <button key={table.id} type="button" onClick={() => setSelectedTableId(table.id)} className={`rounded-2xl border bg-transparent px-2 py-3 text-left ${selectedTableId === table.id ? 'border-amber-200/70 text-amber-100 shadow-[0_0_20px_rgba(251,191,36,.16)]' : 'border-white/15 text-white/70'}`}><span className="block font-black">№{table.tableNumber}</span><span className="block text-[10px] opacity-55">{table.seats} місць</span></button>)}</div></div>)}<OutlineButton tone="emerald" disabled={!selectedTableId || Boolean(busy)} onClick={() => void runAction(`table-approve:${current.request.id}`, () => adminAttentionApi.approveTableChange(current.request.id, selectedTableId))}>Підтвердити пересадку</OutlineButton></div> : <p className="mt-3 rounded-2xl border border-white/10 bg-transparent p-3 text-sm text-white/50">Вільних відповідних столів на цей час немає.</p>}</div>}</>}

            {current.type === 'review' && <div className="mt-4 grid grid-cols-2 gap-2"><OutlineButton tone="amber" onClick={() => acknowledgeReview(current.review.id)}>Зрозуміло</OutlineButton><OutlineButton onClick={onOpenGuests}>Відкрити гостей</OutlineButton></div>}
          </article>
        ) : <div className="mt-3 flex items-center gap-3 rounded-[24px] border border-emerald-300/25 bg-transparent p-4"><span className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-300/35 text-emerald-100"><Check size={19} /></span><div><p className="font-black">Усе спокійно</p><p className="text-xs text-white/45">Подій, що потребують реакції, немає.</p></div></div>}
      </div>

      {reviewsOpen && <div className="fixed inset-0 z-[120] overflow-y-auto bg-black/90 p-3 backdrop-blur-xl"><div className="mx-auto max-w-3xl pb-28"><div className="sticky top-0 z-10 flex items-center justify-between rounded-[24px] border border-fuchsia-300/30 bg-black/90 p-3"><div><p className="font-black">Внутрішні відгуки MOLO</p><p className="text-xs text-white/45">Останні {feed.reviews.length} відгуків</p></div><button type="button" onClick={() => setReviewsOpen(false)} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/20"><X size={18} /></button></div><div className="mt-3 space-y-3">{feed.reviews.map((review) => <article key={review.id} className="rounded-[24px] border border-fuchsia-300/25 bg-transparent p-4"><p className="font-black">{review.booking.client?.fullName || 'Гість'}</p><p className="mt-1 text-xs text-white/45">{bookingLabel(review.booking)}</p><p className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-transparent p-3 text-sm leading-6 text-white/80">{review.text}</p><div className="mt-3 grid grid-cols-2 gap-2"><OutlineButton tone="amber" onClick={() => acknowledgeReview(review.id)}>{acknowledgedReviews.has(review.id) ? 'Прочитано' : 'Зрозуміло'}</OutlineButton><OutlineButton onClick={onOpenBookings}>Бронювання</OutlineButton></div></article>)}{!feed.reviews.length && <p className="rounded-[24px] border border-dashed border-white/15 p-8 text-center text-sm text-white/45">Відгуків поки немає.</p>}</div></div></div>}
    </section>
  );
}

function UrgentDetails({ item }: { item: UrgentItem }) {
  const booking = itemBooking(item);
  const lateness = Number((booking as Booking & { latenessHours?: number }).latenessHours || 0) * 60 + Number((booking as Booking & { latenessMinutes?: number }).latenessMinutes || 0);
  if (item.type === 'reschedule') return <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><Info label="Було" value={`${formatDate(booking.bookingDate)} · ${formatTime(booking.bookingTime)}`} icon={<Clock3 size={15} />} /><Info label="Запит" value={`${formatDate(item.request.requestedDate)} · ${formatTime(item.request.requestedTime)}`} icon={<CalendarClock size={15} />} /></div>;
  if (item.type === 'table-change') return <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><Info label="Поточний стіл" value={`№${booking.table?.tableNumber || '—'}`} icon={<Table2 size={15} />} /><Info label="Побажання гостя" value={item.request.requestedTableNumber ? `№${item.request.requestedTableNumber}` : 'Підібрати інший'} icon={<Table2 size={15} />} /></div>;
  if (item.type === 'review') return <p className="mt-4 whitespace-pre-wrap rounded-2xl border border-amber-200/20 bg-transparent p-3 text-sm leading-6 text-white/80">{item.review.text}</p>;
  return <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><Info label="Гість" value={booking.client?.fullName || '—'} icon={<UserRound size={15} />} /><Info label="Стіл" value={`№${booking.table?.tableNumber || '—'}`} icon={<Table2 size={15} />} /><Info label="Дата" value={formatDate(booking.bookingDate)} icon={<CalendarClock size={15} />} /><Info label={item.event.action === 'guest_reported_lateness' ? 'Запізнення' : 'Час'} value={item.event.action === 'guest_reported_lateness' ? `${lateness} хв` : formatTime(booking.bookingTime)} icon={<Clock3 size={15} />} /></div>;
}

function OutlineButton({ children, tone = 'white', disabled = false, onClick }: { children: React.ReactNode; tone?: 'white' | 'emerald' | 'red' | 'fuchsia' | 'amber'; disabled?: boolean; onClick: () => void }) {
  const classes = { white: 'border-white/25 text-white', emerald: 'border-emerald-300/55 text-emerald-100', red: 'border-red-300/55 text-red-100', fuchsia: 'border-fuchsia-300/55 text-fuchsia-100', amber: 'border-amber-200/55 text-amber-100' }[tone];
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-2xl border bg-transparent px-3 py-3 text-sm font-black transition active:scale-[0.98] disabled:opacity-40 ${classes}`}>{children}</button>;
}

function Info({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-transparent p-3"><p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-white/40">{icon}{label}</p><p className="mt-1 truncate font-bold">{value}</p></div>;
}
