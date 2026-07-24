import { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  MapPinned,
  RefreshCw,
  ShieldAlert,
  Table2,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';

import {
  availabilityBlocksApi,
  type AvailabilityBlock,
} from '../api/availabilityBlocks';
import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import type { Booking, FullMapResponse, TableItem, Zone } from '../api/types';

type Target =
  | { type: 'table'; id: string }
  | { type: 'zone'; id: string }
  | null;

const ACTIVE_STATUSES = new Set(['pending', 'approved']);
const CLEANUP_MINUTES = 15;

function kyivToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function timeToMinutes(value: string | null | undefined) {
  const [hours = '0', minutes = '0'] = String(value || '').split(':');
  return Number(hours) * 60 + Number(minutes);
}

function bookingDuration(booking: Booking) {
  const stored = Number(booking.durationMinutes || 0);
  if (Number.isFinite(stored) && stored >= 30) return stored;
  const match = String(booking.wishes || '').match(/Час відпочинку:\s*(\d+)\s*хв/i);
  return match ? Number(match[1]) : 120;
}

function bookingOverlaps(booking: Booking, startTime: string, endTime: string) {
  const bookingStart = timeToMinutes(booking.bookingTime);
  const bookingEnd = bookingStart + bookingDuration(booking) + CLEANUP_MINUTES;
  return timeToMinutes(startTime) < bookingEnd && timeToMinutes(endTime) > bookingStart;
}

function blockOverlaps(block: AvailabilityBlock, start: number, end: number) {
  if (!block.startTime || !block.endTime) return true;
  return timeToMinutes(block.startTime) < end && timeToMinutes(block.endTime) > start;
}

function dateLabel(date: string) {
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}.${month}.${year}` : date;
}

function timeLabel(value: string | null | undefined) {
  if (!value) return 'увесь день';
  const [hours = '00', minutes = '00'] = value.split(':');
  return `${hours}:${minutes}`;
}

export default function FutureAvailabilityPanel({ onClose }: { onClose: () => void }) {
  const today = useMemo(kyivToday, []);
  const [date, setDate] = useState(today);
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [target, setTarget] = useState<Target>(null);
  const [fullDay, setFullDay] = useState(true);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('23:00');
  const [reason, setReason] = useState('');
  const [transferBookingId, setTransferBookingId] = useState<string | null>(null);
  const [transferTableId, setTransferTableId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    const [mapResult, bookingResult, blockResult] = await Promise.allSettled([
      mapApi.get(),
      bookingsApi.getByDate(date),
      availabilityBlocksApi.list(date),
    ]);
    if (mapResult.status === 'fulfilled') setMap(mapResult.value);
    if (bookingResult.status === 'fulfilled') setBookings(bookingResult.value);
    if (blockResult.status === 'fulfilled') setBlocks(blockResult.value);
    const failed = [mapResult, bookingResult, blockResult].find(
      (result) => result.status === 'rejected',
    ) as PromiseRejectedResult | undefined;
    if (failed) setError(failed.reason?.message || 'Не вдалося завантажити планування');
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    setTarget(null);
    setTransferBookingId(null);
    setTransferTableId('');
    void load();
  }, [date]);

  const activeBookings = useMemo(
    () => bookings.filter((booking) => ACTIVE_STATUSES.has(booking.status)),
    [bookings],
  );

  const selectedTable = useMemo(
    () => target?.type === 'table'
      ? map?.tables.find((table) => table.id === target.id) || null
      : null,
    [target, map],
  );

  const selectedZone = useMemo(
    () => target?.type === 'zone'
      ? map?.zones.find((zone) => zone.id === target.id) || null
      : selectedTable?.zone || null,
    [target, map, selectedTable],
  );

  const targetBookings = useMemo(() => {
    if (!target) return [];
    return activeBookings.filter((booking) => {
      if (target.type === 'table') return booking.table?.id === target.id;
      return booking.table?.zone?.id === target.id;
    });
  }, [target, activeBookings]);

  const conflicts = useMemo(() => {
    if (fullDay) return targetBookings;
    return targetBookings.filter((booking) => bookingOverlaps(booking, startTime, endTime));
  }, [targetBookings, fullDay, startTime, endTime]);

  const targetBlocks = useMemo(() => {
    if (!target) return [];
    return blocks.filter((block) =>
      target.type === 'table'
        ? block.table?.id === target.id
        : block.zone?.id === target.id,
    );
  }, [blocks, target]);

  const canManage = map?.restaurant.adminCanManageZones !== false;

  function tableHasBlock(table: TableItem) {
    return blocks.some((block) =>
      block.table?.id === table.id || Boolean(table.zone?.id && block.zone?.id === table.zone.id),
    );
  }

  function zoneHasBlock(zone: Zone) {
    return blocks.some((block) => block.zone?.id === zone.id);
  }

  async function createBlock() {
    if (!target || !reason.trim() || conflicts.length) return;
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      await availabilityBlocksApi.create({
        tableId: target.type === 'table' ? target.id : undefined,
        zoneId: target.type === 'zone' ? target.id : undefined,
        blockDate: date,
        startTime: fullDay ? undefined : startTime,
        endTime: fullDay ? undefined : endTime,
        reason: reason.trim(),
      });
      setReason('');
      setNotice('Недоступність заплановано');
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося запланувати недоступність');
    } finally {
      setBusy(null);
    }
  }

  async function removeBlock(block: AvailabilityBlock) {
    const targetName = block.table
      ? `столу №${block.table.tableNumber}`
      : `локації «${block.zone?.name || '-'}»`;
    if (!window.confirm(`Відкрити ${targetName} на ${dateLabel(block.blockDate)}?`)) return;
    setBusy(`remove:${block.id}`);
    setError(null);
    try {
      await availabilityBlocksApi.remove(block.id);
      setNotice('Заплановану недоступність скасовано');
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося скасувати планування');
    } finally {
      setBusy(null);
    }
  }

  async function cancelBooking(booking: Booking) {
    if (!window.confirm(`Скасувати бронювання ${booking.client?.fullName || ''} на ${timeLabel(booking.bookingTime)}?`)) return;
    setBusy(`cancel:${booking.id}`);
    setError(null);
    try {
      await bookingsApi.cancel(booking.id);
      setNotice('Бронювання скасовано');
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося скасувати бронювання');
    } finally {
      setBusy(null);
    }
  }

  async function transferBooking(booking: Booking) {
    if (!transferTableId) return;
    setBusy(`transfer:${booking.id}`);
    setError(null);
    try {
      await availabilityBlocksApi.transferBooking(
        booking.id,
        transferTableId,
        reason.trim() || 'Перенесення через планову недоступність',
      );
      setTransferBookingId(null);
      setTransferTableId('');
      setNotice('Бронювання перенесено, гостю створено повідомлення');
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося перенести бронювання');
    } finally {
      setBusy(null);
    }
  }

  function availableDestinations(booking: Booking) {
    const bookingStart = timeToMinutes(booking.bookingTime);
    const bookingEnd = bookingStart + bookingDuration(booking) + CLEANUP_MINUTES;
    return (map?.tables || []).filter((table) => {
      if (table.id === booking.table?.id) return false;
      if (!table.isVisible || table.status === 'closed') return false;
      if (table.zone?.isClosed || table.zone?.isVisible === false) return false;
      if (Number(table.seats) < Number(booking.guestsCount)) return false;
      const hasBookingConflict = activeBookings.some((candidate) => {
        if (candidate.id === booking.id || candidate.table?.id !== table.id) return false;
        const start = timeToMinutes(candidate.bookingTime);
        const end = start + bookingDuration(candidate) + CLEANUP_MINUTES;
        return bookingStart < end && bookingEnd > start;
      });
      if (hasBookingConflict) return false;
      const hasBlockConflict = blocks.some((block) =>
        (block.table?.id === table.id || Boolean(table.zone?.id && block.zone?.id === table.zone.id)) &&
        blockOverlaps(block, bookingStart, bookingEnd),
      );
      return !hasBlockConflict;
    });
  }

  const selectedTargetName = selectedTable
    ? `Стіл №${selectedTable.tableNumber}`
    : selectedZone
      ? `Локація «${selectedZone.name}»`
      : null;

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/95 text-white backdrop-blur-xl">
      <div className="mx-auto min-h-screen max-w-6xl px-3 pb-28 pt-3 sm:px-5">
        <header className="sticky top-0 z-20 rounded-[24px] border border-white/10 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-200/25 bg-amber-300/10 text-amber-100">
                <CalendarClock size={21} />
              </span>
              <div className="min-w-0">
                <p className="truncate font-black">Планування столів і локацій</p>
                <p className="text-xs text-white/45">Майбутні дати, час і причина</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/65 disabled:opacity-40"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5 text-white/65"
              >
                <X size={19} />
              </button>
            </div>
          </div>

          <label className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-3 py-2">
            <CalendarDays size={18} className="text-amber-100/65" />
            <span className="text-xs text-white/40">Дата</span>
            <input
              type="date"
              min={today}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="ml-auto bg-transparent text-base font-black text-white outline-none"
            />
          </label>

          {(notice || error) && (
            <div className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border px-3 py-2 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100'}`}>
              <span>{error || notice}</span>
              <button type="button" onClick={() => { setError(null); setNotice(null); }}><X size={16} /></button>
            </div>
          )}
        </header>

        {!canManage && (
          <div className="mt-3 rounded-[24px] border border-amber-200/30 bg-amber-400/10 p-4 text-amber-100">
            <div className="flex items-start gap-3">
              <ShieldAlert size={21} className="mt-0.5 shrink-0" />
              <div><p className="font-black">Немає права на керування</p><p className="mt-1 text-sm opacity-70">Директор має увімкнути право керувати локаціями та столами.</p></div>
            </div>
          </div>
        )}

        <section className="mt-3 rounded-[26px] border border-white/10 bg-neutral-950 p-4">
          <div className="flex items-center gap-2"><MapPinned size={18} className="text-fuchsia-200" /><h2 className="font-black">Локації</h2></div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {(map?.zones || []).map((zone) => {
              const selected = target?.type === 'zone' && target.id === zone.id;
              const blocked = zoneHasBlock(zone);
              return (
                <button
                  key={zone.id}
                  type="button"
                  disabled={!canManage}
                  onClick={() => setTarget({ type: 'zone', id: zone.id })}
                  className={`rounded-[20px] border p-3 text-left transition active:scale-[0.98] disabled:opacity-45 ${selected ? 'border-amber-200/70 bg-amber-300/15 ring-2 ring-amber-300/40' : blocked ? 'border-fuchsia-300/35 bg-fuchsia-500/10' : 'border-white/10 bg-white/[0.03]'}`}
                >
                  <p className="truncate font-black">{zone.name}</p>
                  <p className="mt-1 text-[10px] text-white/45">{blocked ? 'Є планування' : 'Доступна'}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-3 rounded-[26px] border border-white/10 bg-neutral-950 p-4">
          <div className="flex items-center gap-2"><Table2 size={18} className="text-sky-200" /><h2 className="font-black">Столи</h2></div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {(map?.tables || []).map((table) => {
              const selected = target?.type === 'table' && target.id === table.id;
              const blocked = tableHasBlock(table);
              const bookingCount = activeBookings.filter((booking) => booking.table?.id === table.id).length;
              return (
                <button
                  key={table.id}
                  type="button"
                  disabled={!canManage}
                  onClick={() => setTarget({ type: 'table', id: table.id })}
                  className={`rounded-[20px] border p-3 text-left transition active:scale-[0.98] disabled:opacity-45 ${selected ? 'border-amber-200/70 bg-amber-300/15 ring-2 ring-amber-300/40' : blocked ? 'border-fuchsia-300/35 bg-fuchsia-500/10' : bookingCount ? 'border-sky-300/30 bg-sky-400/[0.07]' : 'border-white/10 bg-white/[0.03]'}`}
                >
                  <p className="text-lg font-black">№{table.tableNumber}</p>
                  <p className="truncate text-[10px] text-white/40">{table.zone?.name || 'Без локації'}</p>
                  <p className="mt-2 text-[10px] text-white/55">{blocked ? 'Недоступність запланована' : bookingCount ? `Бронювань: ${bookingCount}` : 'Вільний'}</p>
                </button>
              );
            })}
          </div>
        </section>

        {target && selectedTargetName && (
          <section className="mt-3 rounded-[28px] border border-amber-200/30 bg-amber-300/[0.06] p-4 shadow-[0_0_36px_rgba(251,191,36,.08)]">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-xs uppercase tracking-[0.16em] text-amber-100/50">Обрано</p><h2 className="mt-1 text-xl font-black">{selectedTargetName}</h2></div>
              <button type="button" onClick={() => setTarget(null)} className="rounded-xl border border-white/10 p-2 text-white/50"><X size={17} /></button>
            </div>

            {targetBlocks.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-fuchsia-100/60">Уже заплановано</p>
                {targetBlocks.map((block) => (
                  <div key={block.id} className="flex items-center justify-between gap-3 rounded-2xl border border-fuchsia-300/25 bg-fuchsia-500/[0.08] p-3">
                    <div className="min-w-0"><p className="font-bold">{block.startTime && block.endTime ? `${timeLabel(block.startTime)}–${timeLabel(block.endTime)}` : 'Увесь день'}</p><p className="truncate text-xs text-white/45">{block.reason}</p></div>
                    <button type="button" disabled={busy === `remove:${block.id}`} onClick={() => void removeBlock(block)} className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-100 disabled:opacity-40"><Trash2 size={14} />Відкрити</button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setFullDay(true)} className={`rounded-2xl border px-3 py-3 text-sm font-black ${fullDay ? 'border-amber-200/60 bg-amber-300 text-neutral-950' : 'border-white/10 bg-black/20 text-white/60'}`}>Увесь день</button>
              <button type="button" onClick={() => setFullDay(false)} className={`rounded-2xl border px-3 py-3 text-sm font-black ${!fullDay ? 'border-amber-200/60 bg-amber-300 text-neutral-950' : 'border-white/10 bg-black/20 text-white/60'}`}>Обрати час</button>
            </div>

            {!fullDay && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/40">Початок<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-black text-white outline-none" /></label>
                <label className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/40">Завершення<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-black text-white outline-none" /></label>
              </div>
            )}

            <label className="mt-3 block text-xs uppercase tracking-[0.14em] text-white/40">Причина
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Ремонт, подія, технічне обслуговування…" className="mt-2 min-h-24 w-full resize-y rounded-2xl border border-white/10 bg-black/25 p-3 text-base normal-case tracking-normal text-white outline-none focus:border-amber-200/40" />
            </label>

            {conflicts.length > 0 && (
              <div className="mt-4 rounded-[24px] border border-red-300/35 bg-red-500/[0.08] p-4">
                <div className="flex items-start gap-3"><CircleAlert size={21} className="mt-0.5 shrink-0 text-red-200" /><div><p className="font-black text-red-100">Спочатку обробіть бронювання</p><p className="mt-1 text-sm text-white/55">Закриття недоступне, поки бронювання не перенесено або не скасовано.</p></div></div>
                <div className="mt-3 space-y-2">
                  {conflicts.map((booking) => {
                    const destinations = availableDestinations(booking);
                    const transferOpen = transferBookingId === booking.id;
                    return (
                      <div key={booking.id} className="rounded-2xl border border-white/10 bg-black/25 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0"><p className="font-bold">{timeLabel(booking.bookingTime)} · Стіл №{booking.table?.tableNumber || '-'}</p><p className="truncate text-xs text-white/45">{booking.client?.fullName || '-'} · {booking.guestsCount} гостей</p></div>
                          <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-white/45">{booking.status === 'pending' ? 'Очікує' : 'Підтверджено'}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => { setTransferBookingId(transferOpen ? null : booking.id); setTransferTableId(''); }} className="rounded-xl border border-sky-300/30 bg-sky-400/10 px-3 py-2 text-xs font-black text-sky-100">Перенести</button>
                          <button type="button" disabled={busy === `cancel:${booking.id}`} onClick={() => void cancelBooking(booking)} className="rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-xs font-black text-red-100 disabled:opacity-40">Скасувати</button>
                        </div>
                        {transferOpen && (
                          <div className="mt-3 rounded-2xl border border-sky-300/20 bg-sky-500/[0.06] p-3">
                            <label className="text-xs text-white/45">Новий вільний стіл
                              <div className="relative mt-2"><select value={transferTableId} onChange={(event) => setTransferTableId(event.target.value)} className="w-full appearance-none rounded-xl border border-white/10 bg-neutral-950 px-3 py-3 pr-9 text-sm font-bold text-white outline-none"><option value="">Оберіть стіл</option>{destinations.map((table) => <option key={table.id} value={table.id}>№{table.tableNumber} · {table.zone?.name || 'Без локації'} · {table.seats} місць</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-3.5 text-white/40" /></div>
                            </label>
                            {!destinations.length && <p className="mt-2 text-xs text-red-100/75">Немає відповідного вільного столу.</p>}
                            <button type="button" disabled={!transferTableId || busy === `transfer:${booking.id}`} onClick={() => void transferBooking(booking)} className="mt-2 w-full rounded-xl bg-sky-300 px-3 py-3 text-sm font-black text-neutral-950 disabled:opacity-40">Підтвердити перенесення</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button type="button" disabled={!canManage || !reason.trim() || conflicts.length > 0 || busy === 'create' || (!fullDay && timeToMinutes(startTime) >= timeToMinutes(endTime))} onClick={() => void createBlock()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 py-4 font-black text-neutral-950 transition active:scale-[0.99] disabled:opacity-35"><CalendarClock size={19} />{busy === 'create' ? 'Зберігаємо…' : 'Запланувати недоступність'}</button>
          </section>
        )}

        {!target && !loading && (
          <div className="mt-3 rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
            <Check size={24} className="mx-auto text-emerald-200/70" />
            <p className="mt-3 font-black">Оберіть локацію або стіл</p>
            <p className="mt-1 text-sm text-white/40">Після вибору з’явиться компактна форма дати, часу та причини.</p>
          </div>
        )}

        <div className="mt-3 rounded-[22px] border border-white/10 bg-neutral-950 p-3 text-xs text-white/40">
          <div className="flex items-start gap-2"><Clock3 size={15} className="mt-0.5 shrink-0" /><p>Фізичні статуси «Зайнятий», «Готується» і «Вільний» наперед не встановлюються. Для майбутньої дати використовується лише запланована доступність.</p></div>
        </div>
      </div>
    </div>
  );
}
