// MOLO GUEST FIX: persistence + custom duration only
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode, KeyboardEvent } from 'react';

import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Menu,
  Phone,
  Users,
} from 'lucide-react';

import type { FullMapResponse, Restaurant, TableItem, Zone } from '../api/types';
import { bookingsApi } from '../api/bookings';
import type { TableRuntimeStatus, BookingPublicStatus, GuestBooking, GuestBookingToken } from '../api/bookings';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { waiterCallsApi } from '../api/waiterCalls';
import type { GuestWaiterCallStatus } from '../api/waiterCalls';
import { useAsyncAction } from '../hooks/useAsyncAction';
import { usePersistentState } from '../hooks/usePersistentState';
import GuestHookahCallPanel from './GuestHookahCallPanel';
const FALLBACK_MENU =
  'https://expz.menu/8ec3f3d4-0e9f-4ed7-a03f-5f4deaba843e?utm_source=ig&utm_medium=social&utm_content=link_in_bio';

type Step = 'home' | 'location_choice' | 'waterfront_choice' | 'map' | 'form' | 'success';

type TableStatus = 'free' | 'pending' | 'reserved' | 'occupied' | 'cleaning' | 'closed';
type Point = [number, number];

type PolygonShape = {
  kind: 'polygon';
  points: Point[];
  expand?: number;
};

type EllipseShape = {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  expand?: number;
};

type EllipsePathShape = {
  kind: 'ellipsePath';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation?: number;
  expand?: number;
};

type VisualTableShape = PolygonShape | EllipseShape | EllipsePathShape;

type VisualTable = {
  number: number;
  seats: number;
  shape: VisualTableShape;
};

type LocationMap = {
  key: string;
  label: string;
  description: string;
  background: string;
  width: number;
  height: number;
  tables: VisualTable[];
};

type TableAvailabilityNotice = {
  tableNumber: string;
  status: TableStatus;
  bookedFrom: string;
  bookedTo: string;
  availableFrom: string;
};

const ACTIVE_BOOKING_STORAGE_KEY = 'molo:guest:active-booking-id';
const LEGACY_ACTIVE_BOOKING_STORAGE_KEY = 'molo:guest:last-booking-id';
const GUEST_BOOKINGS_STORAGE_KEY = 'molo:guest:bookings:v1';
const GUEST_DEVICE_ID_STORAGE_KEY = 'molo:guest:device-id:v1';
const EXTERNAL_REVIEW_SESSION_KEY_PREFIX = 'molo:guest:external-review-opened:';
const MOLO_PUBLIC_REVIEW_URL = 'https://www.google.com/search?q=MOLO+Restaurant';
const MAX_STORED_GUEST_BOOKINGS = 100;

function getGuestDeviceId(): string {
  if (typeof window === 'undefined') return '';

  const deviceId = window.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  try {
    const stored = window.localStorage.getItem(GUEST_DEVICE_ID_STORAGE_KEY);
    if (stored) return stored;

    window.localStorage.setItem(GUEST_DEVICE_ID_STORAGE_KEY, deviceId);
  } catch {
    // Бронювання працює і без доступу до localStorage у цьому сеансі.
  }

  return deviceId;
}

