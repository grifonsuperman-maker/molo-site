import { useMemo, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';

import type { Booking, FullMapResponse, TableItem, TableStatus, Zone } from '../api/types';
import {
  ACTIVE_STATUSES,
  formatDate,
  formatTime,
  NeonButton,
  STATUS_LABEL,
  TABLE_STATUS_COLOR,
  TABLE_STATUS_LABEL,
} from './adminNeonShared';
import type { BookingAction, TableAction } from './adminNeonShared';

type LocationKey =
  | 'hall'
  | 'canopy'
  | 'gazebo'
  | 'rotang'
  | 'embankment'
  | 'glass_gazebo'
  | 'water_gazebo';

type LocationConfig = {
  key: LocationKey;
  label: string;
  description: string;
  background: string;
  width: number;
  height: number;
  min: number;
  max: number;
  aliases: string[];
};

const LOCATIONS: LocationConfig[] = [
  { key: 'hall', label: 'Зал ресторану', description: 'Столи 1–14', background: '/maps/hall-bg-numbered.png', width: 1536, height: 1152, min: 1, max: 14, aliases: ['зал ресторану', 'зал', 'hall'] },
  { key: 'canopy', label: 'Навіс', description: 'Столи 15–20', background: '/maps/canopy-day-numbered.png', width: 1229, height: 1536, min: 15, max: 20, aliases: ['навіс', 'навес', 'canopy'] },
  { key: 'gazebo', label: 'Велика альтанка', description: 'Столи 21–36', background: '/maps/gazebo-day-numbered.png', width: 1229, height: 1536, min: 21, max: 36, aliases: ['велика альтанка', 'велика бесідка', 'gazebo'] },
  { key: 'rotang', label: 'Ротанг', description: 'Столи 37–39', background: '/maps/rotang-day-numbered.png', width: 1536, height: 975, min: 37, max: 39, aliases: ['ротанг', 'rotang'] },
  { key: 'embankment', label: 'Набережна', description: 'Столи 40–44', background: '/maps/embankment-day-numbered.png', width: 1536, height: 864, min: 40, max: 44, aliases: ['набережна', 'набережная', 'embankment'] },
  { key: 'glass_gazebo', label: 'Скляна альтанка', description: 'Столи 45–50', background: '/maps/glass-gazebo-day-numbered.png', width: 1536, height: 1143, min: 45, max: 50, aliases: ['скляна альтанка', 'стеклянная беседка', 'glass gazebo'] },
  { key: 'water_gazebo', label: 'Альтанка на воді', description: 'Столи 100–109', background: '/maps/water-gazebo-day-numbered.png', width: 1158, height: 1536, min: 100, max: 109, aliases: ['альтанка на воді', 'беседка на воде', 'water gazebo'] },
];

function normalize(value: string | null | undefined) {
  return String(value || '').toLowerCase().replace(/[’'`]/g, '').replace(/\s+/g, ' ').trim();
}

function tableNumber(table: TableItem) {
  return Number(table.tableNumber || 0);
}

function locationTables(config: LocationConfig, tables: TableItem[]) {
  return tables.filter((table) => {
    const number = tableNumber(table);
    return number >= config.min && number <= config.max;
  });
}

function locationZone(config: LocationConfig, map: FullMapResponse): Zone | null {
  const byName = map.zones.find((zone) => {
    const name = normalize(zone.name);
    return config.aliases.some((alias) => name.includes(normalize(alias)));
  });
  if (byName) return byName;

  return locationTables(config, map.tables).find((table) => table.zone)?.zone || null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function uniqueCoordinateCount(tables: TableItem[]) {
  return new Set(tables.map((table) => `${Number(table.x).toFixed(2)}:${Number(table.y).toFixed(2)}`)).size;
}

function fallbackPosition(index: number, count: number) {
  const columns = count <= 4 ? 2 : count <= 10 ? 3 : 4;
  const rows = Math.ceil(count / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    left: `${12 + (column * 76) / Math.max(1, columns - 1)}%`,
    top: `${14 + (row * 72) / Math.max(1, rows - 1)}%`,
    width: `${clamp(62 / columns, 9, 24)}%`,
    height: `${clamp(50 / rows, 5, 16)}%`,
    transform: 'translate(-50%, -50%)',
  };
}

function tablePosition(
  table: TableItem,
  index: number,
  tables: TableItem[],
  config: LocationConfig,
  zone: Zone | null,
): CSSProperties {
  const hasUsableCoordinates = uniqueCoordinateCount(tables) >= Math.max(2, Math.ceil(tables.length / 2));
  if (!hasUsableCoordinates) return fallbackPosition(index, tables.length);

  const x = Number(table.x || 0);
  const y = Number(table.y || 0);
  const width = Math.max(24, Number(table.width || 70));
  const height = Math.max(20, Number(table.height || 55));

  let sourceWidth = config.width;
  let sourceHeight = config.height;
  let localX = x;
  let localY = y;

  if (zone && Number(zone.width) > 0 && Number(zone.height) > 0) {
    const insideGlobalZone =
      x >= Number(zone.x) &&
      y >= Number(zone.y) &&
      x <= Number(zone.x) + Number(zone.width) &&
      y <= Number(zone.y) + Number(zone.height);

    sourceWidth = Number(zone.width);
    sourceHeight = Number(zone.height);
    localX = insideGlobalZone ? x - Number(zone.x) : x;
    localY = insideGlobalZone ? y - Number(zone.y) : y;
  }

  const left = clamp((localX / sourceWidth) * 100, 1, 96);
  const top = clamp((localY / sourceHeight) * 100, 1, 96);
  const itemWidth = clamp((width / sourceWidth) * 100, 4, 22);
  const itemHeight = clamp((height / sourceHeight) * 100, 3, 18);

  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${itemWidth}%`,
    height: `${itemHeight}%`,
    transform: `translate(-50%, -50%) rotate(${Number(table.rotation || 0)}deg)`,
  };
}

function bookingStatus(booking: Booking) {
  return STATUS_LABEL[booking.status] || booking.status;
}

function currentBookingActions(booking: Booking, isToday: boolean, tableStatus: TableStatus) {
  const actions: Array<{ action: BookingAction; label: string; tone: 'green' | 'red' | 'blue' | 'cyan' }> = [];

  if (booking.status === 'pending') {
    actions.push({ action: 'approve', label: 'Підтвердити', tone: 'green' });
    actions.push({ action: 'reject', label: 'Відхилити', tone: 'red' });
  }

  if (booking.status === 'approved' && isToday && !booking.checkedInAt) {
    actions.push({ action: 'checkIn', label: 'Гість прийшов', tone: 'blue' });
    actions.push({ action: 'noShow', label: 'Не прийшов', tone: 'red' });
  }

  if (booking.status === 'approved' && isToday && booking.checkedInAt && tableStatus !== 'cleaning') {
    actions.push({ action: 'cleaning', label: 'Стіл готується', tone: 'cyan' });
  }

  if (booking.status === 'approved' && isToday && booking.checkedInAt) {
    actions.push({ action: 'complete', label: 'Стіл вільний', tone: 'green' });
  }

  if (ACTIVE_STATUSES.has(booking.status)) {
    actions.push({ action: 'cancel', label: 'Скасувати бронь', tone: 'red' });
  }

  return actions;
}

export default function AdminRestaurantMap({
  map,
  bookings,
  selectedDate,
  today,
  busy,
  onTableAction,
  onBookingAction,
  onCreateBooking,
  onChangeBookingTable,
}: {
  map: FullMapResponse | null;
  bookings: Booking[];
  selectedDate: string;
  today: string;
  busy: string | null;
  onTableAction: (table: TableItem, action: TableAction) => void;
  onBookingAction: (booking: Booking, action: BookingAction) => void;
  onCreateBooking: (tableId: string) => void;
  onChangeBookingTable: (booking: Booking, tableId: string) => void;
}) {
  const [locationKey, setLocationKey] = useState<LocationKey | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});

  const visibleTables = useMemo(
    () => [...(map?.tables || [])].filter((table) => table.isVisible !== false).sort((a, b) => tableNumber(a) - tableNumber(b)),
    [map],
  );
  const location = LOCATIONS.find((item) => item.key === locationKey) || null;
  const tables = location ? locationTables(location, visibleTables) : [];
  const zone = location && map ? locationZone(location, map) : null;
  const selectedTable = tables.find((table) => table.id === selectedTableId) || null;
  const selectedBookings = selectedTable
    ? bookings.filter((booking) => booking.table?.id === selectedTable.id)
    : [];
  const isToday = selectedDate === today;

  if (!map) {
    return <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/40">План ресторану завантажується.</div>;
  }

  if (!location) {
    return (
      <section className="mt-3 space-y-3">
        <div className="rounded-[24px] border border-amber-200/20 bg-neutral-950 p-4 shadow-[0_0_34px_rgba(251,191,36,.06)]">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-100/55">Інтерактивна карта</p>
          <h2 className="mt-1 text-2xl font-black">Оберіть локацію</h2>
          <p className="mt-1 text-sm text-white/45">Після вибору відкриється фотографія плану. Натисніть безпосередньо на стіл для керування.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {LOCATIONS.map((item) => {
            const itemTables = locationTables(item, visibleTables);
            const active = itemTables.filter((table) => table.status !== 'free').length;
            const bookingCount = bookings.filter((booking) => {
              const number = Number(booking.table?.tableNumber || 0);
              return number >= item.min && number <= item.max;
            }).length;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => { setLocationKey(item.key); setSelectedTableId(null); }}
                className="group overflow-hidden rounded-[24px] border border-white/10 bg-neutral-950 text-left transition active:scale-[0.98]"
              >
                <div className="aspect-[16/8] overflow-hidden bg-black">
                  <img src={item.background} alt={item.label} className="h-full w-full object-cover opacity-70 transition group-hover:opacity-90" />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><h3 className="text-lg font-black">{item.label}</h3><p className="mt-1 text-xs text-white/40">{item.description}</p></div>
                    <span className="rounded-2xl border border-amber-200/25 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-100">Відкрити</span>
                  </div>
                  <p className="mt-3 text-xs text-white/50">{itemTables.length} столів · {active} активних статусів · {bookingCount} броней на {formatDate(selectedDate)}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-[24px] border border-white/10 bg-neutral-950 p-3">
        <button type="button" onClick={() => { setLocationKey(null); setSelectedTableId(null); }} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-black text-white/70">← Локації</button>
        <div className="min-w-0 text-right"><h2 className="truncate text-xl font-black">{location.label}</h2><p className="mt-1 text-xs text-white/40">Броні на {formatDate(selectedDate)}</p></div>
      </div>

      <div className="rounded-[24px] border border-amber-200/20 bg-neutral-950 p-2 shadow-[0_0_36px_rgba(251,191,36,.06)]">
        <div className="relative mx-auto overflow-hidden rounded-[20px] bg-black" style={{ aspectRatio: `${location.width} / ${location.height}` }}>
          <img src={location.background} alt={location.label} className="absolute inset-0 h-full w-full object-contain" />
          {tables.map((table, index) => {
            const selected = selectedTableId === table.id;
            const color = TABLE_STATUS_COLOR[table.status];
            const free = table.status === 'free';
            const style: CSSProperties = {
              ...tablePosition(table, index, tables, location, zone),
              borderColor: selected ? '#fde68a' : free ? 'transparent' : color,
              backgroundColor: selected ? 'rgba(251,191,36,.16)' : free ? 'transparent' : `${color}22`,
              boxShadow: selected ? '0 0 22px rgba(251,191,36,.55)' : free ? 'none' : `0 0 18px ${color}66`,
            };

            return (
              <button
                key={table.id}
                type="button"
                aria-label={`Стіл №${table.tableNumber}, ${TABLE_STATUS_LABEL[table.status]}`}
                title={`Стіл №${table.tableNumber} · ${TABLE_STATUS_LABEL[table.status]}`}
                onClick={() => setSelectedTableId(table.id)}
                className="absolute rounded-xl border-2 transition active:scale-95"
                style={style}
              >
                <span className="sr-only">Стіл №{table.tableNumber}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap gap-2 px-1 pb-1 text-[10px] text-white/45">
          {(Object.keys(TABLE_STATUS_LABEL) as TableStatus[]).map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2 py-1">
              <span className="h-2 w-2 rounded-full border border-white/10" style={{ background: status === 'free' ? 'transparent' : TABLE_STATUS_COLOR[status] }} />
              {TABLE_STATUS_LABEL[status]}
            </span>
          ))}
        </div>
      </div>

      {!selectedTable && (
        <div className="rounded-[22px] border border-dashed border-amber-200/20 bg-amber-300/[0.03] p-5 text-center text-sm text-amber-100/65">Натисніть на потрібний стіл на фотографії.</div>
      )}

      {selectedTable && (
        <div className="rounded-[26px] border border-amber-200/25 bg-neutral-950 p-4 shadow-[0_0_42px_rgba(251,191,36,.08)]">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-100/50">Обраний стіл</p><h3 className="mt-1 text-3xl font-black">№{selectedTable.tableNumber}</h3><p className="mt-1 text-sm text-white/45">До {selectedTable.seats} гостей · {location.label}</p></div>
            <span className={`rounded-full border border-white/10 bg-black/35 px-3 py-2 text-xs font-black ${selectedTable.status === 'free' ? 'text-white/45' : ''}`} style={selectedTable.status === 'free' ? undefined : { color: TABLE_STATUS_COLOR[selectedTable.status] }}>{TABLE_STATUS_LABEL[selectedTable.status]}</span>
          </div>

          <div className="mt-4 rounded-[20px] border border-cyan-200/15 bg-cyan-300/[0.03] p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/50">Фізичний статус зараз</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <NeonButton compact tone="neutral" busy={busy === `table:${selectedTable.id}:free`} disabled={Boolean(busy)} onClick={() => onTableAction(selectedTable, 'free')}>Вільний</NeonButton>
              <NeonButton compact tone="red" busy={busy === `table:${selectedTable.id}:occupied`} disabled={Boolean(busy)} onClick={() => onTableAction(selectedTable, 'occupied')}>Зайнятий</NeonButton>
              <NeonButton compact tone="cyan" busy={busy === `table:${selectedTable.id}:cleaning`} disabled={Boolean(busy)} onClick={() => onTableAction(selectedTable, 'cleaning')}>Готується</NeonButton>
              {selectedTable.status === 'closed'
                ? <NeonButton compact tone="green" busy={busy === `table:${selectedTable.id}:open`} disabled={Boolean(busy)} onClick={() => onTableAction(selectedTable, 'open')}>Відкрити</NeonButton>
                : <NeonButton compact tone="red" busy={busy === `table:${selectedTable.id}:close`} disabled={Boolean(busy)} onClick={() => onTableAction(selectedTable, 'close')}>Закрити</NeonButton>}
              <NeonButton compact tone="amber" disabled={Boolean(busy)} onClick={() => onCreateBooking(selectedTable.id)}>＋ Бронь на стіл</NeonButton>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3"><h4 className="text-lg font-black">Бронювання столу</h4><span className="rounded-xl border border-violet-300/20 bg-violet-400/5 px-3 py-1 text-xs text-violet-100">{formatDate(selectedDate)}</span></div>
            {selectedBookings.length === 0 && <div className="mt-2 rounded-2xl border border-dashed border-white/10 p-4 text-center text-sm text-white/40">На цю дату броней немає.</div>}

            <div className="mt-2 space-y-2">
              {selectedBookings.map((booking) => {
                const target = moveTargets[booking.id] || '';
                const alternatives = visibleTables.filter((table) =>
                  table.id !== selectedTable.id &&
                  table.isVisible !== false &&
                  table.status !== 'closed' &&
                  table.zone?.isClosed !== true &&
                  Number(table.seats) >= Number(booking.guestsCount) &&
                  (!isToday || !['occupied', 'cleaning'].includes(table.status)),
                );

                return (
                  <div key={booking.id} className="rounded-[20px] border border-white/10 bg-black/35 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate font-black">{booking.client?.fullName || 'Гість без імені'}</p><p className="mt-1 text-xs text-white/45">{formatTime(booking.bookingTime)} · {booking.guestsCount} гостей</p></div>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold text-white/65">{bookingStatus(booking)}</span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {currentBookingActions(booking, isToday, selectedTable.status).map((item) => (
                        <NeonButton key={item.action} compact tone={item.tone} busy={busy === `${booking.id}:${item.action}`} disabled={Boolean(busy)} onClick={() => onBookingAction(booking, item.action)}>{item.label}</NeonButton>
                      ))}
                    </div>

                    {ACTIVE_STATUSES.has(booking.status) && (
                      <div className="mt-3 rounded-2xl border border-violet-300/20 bg-violet-400/[0.04] p-3">
                        <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-100/55">Перенести бронь на інший стіл</label>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                          <select value={target} onChange={(event: ChangeEvent<HTMLSelectElement>) => setMoveTargets((current) => ({ ...current, [booking.id]: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-neutral-950 px-3 py-3 text-sm outline-none">
                            <option value="">Оберіть новий стіл</option>
                            {alternatives.map((table) => <option key={table.id} value={table.id}>№{table.tableNumber} · {table.zone?.name || 'Локація'} · до {table.seats} гостей</option>)}
                          </select>
                          <NeonButton compact tone="violet" busy={busy === `${booking.id}:change-table`} disabled={!target || Boolean(busy)} onClick={() => onChangeBookingTable(booking, target)}>Змінити стіл</NeonButton>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
