import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
  type AdminAttentionDashboard,
  type AdminGuestReview,
  type AdminRescheduleRequest,
  type AdminTableChangeRequest,
} from '../api/adminAttention';
import { bookingsApi, type TableStatusesResponse } from '../api/bookings';
import { getAccessToken } from '../api/client';
import { mapApi } from '../api/map';
import type { FullMapResponse, TableItem } from '../api/types';

const POLLING_MS = 15_000;
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

type UrgentItem =
  | { id: string; type: 'reschedule'; request: AdminRescheduleRequest }
  | { id: string; type: 'table-change'; request: AdminTableChangeRequest }
  | { id: string; type: 'review'; review: AdminGuestReview };

function readAcknowledgedReviews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACKNOWLEDGED_REVIEWS_KEY) || '[]');
    return new Set<string>(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function formatDate(value: string) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : value || '—';
}

function formatTime(value: string | null | undefined) {
  const [hours = '00', minutes = '00'] = String(value || '').split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function numericTableSort(left: TableItem, right: TableItem) {
  return Number(left.tableNumber) - Number(right.tableNumber);
}

export default function AdminAttentionPanel() {
  const [dashboard, setDashboard] = useState<AdminAttentionDashboard | null>(null);
  const [acknowledgedReviews, setAcknowledgedReviews] = useState<Set<string>>(readAcknowledgedReviews);
  const [urgentIndex, setUrgentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [pickerRequest, setPickerRequest] = useState<AdminTableChangeRequest | null>(null);
  const [pickerMap, setPickerMap] = useState<FullMapResponse | null>(null);
  const [pickerStatuses, setPickerStatuses] = useState<TableStatusesResponse | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!getAccessToken()) {
      setDashboard(null);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const result = await adminAttentionApi.get();
      setDashboard(result);
      setError(null);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Не вдалося завантажити запити гостей';
      if (!/автор|token|доступ/i.test(message)) setError(message);
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
    if (!dashboard) return [];
    const freshReviewsAfter = Date.now() - 72 * 60 * 60 * 1000;
    return [
      ...dashboard.reschedules.map((request) => ({
        id: `reschedule:${request.id}`,
        type: 'reschedule' as const,
        request,
      })),
      ...dashboard.tableChanges.map((request) => ({
        id: `table-change:${request.id}`,
        type: 'table-change' as const,
        request,
      })),
      ...dashboard.reviews
        .filter((review) => {
          const createdAt = new Date(review.createdAt).getTime();
          return !acknowledgedReviews.has(review.id) && Number.isFinite(createdAt) && createdAt >= freshReviewsAfter;
        })
        .map((review) => ({ id: `review:${review.id}`, type: 'review' as const, review })),
    ];
  }, [dashboard, acknowledgedReviews]);

  useEffect(() => {
    if (urgentIndex >= urgentItems.length) setUrgentIndex(0);
  }, [urgentIndex, urgentItems.length]);

  const currentUrgent = urgentItems[urgentIndex] || null;

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

  async function runAction(key: string, action: () => Promise<{ message: string }>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setNotice(result.message);
      setPickerRequest(null);
      setSelectedTableId(null);
      await load(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Не вдалося виконати дію');
    } finally {
      setBusy(null);
    }
  }

  async function rejectReschedule(request: AdminRescheduleRequest) {
    const comment = window.prompt('Причина відмови для гостя', '') || undefined;
    await runAction(`reschedule:${request.id}:reject`, () =>
      adminAttentionApi.rejectReschedule(request.id, comment),
    );
  }

  async function rejectTableChange(request: AdminTableChangeRequest) {
    const comment = window.prompt('Причина відмови для гостя', '') || undefined;
    await runAction(`table-change:${request.id}:reject`, () =>
      adminAttentionApi.rejectTableChange(request.id, comment),
    );
  }

  async function openTablePicker(request: AdminTableChangeRequest) {
    setPickerRequest(request);
    setSelectedTableId(null);
    setPickerLoading(true);
    setError(null);
    try {
      const [map, statuses] = await Promise.all([
        mapApi.get(),
        bookingsApi.tableStatuses({
          bookingDate: request.booking.bookingDate,
          bookingTime: request.booking.bookingTime,
          durationMinutes: request.booking.durationMinutes || 120,
        }),
      ]);
      setPickerMap(map);
      setPickerStatuses(statuses);
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : 'Не вдалося знайти вільні столи');
    } finally {
      setPickerLoading(false);
    }
  }

  const eligibleTables = useMemo(() => {
    if (!pickerRequest || !pickerMap || !pickerStatuses) return [];
    return pickerMap.tables
      .filter((table) => {
        const runtime = pickerStatuses.statuses[String(table.tableNumber)];
        return Boolean(
          table.isVisible &&
          table.zone?.isVisible !== false &&
          !table.zone?.isClosed &&
          runtime?.status === 'free' &&
          table.id !== pickerRequest.booking.table?.id &&
          Number(table.seats) >= Number(pickerRequest.booking.guestsCount),
        );
      })
      .sort(numericTableSort);
  }, [pickerMap, pickerRequest, pickerStatuses]);

  const groupedEligibleTables = useMemo(() => LOCATION_ORDER.map((location) => ({
    location,
    tables: eligibleTables.filter((table) => table.zone?.name === location),
  })).filter((group) => group.tables.length > 0), [eligibleTables]);

  if (!dashboard) return null;

  return (
    <section className="mx-auto max-w-7xl px-3 pt-3 sm:px-4 lg:px-8" aria-label="Запити гостей для Адміністратора">
      <div className="rounded-[28px] border border-fuchsia-300/25 bg-black/80 p-3 shadow-[0_0_32px_rgba(217,70,239,.10)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-fuchsia-100/60">Запити гостей</p>
            <h2 className="mt-1 text-lg font-black">Потребує уваги · {urgentItems.length}</h2>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-fuchsia-200/45 bg-black/40 text-fuchsia-100 shadow-[0_0_18px_rgba(217,70,239,.16)] disabled:opacity-40"
            aria-label="Оновити запити"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {(notice || error) && (
          <div className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border bg-black/45 px-3 py-2 text-sm ${error ? 'border-red-300/45 text-red-100' : 'border-emerald-300/45 text-emerald-100'}`}>
            <span>{error || notice}</span>
            <button type="button" onClick={() => { setError(null); setNotice(null); }}><X size={16} /></button>
          </div>
        )}

        {currentUrgent ? (
          <article className="mt-3 animate-pulse rounded-[24px] border border-amber-200/55 bg-black/55 p-4 shadow-[0_0_34px_rgba(250,204,21,.17)]">
            <div className="flex items-start justify-between gap-3">
              <UrgentHeading item={currentUrgent} />
              {urgentItems.length > 1 && (
                <div className="flex items-center gap-1 rounded-xl border border-white/15 bg-black/50 p-1">
                  <button type="button" onClick={() => setUrgentIndex((current) => (current - 1 + urgentItems.length) % urgentItems.length)} className="p-1"><ChevronLeft size={17} /></button>
                  <span className="px-1 text-xs">{urgentIndex + 1}/{urgentItems.length}</span>
                  <button type="button" onClick={() => setUrgentIndex((current) => (current + 1) % urgentItems.length)} className="p-1"><ChevronRight size={17} /></button>
                </div>
              )}
            </div>

            {currentUrgent.type === 'reschedule' && (
              <RescheduleCard
                request={currentUrgent.request}
                busy={busy}
                onApprove={() => void runAction(`reschedule:${currentUrgent.request.id}:approve`, () => adminAttentionApi.approveReschedule(currentUrgent.request.id))}
                onReject={() => void rejectReschedule(currentUrgent.request)}
              />
            )}

            {currentUrgent.type === 'table-change' && (
              <TableChangeCard
                request={currentUrgent.request}
                busy={busy}
                onPick={() => void openTablePicker(currentUrgent.request)}
                onReject={() => void rejectTableChange(currentUrgent.request)}
              />
            )}

            {currentUrgent.type === 'review' && (
              <ReviewCard review={currentUrgent.review} onAcknowledge={() => acknowledgeReview(currentUrgent.review.id)} />
            )}
          </article>
        ) : (
          <div className="mt-3 flex items-center gap-3 rounded-[22px] border border-emerald-300/25 bg-black/40 p-4 text-emerald-100">
            <span className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-300/40"><Check size={20} /></span>
            <div><p className="font-black">Нових запитів немає</p><p className="text-xs text-white/45">Час, пересадка та нові відгуки перевірені.</p></div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setReviewsOpen((current) => !current)}
          className="mt-3 flex w-full items-center justify-between rounded-2xl border border-sky-300/35 bg-black/40 px-4 py-3 text-left text-sky-100 shadow-[0_0_18px_rgba(56,189,248,.10)]"
        >
          <span className="flex items-center gap-2 font-black"><MessageSquareText size={18} />Відгуки гостей</span>
          <span className="text-xs text-white/50">{dashboard.reviews.length} · {reviewsOpen ? 'Сховати' : 'Відкрити'}</span>
        </button>

        {reviewsOpen && (
          <div className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {dashboard.reviews.map((review) => (
              <article key={review.id} className="rounded-2xl border border-white/15 bg-black/45 p-3">
                <p className="font-black">{review.booking.client?.fullName || 'Гість'} · Стіл №{review.booking.table?.tableNumber || '—'}</p>
                <p className="mt-1 text-xs text-white/45">{formatDate(review.booking.bookingDate)} · {formatTime(review.booking.bookingTime)}</p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-white/80">{review.text}</p>
              </article>
            ))}
            {!dashboard.reviews.length && <p className="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm text-white/45">Відгуків поки немає.</p>}
          </div>
        )}
      </div>

      {pickerRequest && (
        <div className="fixed inset-0 z-[90] flex items-end bg-black/80 p-3 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Підібрати новий стіл">
          <button type="button" className="absolute inset-0" onClick={() => setPickerRequest(null)} aria-label="Закрити вибір столу" />
          <section className="relative max-h-[86dvh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-fuchsia-300/45 bg-neutral-950 p-4 shadow-[0_0_46px_rgba(217,70,239,.20)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-100/60">Пересадка</p>
                <h3 className="mt-1 text-xl font-black">Підібрати стіл для {pickerRequest.booking.client?.fullName || 'гостя'}</h3>
                <p className="mt-1 text-sm text-white/50">Поточний стіл №{pickerRequest.booking.table?.tableNumber || '—'} · {pickerRequest.booking.guestsCount} гостей</p>
              </div>
              <button type="button" onClick={() => setPickerRequest(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/20"><X size={18} /></button>
            </div>

            {pickerLoading ? (
              <p className="mt-5 rounded-2xl border border-white/15 p-5 text-center text-white/55">Шукаємо вільні столи…</p>
            ) : (
              <div className="mt-5 space-y-4">
                {groupedEligibleTables.map((group) => (
                  <section key={group.location}>
                    <h4 className="mb-2 text-sm font-black text-white/70">{group.location}</h4>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {group.tables.map((table) => (
                        <button
                          key={table.id}
                          type="button"
                          onClick={() => setSelectedTableId(table.id)}
                          className={`rounded-2xl border bg-black/45 px-3 py-3 text-left transition ${selectedTableId === table.id ? 'border-amber-200 text-amber-100 shadow-[0_0_20px_rgba(250,204,21,.22)]' : 'border-white/20 text-white/75'}`}
                        >
                          <span className="block text-lg font-black">№{table.tableNumber}</span>
                          <span className="block text-xs opacity-55">{table.seats} місць</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
                {!groupedEligibleTables.length && <p className="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm text-white/50">Підходящих вільних столів на цей час немає.</p>}
              </div>
            )}

            <button
              type="button"
              disabled={!selectedTableId || Boolean(busy)}
              onClick={() => selectedTableId && void runAction(`table-change:${pickerRequest.id}:approve`, () => adminAttentionApi.approveTableChange(pickerRequest.id, selectedTableId))}
              className="mt-5 w-full rounded-2xl border border-emerald-300/55 bg-black/50 px-4 py-4 font-black text-emerald-100 shadow-[0_0_22px_rgba(52,211,153,.16)] disabled:opacity-35"
            >
              Підтвердити пересадку
            </button>
          </section>
        </div>
      )}
    </section>
  );
}

function UrgentHeading({ item }: { item: UrgentItem }) {
  const content = item.type === 'reschedule'
    ? { icon: <CalendarClock size={18} />, title: 'Гість просить інший час' }
    : item.type === 'table-change'
      ? { icon: <Table2 size={18} />, title: 'Гість просить інший стіл' }
      : { icon: <MessageSquareText size={18} />, title: 'Новий відгук гостя' };
  return <div><p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-amber-100/70">{content.icon}Потребує уваги</p><h3 className="mt-2 text-xl font-black">{content.title}</h3></div>;
}

function RescheduleCard({ request, busy, onApprove, onReject }: {
  request: AdminRescheduleRequest;
  busy: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const booking = request.booking;
  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Info label="Гість" value={booking.client?.fullName || '—'} icon={<UserRound size={15} />} />
        <Info label="Стіл" value={`№${booking.table?.tableNumber || '—'}`} icon={<Table2 size={15} />} />
        <Info label="Було" value={`${formatDate(booking.bookingDate)} · ${formatTime(booking.bookingTime)}`} icon={<Clock3 size={15} />} />
        <Info label="Запит" value={`${formatDate(request.requestedDate)} · ${formatTime(request.requestedTime)}`} icon={<CalendarClock size={15} />} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={Boolean(busy)} onClick={onApprove} className="rounded-2xl border border-emerald-300/60 bg-black/50 px-4 py-3 font-black text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,.16)] disabled:opacity-40">Підтвердити</button>
        <button type="button" disabled={Boolean(busy)} onClick={onReject} className="rounded-2xl border border-red-300/55 bg-black/50 px-4 py-3 font-black text-red-100 shadow-[0_0_20px_rgba(248,113,113,.13)] disabled:opacity-40">Відхилити</button>
      </div>
    </div>
  );
}

function TableChangeCard({ request, busy, onPick, onReject }: {
  request: AdminTableChangeRequest;
  busy: string | null;
  onPick: () => void;
  onReject: () => void;
}) {
  const booking = request.booking;
  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Info label="Гість" value={booking.client?.fullName || '—'} icon={<UserRound size={15} />} />
        <Info label="Поточний стіл" value={`№${booking.table?.tableNumber || '—'}`} icon={<Table2 size={15} />} />
        <Info label="Бажаний" value={request.requestedTableNumber ? `№${request.requestedTableNumber}` : 'Підібрати'} icon={<Table2 size={15} />} />
        <Info label="Дата і час" value={`${formatDate(booking.bookingDate)} · ${formatTime(booking.bookingTime)}`} icon={<Clock3 size={15} />} />
      </div>
      <p className="mt-3 text-sm text-white/55">Поточний стіл залишається за гостем, доки Адміністратор не підтвердить новий.</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={Boolean(busy)} onClick={onPick} className="rounded-2xl border border-fuchsia-300/60 bg-black/50 px-4 py-3 font-black text-fuchsia-100 shadow-[0_0_20px_rgba(217,70,239,.16)] disabled:opacity-40">Підібрати стіл</button>
        <button type="button" disabled={Boolean(busy)} onClick={onReject} className="rounded-2xl border border-red-300/55 bg-black/50 px-4 py-3 font-black text-red-100 shadow-[0_0_20px_rgba(248,113,113,.13)] disabled:opacity-40">Відхилити</button>
      </div>
    </div>
  );
}

function ReviewCard({ review, onAcknowledge }: { review: AdminGuestReview; onAcknowledge: () => void }) {
  return (
    <div className="mt-4">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Info label="Гість" value={review.booking.client?.fullName || '—'} icon={<UserRound size={15} />} />
        <Info label="Стіл" value={`№${review.booking.table?.tableNumber || '—'}`} icon={<Table2 size={15} />} />
        <Info label="Дата" value={formatDate(review.booking.bookingDate)} icon={<CalendarClock size={15} />} />
        <Info label="Час" value={formatTime(review.booking.bookingTime)} icon={<Clock3 size={15} />} />
      </div>
      <p className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/15 bg-black/45 p-3 text-sm leading-6 text-white/85">{review.text}</p>
      <button type="button" onClick={onAcknowledge} className="mt-4 w-full rounded-2xl border border-sky-300/55 bg-black/50 px-4 py-3 font-black text-sky-100 shadow-[0_0_20px_rgba(56,189,248,.14)]">Зрозуміло</button>
    </div>
  );
}

function Info({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-black/45 p-3">
      <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/40">{icon}{label}</p>
      <p className="mt-1 truncate font-black">{value}</p>
    </div>
  );
}
