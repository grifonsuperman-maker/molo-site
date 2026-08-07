import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  MapPinned,
  RefreshCw,
  ShieldAlert,
  Table2,
  Trash2,
  X,
} from 'lucide-react';

import { availabilityBlocksApi, type AvailabilityBlock } from '../api/availabilityBlocks';
import { bookingsApi, type TableRuntimeStatus } from '../api/bookings';
import { mapApi } from '../api/map';
import { tablesApi } from '../api/tables';
import type { Booking, FullMapResponse, TableItem, Zone } from '../api/types';

type Point = [number, number];
type PolygonShape = { kind: 'polygon'; points: Point[]; expand?: number };
type EllipseShape = { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; expand?: number };
type EllipsePathShape = { kind: 'ellipsePath'; cx: number; cy: number; rx: number; ry: number; rotation?: number; expand?: number };
type VisualShape = PolygonShape | EllipseShape | EllipsePathShape;
type VisualTable = { number: number; seats: number; shape: VisualShape };
type LocationMap = {
  key: string;
  label: string;
  description: string;
  background: string;
  width: number;
  height: number;
  tables: VisualTable[];
};
type Target = { type: 'table'; id: string } | { type: 'zone'; id: string } | null;

const ACTIVE_STATUSES = new Set(['pending', 'approved']);
const CLEANUP_MINUTES = 15;
const LOCATION_ZONE_ALIASES: Record<string, string[]> = {
  hall: ['зал ресторану', 'зал', 'hall'],
  canopy: ['навіс', 'навес', 'canopy'],
  gazebo: ['велика альтанка', 'велика бесідка', 'большая беседка', 'gazebo'],
  rotang: ['ротанг', 'rotang'],
  embankment: ['набережна', 'набережная', 'embankment'],
  glass_gazebo: ['скляна альтанка', 'стеклянная беседка', 'glass gazebo'],
  water_gazebo: ['альтанка на воді', 'беседка на воде', 'water gazebo'],
};

