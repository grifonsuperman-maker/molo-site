import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BellRing,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  RefreshCw,
  Table2,
  X,
} from 'lucide-react';

import {
  adminGuestActionsApi,
  type AdminGuestReview,
  type AdminRescheduleRequest,
  type AdminTableChangeRequest,
} from '../api/adminGuestActions';
import { bookingsApi, type TableStatusesResponse } from '../api/bookings';
import { mapApi } from '../api/map';
import type { FullMapResponse, TableItem } from '../api/types';

const POLLING_MS = 15_000;
const SOUND_REPEAT_MS = 5_000;
const SOUND_ENABLED_KEY = 'molo_admin_sound_enabled_v1';
const ACKNOWLEDGED_REVIEWS_KEY = 'molo_admin_acknowledged_reviews_v1';

const LOCATION_ORDER = [
  'Зал ресторану',
  'Навіс',
  'Велика альтанка',
  'Ротанг',
  'Набережна',
  'Скляна альтанка',
  'Альтанка на воді',
];

type AttentionItem =
  | { id: string; kind: 'reschedule'; createdAt: string; request: AdminRescheduleRequest }
  | { id: string; kind: 'table'; createdAt: string; request: AdminTableChangeRequest }
  | { id: string; kind: 'review'; createdAt: string; review: AdminGuestReview };

function formatDate(value: string) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : value || '-';
}

