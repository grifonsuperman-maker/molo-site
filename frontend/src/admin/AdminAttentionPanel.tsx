import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, MessageSquareText, RefreshCw, Table2, X } from 'lucide-react';

import {
  adminAttentionApi,
  type AdminAttentionDashboard,
  type AdminTableChangeRequest,
} from '../api/adminAttention';
import { bookingsApi, type TableStatusesResponse } from '../api/bookings';
import { getAccessToken } from '../api/client';
import { mapApi } from '../api/map';
import type { FullMapResponse, TableItem } from '../api/types';

const POLLING_MS = 15_000;
const LOCATION_ORDER = [
  'Зал ресторану',
  'Навіс',
  'Велика альтанка',
  'Ротанг',
  'Набережна',
  'Скляна альтанка',
  'Альтанка на воді',
];

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
      setDashboard(await adminAttentionApi.get());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не вдалося завантажити запити гостей');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!pickerRequest) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pickerRequest]);

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

  async function rejectTableChange(request: AdminTableChangeRequest) {
    const adminComment = window.prompt('Причина відмови для гостя', '') || undefined;
    await runAction(`table-change:${request.id}:reject`, () =>
      adminAttentionApi.rejectTableChange(request.id, adminComment),
    );
  }

  async function openPicker(request: AdminTableChangeRequest) {
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
        const status = pickerStatuses.statuses[String(table.tableNumber)]?.status;
        return Boolean(
          table.isVisible &&
          table.zone?.isVisible !== false &&
          !table.zone?.isClosed &&
          status === 'free' &&
          table.id !== pickerRequest.booking.table?.id &&
          Number(table.seats) >= Number(pickerRequest.booking.guestsCount),
        );
      })
      .sort(numericTableSort);
  }, [pickerMap, pickerRequest, pickerStatuses]);

  const groupedTables = useMemo(() => LOCATION_ORDER.map((location) => ({
    location,
    tables: eligibleTables.filter((table) => table.zone?.name === location),
  })).filter((group) => group.tables.length), [eligibleTables]);

  if (!dashboard) return null;

  const pendingCount = dashboard.tableChanges.length;
  const pickerDialog = pickerRequest && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="molo-admin-neon-theme fixed inset-0 z-[120] flex items-end p-3 sm:items-center sm:justify-center"
        style={{
          position: 'fixed',
          minHeight: 0,
          overflow: 'visible',
          background: 'rgba(0, 0, 0, 0.8)',
          paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Підібрати новий стіл"
      >
        <button type="button" className="absolute inset-0" onClick={() => setPickerRequest(null)} aria-label="Закрити вибір столу" />
        <section className="relative max-h-[calc(100dvh-1.5rem-env(safe-area-inset-bottom))] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-fuchsia-300/45 bg-neutral-950 p-4 shadow-[0_0_46px_rgba(217,70,239,.20)]">
          <div className="flex items-start justify-between gap-3">
            <div><h3 className="text-xl font-black">Підібрати новий стіл</h3><p className="mt-1 text-sm text-white/50">Поточний №{pickerRequest.booking.table?.tableNumber || '—'} · {pickerRequest.booking.guestsCount} гостей</p></div>
            <button type="button" onClick={() => setPickerRequest(null)} className="grid h-10 w-10 place-items-center rounded-xl border border-white/20"><X size={18} /></button>
          </div>

          {pickerLoading ? <p className="mt-5 rounded-2xl border border-white/15 p-5 text-center text-white/55">Шукаємо вільні столи…</p> : (
            <div className="mt-5 space-y-4">
              {groupedTables.map((group) => (
                <section key={group.location}>
                  <h4 className="mb-2 text-sm font-black text-white/70">{group.location}</h4>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {group.tables.map((table) => (
                      <button key={table.id} type="button" onClick={() => setSelectedTableId(table.id)} className={`rounded-2xl border bg-black/45 px-3 py-3 text-left ${selectedTableId === table.id ? 'border-amber-200 text-amber-100 shadow-[0_0_20px_rgba(250,204,21,.22)]' : 'border-white/20 text-white/75'}`}>
                        <span className="block text-lg font-black">№{table.tableNumber}</span><span className="block text-xs opacity-55">{table.seats} місць</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {!groupedTables.length && <p className="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm text-white/50">Підходящих вільних столів немає.</p>}
            </div>
          )}

          <button type="button" disabled={!selectedTableId || Boolean(busy)} onClick={() => selectedTableId && void runAction(`table-change:${pickerRequest.id}:approve`, () => adminAttentionApi.approveTableChange(pickerRequest.id, selectedTableId))} className="mt-5 w-full rounded-2xl border border-emerald-300/55 bg-black/50 px-4 py-4 font-black text-emerald-100 shadow-[0_0_22px_rgba(52,211,153,.16)] disabled:opacity-35">Підтвердити пересадку</button>
        </section>
      </div>,
      document.body,
    )
    : null;

  return (
    <section className="mx-auto max-w-7xl px-3 pt-3 sm:px-4 lg:px-8" aria-label="Запити гостей для Адміністратора">
      <div className="rounded-[28px] border border-fuchsia-300/30 bg-black/80 p-3 shadow-[0_0_32px_rgba(217,70,239,.12)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-fuchsia-100/60">Потребує уваги</p>
            <h2 className="mt-1 text-lg font-black">Запити гостей · {pendingCount}</h2>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="grid h-11 w-11 place-items-center rounded-2xl border border-fuchsia-200/45 bg-black/40 text-fuchsia-100 shadow-[0_0_18px_rgba(217,70,239,.18)] disabled:opacity-40" aria-label="Оновити запити">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {(notice || error) && (
          <div className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border bg-black/45 px-3 py-2 text-sm ${error ? 'border-red-300/45 text-red-100' : 'border-emerald-300/45 text-emerald-100'}`}>
            <span>{error || notice}</span>
            <button type="button" onClick={() => { setError(null); setNotice(null); }}><X size={16} /></button>
          </div>
        )}

        <div className="mt-3 space-y-3">
          {dashboard.tableChanges.map((request) => (
            <article key={request.id} className="rounded-[24px] border border-fuchsia-300/50 bg-black/50 p-4 shadow-[0_0_26px_rgba(217,70,239,.14)]">
              <h3 className="flex items-center gap-2 text-lg font-black"><Table2 size={19} />Гість просить інший стіл</h3>
              <InfoGrid booking={request.booking} extraLabel="Бажаний" extraValue={request.requestedTableNumber ? `№${request.requestedTableNumber}` : 'Підібрати'} />
              <p className="mt-3 text-sm text-white/55">Поточний стіл залишається за гостем до підтвердження Адміністратора.</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <ActionButton label="Підібрати стіл" disabled={Boolean(busy)} tone="fuchsia" onClick={() => void openPicker(request)} />
                <ActionButton label="Відхилити" disabled={Boolean(busy)} tone="red" onClick={() => void rejectTableChange(request)} />
              </div>
            </article>
          ))}

          {!pendingCount && (
            <div className="flex items-center gap-3 rounded-[22px] border border-emerald-300/30 bg-black/40 p-4 text-emerald-100">
              <span className="grid h-10 w-10 place-items-center rounded-2xl border border-emerald-300/45"><Check size={20} /></span>
              <div><p className="font-black">Запитів на пересадку немає</p><p className="text-xs text-white/45">Нові запити з’являться тут.</p></div>
            </div>
          )}
        </div>

        <button type="button" onClick={() => setReviewsOpen((current) => !current)} className="mt-3 flex w-full items-center justify-between rounded-2xl border border-sky-300/40 bg-black/40 px-4 py-3 text-left text-sky-100 shadow-[0_0_18px_rgba(56,189,248,.12)]">
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

      {pickerDialog}
    </section>
  );
}

function InfoGrid({ booking, extraLabel, extraValue }: { booking: AdminTableChangeRequest['booking']; extraLabel: string; extraValue: string }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <Info label="Гість" value={booking.client?.fullName || '—'} />
      <Info label="Стіл" value={`№${booking.table?.tableNumber || '—'}`} />
      <Info label="Було" value={`${formatDate(booking.bookingDate)} · ${formatTime(booking.bookingTime)}`} />
      <Info label={extraLabel} value={extraValue} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/15 bg-black/45 p-3"><p className="text-[10px] uppercase tracking-[0.12em] text-white/40">{label}</p><p className="mt-1 truncate font-black">{value}</p></div>;
}

function ActionButton({ label, disabled, tone, onClick }: { label: string; disabled: boolean; tone: 'red' | 'fuchsia'; onClick: () => void }) {
  const classes: Record<string, string> = {
    red: 'border-red-300/55 text-red-100 shadow-[0_0_20px_rgba(248,113,113,.13)]',
    fuchsia: 'border-fuchsia-300/60 text-fuchsia-100 shadow-[0_0_20px_rgba(217,70,239,.16)]',
  };
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-2xl border bg-black/50 px-4 py-3 font-black disabled:opacity-40 ${classes[tone]}`}>{label}</button>;
}