const LOCATIONS: LocationMap[] = [
  {
    key: 'hall', label: 'Зал ресторану', description: 'Зал 1–14',
    background: '/maps/hall-bg-numbered.png', width: 1536, height: 1152,
    tables: [
      { number: 1, seats: 4, shape: { kind: 'polygon', points: [[234, 730], [363, 752], [331, 814], [200, 790]] } },
      { number: 2, seats: 4, shape: { kind: 'polygon', points: [[354, 550], [466, 564], [442, 613], [326, 598]] } },
      { number: 3, seats: 4, shape: { kind: 'polygon', points: [[461, 350], [559, 358], [538, 399], [438, 390]] } },
      { number: 4, seats: 4, shape: { kind: 'polygon', points: [[544, 223], [642, 228], [625, 263], [527, 256]] } },
      { number: 5, seats: 6, shape: { kind: 'ellipse', cx: 617, cy: 666, rx: 63, ry: 50 } },
      { number: 6, seats: 6, shape: { kind: 'ellipse', cx: 689.5, cy: 455, rx: 56.5, ry: 40 } },
      { number: 7, seats: 6, shape: { kind: 'ellipse', cx: 784, cy: 311, rx: 53, ry: 37 } },
      { number: 8, seats: 6, shape: { kind: 'ellipse', cx: 802, cy: 825.5, rx: 75, ry: 61.5 } },
      { number: 9, seats: 6, shape: { kind: 'ellipse', cx: 866, cy: 564, rx: 65, ry: 45 } },
      { number: 10, seats: 6, shape: { kind: 'ellipse', cx: 943.5, cy: 390.5, rx: 57.5, ry: 38.5 } },
      { number: 11, seats: 4, shape: { kind: 'polygon', points: [[1142, 409], [1223, 411], [1225, 453], [1142, 450]] } },
      { number: 12, seats: 4, shape: { kind: 'polygon', points: [[1140, 344], [1220, 344], [1220, 390], [1140, 384]] } },
      { number: 13, seats: 4, shape: { kind: 'polygon', points: [[1138, 285], [1215, 285], [1215, 326], [1137, 322]] } },
      { number: 14, seats: 4, shape: { kind: 'polygon', points: [[1134, 230], [1211, 230], [1211, 267], [1134, 263]] } },
    ],
  },
  {
    key: 'canopy', label: 'Навіс', description: 'Зона навісу 15–20',
    background: '/maps/canopy-day-numbered.png', width: 1229, height: 1536,
    tables: [
      { number: 15, seats: 4, shape: { kind: 'polygon', points: [[915, 976], [1105, 1000], [1133, 1091], [908, 1056]], expand: 9 } },
      { number: 16, seats: 4, shape: { kind: 'polygon', points: [[919, 877], [1063, 890], [1079, 937], [916, 918]], expand: 9 } },
      { number: 17, seats: 4, shape: { kind: 'polygon', points: [[925, 816], [1038, 823], [1049, 854], [924, 843]], expand: 9 } },
      { number: 18, seats: 4, shape: { kind: 'polygon', points: [[485, 913], [637, 940], [590, 1002], [417, 975]], expand: 9 } },
      { number: 19, seats: 4, shape: { kind: 'polygon', points: [[573, 843], [688, 858], [661, 891], [535, 876]], expand: 9 } },
      { number: 20, seats: 4, shape: { kind: 'polygon', points: [[627, 796], [729, 805], [708, 829], [602, 819]], expand: 9 } },
    ],
  },
  {
    key: 'gazebo', label: 'Велика альтанка', description: 'Велика альтанка 21–36',
    background: '/maps/gazebo-day-numbered.png', width: 1229, height: 1536,
    tables: [
      { number: 28, seats: 4, shape: { kind: 'polygon', points: [[471, 486], [538, 485], [536, 527], [465, 527]], expand: 9 } },
      { number: 27, seats: 4, shape: { kind: 'polygon', points: [[456, 585], [529, 585], [525, 637], [448, 637]], expand: 9 } },
      { number: 26, seats: 4, shape: { kind: 'polygon', points: [[443, 701], [518, 702], [512, 762], [434, 762]], expand: 9 } },
      { number: 25, seats: 4, shape: { kind: 'polygon', points: [[429, 835], [506, 835], [499, 900], [419, 900]], expand: 9 } },
      { number: 24, seats: 4, shape: { kind: 'polygon', points: [[417, 916], [498, 917], [492, 987], [406, 987]], expand: 9 } },
      { number: 23, seats: 4, shape: { kind: 'polygon', points: [[397, 1056], [483, 1056], [483, 1151], [388, 1150]], expand: 3 } },
      { number: 22, seats: 4, shape: { kind: 'polygon', points: [[375, 1213], [468, 1213], [457, 1331], [357, 1331]], expand: 0 } },
      { number: 21, seats: 4, shape: { kind: 'polygon', points: [[357, 1331], [457, 1331], [448, 1444], [340, 1443]], expand: 0 } },
      { number: 36, seats: 4, shape: { kind: 'polygon', points: [[731, 484], [796, 484], [801, 527], [734, 527]], expand: 9 } },
      { number: 35, seats: 4, shape: { kind: 'polygon', points: [[738, 585], [808, 585], [814, 636], [740, 636]], expand: 9 } },
      { number: 34, seats: 4, shape: { kind: 'polygon', points: [[746, 702], [818, 702], [823, 762], [749, 762]], expand: 9 } },
      { number: 33, seats: 4, shape: { kind: 'polygon', points: [[749, 780], [826, 780], [833, 843], [753, 843]], expand: 9 } },
      { number: 32, seats: 4, shape: { kind: 'polygon', points: [[757, 910], [836, 910], [845, 985], [762, 985]], expand: 9 } },
      { number: 31, seats: 4, shape: { kind: 'polygon', points: [[762, 1063], [848, 1063], [859, 1149], [766, 1149]], expand: 9 } },
      { number: 30, seats: 4, shape: { kind: 'polygon', points: [[768, 1168], [861, 1168], [871, 1262], [772, 1261]], expand: 9 } },
      { number: 29, seats: 4, shape: { kind: 'polygon', points: [[773, 1344], [872, 1345], [884, 1451], [779, 1450]], expand: 9 } },
    ],
  },
  {
    key: 'rotang', label: 'Ротанг', description: 'Ротанг 37–39',
    background: '/maps/rotang-day-numbered.png', width: 1536, height: 975,
    tables: [
      { number: 37, seats: 4, shape: { kind: 'ellipsePath', cx: 273, cy: 778, rx: 90, ry: 55, rotation: -7 } },
      { number: 38, seats: 4, shape: { kind: 'ellipsePath', cx: 1194, cy: 628, rx: 72, ry: 39, rotation: 0 } },
      { number: 39, seats: 4, shape: { kind: 'ellipsePath', cx: 1458, cy: 561, rx: 43, ry: 19, rotation: 4 } },
    ],
  },
  {
    key: 'embankment', label: 'Набережна', description: 'Набережна 40–44',
    background: '/maps/embankment-day-numbered.png', width: 1536, height: 864,
    tables: [
      { number: 40, seats: 4, shape: { kind: 'polygon', points: [[153, 543], [217, 506], [302, 508], [246, 548]], expand: 7 } },
      { number: 41, seats: 4, shape: { kind: 'polygon', points: [[474, 552], [511, 518], [593, 515], [566, 553]], expand: 7 } },
      { number: 42, seats: 4, shape: { kind: 'polygon', points: [[776, 557], [781, 517], [862, 518], [867, 558]], expand: 7 } },
      { number: 43, seats: 4, shape: { kind: 'polygon', points: [[1063, 559], [1039, 520], [1118, 520], [1151, 559]], expand: 7 } },
      { number: 44, seats: 4, shape: { kind: 'polygon', points: [[1318, 562], [1267, 522], [1348, 522], [1402, 562]], expand: 7 } },
    ],
  },
  {
    key: 'glass_gazebo', label: 'Скляна альтанка', description: 'Скляна альтанка 45–50',
    background: '/maps/glass-gazebo-day-numbered.png', width: 1536, height: 1143,
    tables: [
      { number: 45, seats: 4, shape: { kind: 'polygon', points: [[856, 300], [989, 300], [1000, 330], [858, 330]], expand: 7 } },
      { number: 46, seats: 4, shape: { kind: 'polygon', points: [[860, 396], [1030, 396], [1042, 436], [863, 436]], expand: 7 } },
      { number: 47, seats: 4, shape: { kind: 'polygon', points: [[872, 529], [1075, 528], [1095, 591], [880, 591]], expand: 7 } },
      { number: 48, seats: 4, shape: { kind: 'polygon', points: [[895, 742], [1152, 742], [1186, 855], [905, 854]], expand: 8 } },
      { number: 49, seats: 4, shape: { kind: 'polygon', points: [[535, 302], [668, 300], [665, 330], [525, 331]], expand: 7 } },
      { number: 50, seats: 4, shape: { kind: 'polygon', points: [[391, 746], [642, 746], [631, 855], [351, 855]], expand: 8 } },
    ],
  },
  {
    key: 'water_gazebo', label: 'Альтанка на воді', description: 'Альтанка на воді 100–109',
    background: '/maps/water-gazebo-day-numbered.png', width: 1158, height: 1536,
    tables: [
      { number: 100, seats: 4, shape: { kind: 'polygon', points: [[225, 984], [343, 1024], [293, 1079], [172, 1033]], expand: 7 } },
      { number: 101, seats: 4, shape: { kind: 'polygon', points: [[352, 840], [464, 876], [426, 920], [311, 882]], expand: 7 } },
      { number: 102, seats: 4, shape: { kind: 'polygon', points: [[470, 710], [575, 741], [542, 777], [437, 746]], expand: 7 } },
      { number: 103, seats: 4, shape: { kind: 'polygon', points: [[645, 517], [700, 528], [681, 556], [627, 543]], expand: 5 } },
      { number: 104, seats: 4, shape: { kind: 'polygon', points: [[761, 545], [814, 556], [796, 582], [742, 570]], expand: 5 } },
      { number: 105, seats: 4, shape: { kind: 'polygon', points: [[886, 573], [940, 584], [926, 612], [872, 599]], expand: 5 } },
      { number: 106, seats: 4, shape: { kind: 'polygon', points: [[1008, 601], [1060, 613], [1048, 643], [992, 629]], expand: 5 } },
      { number: 107, seats: 4, shape: { kind: 'polygon', points: [[838, 826], [920, 847], [892, 883], [811, 860]], expand: 3 } },
      { number: 108, seats: 4, shape: { kind: 'polygon', points: [[738, 968], [815, 993], [795, 1038], [709, 1016]], expand: 4 } },
      { number: 109, seats: 4, shape: { kind: 'polygon', points: [[616, 1158], [723, 1194], [697, 1244], [586, 1200]], expand: 0 } },
    ],
  },
];

function kyivToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
}
function normalize(value: string | null | undefined) {
  return String(value || '').toLowerCase().replace(/[’'`]/g, '').replace(/\s+/g, ' ').trim();
}
function findZone(zones: Zone[], key: string) {
  const aliases = LOCATION_ZONE_ALIASES[key] || [];
  return zones.find((zone) => aliases.some((alias) => normalize(zone.name).includes(normalize(alias)))) || null;
}
function timeToMinutes(value: string | null | undefined) {
  const [hours = '0', minutes = '0'] = String(value || '').split(':');
  return Number(hours) * 60 + Number(minutes);
}
function bookingDuration(booking: Booking) {
  const stored = Number(booking.durationMinutes || 0);
  return Number.isFinite(stored) && stored >= 30 ? stored : 120;
}
function round(value: number) { return Math.round(value * 10) / 10; }
function expandPolygon(points: Point[], amount = 0): Point[] {
  if (!amount) return points;
  const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  return points.map(([x, y]) => {
    const dx = x - cx; const dy = y - cy; const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const scale = (distance + amount) / distance;
    return [cx + dx * scale, cy + dy * scale];
  });
}
function points(pointsValue: Point[]) { return pointsValue.map(([x, y]) => `${round(x)},${round(y)}`).join(' '); }
function ellipsePath(shape: EllipsePathShape) {
  const rotation = ((shape.rotation || 0) * Math.PI) / 180;
  const rx = shape.rx + (shape.expand || 0); const ry = shape.ry + (shape.expand || 0);
  const result: Point[] = [];
  for (let index = 0; index < 72; index += 1) {
    const angle = (Math.PI * 2 * index) / 72;
    const x = rx * Math.cos(angle); const y = ry * Math.sin(angle);
    result.push([shape.cx + x * Math.cos(rotation) - y * Math.sin(rotation), shape.cy + x * Math.sin(rotation) + y * Math.cos(rotation)]);
  }
  return `M ${points([result[0]])} L ${points(result.slice(1))} Z`;
}
function shapeData(shape: VisualShape) {
  if (shape.kind === 'polygon') return { tag: 'polygon' as const, points: points(expandPolygon(shape.points, shape.expand || 0)) };
  if (shape.kind === 'ellipse') return { tag: 'ellipse' as const, cx: shape.cx, cy: shape.cy, rx: shape.rx + (shape.expand || 0), ry: shape.ry + (shape.expand || 0) };
  return { tag: 'path' as const, d: ellipsePath(shape) };
}
function Shape({ shape, color, active, onClick, label }: { shape: VisualShape; color: string; active: boolean; onClick: () => void; label: string }) {
  const data = shapeData(shape);
  const common = { fill: 'transparent', stroke: color, strokeWidth: active ? 9 : 6, style: { filter: `drop-shadow(0 0 7px ${color}) drop-shadow(0 0 17px ${color})` } };
  const hit = { fill: '#fff', fillOpacity: 0, stroke: 'none', cursor: 'pointer', pointerEvents: 'all' as const, onClick, role: 'button', tabIndex: 0, 'aria-label': label };
  if (data.tag === 'polygon') return <><polygon points={data.points} {...common} /><polygon points={data.points} {...hit} /></>;
  if (data.tag === 'ellipse') return <><ellipse cx={data.cx} cy={data.cy} rx={data.rx} ry={data.ry} {...common} /><ellipse cx={data.cx} cy={data.cy} rx={data.rx} ry={data.ry} {...hit} /></>;
  return <><path d={data.d} {...common} /><path d={data.d} {...hit} /></>;
}

export default function AdminVisualTablePlanner({
  onClose,
  mode = 'admin',
  initialLocationKey = 'hall',
}: {
  onClose: () => void;
  mode?: 'admin' | 'director';
  initialLocationKey?: string;
}) {
  const today = useMemo(kyivToday, []);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('18:00');
  const [locationKey, setLocationKey] = useState(() =>
    LOCATIONS.some((item) => item.key === initialLocationKey)
      ? initialLocationKey
      : 'hall',
  );
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [statuses, setStatuses] = useState<Record<string, TableRuntimeStatus>>({});
  const [target, setTarget] = useState<Target>(null);
  const [fullDay, setFullDay] = useState(true);
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('23:00');
  const [reason, setReason] = useState('');
  const [transferBookingId, setTransferBookingId] = useState<string | null>(null);
  const [transferTableId, setTransferTableId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const location = LOCATIONS.find((item) => item.key === locationKey) || LOCATIONS[0];
  const zone = useMemo(() => findZone(map?.zones || [], locationKey), [map, locationKey]);
  const canManage = mode === 'director' || map?.restaurant.adminCanManageZones !== false;
  const activeBookings = useMemo(() => bookings.filter((booking) => ACTIVE_STATUSES.has(booking.status)), [bookings]);
  const selectedTable = target?.type === 'table' ? map?.tables.find((table) => table.id === target.id) || null : null;
  const selectedZone = target?.type === 'zone' ? map?.zones.find((item) => item.id === target.id) || null : selectedTable?.zone || null;
  const targetBookings = useMemo(() => activeBookings.filter((booking) => target?.type === 'table' ? booking.table?.id === target.id : target?.type === 'zone' ? booking.table?.zone?.id === target.id : false), [activeBookings, target]);
  const conflicts = useMemo(() => fullDay ? targetBookings : targetBookings.filter((booking) => {
    const start = timeToMinutes(booking.bookingTime); const end = start + bookingDuration(booking) + CLEANUP_MINUTES;
    return timeToMinutes(startTime) < end && timeToMinutes(endTime) > start;
  }), [targetBookings, fullDay, startTime, endTime]);
  const targetBlocks = useMemo(() => blocks.filter((block) => target?.type === 'table' ? block.table?.id === target.id : target?.type === 'zone' ? block.zone?.id === target.id : false), [blocks, target]);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError('');
    const [mapResult, bookingsResult, blocksResult, statusesResult] = await Promise.allSettled([
      mapApi.get(), bookingsApi.getByDate(date), availabilityBlocksApi.list(date), bookingsApi.tableStatuses({ bookingDate: date, bookingTime: time, durationMinutes: 120 }),
    ]);
    if (mapResult.status === 'fulfilled') setMap(mapResult.value);
    if (bookingsResult.status === 'fulfilled') setBookings(bookingsResult.value);
    if (blocksResult.status === 'fulfilled') setBlocks(blocksResult.value);
    if (statusesResult.status === 'fulfilled') setStatuses(statusesResult.value.statuses || {});
    const failed = [mapResult, bookingsResult, blocksResult, statusesResult].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) setError(failed.reason?.message || 'Не вдалося завантажити план');
    if (!silent) setLoading(false);
  }
  useEffect(() => { setTarget(null); void load(); }, [date, time]);

  function realTable(number: number) { return map?.tables.find((table) => Number(table.tableNumber) === number) || null; }
  function tableColor(number: number) {
    const table = realTable(number);
    if (target?.type === 'table' && target.id === table?.id) return '#facc15';
    const status = statuses[String(number)]?.status || table?.status || 'free';
    if (status === 'closed') return '#bdbdbd';
    if (status === 'occupied') return '#ff3b4f';
    if (status === 'cleaning') return '#67e8f9';
    if (status === 'reserved') return '#fb923c';
    if (status === 'pending') return '#38bdf8';
    return 'transparent';
  }
  function availableDestinations(booking: Booking) {
    const bookingStart = timeToMinutes(booking.bookingTime); const bookingEnd = bookingStart + bookingDuration(booking) + CLEANUP_MINUTES;
    return (map?.tables || []).filter((table) => {
      if (table.id === booking.table?.id || !table.isVisible || table.status === 'closed' || table.zone?.isClosed || table.zone?.isVisible === false || Number(table.seats) < Number(booking.guestsCount)) return false;
      const conflict = activeBookings.some((candidate) => {
        if (candidate.id === booking.id || candidate.table?.id !== table.id) return false;
        const start = timeToMinutes(candidate.bookingTime); const end = start + bookingDuration(candidate) + CLEANUP_MINUTES;
        return bookingStart < end && bookingEnd > start;
      });
      if (conflict) return false;
      return !blocks.some((block) => {
        if (block.table?.id !== table.id && block.zone?.id !== table.zone?.id) return false;
        if (!block.startTime || !block.endTime) return true;
        return timeToMinutes(block.startTime) < bookingEnd && timeToMinutes(block.endTime) > bookingStart;
      });
    }).sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber));
  }
  async function createBlock() {
    if (!target || !reason.trim() || conflicts.length) return;
    setBusy('create'); setError(''); setNotice('');
    try {
      await availabilityBlocksApi.create({ tableId: target.type === 'table' ? target.id : undefined, zoneId: target.type === 'zone' ? target.id : undefined, blockDate: date, startTime: fullDay ? undefined : startTime, endTime: fullDay ? undefined : endTime, reason: reason.trim() });
      setReason(''); setNotice('Недоступність заплановано'); await load(true);
    } catch (actionError: any) { setError(actionError?.message || 'Не вдалося зберегти'); } finally { setBusy(''); }
  }
  async function removeBlock(block: AvailabilityBlock) {
    setBusy(`remove:${block.id}`); setError('');
    try { await availabilityBlocksApi.remove(block.id); setNotice('Планування скасовано'); await load(true); }
    catch (actionError: any) { setError(actionError?.message || 'Не вдалося відкрити'); } finally { setBusy(''); }
  }
  async function cancelBooking(booking: Booking) {
    if (!window.confirm(`Скасувати бронювання ${booking.client?.fullName || ''}?`)) return;
    setBusy(`cancel:${booking.id}`);
    try { await bookingsApi.cancel(booking.id); setNotice('Бронювання скасовано'); await load(true); }
    catch (actionError: any) { setError(actionError?.message || 'Не вдалося скасувати'); } finally { setBusy(''); }
  }
  async function transferBooking(booking: Booking) {
    if (!transferTableId) return;
    setBusy(`transfer:${booking.id}`);
    try { await availabilityBlocksApi.transferBooking(booking.id, transferTableId, reason.trim() || 'Перенесення Адміністратором'); setNotice('Бронювання перенесено'); setTransferBookingId(null); setTransferTableId(''); await load(true); }
    catch (actionError: any) { setError(actionError?.message || 'Не вдалося перенести'); } finally { setBusy(''); }
  }
  async function setPhysicalStatus(status: 'free' | 'occupied' | 'cleaning' | 'closed') {
    if (!selectedTable || date !== today) return;
    if (mode === 'director' && status !== 'free' && status !== 'occupied') return;
    setBusy(`status:${status}`);
    try { if (mode === 'director') await tablesApi.waiterStatus(selectedTable.id, status === 'occupied' ? 'occupied' : 'free'); else await tablesApi.setStatus(selectedTable.id, status); setNotice(status === 'free' ? 'Стіл вільний' : status === 'occupied' ? 'Стіл зайнятий' : status === 'cleaning' ? 'Стіл готується' : 'Стіл закритий'); await load(true); }
    catch (actionError: any) { setError(actionError?.message || 'Не вдалося змінити статус'); } finally { setBusy(''); }
  }

  const selectedName = selectedTable ? `Стіл №${selectedTable.tableNumber}` : selectedZone ? `Локація «${selectedZone.name}»` : '';

  return (
    <div className={`fixed inset-0 z-[90] overflow-y-auto bg-[#050809] text-white ${mode === 'director' ? 'director-readonly-map' : ''}`}>
      {mode === 'director' && <style>{`.director-readonly-map [data-map-target] > :nth-child(n+3) { display: none; }`}</style>}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,.12),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,.10),transparent_38%)]" />
      <div className="relative mx-auto min-h-screen max-w-6xl px-3 pb-28 pt-3 sm:px-5">
        <header className="sticky top-0 z-30 rounded-[26px] border border-emerald-300/20 bg-black/80 p-3 shadow-[0_0_38px_rgba(16,185,129,.08)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-emerald-300/30 bg-emerald-400/10 text-emerald-100"><MapPinned size={21} /></span><div><p className="font-black">{mode === 'director' ? 'Карти локацій' : 'План столів і локацій'}</p><p className="text-xs text-white/45">{mode === 'director' ? 'Статус столу: зайнятий або вільний' : 'Натисніть на стіл прямо на фото'}</p></div></div>
            <div className="flex gap-2"><button type="button" onClick={() => void load()} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5"><RefreshCw size={18} className={loading ? 'animate-spin' : ''} /></button><button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/5"><X size={19} /></button></div>
          </div>
          {mode === 'admin' && <div className="mt-3 grid grid-cols-2 gap-2"><label className="rounded-2xl border border-white/10 bg-white/[.04] px-3 py-2 text-xs text-white/45">Дата<input type="date" min={today} value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-black text-white outline-none" /></label><label className="rounded-2xl border border-white/10 bg-white/[.04] px-3 py-2 text-xs text-white/45">Час<input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-black text-white outline-none" /></label></div>}
          {(error || notice) && <div className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100'}`}>{error || notice}</div>}
        </header>

        {!canManage && mode === 'admin' && <div className="mt-3 rounded-[24px] border border-amber-300/30 bg-amber-400/10 p-4 text-amber-100"><div className="flex gap-3"><ShieldAlert size={21} /><div><p className="font-black">Немає права на керування</p><p className="mt-1 text-sm opacity-70">Директор має увімкнути право керувати локаціями та столами.</p></div></div></div>}

        <section className="mt-3 rounded-[26px] border border-white/10 bg-black/55 p-3 backdrop-blur-xl">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {LOCATIONS.map((item) => <button key={item.key} type="button" onClick={() => { setLocationKey(item.key); setTarget(null); }} className={`rounded-2xl border px-3 py-3 text-left font-black transition active:scale-[.98] ${locationKey === item.key ? 'border-fuchsia-300/65 bg-fuchsia-400/15 text-fuchsia-100 shadow-[0_0_24px_rgba(217,70,239,.18)]' : 'border-white/10 bg-white/[.03] text-white/65'}`}>{item.label}</button>)}
          </div>
        </section>

        <section className="mt-3 rounded-[28px] border border-emerald-300/20 bg-black/60 p-3 shadow-[0_0_35px_rgba(16,185,129,.08)]">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-[.18em] text-emerald-100/55">{location.description}</p><h2 className="text-2xl font-black">{location.label}</h2></div>{mode === 'admin' && zone && <button type="button" disabled={!canManage} onClick={() => setTarget({ type: 'zone', id: zone.id })} className="rounded-2xl border border-fuchsia-300/35 bg-fuchsia-400/10 px-3 py-2 text-xs font-black text-fuchsia-100">Керувати локацією</button>}</div>
          <div className="relative overflow-hidden rounded-[22px] border border-white/10 bg-black">
            <img src={location.background} alt={location.label} className="block w-full" draggable={false} />
            <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${location.width} ${location.height}`} preserveAspectRatio="none">
              {location.tables.map((visual) => {
                const table = realTable(visual.number); if (!table) return null;
                return <Shape key={visual.number} shape={visual.shape} color={tableColor(visual.number)} active={target?.type === 'table' && target.id === table.id} onClick={() => canManage && setTarget({ type: 'table', id: table.id })} label={`Стіл ${visual.number}`} />;
              })}
            </svg>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/55"><span>Вільний — без контуру</span><span>🔵 Очікує</span><span>🟠 Заброньований</span><span>🔴 Зайнятий</span><span>🩵 Готується</span><span>⚪ Закритий</span></div>
        </section>

        {target && <section data-map-target className="mt-3 rounded-[28px] border border-amber-300/30 bg-amber-300/[.06] p-4 shadow-[0_0_38px_rgba(251,191,36,.09)]">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-[.16em] text-amber-100/50">Обрано</p><h2 className="mt-1 text-2xl font-black">{selectedName}</h2>{selectedTable && <p className="mt-1 text-sm text-white/50">{selectedTable.seats} місць · {selectedTable.zone?.name || location.label}</p>}</div><button type="button" onClick={() => setTarget(null)} className="rounded-xl border border-white/10 p-2"><X size={17} /></button></div>

          {selectedTable && date === today && <div className="mt-4"><p className="mb-2 text-xs font-black uppercase tracking-[.14em] text-white/40">Статус зараз</p>{mode === 'director' ? <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => void setPhysicalStatus('free')} className="rounded-2xl border border-emerald-200/65 bg-black/60 px-3 py-3 text-sm font-black text-emerald-50 shadow-[0_0_20px_rgba(52,211,153,.18)]">Стіл вільний</button><button type="button" onClick={() => void setPhysicalStatus('occupied')} className="rounded-2xl border border-rose-200/65 bg-black/60 px-3 py-3 text-sm font-black text-rose-50 shadow-[0_0_20px_rgba(244,63,94,.18)]">Стіл зайнятий</button></div> : <div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => void setPhysicalStatus('free')} className="rounded-2xl border border-emerald-300/35 bg-emerald-400/10 px-3 py-3 text-xs font-black text-emerald-100">Вільний</button><button type="button" onClick={() => void setPhysicalStatus('cleaning')} className="rounded-2xl border border-cyan-300/35 bg-cyan-400/10 px-3 py-3 text-xs font-black text-cyan-100">Готується</button><button type="button" onClick={() => void setPhysicalStatus('closed')} className="rounded-2xl border border-red-300/35 bg-red-400/10 px-3 py-3 text-xs font-black text-red-100">Закрити</button></div>}</div>}

          {targetBlocks.length > 0 && <div className="mt-4 space-y-2"><p className="text-xs font-black uppercase tracking-[.14em] text-fuchsia-100/55">Заплановано</p>{targetBlocks.map((block) => <div key={block.id} className="flex items-center justify-between gap-3 rounded-2xl border border-fuchsia-300/25 bg-fuchsia-500/[.08] p-3"><div><p className="font-bold">{block.startTime && block.endTime ? `${block.startTime.slice(0, 5)}–${block.endTime.slice(0, 5)}` : 'Увесь день'}</p><p className="text-xs text-white/45">{block.reason}</p></div><button type="button" disabled={busy === `remove:${block.id}`} onClick={() => void removeBlock(block)} className="rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-xs font-black text-red-100"><Trash2 size={14} className="inline" /> Відкрити</button></div>)}</div>}

          {conflicts.length > 0 && <div className="mt-4 rounded-[24px] border border-red-300/30 bg-red-500/[.08] p-4"><p className="font-black text-red-100">Спочатку обробіть бронювання</p><div className="mt-3 space-y-2">{conflicts.map((booking) => { const destinations = availableDestinations(booking); const open = transferBookingId === booking.id; return <div key={booking.id} className="rounded-2xl border border-white/10 bg-black/30 p-3"><p className="font-bold">{booking.bookingTime.slice(0, 5)} · Стіл №{booking.table?.tableNumber || '-'}</p><p className="text-xs text-white/45">{booking.client?.fullName || '-'} · {booking.guestsCount} гостей</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => { setTransferBookingId(open ? null : booking.id); setTransferTableId(''); }} className="rounded-xl border border-sky-300/30 bg-sky-400/10 px-3 py-2 text-xs font-black text-sky-100">Перенести</button><button type="button" onClick={() => void cancelBooking(booking)} className="rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-xs font-black text-red-100">Скасувати</button></div>{open && <div className="relative mt-3"><select value={transferTableId} onChange={(event) => setTransferTableId(event.target.value)} className="w-full appearance-none rounded-xl border border-white/10 bg-neutral-950 px-3 py-3 pr-9 text-sm font-bold"><option value="">Оберіть вільний стіл</option>{destinations.map((table) => <option key={table.id} value={table.id}>№{table.tableNumber} · {table.zone?.name || 'Без локації'} · {table.seats} місць</option>)}</select><ChevronDown size={16} className="pointer-events-none absolute right-3 top-3.5 text-white/40" /><button type="button" disabled={!transferTableId} onClick={() => void transferBooking(booking)} className="mt-2 w-full rounded-xl bg-sky-300 px-3 py-3 text-sm font-black text-neutral-950 disabled:opacity-40">Підтвердити перенесення</button></div>}</div>; })}</div></div>}

          <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => setFullDay(true)} className={`rounded-2xl border px-3 py-3 text-sm font-black ${fullDay ? 'border-amber-200/60 bg-amber-300 text-neutral-950' : 'border-white/10 bg-black/20 text-white/60'}`}>Увесь день</button><button type="button" onClick={() => setFullDay(false)} className={`rounded-2xl border px-3 py-3 text-sm font-black ${!fullDay ? 'border-amber-200/60 bg-amber-300 text-neutral-950' : 'border-white/10 bg-black/20 text-white/60'}`}>Обрати час</button></div>
          {!fullDay && <div className="mt-2 grid grid-cols-2 gap-2"><label className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/40">Початок<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-black text-white outline-none" /></label><label className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-white/40">Завершення<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="mt-1 block w-full bg-transparent text-base font-black text-white outline-none" /></label></div>}
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Причина: ремонт, подія, обслуговування…" className="mt-3 min-h-24 w-full rounded-2xl border border-white/10 bg-black/25 p-3 text-base outline-none focus:border-amber-200/40" />
          <button type="button" disabled={!canManage || !reason.trim() || conflicts.length > 0 || busy === 'create' || (!fullDay && timeToMinutes(startTime) >= timeToMinutes(endTime))} onClick={() => void createBlock()} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 py-4 font-black text-neutral-950 disabled:opacity-35"><CalendarClock size={19} />Запланувати недоступність</button>
        </section>}

        {!target && <div className="mt-3 rounded-[24px] border border-dashed border-white/10 bg-white/[.02] p-7 text-center"><CheckCircle2 size={24} className="mx-auto text-emerald-200/70" /><p className="mt-3 font-black">Натисніть на стіл на фото</p><p className="mt-1 text-sm text-white/40">{mode === 'director' ? 'Доступні лише два стани: зайнятий або вільний.' : 'Або натисніть «Керувати локацією» для всієї зони.'}</p></div>}
        {mode === 'admin' && <div className="mt-3 flex items-start gap-2 rounded-[22px] border border-white/10 bg-black/45 p-3 text-xs text-white/40"><Clock3 size={15} className="mt-0.5 shrink-0" /><p>На майбутню дату змінюється лише планова доступність. Фізичні статуси столу змінюються тільки для сьогодні.</p></div>}
      </div>
    </div>
  );
}
