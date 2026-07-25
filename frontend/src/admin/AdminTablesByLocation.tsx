import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, MapPinned, RefreshCw, Table2, X } from 'lucide-react';

import { bookingsApi, type TableStatusesResponse } from '../api/bookings';
import { mapApi } from '../api/map';
import { tablesApi } from '../api/tables';
import type { FullMapResponse, TableItem, TableStatus } from '../api/types';

const POLLING_MS = 15_000;

const LOCATIONS = [
  { key: 'hall', label: 'Зал ресторану', range: '1–14', accepts: (number: number) => number >= 1 && number <= 14 },
  { key: 'canopy', label: 'Навіс', range: '15–20', accepts: (number: number) => number >= 15 && number <= 20 },
  { key: 'gazebo', label: 'Велика альтанка', range: '21–36', accepts: (number: number) => number >= 21 && number <= 36 },
  { key: 'rotang', label: 'Ротанг', range: '37–39', accepts: (number: number) => number >= 37 && number <= 39 },
  { key: 'embankment', label: 'Набережна', range: '40–44', accepts: (number: number) => number >= 40 && number <= 44 },
  { key: 'glass-gazebo', label: 'Скляна альтанка', range: '45–50', accepts: (number: number) => number >= 45 && number <= 50 },
  { key: 'water-gazebo', label: 'Альтанка на воді', range: '100–109', accepts: (number: number) => number >= 100 && number <= 109 },
] as const;