function readStoredBookingId(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(ACTIVE_BOOKING_STORAGE_KEY);
    if (stored) return stored;

    const legacyStored = window.sessionStorage.getItem(LEGACY_ACTIVE_BOOKING_STORAGE_KEY);
    if (!legacyStored) return null;

    const parsed = JSON.parse(legacyStored);
    if (typeof parsed !== 'string' || !parsed) return null;

    window.localStorage.setItem(ACTIVE_BOOKING_STORAGE_KEY, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function readStoredGuestBookings(): GuestBookingToken[] {
  if (typeof window === 'undefined') return [];

  try {
    const value = JSON.parse(window.localStorage.getItem(GUEST_BOOKINGS_STORAGE_KEY) || '[]');
    if (!Array.isArray(value)) return [];

    return value
      .filter((item): item is GuestBookingToken =>
        typeof item?.bookingId === 'string' && Boolean(item.bookingId) &&
        typeof item?.token === 'string' && Boolean(item.token) &&
        typeof item?.createdAt === 'string' && Boolean(item.createdAt),
      )
      .slice(0, MAX_STORED_GUEST_BOOKINGS);
  } catch {
    return [];
  }
}

function saveGuestBooking(booking: GuestBookingToken) {
  try {
    const bookings = readStoredGuestBookings().filter((item) => item.bookingId !== booking.bookingId);
    window.localStorage.setItem(
      GUEST_BOOKINGS_STORAGE_KEY,
      JSON.stringify([booking, ...bookings].slice(0, MAX_STORED_GUEST_BOOKINGS)),
    );
  } catch {
    // Бронювання продовжує працювати, навіть якщо сховище браузера недоступне.
  }
}

function guestBookingToStatus(booking: GuestBooking): BookingPublicStatus {
  const bookedTo = addMinutesToTime(booking.bookingTime, booking.durationMinutes);
  const availableFrom = addMinutesToTime(bookedTo, CLEANUP_MINUTES);
  const pendingAgeMinutes = Math.max(0, Math.floor((Date.now() - new Date(booking.createdAt).getTime()) / 60_000));

  return {
    ...booking,
    bookedFrom: booking.bookingTime,
    bookedTo,
    availableFrom,
    bookedFromLabel: booking.bookingTime,
    bookedToLabel: bookedTo,
    availableFromLabel: availableFrom,
    pendingAgeMinutes,
    pendingReminderMinutes: 15,
    isPendingTooLong: pendingAgeMinutes >= 15,
  };
}


const LOCATION_ZONE_ALIASES: Record<string, string[]> = {
  hall: ['зал ресторану', 'зал', 'hall'],
  canopy: ['навіс', 'навес', 'canopy'],
  gazebo: ['велика альтанка', 'велика бесідка', 'большая беседка', 'gazebo'],
  rotang: ['ротанг', 'rotang'],
  embankment: ['набережна', 'набережная', 'embankment'],
  glass_gazebo: ['скляна альтанка', 'стеклянная беседка', 'glass gazebo'],
  water_gazebo: ['альтанка на воді', 'беседка на воде', 'water gazebo'],
};

function normalizeZoneName(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findLocationZone(zones: Zone[], locationKey: string) {
  const aliases = LOCATION_ZONE_ALIASES[locationKey] || [];

  return zones.find((zone) => {
    const normalized = normalizeZoneName(zone.name);
    return aliases.some((alias) => normalized.includes(normalizeZoneName(alias)));
  }) || null;
}

const STATUS_TEXT: Record<TableStatus, string> = {
  free: 'Вільний',
  pending: 'Очікує підтвердження',
  reserved: 'Заброньований',
  occupied: 'Зайнятий',
  cleaning: 'Готується',
  closed: 'Закритий',
};

const STATUS_COLORS: Record<TableStatus | 'active', string> = {
  active: '#facc15',
  pending: '#38bdf8',
  reserved: '#fb923c',
  occupied: '#ff3b4f',
  cleaning: '#67e8f9',
  closed: '#bdbdbd',
  free: '#ffffff',
};

const LOCATIONS: LocationMap[] = [
  {
    key: 'hall',
    label: 'Зал ресторану',
    description: 'Зал 1–14',
    background: '/maps/hall-bg-numbered.png',
    width: 1536,
    height: 1152,
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
    key: 'canopy',
    label: 'Навіс',
    description: 'Зона навісу 15–20',
    background: '/maps/canopy-day-numbered.png',
    width: 1229,
    height: 1536,
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
    key: 'gazebo',
    label: 'Велика альтанка',
    description: 'Велика альтанка 21–36',
    background: '/maps/gazebo-day-numbered.png',
    width: 1229,
    height: 1536,
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
    key: 'rotang',
    label: 'Ротанг',
    description: 'Ротанг 37–39',
    background: '/maps/rotang-day-numbered.png',
    width: 1536,
    height: 975,
    tables: [
      { number: 37, seats: 4, shape: { kind: 'ellipsePath', cx: 273, cy: 778, rx: 90, ry: 55, rotation: -7 } },
      { number: 38, seats: 4, shape: { kind: 'ellipsePath', cx: 1194, cy: 628, rx: 72, ry: 39, rotation: 0 } },
      { number: 39, seats: 4, shape: { kind: 'ellipsePath', cx: 1458, cy: 561, rx: 43, ry: 19, rotation: 4 } },
    ],
  },
  {
    key: 'embankment',
    label: 'Набережна',
    description: 'Набережна 40–44',
    background: '/maps/embankment-day-numbered.png',
    width: 1536,
    height: 864,
    tables: [
      { number: 40, seats: 4, shape: { kind: 'polygon', points: [[153, 543], [217, 506], [302, 508], [246, 548]], expand: 7 } },
      { number: 41, seats: 4, shape: { kind: 'polygon', points: [[474, 552], [511, 518], [593, 515], [566, 553]], expand: 7 } },
      { number: 42, seats: 4, shape: { kind: 'polygon', points: [[776, 557], [781, 517], [862, 518], [867, 558]], expand: 7 } },
      { number: 43, seats: 4, shape: { kind: 'polygon', points: [[1063, 559], [1039, 520], [1118, 520], [1151, 559]], expand: 7 } },
      { number: 44, seats: 4, shape: { kind: 'polygon', points: [[1318, 562], [1267, 522], [1348, 522], [1402, 562]], expand: 7 } },
    ],
  },
  {
    key: 'glass_gazebo',
    label: 'Скляна альтанка',
    description: 'Скляна альтанка 45–50',
    background: '/maps/glass-gazebo-day-numbered.png',
    width: 1536,
    height: 1143,
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
    key: 'water_gazebo',
    label: 'Альтанка на воді',
    description: 'Альтанка на воді 100–109',
    background: '/maps/water-gazebo-day-numbered.png',
    width: 1158,
    height: 1536,
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

const WATERFRONT_LOCATION_KEYS = ['canopy', 'gazebo', 'rotang', 'embankment', 'glass_gazebo', 'water_gazebo'];

const CLEANUP_MINUTES = 15;

function normalizeTableStatus(status: unknown): TableStatus {
  if (status === 'pending' || status === 'awaiting_confirmation') return 'pending';
  if (status === 'reserved' || status === 'booked') return 'reserved';
  if (status === 'occupied') return 'occupied';
  if (status === 'cleaning' || status === 'preparing') return 'cleaning';
  if (status === 'closed') return 'closed';
  return 'free';
}

function getRestaurantFromResponse(value: unknown): Restaurant | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { data?: Restaurant } | Restaurant;
  return 'data' in data && data.data ? data.data : (data as Restaurant);
}

function getMapFromResponse(value: unknown): FullMapResponse | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { data?: FullMapResponse } | FullMapResponse;
  return 'data' in data && data.data ? data.data : (data as FullMapResponse);
}

function createFallbackTable(tableNumber: number, seats: number): TableItem {
  return {
    id: `visual-${tableNumber}`,
    tableNumber: String(tableNumber),
    seats,
    shape: 'visual',
    photoUrl: null,
    status: 'free',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    isVisible: true,
  };
}
function hourWord(hours: number): string {
  if (hours === 1) return 'година';
  if (hours >= 2 && hours <= 4) return 'години';
  return 'годин';
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} хв`;

  const hours = minutes / 60;

  if (Number.isInteger(hours)) {
    return `${hours} ${hourWord(hours)}`;
  }

  return `${String(hours).replace('.', ',')} години`;
}

function timeToMinutes(value: string): number {
  const [hours = '0', minutes = '0'] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function minutesToTime(value: number): string {
  const normalized = ((value % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function addMinutesToTime(value: string, minutes: number): string {
  return minutesToTime(timeToMinutes(value) + minutes);
}

function getTableNeonColor(status: TableStatus, active: boolean) {
  if (active) return STATUS_COLORS.active;
  return STATUS_COLORS[status];
}

function expandPolygon(points: Point[], amount = 0): Point[] {
  if (!amount) return points;

  const cx = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const cy = points.reduce((sum, [, y]) => sum + y, 0) / points.length;

  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const scale = (distance + amount) / distance;
    return [cx + dx * scale, cy + dy * scale];
  });
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function pointList(points: Point[]): string {
  return points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

function ellipsePath(shape: EllipsePathShape): string {
  const steps = 72;
  const rotation = ((shape.rotation ?? 0) * Math.PI) / 180;
  const rx = shape.rx + (shape.expand ?? 0);
  const ry = shape.ry + (shape.expand ?? 0);
  const points: Point[] = [];

  for (let i = 0; i < steps; i += 1) {
    const t = (Math.PI * 2 * i) / steps;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    const xr = x * Math.cos(rotation) - y * Math.sin(rotation);
    const yr = x * Math.sin(rotation) + y * Math.cos(rotation);
    points.push([shape.cx + xr, shape.cy + yr]);
  }

  return `M ${pointList([points[0]])} L ${pointList(points.slice(1))} Z`;
}

function shapeRenderData(shape: VisualTableShape):
  | { tag: 'polygon'; points: string }
  | { tag: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { tag: 'path'; d: string } {
  if (shape.kind === 'polygon') {
    return {
      tag: 'polygon',
      points: pointList(expandPolygon(shape.points, shape.expand ?? 0)),
    };
  }

  if (shape.kind === 'ellipse') {
    return {
      tag: 'ellipse',
      cx: shape.cx,
      cy: shape.cy,
      rx: shape.rx + (shape.expand ?? 0),
      ry: shape.ry + (shape.expand ?? 0),
    };
  }

  return {
    tag: 'path',
    d: ellipsePath(shape),
  };
}

function GoldButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="molo-button rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.16)] backdrop-blur-sm disabled:opacity-50 sm:text-2xl"
    >
      {children}
    </button>
  );
}

function VisibleContour({ shape, color }: { shape: VisualTableShape; color: string }) {
  const data = shapeRenderData(shape);
  const neonStyle = {
    filter: `
      drop-shadow(0 0 6px ${color})
      drop-shadow(0 0 14px ${color})
      drop-shadow(0 0 26px ${color})
    `,
    transition: 'all 180ms ease',
  };
  const commonProps = {
    fill: 'transparent',
    stroke: color,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style: neonStyle,
    pointerEvents: 'none' as const,
  };

  if (data.tag === 'polygon') {
    return (
      <>
        <polygon points={data.points} {...commonProps} strokeWidth={22} strokeOpacity={0.28} />
        <polygon points={data.points} {...commonProps} strokeWidth={13} strokeOpacity={0.78} />
        <polygon points={data.points} {...commonProps} strokeWidth={6} strokeOpacity={1} />
        <polygon points={data.points} fill="transparent" stroke="white" strokeWidth={2} strokeOpacity={0.65} strokeLinejoin="round" pointerEvents="none" />
      </>
    );
  }

  if (data.tag === 'ellipse') {
    return (
      <>
        <ellipse cx={data.cx} cy={data.cy} rx={data.rx} ry={data.ry} {...commonProps} strokeWidth={22} strokeOpacity={0.28} />
        <ellipse cx={data.cx} cy={data.cy} rx={data.rx} ry={data.ry} {...commonProps} strokeWidth={13} strokeOpacity={0.78} />
        <ellipse cx={data.cx} cy={data.cy} rx={data.rx} ry={data.ry} {...commonProps} strokeWidth={6} strokeOpacity={1} />
        <ellipse cx={data.cx} cy={data.cy} rx={data.rx} ry={data.ry} fill="transparent" stroke="white" strokeWidth={2} strokeOpacity={0.65} pointerEvents="none" />
      </>
    );
  }

  return (
    <>
      <path d={data.d} {...commonProps} strokeWidth={22} strokeOpacity={0.28} />
      <path d={data.d} {...commonProps} strokeWidth={13} strokeOpacity={0.78} />
      <path d={data.d} {...commonProps} strokeWidth={6} strokeOpacity={1} />
      <path d={data.d} fill="transparent" stroke="white" strokeWidth={2} strokeOpacity={0.65} pointerEvents="none" />
    </>
  );
}

function ClickZone({ table, onPick }: { table: VisualTable; onPick: (table: VisualTable) => void }) {
  const data = shapeRenderData(table.shape);
  const commonProps = {
    className: 'molo-svg-hit',
    fill: '#ffffff',
    fillOpacity: 0,
    stroke: 'none',
    cursor: 'pointer',
    pointerEvents: 'all' as const,
    role: 'button',
    tabIndex: 0,
    'aria-label': `Стіл ${table.number}`,
    onClick: () => onPick(table),
    onKeyDown: (event: KeyboardEvent<SVGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onPick(table);
      }
    },
  };

  if (data.tag === 'polygon') return <polygon points={data.points} {...commonProps} />;
  if (data.tag === 'ellipse') return <ellipse cx={data.cx} cy={data.cy} rx={data.rx} ry={data.ry} {...commonProps} />;
  return <path d={data.d} {...commonProps} />;
}

export default function GuestApp() {
  const [step, setStep] = usePersistentState<Step>('molo:guest:step', 'home');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [selectedLocationKey, setSelectedLocationKey] = usePersistentState(
    'molo:guest:selected-location',
    'hall',
  );
  const [selectedTable, setSelectedTable] = usePersistentState<TableItem | null>(
    'molo:guest:selected-table',
    null,
  );
  const [activeTableNumber, setActiveTableNumber] = useState<number | null>(null);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState('19:00');
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [customDurationHours, setCustomDurationHours] = useState('3');
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [tableNotice, setTableNotice] = useState<TableAvailabilityNotice | null>(null);
  const [dateStatuses, setDateStatuses] = useState<Record<string, TableRuntimeStatus>>({});
  const [legacyBookingId] = useState<string | null>(readStoredBookingId);
  const [lastBookingId, setLastBookingId] = useState<string | null>(legacyBookingId);
  const [guestBookings, setGuestBookings] = useState<GuestBookingToken[]>(readStoredGuestBookings);
  const [guestDeviceId] = useState(getGuestDeviceId);
  const [myBookings, setMyBookings] = useState<GuestBooking[]>([]);
  const [showMyBookings, setShowMyBookings] = useState(false);
  const [bookingStatus, setBookingStatus] = useState<BookingPublicStatus | null>(null);
  const [waiterCallStatus, setWaiterCallStatus] = useState<GuestWaiterCallStatus | null>(null);
  const [waiterCallBusy, setWaiterCallBusy] = useState(false);
  const [waiterCallMessage, setWaiterCallMessage] = useState<string | null>(null);
  const [guestActionBusy, setGuestActionBusy] = useState(false);
  const [guestActionMessage, setGuestActionMessage] = useState<string | null>(null);
  const [showExternalReviewOffer, setShowExternalReviewOffer] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    guestsCount: 2,
    wishes: '',
  });

  const { loading, error, run } = useAsyncAction();

  const siteMode = restaurant?.siteMode || 'night';

  useEffect(() => {
    try {
      if (lastBookingId) {
        window.localStorage.setItem(ACTIVE_BOOKING_STORAGE_KEY, lastBookingId);
      } else {
        window.localStorage.removeItem(ACTIVE_BOOKING_STORAGE_KEY);
      }

      window.sessionStorage.removeItem(LEGACY_ACTIVE_BOOKING_STORAGE_KEY);
    } catch {
      // Бронювання продовжує працювати, навіть якщо сховище браузера недоступне.
    }
  }, [lastBookingId]);

  useEffect(() => {
    if (step === 'form' && !selectedTable) {
      setStep('map');
    }

    if (step === 'success' && !lastBookingId && !bookingStatus) {
      setStep('home');
    }
  }, [step, selectedTable, lastBookingId, bookingStatus, setStep]);

  useEffect(() => {
    let stopped = false;

    function refreshPublicSettings() {
      restaurantApi
        .get()
        .then((response) => {
          if (!stopped) setRestaurant(getRestaurantFromResponse(response));
        })
        .catch(() => {});

      refreshMap();
    }

    refreshPublicSettings();
    const timer = window.setInterval(refreshPublicSettings, 15000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setTableNotice(null);
    setActiveTableNumber(null);
    refreshDateStatuses();
  }, [date, time, durationMinutes, selectedLocationKey]);


  useEffect(() => {
    if (!guestDeviceId && !lastBookingId && !legacyBookingId && guestBookings.length === 0) return;

    let stopped = false;

    async function refreshBookingStatus() {
      const tokens = guestBookings.map((booking) => booking.token);
      let selectedBookingId = lastBookingId;

      try {
        let hasGuestBooking = false;
        if (guestDeviceId || tokens.length > 0) {
          const bookings = await bookingsApi.guestList(guestDeviceId, tokens);
          if (stopped) return;
          setMyBookings(bookings);

          const activeBookings = bookings.filter(
            (item) => item.status === 'pending' || item.status === 'approved',
          );
          const booking =
            activeBookings.find((item) => item.bookingId === lastBookingId) ||
            activeBookings[0] ||
            bookings.find((item) => item.bookingId === lastBookingId);
          if (booking) {
            hasGuestBooking = true;
            selectedBookingId = booking.bookingId;
            if (booking.bookingId !== lastBookingId) setLastBookingId(booking.bookingId);
            setBookingStatus(guestBookingToStatus(booking));
          }
        }

        if (legacyBookingId) {
          // Старі бронювання не мають токена і залишаються на публічній перевірці статусу.
          const status = await bookingsApi.getPublicStatus(legacyBookingId);
          if (stopped) return;

          if (!hasGuestBooking) {
            selectedBookingId = legacyBookingId;
            setBookingStatus(status);
          }
        }
      } catch {
        // Тимчасова помилка перевірки не видаляє збережені заявки гостя.
      }

      try {
        if (!selectedBookingId) return;
        const callStatus = await waiterCallsApi.guestStatus(selectedBookingId);
        if (!stopped) setWaiterCallStatus(callStatus);
      } catch {
        if (!stopped) setWaiterCallStatus(null);
      }
    }

    refreshBookingStatus();
    const timer = window.setInterval(refreshBookingStatus, 15000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [lastBookingId, legacyBookingId, guestBookings, guestDeviceId]);

  const visibleTables = useMemo(() => {
    return (map?.tables || []).filter((table) => table.isVisible !== false);
  }, [map]);

  const currentLocation = useMemo(() => {
    return LOCATIONS.find((location) => location.key === selectedLocationKey) ?? LOCATIONS[0];
  }, [selectedLocationKey]);

  const bookingEndTime = useMemo(() => addMinutesToTime(time, durationMinutes), [time, durationMinutes]);
  const availableAfterCleanup = useMemo(() => addMinutesToTime(bookingEndTime, CLEANUP_MINUTES), [bookingEndTime]);
  const bookingPeriod = `${time} — ${bookingEndTime}`;
  const activeBookingPeriod = bookingStatus
    ? `${bookingStatus.bookedFromLabel} — ${bookingStatus.bookedToLabel}`
    : bookingPeriod;
  const activeBookingTableNumber =
    bookingStatus?.tableNumber || selectedTable?.tableNumber || null;
  const activeGuestBooking = guestBookings.find((booking) => booking.bookingId === lastBookingId) || null;
  const kyivToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv' }).format(new Date());
  const activeMyBookings = myBookings.filter((booking) =>
    (booking.status === 'pending' || booking.status === 'approved') && booking.bookingDate >= kyivToday,
  );
  const unreadNotificationBookings = myBookings.filter((booking) =>
    booking.status === 'cancelled' &&
    Boolean(booking.guestNotification) &&
    !booking.guestNotification?.acknowledgedAt,
  );
  const completedReviewBooking = myBookings.find((booking) =>
    booking.status === 'completed' && booking.canLeaveReview,
  ) || null;
  const completedReviewAccess = completedReviewBooking
    ? guestBookings.find((booking) => booking.bookingId === completedReviewBooking.bookingId) || null
    : null;
  const myBookingCards = [...activeMyBookings, ...unreadNotificationBookings].map((booking) => ({
    booking,
    access: guestBookings.find((item) => item.bookingId === booking.bookingId) || null,
  }));
  const pendingTooLong =
    bookingStatus?.status === 'pending' &&
    (bookingStatus.isPendingTooLong || bookingStatus.pendingAgeMinutes >= 15);
  const activeBookingStatusText = !bookingStatus
    ? 'Перевіряємо статус...'
    : bookingStatus.status === 'pending'
      ? pendingTooLong
        ? 'Очікує підтвердження понад 15 хвилин'
        : 'Очікує підтвердження'
      : bookingStatus.status === 'approved'
        ? 'Бронювання підтверджено'
        : 'Статус заявки оновлено';

  function refreshMap() {
    mapApi
      .get()
      .then((response) => setMap(getMapFromResponse(response)))
      .catch(() => {});

    refreshDateStatuses();
  }

  function refreshDateStatuses() {
    bookingsApi
      .tableStatuses({ bookingDate: date, bookingTime: time, durationMinutes })
      .then((response) => {
        const payload = (response as any)?.data || response;
        setDateStatuses(payload?.statuses || {});
      })
      .catch(() => setDateStatuses({}));
  }

  function isLocationClosed(locationKey: string) {
    return findLocationZone(map?.zones || [], locationKey)?.isClosed === true;
  }

  function findRealTableByNumber(tableNumber: number) {
    return visibleTables.find(
      (table) => Number(table.tableNumber) === Number(tableNumber),
    );
  }

  function getRuntimeStatus(tableNumber: number | string): TableRuntimeStatus | null {
    return dateStatuses[String(tableNumber)] || null;
  }

  function getVisualTableStatus(tableNumber: number): TableStatus {
    const realTable = findRealTableByNumber(tableNumber);
    const runtime = getRuntimeStatus(tableNumber);

    if (isLocationClosed(selectedLocationKey)) return 'closed';
    if (realTable?.zone?.isClosed) return 'closed';
    if (runtime?.status) return normalizeTableStatus(runtime.status);

    const physicalStatus = normalizeTableStatus(realTable?.status);

    if (physicalStatus === 'closed' || physicalStatus === 'occupied' || physicalStatus === 'cleaning') {
      return physicalStatus;
    }

    // pending/reserved більше не беремо з table.status, бо це може бути майбутня бронь.
    return 'free';
  }

  function getSelectableTableStatus(table: TableItem): TableStatus {
    const runtime = getRuntimeStatus(table.tableNumber);

    if (isLocationClosed(selectedLocationKey)) return 'closed';
    if (table.zone?.isClosed) return 'closed';
    if (runtime?.status) return normalizeTableStatus(runtime.status);

    const physicalStatus = normalizeTableStatus(table.status);

    if (physicalStatus === 'closed' || physicalStatus === 'occupied' || physicalStatus === 'cleaning') {
      return physicalStatus;
    }

    return 'free';
  }

  function createTableNotice(table: TableItem, status: TableStatus): TableAvailabilityNotice {
    const runtime = getRuntimeStatus(table.tableNumber);
    const conflict = runtime?.conflict;

    return {
      tableNumber: String(table.tableNumber),
      status,
      bookedFrom: conflict?.bookedFromLabel || time,
      bookedTo: conflict?.bookedToLabel || bookingEndTime,
      availableFrom: conflict?.availableFromLabel || availableAfterCleanup,
    };
  }

  function closeTableNotice() {
    setTableNotice(null);
    setActiveTableNumber(null);
  }

  function callAdmin() {
    const phone = bookingStatus?.restaurantPhone || restaurant?.phone;

    if (phone) {
      window.location.href = `tel:${phone}`;
      return;
    }

    alert('Телефон адміністратора ще не додано.');
  }

  async function runGuestAction(bookingId: string, token: string, action: (token: string) => Promise<{ message: string; booking?: GuestBooking; askExternalReview?: boolean }>) {
    if (!bookingId || !token || guestActionBusy) return null;

    setLastBookingId(bookingId);
    setGuestActionBusy(true);
    setGuestActionMessage(null);

    try {
      const result = await action(token);
      const booking = await bookingsApi.getGuest(bookingId, token)
        .catch(() => result.booking || null);
      if (booking) {
        setBookingStatus(guestBookingToStatus(booking));
        setMyBookings((current) =>
          booking.status === 'pending' || booking.status === 'approved'
            ? current.map((item) => item.bookingId === booking.bookingId ? booking : item)
            : current.filter((item) => item.bookingId !== booking.bookingId),
        );
      }
      setGuestActionMessage(result.message);
      return result;
    } catch (actionError: any) {
      setGuestActionMessage(actionError?.message || 'Не вдалося оновити бронювання');
    } finally {
      setGuestActionBusy(false);
    }

    return null;
  }

  function openExternalReview() {
    if (!lastBookingId || !activeGuestBooking) return;

    try {
      window.sessionStorage.setItem(`${EXTERNAL_REVIEW_SESSION_KEY_PREFIX}${lastBookingId}`, 'true');
    } catch {
      // The offer is still hidden for the current mounted session.
    }
    setShowExternalReviewOffer(false);
    void bookingsApi.guestExternalReviewOpened(lastBookingId, activeGuestBooking.token);
  }

  async function callWaiter() {
    if (!lastBookingId || waiterCallBusy) return;

    setWaiterCallBusy(true);
    setWaiterCallMessage(null);

    try {
      const result = await waiterCallsApi.createFromGuest(lastBookingId);
      setWaiterCallMessage(result.message || 'Виклик офіціанта відправлено');
      const status = await waiterCallsApi.guestStatus(lastBookingId);
      setWaiterCallStatus(status);
    } catch (callError: any) {
      setWaiterCallMessage(callError?.message || 'Не вдалося викликати офіціанта');
    } finally {
      setWaiterCallBusy(false);
    }
  }

  function openMenu() {
    window.open(restaurant?.menuUrl || FALLBACK_MENU, '_blank');
  }

  function openLocation(locationKey: string) {
    if (isLocationClosed(locationKey)) {
      const location = LOCATIONS.find((item) => item.key === locationKey);
      alert(`${location?.label || 'Локація'} зараз закрита для бронювання.`);
      return;
    }

    setSelectedLocationKey(locationKey);
    setSelectedTable(null);
    setActiveTableNumber(null);
    setTableNotice(null);
    setStep('map');
  }

  function goBack() {
    setActiveTableNumber(null);

    if (step === 'form') {
      setStep('map');
      return;
    }

    if (step === 'map') {
      if (selectedLocationKey === 'hall') {
        setStep('location_choice');
      } else {
        setStep('waterfront_choice');
      }
      return;
    }

    if (step === 'waterfront_choice') {
      setStep('location_choice');
      return;
    }

    if (step === 'location_choice') {
      setStep('home');
      return;
    }

    setStep('home');
  }

  function openCustomDuration() {
    setIsCustomDuration(true);

    const hours = Number(customDurationHours);

    if (Number.isFinite(hours) && hours > 0) {
      setDurationMinutes(Math.min(720, Math.max(60, hours * 60)));
    }
  }

  function updateCustomDuration(value: string) {
    const digitsOnly = value.replace(/\D/g, '').slice(0, 2);
    setCustomDurationHours(digitsOnly);
    setIsCustomDuration(true);

    if (!digitsOnly) return;

    const hours = Math.min(12, Math.max(1, Number(digitsOnly)));
    setDurationMinutes(hours * 60);
  }

  function selectTable(table: TableItem) {
    const status = getSelectableTableStatus(table);

    if (restaurant?.status === 'booking_closed' || status !== 'free' || table.zone?.isClosed || isLocationClosed(selectedLocationKey)) {
      alert(`Стіл недоступний: ${STATUS_TEXT[status]}`);
      return;
    }

    setTableNotice(null);
    setSelectedTable(table);
    setStep('form');
  }

  function selectVisualTable(visualTable: VisualTable) {
    const realTable = findRealTableByNumber(visualTable.number);
    const table = realTable ?? createFallbackTable(visualTable.number, visualTable.seats);
    const status = getSelectableTableStatus(table);

    setActiveTableNumber(visualTable.number);

    if (restaurant?.status === 'booking_closed' || status !== 'free' || table.zone?.isClosed || isLocationClosed(selectedLocationKey)) {
      window.setTimeout(() => {
        setTableNotice(createTableNotice(table, table.zone?.isClosed || isLocationClosed(selectedLocationKey) ? 'closed' : status));
      }, 220);
      return;
    }

    setTableNotice(null);

    window.setTimeout(() => {
      selectTable(table);
    }, 650);
  }

  async function revalidateSelectedTableBeforeSubmit() {
    if (!selectedTable) return false;

    try {
      const [statusesResponse, mapResponse, restaurantResponse] = await Promise.all([
        bookingsApi.tableStatuses({
          bookingDate: date,
          bookingTime: time,
          durationMinutes,
        }),
        mapApi.get(),
        restaurantApi.get(),
      ]);

      const statusesPayload = (statusesResponse as any)?.data || statusesResponse;
      const freshStatuses = statusesPayload?.statuses || {};
      const freshMap = getMapFromResponse(mapResponse);
      const freshRestaurant = getRestaurantFromResponse(restaurantResponse);
      const tableNumber = String(selectedTable.tableNumber);
      const runtime = freshStatuses[tableNumber] as TableRuntimeStatus | undefined;
      const freshTable = (freshMap?.tables || []).find(
        (table) => String(table.tableNumber) === tableNumber,
      );
      const locationClosed =
        findLocationZone(freshMap?.zones || [], selectedLocationKey)?.isClosed === true;

      setDateStatuses(freshStatuses);
      if (freshMap) setMap(freshMap);
      if (freshRestaurant) setRestaurant(freshRestaurant);

      let freshStatus: TableStatus = 'free';

      if (
        freshRestaurant?.status === 'closed' ||
        freshRestaurant?.status === 'booking_closed' ||
        locationClosed ||
        freshTable?.zone?.isClosed
      ) {
        freshStatus = 'closed';
      } else if (runtime?.status) {
        freshStatus = normalizeTableStatus(runtime.status);
      } else {
        const physicalStatus = normalizeTableStatus(freshTable?.status);

        if (
          physicalStatus === 'closed' ||
          physicalStatus === 'occupied' ||
          physicalStatus === 'cleaning'
        ) {
          freshStatus = physicalStatus;
        }
      }

      if (freshStatus !== 'free') {
        const conflict = runtime?.conflict;

        setTableNotice({
          tableNumber,
          status: freshStatus,
          bookedFrom: conflict?.bookedFromLabel || time,
          bookedTo: conflict?.bookedToLabel || bookingEndTime,
          availableFrom: conflict?.availableFromLabel || availableAfterCleanup,
        });
        setActiveTableNumber(Number(tableNumber));
        setStep('map');
        alert(`Стіл №${tableNumber} вже недоступний. Оберіть інший стіл або час.`);
        return false;
      }

      return true;
    } catch {
      alert('Не вдалося повторно перевірити доступність столу. Спробуйте ще раз.');
      return false;
    }
  }

  async function submit() {
    if (!selectedTable) return;

    const bookingGuestDeviceId = guestDeviceId || getGuestDeviceId();
    if (!bookingGuestDeviceId) {
      alert('Не вдалося створити ідентифікатор пристрою. Спробуйте ще раз.');
      return;
    }

    const tableIsStillAvailable = await revalidateSelectedTableBeforeSubmit();
    if (!tableIsStillAvailable) return;

    const wishesWithTime = [
      `Час відпочинку: ${formatDuration(durationMinutes)} (${bookingPeriod})`,
      `Підготовка столу після гостей: ${CLEANUP_MINUTES} хв, наступний гість з ${availableAfterCleanup}`,
      form.wishes.trim(),
    ]
      .filter(Boolean)
      .join('\n');

    const result = await run(() =>
      bookingsApi.create({
        tableId: selectedTable.id,
        tableNumber: String(selectedTable.tableNumber),
        seats: selectedTable.seats,
        fullName: form.fullName,
        phone: form.phone,
        guestDeviceId: bookingGuestDeviceId,
        bookingDate: date,
        bookingTime: time,
        guestsCount: Number(form.guestsCount),
        durationMinutes,
        wishes: wishesWithTime,
      }),
    );

    if (result) {
      const booking = {
        bookingId: result.bookingId,
        token: result.guestAccessToken,
        createdAt: new Date().toISOString(),
      };
      saveGuestBooking(booking);
      setGuestBookings(readStoredGuestBookings());
      setLastBookingId(result.bookingId);
      setBookingStatus(null);
      setWaiterCallStatus(null);
      setWaiterCallMessage(null);
      refreshMap();
      refreshDateStatuses();
      setStep('success');
    }
  }

  if (restaurant?.status === 'closed') {
    return (
      <div className={`molo-mode-${siteMode} flex min-h-[100dvh] items-center justify-center bg-black px-4 text-white`}>
        <section className="molo-panel rounded-[34px] border border-white/10 bg-white/5 p-6 text-center shadow-2xl backdrop-blur-xl">
          <h1 className="text-2xl font-semibold">Ресторан зачинений</h1>
          <p className="mt-3 text-neutral-300">{restaurant.closeMessage}</p>
        </section>
      </div>
    );
  }

  return (
    <div className={`molo-mode-${siteMode} min-h-[100dvh] bg-black text-white`}>
      <style>
        {`
          @keyframes moloFadeIn {
            from { opacity: 0; transform: translateY(10px) scale(0.985); filter: blur(5px); }
            to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
          }

          @keyframes moloPanelUp {
            from { opacity: 0; transform: translateY(28px) scale(0.98); filter: blur(6px); }
            to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
          }

          @keyframes moloBgZoom {
            from { opacity: 0.72; transform: scale(1.015); }
            to { opacity: 1; transform: scale(1); }
          }

          @keyframes moloLogoPop {
            from { opacity: 0; transform: translateY(-10px) scale(0.9); filter: blur(5px); }
            to { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
          }

          .molo-screen { animation: moloFadeIn 420ms ease-out both; }
          .molo-panel { animation: moloPanelUp 520ms cubic-bezier(0.16, 1, 0.3, 1) both; }
          .molo-bg { animation: moloBgZoom 900ms ease-out both; transform-origin: center; }
          .molo-logo { animation: moloLogoPop 650ms cubic-bezier(0.16, 1, 0.3, 1) both; }

          .molo-button {
            transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease, background 180ms ease, opacity 180ms ease;
          }
          .molo-button:active { transform: scale(0.96); }
          .molo-button:hover {
            border-color: rgba(253, 230, 138, 1);
            box-shadow: 0 0 42px rgba(251, 191, 36, 0.2);
            background: rgba(0, 0, 0, 0.18);
          }

          .molo-svg-map,
          .molo-svg-map * {
            outline: none;
            -webkit-tap-highlight-color: transparent;
            -webkit-touch-callout: none;
            user-select: none;
          }

          .molo-svg-hit {
            touch-action: manipulation;
          }

          .molo-mode-day .molo-bg {
            filter: brightness(1.18) saturate(1.03) contrast(0.96);
          }

          .molo-mode-night .molo-bg {
            filter: brightness(0.82) saturate(0.95) contrast(1.04);
          }

          .molo-mode-holiday .molo-bg {
            filter: brightness(0.94) saturate(1.18) contrast(1.06);
          }

          .molo-mode-overlay {
            background: linear-gradient(to bottom, rgba(0,0,0,.25), rgba(0,0,0,.25), rgba(0,0,0,.8));
          }

          .molo-mode-day .molo-mode-overlay {
            background:
              linear-gradient(to bottom, rgba(255,244,214,.08), rgba(65,35,10,.08), rgba(28,16,5,.72));
          }

          .molo-mode-holiday .molo-mode-overlay {
            background:
              radial-gradient(circle at 50% 8%, rgba(253,230,138,.18), transparent 34%),
              linear-gradient(to bottom, rgba(88,12,25,.14), rgba(0,0,0,.22), rgba(38,8,13,.84));
          }

          .molo-holiday-lights {
            position: fixed;
            inset: 0 0 auto 0;
            z-index: 75;
            pointer-events: none;
            height: 18px;
            background:
              radial-gradient(circle at 3% 50%, #fde68a 0 4px, transparent 5px),
              radial-gradient(circle at 10% 50%, #fb7185 0 4px, transparent 5px),
              radial-gradient(circle at 17% 50%, #86efac 0 4px, transparent 5px),
              radial-gradient(circle at 24% 50%, #fde68a 0 4px, transparent 5px);
            background-size: 28% 18px;
            filter: drop-shadow(0 0 8px rgba(253,230,138,.85));
            opacity: .95;
          }

          .molo-site-mode-badge {
            border: 1px solid rgba(253,230,138,.45);
            background: rgba(0,0,0,.28);
            box-shadow: 0 0 28px rgba(251,191,36,.14);
          }
        `}
      </style>

      {siteMode === 'holiday' && <div className="molo-holiday-lights" aria-hidden="true" />}

      {step !== 'home' && (
        <div className="fixed left-4 top-4 z-[80]">
          <button
            onClick={goBack}
            className="molo-button inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-black/30 px-4 py-2 text-sm text-amber-100 shadow-xl backdrop-blur-md"
          >
            <ArrowLeft className="h-4 w-4" />
            Назад
          </button>
        </div>
      )}

      {(activeMyBookings.length > 0 || unreadNotificationBookings.length > 0 || completedReviewAccess) && (
        <aside
          className={`fixed left-1/2 z-[95] w-[calc(100%-24px)] max-w-md -translate-x-1/2 ${
            step === 'home' ? 'top-3' : 'top-16'
          }`}
          aria-live="polite"
        >
          <div className="rounded-[24px] border border-amber-200/45 bg-neutral-950/95 p-3 shadow-2xl backdrop-blur-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-black text-white">
                  Ваша заявка
                  {activeBookingTableNumber ? ` · Стіл №${activeBookingTableNumber}` : ''}
                </p>
                <p
                  className={`mt-1 text-xs font-semibold ${
                    pendingTooLong
                      ? 'text-amber-100'
                      : bookingStatus?.status === 'approved'
                        ? 'text-emerald-200'
                        : 'text-sky-200'
                  }`}
                >
                  {activeBookingStatusText}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowMyBookings(true)}
                className="shrink-0 rounded-2xl border border-amber-200/55 bg-amber-300/15 px-3 py-2 text-xs font-black text-amber-100 transition active:scale-95"
              >
                Мої бронювання
              </button>
            </div>

            {pendingTooLong && (
              <button
                type="button"
                onClick={callAdmin}
                className="mt-3 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-4 py-3 text-sm font-black text-amber-100 transition active:scale-[0.98]"
              >
                Зателефонувати Адміністратору
              </button>
            )}
          </div>
        </aside>
      )}

      {step === 'home' && (
        <section className="molo-screen fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-black">
          <img
            src="/hero-bg.jpg"
            alt="MOLO"
            className="molo-bg absolute inset-0 h-full w-full object-cover opacity-85"
            draggable={false}
          />

          <div className="molo-mode-overlay absolute inset-0" />

          <div className="relative flex h-[100dvh] w-full flex-col items-center justify-center px-4 pb-[112px] pt-6 text-center">
            <img
              src="/logo.png"
              alt="MOLO"
              className="molo-logo mx-auto h-64 w-64 object-contain mix-blend-screen sm:h-80 sm:w-80"
              draggable={false}
            />

            <div className="molo-panel w-full">
              <p className="mt-2 text-sm uppercase tracking-[0.55em] text-amber-100/75">
                Restaurant
              </p>

              <div className="molo-site-mode-badge mx-auto mt-3 w-fit rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-100/90">
                {siteMode === 'day'
                  ? 'Денний режим'
                  : siteMode === 'holiday'
                    ? 'Святковий режим ✨'
                    : 'Нічний режим'}
              </div>

              <h1 className="mt-3 text-6xl font-light tracking-[0.24em] text-white sm:text-7xl">
                MOLO
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-xl leading-snug text-white/90 sm:text-3xl">
                Бронювання столиків, меню та звʼязок з адміністратором.
              </p>

              <div className="mx-auto mt-8 grid w-full max-w-2xl gap-4">
                <GoldButton onClick={() => setStep('location_choice')}>
                  Забронювати столик
                </GoldButton>

                <button
                  onClick={openMenu}
                  className="molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-2xl"
                >
                  <Menu className="h-7 w-7 text-amber-200" />
                  Menu
                </button>

                <button
                  onClick={callAdmin}
                  className="molo-button inline-flex items-center justify-center gap-4 rounded-[26px] border border-amber-200/95 bg-black/10 px-6 py-5 text-xl font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-2xl"
                >
                  <Phone className="h-7 w-7 text-amber-200" />
                  Зателефонувати адміністратору
                </button>
              </div>

              <p className="mt-6 text-base text-white/75 sm:text-xl">
                Ми працюємо з 10:00 до 23:00
              </p>
            </div>
          </div>
        </section>
      )}

      {step === 'location_choice' && (
        <section className="molo-screen fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-black text-white">
          <img
            src="/maps/territory-bg.png"
            alt="Вхід до ресторану MOLO"
            className="molo-bg absolute inset-0 h-full w-full object-cover opacity-95"
            draggable={false}
          />

          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/10 to-black/80" />

          <button
            aria-label="Зал ресторану"
            onClick={() => openLocation('hall')}
            className="absolute left-[38%] top-[23%] h-[42%] w-[34%] rounded-[32px] border border-amber-200/0 bg-amber-300/0 transition active:scale-[0.99]"
          />

          <button
            aria-label="Набережна ресторану"
            onClick={() => setStep('waterfront_choice')}
            className="absolute left-[0%] top-[25%] h-[44%] w-[36%] rounded-[32px] border border-amber-200/0 bg-amber-300/0 transition active:scale-[0.99]"
          />

          <div className="relative flex h-[100dvh] w-full items-end px-4 pb-[92px] pt-20 text-center">
            <div className="molo-panel w-full">
              <p className="text-xs uppercase tracking-[0.4em] text-amber-100/80">
                MOLO
              </p>

              <h1 className="mx-auto mt-3 max-w-[520px] text-2xl font-black leading-tight text-white sm:text-3xl">
                Раді вітати вас у ресторані MOLO
              </h1>

              <p className="mx-auto mt-3 max-w-[520px] text-sm leading-snug text-white/85 sm:text-base">
                Оберіть локацію, у якій бажаєте забронювати стіл
              </p>

              <div className="mx-auto mt-5 grid w-full max-w-[560px] gap-3">
                <button
                  onClick={() => openLocation('hall')}
                  className="molo-button rounded-[24px] border border-amber-200/95 bg-black/10 px-5 py-4 text-lg font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.14)] backdrop-blur-sm sm:text-xl"
                >
                  Зал ресторану
                </button>

                <button
                  onClick={() => setStep('waterfront_choice')}
                  className="molo-button rounded-[24px] border border-amber-200/95 bg-black/10 px-5 py-4 text-lg font-semibold text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.14)] backdrop-blur-sm sm:text-xl"
                >
                  Набережна ресторану
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 'waterfront_choice' && (
        <section className="molo-screen fixed inset-0 z-40 h-[100dvh] w-screen overflow-hidden bg-black text-white">
          <img
            src="/maps/waterfront-bg.png"
            alt="Набережна ресторану MOLO"
            className="molo-bg absolute inset-0 h-full w-full object-cover opacity-95"
            draggable={false}
          />

          <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/15 to-black/88" />

          <div className="relative flex h-[100dvh] w-full items-end px-4 pb-[92px] pt-20 text-center">
            <div className="molo-panel w-full">
              <p className="text-xs uppercase tracking-[0.4em] text-amber-100/80">
                Набережна ресторану
              </p>

              <h1 className="mx-auto mt-3 max-w-[520px] text-2xl font-black leading-tight text-white sm:text-3xl">
                Оберіть локацію на набережній
              </h1>

              <div className="mx-auto mt-5 grid w-full max-w-[680px] grid-cols-2 gap-3">
                {LOCATIONS.filter((location) => WATERFRONT_LOCATION_KEYS.includes(location.key)).map((location) => (
                  <button
                    key={location.key}
                    onClick={() => openLocation(location.key)}
                    className="molo-button rounded-[22px] border border-amber-200/90 bg-black/10 px-4 py-4 text-base font-semibold text-amber-100 shadow-[0_0_28px_rgba(251,191,36,.12)] backdrop-blur-sm sm:text-lg"
                  >
                    {location.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {step === 'map' && (
        <section className="molo-screen min-h-[100dvh] bg-black px-3 pt-16 pb-[104px] text-white sm:px-4 sm:py-20 sm:pb-[120px]">
          <div className="molo-panel mx-auto max-w-6xl">
            <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-amber-100/75 sm:text-sm sm:tracking-[0.28em]">
                  {currentLocation.description}
                </p>

                <h1 className="mt-1 text-2xl font-black tracking-tight sm:mt-2 sm:text-4xl">
                  Оберіть стіл
                </h1>

                <p className="mt-1 text-sm text-white/70 sm:mt-2 sm:text-base">
                  Оберіть дату, час і натисніть на стіл прямо на фото.
                </p>
              </div>

              <button
                onClick={refreshMap}
                className="molo-button hidden rounded-full border border-amber-200/60 bg-black/20 px-4 py-2 text-sm text-amber-100 sm:inline-flex"
              >
                Оновити
              </button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 sm:mb-4 sm:gap-3">
              <label className="rounded-2xl border border-amber-200/35 bg-black/20 px-3 py-2.5 sm:px-4 sm:py-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/55 sm:gap-2 sm:text-xs sm:tracking-[0.18em]">
                  <CalendarDays className="h-4 w-4" />
                  Дата
                </span>

                <input
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  type="date"
                  className="mt-1.5 w-full bg-transparent text-[13px] outline-none sm:mt-2 sm:text-sm"
                />
              </label>

              <label className="rounded-2xl border border-amber-200/35 bg-black/20 px-3 py-2.5 sm:px-4 sm:py-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/55 sm:gap-2 sm:text-xs sm:tracking-[0.18em]">
                  <Clock className="h-4 w-4" />
                  Час приходу
                </span>

                <input
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  type="time"
                  step="300"
                  className="mt-1.5 w-full bg-transparent text-[13px] outline-none sm:mt-2 sm:text-sm"
                />
              </label>
            </div>

            <div className="mb-3 rounded-[22px] border border-amber-200/35 bg-black/25 p-3 shadow-[0_0_34px_rgba(251,191,36,.08)] sm:mb-4 sm:rounded-[28px] sm:p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/55 sm:gap-2 sm:text-xs sm:tracking-[0.18em]">
                    <Clock className="h-4 w-4" />
                    Час відпочинку
                  </p>

                  <p className="mt-1.5 text-xl font-semibold text-amber-100 sm:mt-2 sm:text-2xl">
                    Ваш час: {bookingPeriod}
                  </p>

                  <p className="mt-1 text-xs leading-snug text-white/60 sm:text-sm">
                    Відпочинок: {formatDuration(durationMinutes)} · підготовка столу {CLEANUP_MINUTES} хв · наступний гість з {availableAfterCleanup}
                  </p>
                </div>

                {durationMinutes > 180 && (
                  <span className="w-fit rounded-full border border-sky-300/50 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-100">
                    Довге бронювання
                  </span>
                )}
              </div>

              <div className="mt-4">
                {!isCustomDuration ? (
                  <button
                    type="button"
                    onClick={openCustomDuration}
                    className="molo-button rounded-2xl border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold text-white/80"
                  >
                    Свій час
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-3 rounded-2xl border border-sky-200/70 bg-sky-300/15 px-4 py-3 text-sky-100 shadow-[0_0_24px_rgba(56,189,248,.16)]">
                    <span className="text-sm font-semibold">Свій час</span>
                    <input
                      value={customDurationHours}
                      onChange={(event) => updateCustomDuration(event.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label="Кількість годин"
                      className="w-12 rounded-xl border border-sky-100/30 bg-black/20 px-2 py-1 text-center text-base font-bold outline-none"
                      placeholder="3"
                    />
                    <span className="text-sm font-semibold">годин</span>
                  </div>
                )}
              </div>
            </div>

            {restaurant?.status === 'booking_closed' && (
              <div className="mb-4 rounded-2xl border border-amber-200/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                {restaurant.bookingClosedMessage}
              </div>
            )}

            {tableNotice && (
              <div className="mb-4 rounded-[28px] border border-amber-200/35 bg-black/55 p-4 text-white shadow-[0_0_34px_rgba(251,191,36,.08)] sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.22em] text-amber-100/55">
                      Стіл недоступний
                    </p>

                    <h2 className="mt-1 text-2xl font-semibold text-amber-100">
                      Стіл №{tableNotice.tableNumber} зайнятий
                    </h2>
                  </div>

                  <span className="w-fit rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70">
                    {STATUS_TEXT[tableNotice.status]}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                      Заброньовано
                    </p>

                    <p className="mt-1 text-2xl font-semibold text-white">
                      {tableNotice.bookedFrom} — {tableNotice.bookedTo}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-emerald-200/20 bg-emerald-400/10 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-100/55">
                      Вільний з
                    </p>

                    <p className="mt-1 text-2xl font-semibold text-emerald-100">
                      {tableNotice.availableFrom}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={closeTableNotice}
                    className="rounded-2xl border border-amber-200/55 bg-amber-300/15 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-300/20"
                  >
                    Змінити час
                  </button>

                  <button
                    type="button"
                    onClick={closeTableNotice}
                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white/75 transition hover:bg-white/10"
                  >
                    Обрати інший стіл
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-[22px] border border-amber-200/30 bg-black/60 p-1 sm:rounded-[30px] sm:p-2">
              <div className="relative mx-auto w-full overflow-hidden rounded-[18px] sm:rounded-[24px]">
                <img
                  src={currentLocation.background}
                  alt={currentLocation.label}
                  className="block w-full rounded-[18px] object-contain sm:rounded-[24px]"
                  draggable={false}
                />

                <svg
                  className="molo-svg-map absolute inset-0 z-50 h-full w-full"
                  viewBox={`0 0 ${currentLocation.width} ${currentLocation.height}`}
                  preserveAspectRatio="none"
                >

                  {currentLocation.tables.map((visualTable) => {
                    const status = getVisualTableStatus(visualTable.number);
                    const isActive = activeTableNumber === visualTable.number;
                    const color = getTableNeonColor(status, isActive);
                    const shouldShowVisibleNeon = isActive || status !== 'free';

                    return (
                      <g key={`svg-table-${visualTable.number}`}>
                        {shouldShowVisibleNeon && (
                          <VisibleContour
                            shape={visualTable.shape}
                            color={color}
                          />
                        )}

                        <ClickZone table={visualTable} onPick={selectVisualTable} />
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            <div className="mt-5 hidden rounded-[28px] border border-amber-200/30 bg-black/30 p-4 sm:block">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Статуси столів</h2>

                <div className="flex flex-wrap gap-2 text-[11px] text-white/65">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full border border-neutral-400 bg-white" />
                    Вільний
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#38bdf8]" />
                    Очікує
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#fb923c]" />
                    Заброньований
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff3b4f]" />
                    Зайнятий
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#67e8f9]" />
                    Готується
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#bdbdbd]" />
                    Закритий
                  </span>
                </div>
              </div>

              <p className="rounded-2xl border border-dashed border-amber-200/30 bg-black/30 p-4 text-sm text-white/60">
                Вільні столи не світяться постійно. Контур зʼявляється при виборі або коли стіл має статус.
              </p>
            </div>
          </div>
        </section>
      )}

      {step === 'form' && selectedTable && (
        <section className="molo-screen flex min-h-[100dvh] items-center justify-center bg-black px-4 py-20 pb-[120px] text-white">
          <div className="molo-panel w-full max-w-2xl rounded-[32px] border border-amber-200/35 bg-black/35 p-6 shadow-2xl backdrop-blur-md">
            <h1 className="text-2xl font-semibold">
              Стіл №{selectedTable.tableNumber}
            </h1>

            <p className="mt-1 text-sm text-white/70 sm:mt-2 sm:text-base">
              до {selectedTable.seats} гостей · {date}
            </p>

            <div className="mt-5 rounded-[26px] border border-amber-200/30 bg-amber-300/10 p-4">
              <p className="text-sm uppercase tracking-[0.18em] text-amber-100/70">
                Стіл доступний
              </p>

              <p className="mt-1.5 text-xl font-semibold text-amber-100 sm:mt-2 sm:text-2xl">
                Ваш час: {bookingPeriod}
              </p>

              <p className="mt-1 text-sm text-white/70">
                Відпочинок: {formatDuration(durationMinutes)} · наступний гість з {availableAfterCleanup}
              </p>
            </div>

            <div className="mt-6 grid gap-4">
              <input
                placeholder="Ваше імʼя"
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                className="w-full rounded-2xl border border-amber-200/35 bg-white/5 px-4 py-3 outline-none"
              />

              <input
                placeholder="Телефон"
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                className="w-full rounded-2xl border border-amber-200/35 bg-white/5 px-4 py-3 outline-none"
              />

              <label className="rounded-2xl border border-amber-200/35 bg-white/5 px-4 py-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/55 sm:gap-2 sm:text-xs sm:tracking-[0.18em]">
                  <Users className="h-4 w-4" />
                  Кількість гостей
                </span>

                <input
                  value={form.guestsCount}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      guestsCount: Number(event.target.value),
                    })
                  }
                  min={1}
                  type="number"
                  className="mt-2 w-full bg-transparent outline-none"
                />
              </label>

              <textarea
                placeholder="Побажання"
                value={form.wishes}
                onChange={(event) => setForm({ ...form, wishes: event.target.value })}
                className="min-h-24 w-full rounded-2xl border border-amber-200/35 bg-white/5 px-4 py-3 outline-none"
              />

              {error && <p className="text-sm text-red-300">{error}</p>}

              <GoldButton onClick={submit} disabled={loading}>
                {loading ? 'Надсилаємо...' : 'Надіслати заявку'}
              </GoldButton>
            </div>
          </div>
        </section>
      )}

      {showMyBookings && (
        <div className="fixed inset-0 z-[110] flex items-end bg-black/70" role="dialog" aria-modal="true" aria-label="Мої бронювання">
          <button type="button" className="absolute inset-0" aria-label="Закрити мої бронювання" onClick={() => setShowMyBookings(false)} />
          <section className="relative max-h-[82dvh] w-full overflow-y-auto rounded-t-[32px] border border-amber-200/45 bg-neutral-950 p-5 pb-8 shadow-[0_-8px_35px_rgba(251,191,36,.2)]">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-amber-100/60" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-amber-100">Мої бронювання</h2>
                <p className="mt-1 text-sm text-white/75">
                  {activeMyBookings.length === 0
                    ? 'У вас немає активних бронювань'
                    : activeMyBookings.length === 1
                      ? 'У вас 1 активне бронювання'
                      : `У вас ${activeMyBookings.length} активних бронювань`}
                </p>
              </div>
              <button type="button" onClick={() => setShowMyBookings(false)} className="rounded-xl border border-amber-200/45 px-3 py-2 text-sm font-bold text-amber-100">Закрити</button>
            </div>

            <div className="mt-5 space-y-3">
              {myBookingCards.map(({ booking, access }) => (
                <article key={booking.bookingId} className="rounded-2xl border border-amber-200/45 bg-amber-300/10 p-4 shadow-[0_0_22px_rgba(251,191,36,.24)]">
                  <p className="font-bold text-white">{booking.bookingDate} · {booking.bookingTime} · Стіл №{booking.tableNumber || '—'}</p>
                  <p className="mt-1 text-xs text-white/70">
                    {booking.status === 'approved'
                      ? 'Бронювання підтверджено'
                      : booking.status === 'cancelled'
                        ? 'Бронювання скасовано'
                        : 'Очікує підтвердження'}
                  </p>
                  {booking.status === 'cancelled' &&
                    booking.guestNotification &&
                    !booking.guestNotification.acknowledgedAt && (
                      <div className="mt-3 rounded-2xl border border-red-200/35 bg-red-300/10 p-3 text-left">
                        <p className="font-bold text-red-100">
                          {booking.guestNotification.title || 'Повідомлення про бронювання'}
                        </p>
                        {booking.guestNotification.message && (
                          <p className="mt-1 text-sm text-white/75">
                            {booking.guestNotification.message}
                          </p>
                        )}
                        {access && (
                          <button
                            type="button"
                            disabled={guestActionBusy}
                            onClick={() => {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) =>
                                  bookingsApi.guestAcknowledgeNotification(
                                    booking.bookingId,
                                    token,
                                  ),
                              );
                            }}
                            className="mt-3 rounded-xl border border-amber-200/60 bg-amber-300/20 px-3 py-2 text-sm font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)] disabled:opacity-50"
                          >
                            Ознайомився
                          </button>
                        )}
                      </div>
                    )}
                  {access && booking.status !== 'cancelled' && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {booking.canReportLateness && (
                        <button
                          type="button"
                          disabled={guestActionBusy || !booking.isLatenessPromptDue}
                          onClick={() => {
                            const minutes = Number(window.prompt('На скільки хвилин ви запізнюєтеся?', '15'));
                            if (Number.isInteger(minutes) && minutes > 0 && minutes <= 720) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestLateness(
                                  booking.bookingId,
                                  token,
                                  Math.floor(minutes / 60),
                                  minutes % 60,
                                ),
                              );
                            }
                          }}
                          className="rounded-xl border border-amber-200/60 bg-amber-300/20 px-3 py-2 text-sm font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)] disabled:opacity-45"
                        >
                          {booking.isLatenessPromptDue
                            ? 'Повідомити про запізнення'
                            : `Запізнююсь — доступно після ${String(booking.bookingTime).slice(0, 5)}`}
                        </button>
                      )}
                      {booking.canGuestChangeTime && (
                        <button
                          type="button"
                          disabled={guestActionBusy}
                          onClick={() => {
                            const requestedTime = window.prompt(
                              'Вкажіть новий час у форматі ГГ:ХХ',
                              String(booking.bookingTime).slice(0, 5),
                            );
                            if (requestedTime?.trim()) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestChangeTime(
                                  booking.bookingId,
                                  token,
                                  {
                                    requestedDate: booking.bookingDate,
                                    requestedTime: requestedTime.trim(),
                                  },
                                ),
                              );
                            }
                          }}
                          className="rounded-xl border border-amber-200/60 bg-amber-300/20 px-3 py-2 text-sm font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)] disabled:opacity-50"
                        >
                          Змінити час
                        </button>
                      )}
                      {booking.canGuestCancel && (
                        <button
                          type="button"
                          disabled={guestActionBusy}
                          onClick={() => {
                            if (window.confirm('Скасувати це бронювання?')) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestCancel(booking.bookingId, token),
                              );
                            }
                          }}
                          className="rounded-xl border border-amber-200/60 bg-amber-300/20 px-3 py-2 text-sm font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)] disabled:opacity-50"
                        >
                          Скасувати бронювання
                        </button>
                      )}
                      {booking.canGuestChangeTable && (
                        <button
                          type="button"
                          disabled={guestActionBusy}
                          onClick={() => {
                            const tableNumber = window.prompt('Вкажіть номер нового столу');
                            if (tableNumber?.trim()) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestChangeTable(
                                  booking.bookingId,
                                  token,
                                  { tableNumber: tableNumber.trim() },
                                ),
                              );
                            }
                          }}
                          className="rounded-xl border border-amber-200/60 bg-amber-300/20 px-3 py-2 text-sm font-bold text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.28)] disabled:opacity-50"
                        >
                          Змінити стіл
                        </button>
                      )}
                      {booking.canLeaveReview && (
                        <button
                          type="button"
                          disabled={guestActionBusy}
                          onClick={() => {
                            const text = window.prompt('Поділіться враженнями від візиту');
                            if (text?.trim()) {
                              void runGuestAction(
                                booking.bookingId,
                                access.token,
                                (token) => bookingsApi.guestReview(
                                  booking.bookingId,
                                  token,
                                  { text: text.trim() },
                                ),
                              ).then((result) => {
                                if (result?.askExternalReview) {
                                  setLastBookingId(booking.bookingId);
                                  try {
                                    setShowExternalReviewOffer(
                                      window.sessionStorage.getItem(
                                        `${EXTERNAL_REVIEW_SESSION_KEY_PREFIX}${booking.bookingId}`,
                                      ) !== 'true',
                                    );
                                  } catch {
                                    setShowExternalReviewOffer(true);
                                  }
                                }
                              });
                            }
                          }}
                          className="rounded-xl border border-emerald-200/35 bg-emerald-300/10 px-3 py-2 text-sm font-bold text-emerald-100 disabled:opacity-50"
                        >
                          Залишити відгук
                        </button>
                      )}
                    </div>
                  )}
                  {booking.status === 'approved' && <div className="mt-4"><GuestHookahCallPanel bookingId={booking.bookingId} /></div>}
                </article>
              ))}
            </div>
            {completedReviewBooking && completedReviewAccess && (
              <section className="mt-5 rounded-2xl border border-amber-200/45 bg-amber-300/10 p-4 text-left shadow-[0_0_22px_rgba(251,191,36,.24)]">
                <p className="font-bold text-amber-100">Залиште відгук про ваш відпочинок у MOLO</p>
                <button type="button" disabled={guestActionBusy} onClick={() => {
                  const text = window.prompt('Поділіться враженнями від візиту');
                  if (text?.trim()) void runGuestAction(completedReviewBooking.bookingId, completedReviewAccess.token, (token) => bookingsApi.guestReview(completedReviewBooking.bookingId, token, { text: text.trim() })).then((result) => {
                    if (!result?.askExternalReview) return;
                    setLastBookingId(completedReviewBooking.bookingId);
                    try {
                      setShowExternalReviewOffer(
                        window.sessionStorage.getItem(`${EXTERNAL_REVIEW_SESSION_KEY_PREFIX}${completedReviewBooking.bookingId}`) !== 'true',
                      );
                    } catch {
                      setShowExternalReviewOffer(true);
                    }
                  });
                }} className="mt-3 rounded-xl border border-emerald-200/35 bg-emerald-300/10 px-3 py-2 text-sm font-bold text-emerald-100 disabled:opacity-50">Залишити відгук</button>
              </section>
            )}
            {showExternalReviewOffer && activeGuestBooking && (
              <section className="mt-4 rounded-2xl border border-amber-200/35 bg-amber-300/10 p-4 text-left text-sm text-amber-50">
                <p className="font-semibold">Сподобався візит?</p>
                <p className="mt-1 text-white/70">Залиште публічний відгук про MOLO — це допоможе нам стати кращими.</p>
                <a href={MOLO_PUBLIC_REVIEW_URL} target="_blank" rel="noreferrer" onClick={openExternalReview} className="mt-3 inline-flex rounded-xl border border-amber-200/55 px-3 py-2 text-xs font-bold text-amber-100">Залишити публічний відгук</a>
              </section>
            )}
            {guestActionMessage && <p className="mt-3 text-xs text-white/70">{guestActionMessage}</p>}
          </section>
        </div>
      )}

      {step === 'success' && (
        <section className="molo-screen flex min-h-[100dvh] items-center justify-center bg-black px-4 py-20 pb-[120px] text-center text-white">
          <div className="molo-panel w-full max-w-2xl rounded-[32px] border border-emerald-400/25 bg-emerald-950/40 p-6 shadow-2xl backdrop-blur-xl">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-400" />

            <h1 className="text-2xl font-semibold">Заявку надіслано</h1>

            <p className="mt-3 text-white/70">
              Адміністратор отримає заявку та підтвердить бронювання. У заявці буде ваш час {activeBookingPeriod}.
            </p>

            <div className="mt-5 rounded-[26px] border border-white/10 bg-black/25 p-4 text-left">
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">Статус заявки</p>

              {!bookingStatus && (
                <p className="mt-2 text-sm text-white/65">Очікуємо відповідь адміністратора...</p>
              )}

              {bookingStatus?.status === 'pending' && !pendingTooLong && (
                <p className="mt-2 text-sm text-sky-100">
                  Заявка очікує підтвердження. Минуло приблизно {bookingStatus.pendingAgeMinutes} хв.
                </p>
              )}

              {bookingStatus?.status === 'pending' && pendingTooLong && (
                <div className="mt-3 rounded-2xl border border-amber-200/35 bg-amber-300/10 p-4 text-center">
                  <p className="text-lg font-semibold text-amber-100">
                    Адміністратор ще не підтвердив бронювання
                  </p>
                  <p className="mt-2 text-sm text-white/70">
                    Заявка очікує вже {bookingStatus.pendingAgeMinutes} хв. Можна подзвонити адміністратору ресторану.
                  </p>
                  <button
                    type="button"
                    onClick={callAdmin}
                    className="mt-4 rounded-2xl border border-amber-200/60 bg-amber-300/20 px-5 py-3 text-sm font-bold text-amber-100 transition active:scale-95"
                  >
                    Зателефонувати Адміністратору
                  </button>
                </div>
              )}

              {bookingStatus?.status === 'approved' && (
                <div className="mt-3 rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4 text-center">
                  <p className="text-sm font-semibold text-emerald-100">Бронювання підтверджено ✅</p>

                  {!waiterCallStatus?.canCall && (
                    <p className="mt-2 text-xs text-white/55">
                      Кнопка виклику офіціанта зʼявиться після того, як адміністратор або офіціант відмітить: “Гість прийшов”.
                    </p>
                  )}

                  {waiterCallStatus?.canCall && !waiterCallStatus.activeCall && (
                    <button
                      type="button"
                      onClick={callWaiter}
                      disabled={waiterCallBusy}
                      className="mt-4 w-full rounded-2xl border border-amber-200/60 bg-amber-300/20 px-5 py-4 text-base font-black text-amber-100 transition active:scale-95 disabled:opacity-60"
                    >
                      {waiterCallBusy ? 'Відправляємо...' : '🔔 Викликати офіціанта'}
                    </button>
                  )}

                  {waiterCallStatus?.activeCall && (
                    <div className="mt-4 rounded-2xl border border-amber-200/35 bg-amber-300/10 p-4 text-amber-100">
                      <p className="font-bold">
                        {waiterCallStatus.activeCall.status === 'accepted'
                          ? 'Офіціант прийняв виклик'
                          : 'Виклик офіціанта відправлено'}
                      </p>
                      <p className="mt-1 text-xs text-white/60">
                        {waiterCallStatus.activeCall.waiterName
                          ? `Офіціант: ${waiterCallStatus.activeCall.waiterName}`
                          : 'Виклик у загальному списку офіціантів'}
                      </p>
                    </div>
                  )}

                  {waiterCallMessage && (
                    <p className="mt-3 text-xs text-amber-100">{waiterCallMessage}</p>
                  )}

                  {lastBookingId && (
                    <div className="mt-4">
                      <GuestHookahCallPanel bookingId={lastBookingId} />
                    </div>
                  )}
              
                </div>
              )}

              {(bookingStatus?.status === 'rejected' || bookingStatus?.status === 'cancelled') && (
                <p className="mt-2 text-sm text-red-100">На жаль, бронювання не підтверджено. Подзвоніть адміністратору.</p>
              )}

            </div>

            <div className="mt-6">
              <GoldButton onClick={() => setStep('home')}>
                На головну
              </GoldButton>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
