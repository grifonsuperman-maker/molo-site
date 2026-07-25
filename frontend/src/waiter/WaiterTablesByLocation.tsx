import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, MapPinned, RefreshCw, Table2, X } from 'lucide-react';

import { tablesApi } from '../api/tables';
import type { TableItem, TableStatus } from '../api/types';

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
  closed: 'Закритий',
};

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

export default function WaiterTablesByLocation({ onClose }: { onClose: () => void }) {
  const [tables, setTables] = useState<TableItem[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await tablesApi.getAll();
      setTables(result);
      setError(null);
    } catch (loadError: any) {
      setError(loadError?.message || 'Не вдалося завантажити столи');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), POLLING_MS);
    return () => window.clearInterval(timer);
  }, []);

  const locationGroups = useMemo(() => LOCATIONS.map((location) => ({
    ...location,
    tables: tables
      .filter((table) => table.isVisible !== false && location.accepts(Number(table.tableNumber)))
      .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber)),
  })), [tables]);

  const unassignedTables = useMemo(() => tables
    .filter((table) => table.isVisible !== false && !LOCATIONS.some((location) => location.accepts(Number(table.tableNumber))))
    .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber)), [tables]);

  const selectedTable = tables.find((table) => table.id === selectedTableId) || null;

  async function setStatus(table: TableItem, status: 'occupied' | 'free') {
    const key = `${table.id}:${status}`;
    setBusy(key);
    setNotice(null);
    setError(null);

    try {
      const updated = await tablesApi.waiterStatus(table.id, status);
      setTables((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(`Стіл №${table.tableNumber}: ${STATUS_LABELS[updated.status]}`);
      await load(true);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося змінити статус столу');
    } finally {
      setBusy(null);
    }
  }

  function scrollToLocation(key: string) {
    document.getElementById(`waiter-location-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderTable(table: TableItem) {
    const selected = selectedTableId === table.id;
    return (
      <button
        key={table.id}
        type="button"
        onClick={() => setSelectedTableId(table.id)}
        className={`rounded-[22px] border bg-black/25 p-4 text-left transition active:scale-[0.98] ${tableTone(table.status)} ${selected ? 'ring-2 ring-amber-200/80 shadow-[0_0_24px_rgba(250,204,21,.26)]' : ''}`}
      >
        <p className="text-2xl font-black">№{table.tableNumber}</p>
        <p className="mt-2 text-sm opacity-85">{STATUS_LABELS[table.status]}</p>
        <p className="mt-2 text-xs opacity-45">{table.seats} місць</p>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[85] overflow-y-auto bg-[#020607] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(250,204,21,.14),transparent_34%),radial-gradient(circle_at_90%_30%,rgba(34,211,238,.10),transparent_36%),linear-gradient(180deg,#020607,#071011_55%,#020607)]" />
      <main className={`relative mx-auto min-h-screen max-w-4xl px-3 pt-3 sm:px-5 ${selectedTable ? 'pb-64' : 'pb-28'}`}>
        <header className="sticky top-0 z-40 rounded-[30px] border border-amber-200/25 bg-black/90 p-4 shadow-[0_0_46px_rgba(250,204,21,.08)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-200/35 bg-amber-300/10 text-amber-100"><Table2 size={21} /></span>
              <div className="min-w-0"><h1 className="truncate text-2xl font-black">Столи</h1><p className="text-xs text-white/45">Швидкий статус для гостя без бронювання</p></div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => void load()} disabled={loading} className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-200/35 bg-amber-300/10 text-amber-100 disabled:opacity-40"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button>
              <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[.04] text-white/75"><X size={19} /></button>
            </div>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {locationGroups.map((location) => (
              <button key={location.key} type="button" onClick={() => scrollToLocation(location.key)} className="shrink-0 rounded-2xl border border-white/10 bg-white/[.035] px-3 py-2 text-xs font-black text-white/60">
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

        <div className="mt-4 space-y-4">
          {locationGroups.map((location) => (
            <section id={`waiter-location-${location.key}`} key={location.key} className="scroll-mt-40 rounded-[28px] border border-white/12 bg-black/50 p-4 shadow-[0_0_30px_rgba(255,255,255,.03)] backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-200/35 bg-amber-300/10 text-amber-100"><MapPinned size={19} /></span><div><h2 className="text-xl font-black">{location.label}</h2><p className="text-xs text-white/40">Столи {location.range}</p></div></div>
                <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/55">{location.tables.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{location.tables.map(renderTable)}</div>
              {!location.tables.length && <p className="rounded-2xl border border-dashed border-white/15 p-5 text-center text-sm text-white/40">У цій локації столи не знайдено.</p>}
            </section>
          ))}

          {unassignedTables.length > 0 && (
            <section className="rounded-[28px] border border-white/12 bg-black/50 p-4">
              <div className="mb-4"><h2 className="text-xl font-black">Без визначеної локації</h2><p className="text-xs text-white/40">Потрібно перевірити номер або локацію столу</p></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{unassignedTables.map(renderTable)}</div>
            </section>
          )}
        </div>

        <button type="button" onClick={onClose} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[.03] p-4 font-black text-white/60"><ArrowLeft size={18} />Назад у пульт</button>
      </main>

      {selectedTable && (
        <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:px-5">
          <section className="mx-auto max-w-4xl rounded-[28px] border border-amber-200/25 bg-black/95 p-4 shadow-[0_0_36px_rgba(250,204,21,.12)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-2xl font-black">Стіл №{selectedTable.tableNumber}</p><p className="mt-1 text-sm text-white/50">{selectedTable.zone?.name || 'Без локації'} · {selectedTable.seats} місць</p></div>
              <button type="button" onClick={() => setSelectedTableId(null)} className="rounded-xl border border-white/10 bg-white/[.04] p-2 text-white/60"><X size={17} /></button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" disabled={Boolean(busy)} onClick={() => void setStatus(selectedTable, 'occupied')} className="rounded-2xl border border-red-400/65 bg-transparent p-3 font-black text-red-100 shadow-[0_0_14px_rgba(255,59,79,.14)] disabled:opacity-40">Зайнятий</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void setStatus(selectedTable, 'free')} className="rounded-2xl border border-white/45 bg-transparent p-3 font-black text-white/85 disabled:opacity-40">Вільний</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