const STATUS_LABELS: Record<TableStatus, string> = {
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

function tableTone(status: TableStatus) {
  return {
    free: 'border-white/35 text-white/85 shadow-[0_0_16px_rgba(255,255,255,.07)]',
    pending: 'border-sky-300/70 text-sky-100 shadow-[0_0_18px_rgba(56,189,248,.20)]',
    reserved: 'border-orange-300/70 text-orange-100 shadow-[0_0_18px_rgba(251,146,60,.20)]',
    occupied: 'border-red-400/75 text-red-100 shadow-[0_0_18px_rgba(255,59,79,.24)]',
    cleaning: 'border-cyan-200/70 text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,.20)]',
    closed: 'border-neutral-300/55 text-neutral-200 shadow-[0_0_14px_rgba(189,189,189,.12)]',
  }[status];
}

function tableStatus(table: TableItem, statuses: TableStatusesResponse | null): TableStatus {
  return (statuses?.statuses?.[String(table.tableNumber)]?.status || table.status) as TableStatus;
}

export default function AdminTablesByLocation({ onClose }: { onClose: () => void }) {
  const today = useMemo(kyivToday, []);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedTime, setSelectedTime] = useState('19:00');
  const [fullMap, setFullMap] = useState<FullMapResponse | null>(null);
  const [statuses, setStatuses] = useState<TableStatusesResponse | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [actionTop, setActionTop] = useState(12);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);

    const [mapResult, statusResult] = await Promise.allSettled([
      mapApi.get(),
      bookingsApi.tableStatuses({
        bookingDate: selectedDate,
        bookingTime: selectedTime,
        durationMinutes: 120,
      }),
    ]);

    if (mapResult.status === 'fulfilled') setFullMap(mapResult.value);
    if (statusResult.status === 'fulfilled') setStatuses(statusResult.value);

    const failed = [mapResult, statusResult].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) setError(failed.reason?.message || 'Не вдалося завантажити столи');
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, [selectedDate, selectedTime]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const header = headerRef.current;
    if (!scroller || !header) return;

    let frame = 0;
    const updateTop = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setActionTop(Math.ceil(header.getBoundingClientRect().bottom + 8));
      });
    };

    updateTop();
    const observer = new ResizeObserver(updateTop);
    observer.observe(header);
    scroller.addEventListener('scroll', updateTop, { passive: true });
    window.addEventListener('resize', updateTop);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener('scroll', updateTop);
      window.removeEventListener('resize', updateTop);
    };
  }, []);

  const locationGroups = useMemo(() => LOCATIONS.map((location) => ({
    ...location,
    tables: (fullMap?.tables || [])
      .filter((table) => table.isVisible !== false && location.accepts(Number(table.tableNumber)))
      .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber)),
  })), [fullMap]);

  const unassignedTables = useMemo(() => (fullMap?.tables || [])
    .filter((table) => table.isVisible !== false && !LOCATIONS.some((location) => location.accepts(Number(table.tableNumber))))
    .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber)), [fullMap]);

  const selectedTable = (fullMap?.tables || []).find((table) => table.id === selectedTableId) || null;

  async function runTableAction(table: TableItem, status: 'free' | 'occupied' | 'cleaning' | 'closed') {
    if (selectedDate !== today) return;
    const key = `${table.id}:${status}`;
    setBusy(key);
    setError(null);
    setNotice(null);

    try {
      if (status === 'free') await tablesApi.free(table.id);
      if (status === 'occupied') await tablesApi.occupied(table.id);
      if (status === 'cleaning') await tablesApi.cleaning(table.id);
      if (status === 'closed') await tablesApi.close(table.id);
      setNotice(`Стіл №${table.tableNumber} оновлено`);
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося змінити статус столу');
    } finally {
      setBusy(null);
    }
  }

  function scrollToLocation(key: string) {
    document.getElementById(`admin-location-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderTable(table: TableItem) {
    const status = tableStatus(table, statuses);
    const selected = selectedTableId === table.id;

    return (
      <button
        key={table.id}
        type="button"
        onClick={() => setSelectedTableId(table.id)}
        className={`rounded-[22px] border bg-black/25 p-4 text-left transition active:scale-[0.98] ${tableTone(status)} ${selected ? 'ring-2 ring-amber-200/80 shadow-[0_0_24px_rgba(250,204,21,.26)]' : ''}`}
      >
        <p className="text-2xl font-black">№{table.tableNumber}</p>
        <p className="mt-2 text-sm opacity-85">{STATUS_LABELS[status]}</p>
        <p className="mt-2 text-xs opacity-45">{table.seats} місць</p>
      </button>
    );
  }

  return (
    <div ref={scrollRef} className="fixed inset-0 z-[85] overflow-y-auto bg-[#050707] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,.12),transparent_32%),radial-gradient(circle_at_top_right,rgba(34,211,238,.11),transparent_35%),linear-gradient(180deg,#050707,#081010_55%,#050707)]" />
      <main className="relative mx-auto min-h-screen max-w-7xl px-3 pb-28 pt-3 sm:px-5">
        <header ref={headerRef} className="sticky top-0 z-40 rounded-[28px] border border-amber-200/35 bg-black/90 p-3 shadow-[0_0_36px_rgba(250,204,21,.12)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-200/55 text-amber-100 shadow-[0_0_20px_rgba(250,204,21,.16)]"><Table2 size={22} /></span>
              <div className="min-w-0"><h1 className="truncate text-xl font-black">Столи за локаціями</h1><p className="text-xs text-white/45">7 локацій · столи впорядковані за номером</p></div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => void load()} disabled={loading} className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-200/45 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,.14)] disabled:opacity-40"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
              <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/25 text-white/75"><X size={19} /></button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="rounded-2xl border border-white/20 bg-black/35 px-3 py-2 text-xs text-white/45">Дата
              <input type="date" min={today} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-black text-white outline-none" />
            </label>
            <label className="rounded-2xl border border-white/20 bg-black/35 px-3 py-2 text-xs text-white/45">Час перевірки
              <input type="time" value={selectedTime} onChange={(event) => setSelectedTime(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-black text-white outline-none" />
            </label>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {locationGroups.map((location) => (
              <button key={location.key} type="button" onClick={() => scrollToLocation(location.key)} className="shrink-0 rounded-2xl border border-fuchsia-300/45 bg-black/25 px-3 py-2 text-xs font-black text-fuchsia-100 shadow-[0_0_14px_rgba(217,70,239,.12)]">
                {location.label} · {location.tables.length}
              </button>
            ))}
          </div>
        </header>

        {(notice || error) && (
          <div className={`mt-3 flex items-start justify-between gap-3 rounded-2xl border bg-black/55 px-3 py-3 text-sm ${error ? 'border-red-300/55 text-red-100' : 'border-emerald-300/55 text-emerald-100'}`}>
            <span>{error || notice}</span><button type="button" onClick={() => { setError(null); setNotice(null); }}><X size={16} /></button>
          </div>
        )}

        <div className="mt-3 rounded-[26px] border border-white/15 bg-black/45 p-3 text-xs text-white/50">
          <Clock3 size={16} className="mr-2 inline text-cyan-100" />
          {selectedDate === today ? 'Сьогодні можна змінювати робочий статус столу.' : 'На майбутню дату показується стан бронювання без зміни фізичного статусу.'}
        </div>

        <div className="mt-4 space-y-4">
          {locationGroups.map((location) => (
            <section id={`admin-location-${location.key}`} key={location.key} className="scroll-mt-44 rounded-[30px] border border-emerald-300/25 bg-black/50 p-4 shadow-[0_0_28px_rgba(16,185,129,.07)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-emerald-300/40 text-emerald-100"><MapPinned size={19} /></span><div><h2 className="text-xl font-black">{location.label}</h2><p className="text-xs text-white/40">Столи {location.range}</p></div></div>
                <span className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/55">{location.tables.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {location.tables.map(renderTable)}
              </div>
              {!location.tables.length && <p className="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm text-white/40">У цій локації столи не знайдено.</p>}
            </section>
          ))}

          {unassignedTables.length > 0 && (
            <section className="rounded-[30px] border border-white/20 bg-black/50 p-4">
              <div className="mb-4"><h2 className="text-xl font-black">Без визначеної локації</h2><p className="text-xs text-white/40">Потрібно перевірити номер або локацію столу</p></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{unassignedTables.map(renderTable)}</div>
            </section>
          )}
        </div>

        <button type="button" onClick={onClose} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/25 bg-transparent p-4 font-black text-white/70"><ArrowLeft size={18} />Назад у пульт</button>
      </main>

      {selectedTable && (
        <div className="fixed inset-x-0 z-[60] px-3 sm:px-5" style={{ top: actionTop }}>
          <section className="mx-auto max-w-7xl rounded-[28px] border border-amber-200/55 bg-black/95 p-4 shadow-[0_0_30px_rgba(250,204,21,.14)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-2xl font-black">Стіл №{selectedTable.tableNumber}</p><p className="mt-1 text-sm text-white/50">{selectedTable.zone?.name || 'Без локації'} · {selectedTable.seats} місць</p></div>
              <button type="button" onClick={() => setSelectedTableId(null)} className="rounded-xl border border-white/20 p-2 text-white/60"><X size={17} /></button>
            </div>
            {selectedDate === today ? (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button type="button" disabled={Boolean(busy)} onClick={() => void runTableAction(selectedTable, 'free')} className="rounded-2xl border border-white/45 bg-transparent p-3 font-black text-white/85">Вільний</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void runTableAction(selectedTable, 'occupied')} className="rounded-2xl border border-red-400/65 bg-transparent p-3 font-black text-red-100 shadow-[0_0_14px_rgba(255,59,79,.14)]">Зайнятий</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void runTableAction(selectedTable, 'cleaning')} className="rounded-2xl border border-cyan-200/65 bg-transparent p-3 font-black text-cyan-100 shadow-[0_0_14px_rgba(103,232,249,.14)]">Готується</button>
                <button type="button" disabled={Boolean(busy)} onClick={() => void runTableAction(selectedTable, 'closed')} className="rounded-2xl border border-neutral-300/55 bg-transparent p-3 font-black text-neutral-200">Закрити</button>
              </div>
            ) : <p className="mt-4 text-sm text-white/50">Для майбутньої дати робочі статуси не змінюються.</p>}
          </section>
        </div>
      )}
    </div>
  );
}