function formatTime(value: string | null | undefined) {
  const [hours = '00', minutes = '00'] = String(value || '').split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function readAcknowledgedReviews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACKNOWLEDGED_REVIEWS_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function usePortalSlots() {
  const [homeSlot, setHomeSlot] = useState<HTMLElement | null>(null);
  const [guestSlot, setGuestSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sync = () => {
      const workspace = document.querySelector<HTMLElement>('.molo-admin-workspace');
      if (!workspace) return;

      const sections = Array.from(workspace.querySelectorAll<HTMLElement>('main > section'));
      const homeSection = sections.find((section) => section.textContent?.includes('Найближчі')) || null;
      const guestSection = sections.find((section) => section.querySelector('input[placeholder="Ім’я або телефон"]')) || null;

      if (homeSection) {
        let slot = homeSection.querySelector<HTMLElement>(':scope > [data-admin-guest-attention-slot]');
        if (!slot) {
          slot = document.createElement('div');
          slot.dataset.adminGuestAttentionSlot = 'true';
          homeSection.insertBefore(slot, homeSection.firstChild);
        }
        setHomeSlot(slot);
      } else {
        setHomeSlot(null);
      }

      if (guestSection) {
        let slot = guestSection.querySelector<HTMLElement>(':scope > [data-admin-guest-reviews-slot]');
        if (!slot) {
          slot = document.createElement('div');
          slot.dataset.adminGuestReviewsSlot = 'true';
          guestSection.insertBefore(slot, guestSection.children[1] || null);
        }
        setGuestSlot(slot);
      } else {
        setGuestSlot(null);
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return { homeSlot, guestSlot };
}

export default function AdminGuestAttentionPanel() {
  const { homeSlot, guestSlot } = usePortalSlots();
  const [reschedules, setReschedules] = useState<AdminRescheduleRequest[]>([]);
  const [tableChanges, setTableChanges] = useState<AdminTableChangeRequest[]>([]);
  const [reviews, setReviews] = useState<AdminGuestReview[]>([]);
  const [fullMap, setFullMap] = useState<FullMapResponse | null>(null);
  const [tableStatuses, setTableStatuses] = useState<TableStatusesResponse | null>(null);
  const [acknowledgedReviews, setAcknowledgedReviews] = useState<Set<string>>(readAcknowledgedReviews);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerRequest, setPickerRequest] = useState<AdminTableChangeRequest | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [reviewsExpanded, setReviewsExpanded] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const results = await Promise.allSettled([
      adminGuestActionsApi.pendingReschedules(),
      adminGuestActionsApi.pendingTableChanges(),
      adminGuestActionsApi.reviews(150),
      mapApi.get(),
    ]);

    if (results[0].status === 'fulfilled') setReschedules(results[0].value);
    if (results[1].status === 'fulfilled') setTableChanges(results[1].value);
    if (results[2].status === 'fulfilled') setReviews(results[2].value);
    if (results[3].status === 'fulfilled') setFullMap(results[3].value);

    const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) setError(failed.reason?.message || 'Не вдалося завантажити запити гостей');
    else setError(null);
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unlock = () => setAudioUnlocked(true);
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const items = useMemo<AttentionItem[]>(() => {
    const freshReviewLimit = Date.now() - 72 * 60 * 60 * 1000;
    const next: AttentionItem[] = [
      ...tableChanges.map((request) => ({
        id: `table:${request.id}`,
        kind: 'table' as const,
        createdAt: request.createdAt,
        request,
      })),
      ...reschedules.map((request) => ({
        id: `reschedule:${request.id}`,
        kind: 'reschedule' as const,
        createdAt: request.createdAt,
        request,
      })),
      ...reviews
        .filter((review) => {
          const createdAt = new Date(review.createdAt).getTime();
          return createdAt >= freshReviewLimit && !acknowledgedReviews.has(review.id);
        })
        .map((review) => ({
          id: `review:${review.id}`,
          kind: 'review' as const,
          createdAt: review.createdAt,
          review,
        })),
    ];

    return next.sort((left, right) => {
      const rank = { table: 1, reschedule: 2, review: 3 };
      return rank[left.kind] - rank[right.kind] || right.createdAt.localeCompare(left.createdAt);
    });
  }, [reschedules, tableChanges, reviews, acknowledgedReviews]);

  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [items.length, index]);

  function playSound() {
    if (!audioUnlocked) return;
    try {
      if (localStorage.getItem(SOUND_ENABLED_KEY) === 'false') return;
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const context = audioContextRef.current || new AudioContextClass();
      audioContextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(640, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(980, context.currentTime + 0.18);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.36);
    } catch {
      // Мобільний браузер може блокувати звук до першого натискання.
    }
  }

  useEffect(() => {
    if (!items.length || !audioUnlocked) return;
    playSound();
    const timer = window.setInterval(playSound, SOUND_REPEAT_MS);
    return () => window.clearInterval(timer);
  }, [items.map((item) => item.id).join('|'), audioUnlocked]);

  async function runAction(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice('Дію виконано');
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося виконати дію');
    } finally {
      setBusy(null);
    }
  }

  function acknowledgeReview(reviewId: string) {
    setAcknowledgedReviews((current) => {
      const next = new Set(current);
      next.add(reviewId);
      try {
        localStorage.setItem(ACKNOWLEDGED_REVIEWS_KEY, JSON.stringify([...next].slice(-500)));
      } catch {}
      return next;
    });
  }

  async function openTablePicker(request: AdminTableChangeRequest) {
    setPickerRequest(request);
    setSelectedTableId(null);
    setError(null);
    try {
      const response = await bookingsApi.tableStatuses({
        bookingDate: request.booking.bookingDate,
        bookingTime: request.booking.bookingTime,
        durationMinutes: request.booking.durationMinutes || 120,
      });
      setTableStatuses(response);
    } catch (pickerError: any) {
      setError(pickerError?.message || 'Не вдалося перевірити доступні столи');
    }
  }

  const candidateGroups = useMemo(() => {
    if (!pickerRequest || !fullMap || !tableStatuses) return [];
    const currentTableId = pickerRequest.booking.table?.id;
    const candidates = fullMap.tables.filter((table) => {
      const runtime = tableStatuses.statuses[String(table.tableNumber)];
      return (
        table.id !== currentTableId &&
        table.isVisible &&
        table.zone?.isVisible !== false &&
        !table.zone?.isClosed &&
        Number(table.seats) >= Number(pickerRequest.booking.guestsCount) &&
        runtime?.status === 'free'
      );
    });

    return LOCATION_ORDER.map((location) => ({
      location,
      tables: candidates
        .filter((table) => table.zone?.name === location)
        .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber)),
    })).filter((group) => group.tables.length > 0);
  }, [pickerRequest, fullMap, tableStatuses]);

  const current = items[index] || null;

  const homeContent = (
    <section className="rounded-[28px] border border-fuchsia-300/45 bg-black/70 p-4 shadow-[0_0_42px_rgba(217,70,239,.16)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-fuchsia-100"><BellRing size={16} />Запити гостей</p>
          <p className="mt-1 text-sm text-white/50">Час, пересадка та нові відгуки</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/20 bg-transparent text-white/75 disabled:opacity-50"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {(notice || error) && <p className={`mt-3 rounded-2xl border bg-transparent p-3 text-sm ${error ? 'border-red-300/45 text-red-100' : 'border-emerald-300/45 text-emerald-100'}`}>{error || notice}</p>}

      {current ? (
        <article className="mt-4 animate-pulse rounded-[24px] border border-fuchsia-300/55 bg-transparent p-4 shadow-[0_0_34px_rgba(217,70,239,.20)]">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-black">
              {current.kind === 'table' ? 'Гість просить змінити стіл' : current.kind === 'reschedule' ? 'Гість просить інший час' : 'Новий відгук гостя'}
            </h2>
            {items.length > 1 && <div className="flex items-center gap-1 rounded-xl border border-white/15 p-1"><button type="button" onClick={() => setIndex((value) => (value - 1 + items.length) % items.length)} className="p-1"><ChevronLeft size={17} /></button><span className="px-1 text-xs">{index + 1}/{items.length}</span><button type="button" onClick={() => setIndex((value) => (value + 1) % items.length)} className="p-1"><ChevronRight size={17} /></button></div>}
          </div>

          {current.kind === 'reschedule' && <RescheduleCard request={current.request} busy={busy} onApprove={() => void runAction(`reschedule:${current.request.id}:approve`, () => adminGuestActionsApi.approveReschedule(current.request.id))} onReject={() => { const comment = window.prompt('Причина відмови для гостя', '') || undefined; void runAction(`reschedule:${current.request.id}:reject`, () => adminGuestActionsApi.rejectReschedule(current.request.id, comment)); }} />}
          {current.kind === 'table' && <TableChangeCard request={current.request} busy={busy} onPick={() => void openTablePicker(current.request)} onReject={() => { const comment = window.prompt('Причина відмови для гостя', '') || undefined; void runAction(`table:${current.request.id}:reject`, () => adminGuestActionsApi.rejectTableChange(current.request.id, comment)); }} />}
          {current.kind === 'review' && <ReviewCard review={current.review} onAcknowledge={() => acknowledgeReview(current.review.id)} onOpenAll={() => setReviewsExpanded(true)} />}
        </article>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-[22px] border border-emerald-300/30 bg-transparent p-4 text-emerald-100"><Check size={20} /><span className="font-bold">Нових запитів гостей немає</span></div>
      )}
    </section>
  );

  const guestContent = (
    <section className="rounded-[24px] border border-fuchsia-300/35 bg-black/65 p-4 shadow-[0_0_28px_rgba(217,70,239,.12)]">
      <div className="flex items-center justify-between gap-3">
        <div><p className="flex items-center gap-2 font-black"><MessageSquareText size={18} />Відгуки</p><p className="text-xs text-white/45">Всього: {reviews.length}</p></div>
        <button type="button" onClick={() => setReviewsExpanded((value) => !value)} className="rounded-2xl border border-fuchsia-300/45 bg-transparent px-4 py-2 text-sm font-black text-fuchsia-100">{reviewsExpanded ? 'Сховати' : 'Відкрити'}</button>
      </div>
      {reviewsExpanded && <div className="mt-3 space-y-2">{reviews.slice(0, 50).map((review) => <ReviewListItem key={review.id} review={review} />)}{!reviews.length && <p className="rounded-2xl border border-dashed border-white/15 p-4 text-center text-sm text-white/40">Відгуків ще немає.</p>}</div>}
    </section>
  );

  return (
    <>
      {homeSlot && createPortal(homeContent, homeSlot)}
      {guestSlot && createPortal(guestContent, guestSlot)}
      {pickerRequest && createPortal(
        <div className="fixed inset-0 z-[140] flex items-end bg-black/80 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Підібрати стіл">
          <section className="max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-[30px] border border-fuchsia-300/45 bg-neutral-950 p-4 shadow-[0_0_50px_rgba(217,70,239,.22)]">
            <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xl font-black"><Table2 size={21} />Підібрати стіл</p><p className="mt-1 text-sm text-white/50">Поточний стіл №{pickerRequest.booking.table?.tableNumber || '-'} · {pickerRequest.booking.guestsCount} гостей</p>{pickerRequest.requestedTableNumber && <p className="mt-1 text-xs text-fuchsia-100">Побажання гостя: стіл №{pickerRequest.requestedTableNumber}</p>}</div><button type="button" onClick={() => setPickerRequest(null)} className="rounded-2xl border border-white/20 p-2"><X size={19} /></button></div>
            <div className="mt-4 space-y-4">{candidateGroups.map((group) => <div key={group.location}><p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-white/45">{group.location}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{group.tables.map((table) => <CandidateTable key={table.id} table={table} selected={selectedTableId === table.id} preferred={pickerRequest.requestedTableNumber === String(table.tableNumber)} onClick={() => setSelectedTableId(table.id)} />)}</div></div>)}{!candidateGroups.length && <p className="rounded-2xl border border-dashed border-white/20 p-5 text-center text-sm text-white/45">Підходящих вільних столів на цей час немає.</p>}</div>
            <button type="button" disabled={!selectedTableId || Boolean(busy)} onClick={() => selectedTableId && void runAction(`table:${pickerRequest.id}:approve`, async () => { await adminGuestActionsApi.approveTableChange(pickerRequest.id, selectedTableId); setPickerRequest(null); })} className="mt-5 w-full rounded-2xl border border-emerald-300/55 bg-transparent px-4 py-4 font-black text-emerald-100 shadow-[0_0_24px_rgba(52,211,153,.16)] disabled:opacity-40">Підтвердити пересадку</button>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

function RescheduleCard({ request, busy, onApprove, onReject }: { request: AdminRescheduleRequest; busy: string | null; onApprove: () => void; onReject: () => void }) {
  const booking = request.booking;
  return <div className="mt-3"><div className="grid grid-cols-2 gap-2 text-sm"><Info label="Було" value={`${formatDate(booking.bookingDate)} · ${formatTime(booking.bookingTime)}`} /><Info label="Запит" value={`${formatDate(request.requestedDate)} · ${formatTime(request.requestedTime)}`} /><Info label="Гість" value={booking.client?.fullName || '-'} /><Info label="Стіл" value={`№${booking.table?.tableNumber || '-'}`} /></div><div className="mt-3 grid grid-cols-2 gap-2"><ActionButton label="Підтвердити" disabled={Boolean(busy)} tone="emerald" onClick={onApprove} /><ActionButton label="Відхилити" disabled={Boolean(busy)} tone="red" onClick={onReject} /></div></div>;
}

function TableChangeCard({ request, busy, onPick, onReject }: { request: AdminTableChangeRequest; busy: string | null; onPick: () => void; onReject: () => void }) {
  const booking = request.booking;
  return <div className="mt-3"><div className="grid grid-cols-2 gap-2 text-sm"><Info label="Поточний стіл" value={`№${booking.table?.tableNumber || '-'}`} /><Info label="Побажання" value={request.requestedTableNumber ? `№${request.requestedTableNumber}` : 'Підібрати інший'} /><Info label="Гість" value={booking.client?.fullName || '-'} /><Info label="Дата і час" value={`${formatDate(booking.bookingDate)} · ${formatTime(booking.bookingTime)}`} /></div><div className="mt-3 grid grid-cols-2 gap-2"><ActionButton label="Підібрати стіл" disabled={Boolean(busy)} tone="fuchsia" onClick={onPick} /><ActionButton label="Відхилити" disabled={Boolean(busy)} tone="red" onClick={onReject} /></div></div>;
}

function ReviewCard({ review, onAcknowledge, onOpenAll }: { review: AdminGuestReview; onAcknowledge: () => void; onOpenAll: () => void }) {
  return <div className="mt-3"><div className="grid grid-cols-2 gap-2 text-sm"><Info label="Гість" value={review.booking.client?.fullName || '-'} /><Info label="Стіл" value={`№${review.booking.table?.tableNumber || '-'}`} /></div><p className="mt-3 rounded-2xl border border-white/15 bg-transparent p-3 text-sm leading-6 text-white/85">{review.text}</p><div className="mt-3 grid grid-cols-2 gap-2"><ActionButton label="Зрозуміло" disabled={false} tone="emerald" onClick={onAcknowledge} /><ActionButton label="Усі відгуки" disabled={false} tone="fuchsia" onClick={onOpenAll} /></div></div>;
}

function ReviewListItem({ review }: { review: AdminGuestReview }) {
  return <article className="rounded-2xl border border-white/15 bg-transparent p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-bold">{review.booking.client?.fullName || 'Гість'} · стіл №{review.booking.table?.tableNumber || '-'}</p><p className="text-xs text-white/40">{formatDate(review.booking.bookingDate)} · {formatTime(review.booking.bookingTime)}</p></div><span className="text-[10px] text-white/35">{new Date(review.createdAt).toLocaleString('uk-UA')}</span></div><p className="mt-2 text-sm leading-6 text-white/75">{review.text}</p></article>;
}

function CandidateTable({ table, selected, preferred, onClick }: { table: TableItem; selected: boolean; preferred: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-2xl border bg-transparent p-3 text-left transition ${selected ? 'border-amber-300 text-amber-100 shadow-[0_0_22px_rgba(250,204,21,.24)]' : preferred ? 'border-fuchsia-300/70 text-fuchsia-100 shadow-[0_0_18px_rgba(217,70,239,.16)]' : 'border-white/20 text-white/75'}`}><p className="text-lg font-black">№{table.tableNumber}</p><p className="mt-1 text-xs">{table.seats} місць</p>{preferred && <p className="mt-1 text-[10px] font-bold uppercase">Побажання гостя</p>}</button>;
}

function ActionButton({ label, disabled, tone, onClick }: { label: string; disabled: boolean; tone: 'emerald' | 'red' | 'fuchsia'; onClick: () => void }) {
  const styles = { emerald: 'border-emerald-300/55 text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,.12)]', red: 'border-red-300/55 text-red-100 shadow-[0_0_20px_rgba(248,113,113,.12)]', fuchsia: 'border-fuchsia-300/55 text-fuchsia-100 shadow-[0_0_20px_rgba(217,70,239,.12)]' }[tone];
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-2xl border bg-transparent px-3 py-3 text-sm font-black disabled:opacity-45 ${styles}`}>{label}</button>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/15 bg-transparent p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-white/35">{label}</p><p className="mt-1 truncate font-bold">{value}</p></div>;
}
