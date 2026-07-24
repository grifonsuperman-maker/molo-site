import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MessageSquareText,
  RefreshCw,
  Table2,
  X,
} from 'lucide-react';

import {
  adminGuestRequestsApi,
  type AdminGuestReview,
  type AdminGuestRequestsResponse,
  type AdminRescheduleRequest,
  type AdminTableChangeRequest,
} from '../api/adminGuestRequests';
import { bookingsApi, type TableStatusesResponse } from '../api/bookings';
import { mapApi } from '../api/map';
import type { FullMapResponse, TableItem } from '../api/types';

const POLLING_MS = 15_000;
const SOUND_REPEAT_MS = 5_000;
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

type UrgentGuestItem =
  | { id: string; type: 'reschedule'; value: AdminRescheduleRequest; createdAt: string }
  | { id: string; type: 'table'; value: AdminTableChangeRequest; createdAt: string }
  | { id: string; type: 'review'; value: AdminGuestReview; createdAt: string };

function formatDate(value: string) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : value || '—';
}

function formatTime(value: string) {
  const [hours = '00', minutes = '00'] = String(value || '').split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Не вдалося виконати дію';
}

function bookingGuestName(item: UrgentGuestItem) {
  return item.value.booking?.client?.fullName || 'Гість';
}

export default function AdminGuestRequestsPanel() {
  const [data, setData] = useState<AdminGuestRequestsResponse>({
    reschedules: [],
    tableChanges: [],
    reviews: [],
  });
  const [fullMap, setFullMap] = useState<FullMapResponse | null>(null);
  const [urgentIndex, setUrgentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [tablePicker, setTablePicker] = useState<AdminTableChangeRequest | null>(null);
  const [tableStatuses, setTableStatuses] = useState<TableStatusesResponse | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);

  async function loadAll(silent = false) {
    if (!silent) setLoading(true);
    const [requestsResult, mapResult] = await Promise.allSettled([
      adminGuestRequestsApi.list(),
      fullMap ? Promise.resolve(fullMap) : mapApi.get(),
    ]);

    if (requestsResult.status === 'fulfilled') {
      setData(requestsResult.value);
      setError(null);
    } else {
      setError(errorText(requestsResult.reason));
    }
    if (mapResult.status === 'fulfilled') setFullMap(mapResult.value);
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    const timer = window.setInterval(() => void loadAll(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, []);

  const urgentItems = useMemo<UrgentGuestItem[]>(() => {
    const items: UrgentGuestItem[] = [
      ...data.tableChanges.map((value) => ({
        id: `table:${value.id}`,
        type: 'table' as const,
        value,
        createdAt: value.createdAt,
      })),
      ...data.reschedules.map((value) => ({
        id: `reschedule:${value.id}`,
        type: 'reschedule' as const,
        value,
        createdAt: value.createdAt,
      })),
      ...data.reviews
        .filter((value) => !value.acknowledgedAt)
        .map((value) => ({
          id: `review:${value.id}`,
          type: 'review' as const,
          value,
          createdAt: value.createdAt,
        })),
    ];
    return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [data]);

  useEffect(() => {
    if (urgentIndex >= urgentItems.length) setUrgentIndex(0);
  }, [urgentItems.length, urgentIndex]);

  useEffect(() => {
    const unlock = () => {
      try {
        const AudioContextClass = window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;
        const context = audioContextRef.current || new AudioContextClass();
        audioContextRef.current = context;
        void context.resume();
        setAudioUnlocked(true);
      } catch {}
    };
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    return () => document.removeEventListener('pointerdown', unlock, true);
  }, []);

  function playAlert() {
    let soundEnabled = true;
    try {
      soundEnabled = localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
    } catch {}
    if (!soundEnabled || !audioUnlocked) return;

    try {
      const context = audioContextRef.current;
      if (!context) return;
      const now = context.currentTime;
      [740, 940, 1180].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = now + index * 0.13;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.24, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.2);
      });
    } catch {}
  }

  useEffect(() => {
    if (!urgentItems.length || !audioUnlocked) return;
    playAlert();
    const timer = window.setInterval(playAlert, SOUND_REPEAT_MS);
    return () => window.clearInterval(timer);
  }, [urgentItems.map((item) => item.id).join('|'), audioUnlocked]);

  async function runAction(key: string, action: () => Promise<{ message: string }>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setNotice(result.message);
      await loadAll(true);
    } catch (actionError) {
      setError(errorText(actionError));
    } finally {
      setBusy(null);
    }
  }

  async function openTablePicker(request: AdminTableChangeRequest) {
    setTablePicker(request);
    setTableStatuses(null);
    setPickerLoading(true);
    setError(null);
    try {
      const result = await bookingsApi.tableStatuses({
        bookingDate: request.booking.bookingDate,
        bookingTime: request.booking.bookingTime,
        durationMinutes: Number(request.booking.durationMinutes || 120),
      });
      setTableStatuses(result);
    } catch (pickerError) {
      setError(errorText(pickerError));
    } finally {
      setPickerLoading(false);
    }
  }

  const candidateGroups = useMemo(() => {
    if (!tablePicker || !fullMap || !tableStatuses) return [] as Array<{ name: string; tables: TableItem[] }>;
    const currentTableId = tablePicker.booking.table?.id;
    const guestsCount = Number(tablePicker.booking.guestsCount || 0);
    const candidates = (fullMap.tables || []).filter((table) => {
      const runtime = tableStatuses.statuses[String(table.tableNumber)];
      return table.id !== currentTableId && runtime?.status === 'free' && Number(table.seats || 0) >= guestsCount;
    });

    return LOCATION_ORDER.map((name) => ({
      name,
      tables: candidates
        .filter((table) => table.zone?.name === name)
        .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber)),
    })).filter((group) => group.tables.length > 0);
  }, [tablePicker, fullMap, tableStatuses]);

  const current = urgentItems[urgentIndex] || null;

  return (
    <section className="mx-auto max-w-7xl px-3 pt-3 sm:px-4 lg:px-8" aria-label="Запити гостей">
      <div className="rounded-[28px] border border-fuchsia-300/30 bg-black/80 p-4 shadow-[0_0_34px_rgba(217,70,239,.12)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-100">
              <BellRing size={16} /> Друга частина пульта
            </p>
            <h2 className="mt-1 text-lg font-black">Запити гостей і відгуки</h2>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-white/25 bg-transparent text-white shadow-[0_0_18px_rgba(255,255,255,.12)] disabled:opacity-40"
            aria-label="Оновити запити"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {(notice || error) && (
          <div className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border bg-transparent px-3 py-2 text-sm ${error ? 'border-red-300/55 text-red-100 shadow-[0_0_18px_rgba(248,113,113,.14)]' : 'border-emerald-300/45 text-emerald-100 shadow-[0_0_18px_rgba(52,211,153,.12)]'}`}>
            <span>{error || notice}</span>
            <button type="button" onClick={() => { setError(null); setNotice(null); }}><X size={16} /></button>
          </div>
        )}

        {current ? (
          <article className="mt-4 animate-pulse rounded-[24px] border border-fuchsia-300/60 bg-transparent p-4 shadow-[0_0_42px_rgba(217,70,239,.2)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-100">Потребує уваги</p>
                <h3 className="mt-2 text-xl font-black">
                  {current.type === 'reschedule' && 'Гість просить змінити час'}
                  {current.type === 'table' && 'Гість просить змінити стіл'}
                  {current.type === 'review' && 'Новий внутрішній відгук'}
                </h3>
                <p className="mt-1 text-sm text-white/60">{bookingGuestName(current)} · Стіл №{current.value.booking?.table?.tableNumber || '—'}</p>
              </div>
              {urgentItems.length > 1 && (
                <div className="flex items-center gap-1 rounded-xl border border-white/20 bg-transparent p-1">
                  <button type="button" onClick={() => setUrgentIndex((urgentIndex - 1 + urgentItems.length) % urgentItems.length)} className="p-1"><ChevronLeft size={17} /></button>
                  <span className="px-1 text-xs">{urgentIndex + 1}/{urgentItems.length}</span>
                  <button type="button" onClick={() => setUrgentIndex((urgentIndex + 1) % urgentItems.length)} className="p-1"><ChevronRight size={17} /></button>
                </div>
              )}
            </div>

            {current.type === 'reschedule' && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Info label="Було" value={`${formatDate(current.value.booking.bookingDate)} · ${formatTime(current.value.booking.bookingTime)}`} />
                  <Info label="Запит" value={`${formatDate(current.value.requestedDate)} · ${formatTime(current.value.requestedTime)}`} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <OutlineButton
                    label="Підтвердити"
                    tone="emerald"
                    disabled={Boolean(busy)}
                    onClick={() => void runAction(`reschedule:${current.value.id}:approve`, () => adminGuestRequestsApi.approveReschedule(current.value.id))}
                  />
                  <OutlineButton
                    label="Відхилити"
                    tone="red"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      const comment = window.prompt('Причина відмови для гостя', '') || '';
                      void runAction(`reschedule:${current.value.id}:reject`, () => adminGuestRequestsApi.rejectReschedule(current.value.id, comment));
                    }}
                  />
                </div>
              </div>
            )}

            {current.type === 'table' && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Info label="Поточний стіл" value={`№${current.value.booking.table?.tableNumber || '—'}`} />
                  <Info label="Побажання гостя" value={current.value.requestedTableNumber ? `Стіл №${current.value.requestedTableNumber}` : 'Підібрати інший'} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <OutlineButton
                    label="Підібрати стіл"
                    tone="fuchsia"
                    disabled={Boolean(busy)}
                    onClick={() => void openTablePicker(current.value)}
                  />
                  <OutlineButton
                    label="Відхилити"
                    tone="red"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      const comment = window.prompt('Причина відмови для гостя', '') || '';
                      void runAction(`table:${current.value.id}:reject`, () => adminGuestRequestsApi.rejectTableChange(current.value.id, comment));
                    }}
                  />
                </div>
              </div>
            )}

            {current.type === 'review' && (
              <div className="mt-4 space-y-3">
                <p className="rounded-2xl border border-white/20 bg-transparent p-3 text-sm leading-6 text-white/80">{current.value.text}</p>
                <OutlineButton
                  label="Зрозуміло"
                  tone="emerald"
                  disabled={Boolean(busy)}
                  onClick={() => void runAction(`review:${current.value.id}:ack`, () => adminGuestRequestsApi.acknowledgeReview(current.value.id))}
                />
              </div>
            )}
          </article>
        ) : (
          <div className="mt-4 flex items-center gap-3 rounded-[22px] border border-emerald-300/30 bg-transparent p-4 text-emerald-100 shadow-[0_0_20px_rgba(52,211,153,.08)]">
            <Check size={20} />
            <div><p className="font-black">Нових запитів немає</p><p className="text-xs text-white/45">Зміна часу, пересадка та відгуки опрацьовані.</p></div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setReviewsOpen((value) => !value)}
          className="mt-4 flex w-full items-center justify-between rounded-2xl border border-sky-300/35 bg-transparent px-4 py-3 text-left text-sky-100 shadow-[0_0_18px_rgba(56,189,248,.08)]"
        >
          <span className="flex items-center gap-2 font-black"><MessageSquareText size={18} /> Відгуки гостей</span>
          <span className="text-xs text-white/55">{data.reviews.length} · {reviewsOpen ? 'Сховати' : 'Відкрити'}</span>
        </button>

        {reviewsOpen && (
          <div className="mt-3 space-y-2">
            {data.reviews.map((review) => (
              <article key={review.id} className="rounded-2xl border border-white/15 bg-transparent p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black">{review.booking.client?.fullName || 'Гість'} · Стіл №{review.booking.table?.tableNumber || '—'}</p>
                    <p className="text-xs text-white/45">{formatDate(review.booking.bookingDate)} · {formatTime(review.booking.bookingTime)}</p>
                  </div>
                  <span className={`text-[10px] font-black uppercase ${review.acknowledgedAt ? 'text-white/35' : 'text-fuchsia-200'}`}>{review.acknowledgedAt ? 'Опрацьовано' : 'Новий'}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/75">{review.text}</p>
              </article>
            ))}
            {!data.reviews.length && <p className="py-4 text-center text-sm text-white/40">Відгуків поки немає.</p>}
          </div>
        )}
      </div>

      {tablePicker && (
        <div className="fixed inset-0 z-[120] flex items-end bg-black/80 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-label="Підібрати новий стіл">
          <button type="button" className="absolute inset-0" aria-label="Закрити" onClick={() => setTablePicker(null)} />
          <section className="relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[32px] border border-fuchsia-300/40 bg-neutral-950 p-4 pb-10 shadow-[0_0_52px_rgba(217,70,239,.2)] sm:max-w-2xl sm:rounded-[32px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-fuchsia-100"><Table2 size={17} /> Підібрати стіл</p>
                <h3 className="mt-2 text-xl font-black">{tablePicker.booking.client?.fullName || 'Гість'} · {tablePicker.booking.guestsCount} гостей</h3>
                <p className="mt-1 text-sm text-white/55"><Clock3 size={14} className="mr-1 inline" />{formatDate(tablePicker.booking.bookingDate)} · {formatTime(tablePicker.booking.bookingTime)}</p>
              </div>
              <button type="button" onClick={() => setTablePicker(null)} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/25 bg-transparent"><X size={18} /></button>
            </div>

            {pickerLoading && <p className="mt-5 text-sm text-white/55">Перевіряємо доступні столи…</p>}
            {!pickerLoading && candidateGroups.map((group) => (
              <div key={group.name} className="mt-5">
                <h4 className="text-sm font-black uppercase tracking-[0.14em] text-white/55">{group.name}</h4>
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {group.tables.map((table) => (
                    <button
                      key={table.id}
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => void runAction(`table:${tablePicker.id}:approve`, async () => {
                        const result = await adminGuestRequestsApi.approveTableChange(tablePicker.id, table.id);
                        setTablePicker(null);
                        return result;
                      })}
                      className="rounded-2xl border border-emerald-300/45 bg-transparent px-3 py-3 text-left text-emerald-100 shadow-[0_0_16px_rgba(52,211,153,.08)] disabled:opacity-40"
                    >
                      <span className="block text-lg font-black">№{table.tableNumber}</span>
                      <span className="block text-[10px] text-white/45">{table.seats} місць</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!pickerLoading && !candidateGroups.length && <p className="mt-5 rounded-2xl border border-red-300/35 bg-transparent p-4 text-sm text-red-100">Підходящих вільних столів на цей час немає.</p>}
          </section>
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/15 bg-transparent p-3">
      <p className="text-[10px] uppercase tracking-[0.14em] text-white/35">{label}</p>
      <p className="mt-1 font-bold">{value}</p>
    </div>
  );
}

function OutlineButton({ label, tone, disabled, onClick }: {
  label: string;
  tone: 'emerald' | 'red' | 'fuchsia';
  disabled: boolean;
  onClick: () => void;
}) {
  const classes = {
    emerald: 'border-emerald-300/55 text-emerald-100 shadow-[0_0_18px_rgba(52,211,153,.12)]',
    red: 'border-red-300/55 text-red-100 shadow-[0_0_18px_rgba(248,113,113,.12)]',
    fuchsia: 'border-fuchsia-300/60 text-fuchsia-100 shadow-[0_0_20px_rgba(217,70,239,.14)]',
  }[tone];
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-2xl border bg-transparent px-4 py-3 font-black transition active:scale-[0.98] disabled:opacity-40 ${classes}`}>{label}</button>;
}
