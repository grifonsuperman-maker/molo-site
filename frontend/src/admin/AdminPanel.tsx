import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { tablesApi } from '../api/tables';
import { zonesApi } from '../api/zones';
import type { Booking, FullMapResponse, Restaurant, SiteMode, TableItem, TableStatus, Zone } from '../api/types';

type Tab = 'dashboard' | 'bookings' | 'tables' | 'clients' | 'settings';
type BookingAction = 'approve' | 'reject' | 'cancel' | 'checkIn' | 'complete' | 'noShow' | 'prepareTable';
type TableAction = 'free' | 'occupied' | 'cleaning' | 'close' | 'open';
type AdminTable = TableItem & { isVirtual?: boolean };
type LocationKey = 'hall' | 'canopy' | 'gazebo' | 'rotang' | 'embankment' | 'glass_gazebo' | 'water_gazebo' | 'other';
type BookingView = 'locations' | 'all' | 'pending' | 'long_pending' | LocationKey;
type TableView = 'locations' | 'all' | LocationKey;

type LocationInfo = {
  key: LocationKey;
  label: string;
  description: string;
};

const LOCATIONS: LocationInfo[] = [
  { key: 'hall', label: 'Зал ресторану', description: 'Столи 1–14' },
  { key: 'canopy', label: 'Навіс', description: 'Столи 15–20' },
  { key: 'gazebo', label: 'Велика альтанка', description: 'Столи 21–36' },
  { key: 'rotang', label: 'Ротанг', description: 'Столи 37–39' },
  { key: 'embankment', label: 'Набережна', description: 'Столи 40–44' },
  { key: 'glass_gazebo', label: 'Скляна альтанка', description: 'Столи 45–50' },
  { key: 'water_gazebo', label: 'Альтанка на воді', description: 'Столи 100–109' },
  { key: 'other', label: 'Інші столи', description: 'Столи без локації' },
];

const ALL_TABLE_NUMBERS = [
  ...Array.from({ length: 14 }, (_, index) => index + 1),
  ...Array.from({ length: 6 }, (_, index) => index + 15),
  ...Array.from({ length: 16 }, (_, index) => index + 21),
  37,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  46,
  47,
  48,
  49,
  50,
  ...Array.from({ length: 10 }, (_, index) => index + 100),
];

const STATUS_LABELS: Record<string, string> = {
  pending: 'Очікує підтвердження',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  cancelled: 'Скасовано',
  completed: 'Завершено',
};

const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  free: 'Вільний',
  pending: 'Очікує',
  reserved: 'Заброньований',
  occupied: 'Зайнятий',
  cleaning: 'Готується',
  closed: 'Закритий',
};

const TABLE_STATUS_DOT: Record<TableStatus, string> = {
  free: 'bg-white',
  pending: 'bg-sky-400',
  reserved: 'bg-orange-400',
  occupied: 'bg-red-500',
  cleaning: 'bg-cyan-300',
  closed: 'bg-neutral-400',
};

const BOOKING_STATUS_STYLES: Record<string, string> = {
  pending: 'border-sky-300/35 bg-sky-400/10 text-sky-100',
  approved: 'border-orange-300/35 bg-orange-400/10 text-orange-100',
  rejected: 'border-red-300/35 bg-red-400/10 text-red-100',
  cancelled: 'border-neutral-400/25 bg-neutral-500/10 text-neutral-200',
  completed: 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100',
  no_show: 'border-red-300/45 bg-red-500/15 text-red-100',
};

const PENDING_REMINDER_MINUTES = 15;
const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);

function unwrapData<T>(value: T | { data?: T }): T {
  if (value && typeof value === 'object' && 'data' in value && (value as { data?: T }).data) {
    return (value as { data: T }).data;
  }

  return value as T;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '-';
  const [hours = '00', minutes = '00'] = String(value).split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return String(value);
  return `${day}.${month}.${year}`;
}

function normalizePhone(phone: string | null | undefined): string {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function splitLines(value: string | null | undefined): string[] {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();

  return lines.filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hourWord(hours: number): string {
  if (hours === 1) return 'година';
  if (hours >= 2 && hours <= 4) return 'години';
  return 'годин';
}

function durationLabel(minutes: number): string {
  if (!minutes || !Number.isFinite(minutes)) return '-';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0 && rest > 0) return `${hours} ${hourWord(hours)} ${rest} хв`;
  if (hours > 0) return `${hours} ${hourWord(hours)}`;
  return `${minutes} хв`;
}

function isNoShow(booking: Booking): boolean {
  return String(booking.wishes || '').includes('[NO_SHOW]');
}

function bookingAgeMinutes(booking: Booking): number {
  if (!booking.createdAt) return 0;
  const createdAt = new Date(booking.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - createdAt) / 60000));
}

function isPendingTooLong(booking: Booking): boolean {
  return booking.status === 'pending' && bookingAgeMinutes(booking) >= PENDING_REMINDER_MINUTES;
}

function bookingViewStatus(booking: Booking): string {
  if (isNoShow(booking)) return 'no_show';
  return booking.status;
}

function parseBookingDetails(booking: Booking) {
  const lines = uniqueLines(splitLines(booking.wishes));
  const durationLines = lines.filter((line) => /^Час відпочинку:/i.test(line));
  const cleanupLines = lines.filter((line) => /^Підготовка столу/i.test(line));

  const durationLine = durationLines[0] || '';
  const cleanupLine = cleanupLines[0] || '';

  const rangeMatch = durationLine.match(/\((\d{2}:\d{2})\s*[—-]\s*(\d{2}:\d{2})\)/);
  const durationMinutesMatch = durationLine.match(/Час відпочинку:\s*(\d+)\s*хв/i);
  const availableFromMatch = cleanupLine.match(/наступний гість з\s+(\d{2}:\d{2})/i);
  const durationMinutes = booking.durationMinutes || (durationMinutesMatch ? Number(durationMinutesMatch[1]) : 0);

  const durationText = durationLine
    .replace(/^Час відпочинку:\s*/i, '')
    .replace(/\s*\(.+\)\s*$/, '')
    .trim();

  const cleanupText = cleanupLine.replace(/^Підготовка столу після гостей:\s*/i, '').trim();

  const guestWishes = lines.filter(
    (line) =>
      !/^Час відпочинку:/i.test(line) &&
      !/^Підготовка столу/i.test(line) &&
      !line.includes('[NO_SHOW]'),
  );

  return {
    period: rangeMatch ? `${rangeMatch[1]} — ${rangeMatch[2]}` : `${formatTime(booking.bookingTime)} — -`,
    durationText: durationText || durationLabel(durationMinutes),
    cleanupText: cleanupText || '-',
    availableFrom: availableFromMatch?.[1] || '-',
    durationMinutes,
    guestWishes,
    isLong: Number(durationMinutes || 0) > 180,
  };
}

function bookingStatusLabel(booking: Booking): string {
  const status = bookingViewStatus(booking);
  if (status === 'no_show') return 'Гість не прийшов';
  return STATUS_LABELS[status] || status;
}

function tableStatusLabel(status: TableStatus): string {
  return TABLE_STATUS_LABELS[status] || status;
}

function bookingStatusClass(booking: Booking): string {
  return BOOKING_STATUS_STYLES[bookingViewStatus(booking)] || 'border-white/15 bg-white/5 text-white/80';
}

function statusOrder(status: TableStatus): number {
  return {
    pending: 1,
    reserved: 2,
    occupied: 3,
    cleaning: 4,
    closed: 5,
    free: 6,
  }[status];
}

function actionText(action: BookingAction): string {
  return {
    approve: 'Бронювання підтверджено',
    reject: 'Бронювання відхилено',
    cancel: 'Бронювання скасовано',
    checkIn: 'Гість прийшов, стіл зайнятий',
    complete: 'Бронювання завершено, стіл вільний',
    noShow: 'Гість не прийшов: бронь знято',
    prepareTable: 'Стіл відправлено на підготовку',
  }[action];
}

function tableNumberValue(booking: Booking): number {
  return Number(booking.table?.tableNumber || 0);
}

function getLocationKeyByTableNumber(value: number): LocationKey {
  if (value >= 1 && value <= 14) return 'hall';
  if (value >= 15 && value <= 20) return 'canopy';
  if (value >= 21 && value <= 36) return 'gazebo';
  if (value >= 37 && value <= 39) return 'rotang';
  if (value >= 40 && value <= 44) return 'embankment';
  if (value >= 45 && value <= 50) return 'glass_gazebo';
  if (value >= 100 && value <= 109) return 'water_gazebo';
  return 'other';
}

function getBookingLocationKey(booking: Booking): LocationKey {
  return getLocationKeyByTableNumber(tableNumberValue(booking));
}

function getTableLocationKey(table: TableItem): LocationKey {
  return getLocationKeyByTableNumber(Number(table.tableNumber || 0));
}

const LOCATION_ZONE_ALIASES: Record<LocationKey, string[]> = {
  hall: ['зал ресторану', 'зал', 'hall'],
  canopy: ['навіс', 'навес', 'canopy'],
  gazebo: ['велика альтанка', 'велика бесідка', 'большая беседка', 'gazebo'],
  rotang: ['ротанг', 'rotang'],
  embankment: ['набережна', 'набережная', 'embankment'],
  glass_gazebo: ['скляна альтанка', 'стеклянная беседка', 'glass gazebo'],
  water_gazebo: ['альтанка на воді', 'беседка на воде', 'water gazebo'],
  other: [],
};

function normalizeZoneName(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namedZoneForLocation(zones: Zone[], key: LocationKey) {
  const aliases = LOCATION_ZONE_ALIASES[key] || [];

  return (
    zones.find((zone) => {
      const normalized = normalizeZoneName(zone.name);
      return aliases.some((alias) => normalized.includes(normalizeZoneName(alias)));
    }) || null
  );
}

function linkedZoneForLocation(tables: TableItem[], zones: Zone[], key: LocationKey) {
  const counts = new Map<string, number>();

  tables
    .filter((table) => getTableLocationKey(table) === key)
    .forEach((table) => {
      const zoneId = table.zone?.id;
      if (!zoneId) return;
      counts.set(zoneId, (counts.get(zoneId) || 0) + 1);
    });

  const bestZoneId = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

  if (!bestZoneId) return null;
  return zones.find((zone) => zone.id === bestZoneId) || null;
}

function siteModeLabel(mode: SiteMode | undefined) {
  if (mode === 'day') return 'День';
  if (mode === 'holiday') return 'Свято';
  return 'Ніч';
}

function createVirtualAdminTable(tableNumber: number): AdminTable {
  return {
    id: `virtual-table-${tableNumber}`,
    tableNumber: String(tableNumber),
    seats: 4,
    status: 'free',
    isVisible: true,
    shape: 'rectangle',
    photoUrl: null,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    zone: null,
    isVirtual: true,
  } as AdminTable;
}

function sortBookings(a: Booking, b: Booking) {
  const timeCompare = String(a.bookingTime || '').localeCompare(String(b.bookingTime || ''));
  if (timeCompare !== 0) return timeCompare;
  return tableNumberValue(a) - tableNumberValue(b);
}

function isActiveBooking(booking: Booking) {
  return ACTIVE_BOOKING_STATUSES.has(booking.status) && !isNoShow(booking);
}

export default function AdminPanel({ settingsOnly = false }: { settingsOnly?: boolean }) {
  const [tab, setTab] = useState<Tab>(settingsOnly ? 'settings' : 'dashboard');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [fullMap, setFullMap] = useState<FullMapResponse | null>(null);
  const [closeMessage, setCloseMessage] = useState('Ресторан зараз зачинений. Ми працюємо з 10:00 до 23:00.');
  const [bookingClosedMessage, setBookingClosedMessage] = useState('');
  const [menuUrl, setMenuUrl] = useState('');
  const [siteMode, setSiteMode] = useState<SiteMode>('night');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [bookingsView, setBookingsView] = useState<BookingView>('locations');
  const [tableView, setTableView] = useState<TableView>('locations');

  async function load() {
    setLoading(true);
    setError(null);

    const [bookingsResult, restaurantResult, mapResult] = await Promise.allSettled([
      bookingsApi.getToday(),
      restaurantApi.get(),
      mapApi.get(),
    ]);

    if (bookingsResult.status === 'fulfilled') {
      setBookings(unwrapData<Booking[]>(bookingsResult.value));
    } else {
      setError(bookingsResult.reason?.message || 'Не вдалося завантажити бронювання');
    }

    if (restaurantResult.status === 'fulfilled') {
      const value = unwrapData<Restaurant>(restaurantResult.value);
      setRestaurant(value);
      if (value?.closeMessage) setCloseMessage(value.closeMessage);
      setBookingClosedMessage(value?.bookingClosedMessage || '');
      setMenuUrl(value?.menuUrl || '');
      setSiteMode(value?.siteMode || 'night');
    }

    if (mapResult.status === 'fulfilled') {
      setFullMap(unwrapData<FullMapResponse>(mapResult.value));
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const todayBookings = useMemo(() => [...bookings].sort(sortBookings), [bookings]);

  const activeBookings = useMemo(() => todayBookings.filter(isActiveBooking), [todayBookings]);

  const pendingReminders = useMemo(() => todayBookings.filter(isPendingTooLong), [todayBookings]);

  const stats = useMemo(() => {
    const pending = todayBookings.filter((booking) => booking.status === 'pending').length;
    const approved = todayBookings.filter((booking) => booking.status === 'approved').length;
    const completed = todayBookings.filter((booking) => booking.status === 'completed').length;
    const noShow = todayBookings.filter(isNoShow).length;
    const longBookings = todayBookings.filter((booking) => parseBookingDetails(booking).isLong).length;
    const pendingLong = pendingReminders.length;
    const guests = activeBookings.reduce((sum, booking) => sum + Number(booking.guestsCount || 0), 0);

    return {
      bookings: todayBookings.length,
      active: activeBookings.length,
      pending,
      pendingLong,
      approved,
      completed,
      noShow,
      longBookings,
      guests,
    };
  }, [todayBookings, activeBookings, pendingReminders]);

  const tables = useMemo<AdminTable[]>(() => {
    const byNumber = new Map<string, AdminTable>();

    (fullMap?.tables || []).forEach((table) => {
      byNumber.set(String(table.tableNumber), table as AdminTable);
    });

    ALL_TABLE_NUMBERS.forEach((tableNumber) => {
      const key = String(tableNumber);
      if (!byNumber.has(key)) {
        byNumber.set(key, createVirtualAdminTable(tableNumber));
      }
    });

    return Array.from(byNumber.values()).sort((a, b) => {
      const locationDiff =
        LOCATIONS.findIndex((location) => location.key === getTableLocationKey(a)) -
        LOCATIONS.findIndex((location) => location.key === getTableLocationKey(b));

      if (locationDiff !== 0) return locationDiff;
      return Number(a.tableNumber) - Number(b.tableNumber);
    });
  }, [fullMap]);

  const tableStats = useMemo(() => {
    const initial: Record<TableStatus, number> = { free: 0, pending: 0, reserved: 0, occupied: 0, cleaning: 0, closed: 0 };
    tables.forEach((table) => {
      initial[table.status] = (initial[table.status] || 0) + 1;
    });
    return initial;
  }, [tables]);

  const tableLocationStats = useMemo(() => {
    const initial = Object.fromEntries(
      LOCATIONS.map((location) => [
        location.key,
        { total: 0, occupied: 0, cleaning: 0, closed: 0, reserved: 0, pending: 0 },
      ]),
    ) as Record<LocationKey, { total: number; occupied: number; cleaning: number; closed: number; reserved: number; pending: number }>;

    tables.forEach((table) => {
      const key = getTableLocationKey(table);
      initial[key].total += 1;
      if (table.status === 'occupied') initial[key].occupied += 1;
      if (table.status === 'cleaning') initial[key].cleaning += 1;
      if (table.status === 'closed') initial[key].closed += 1;
      if (table.status === 'reserved') initial[key].reserved += 1;
      if (table.status === 'pending') initial[key].pending += 1;
    });

    return initial;
  }, [tables]);

  const locationZones = useMemo(() => {
    const zones = fullMap?.zones || [];
    const result = Object.fromEntries(
      LOCATIONS.map((location) => {
        const zone =
          linkedZoneForLocation(tables, zones, location.key) ||
          namedZoneForLocation(zones, location.key);

        return [location.key, zone];
      }),
    ) as Record<LocationKey, Zone | null>;

    return result;
  }, [fullMap, tables]);

  const selectedTableLocation = useMemo(
    () => LOCATIONS.find((location) => location.key === tableView) || null,
    [tableView],
  );

  const visibleTables = useMemo(() => {
    if (tableView === 'locations') return [] as AdminTable[];
    if (tableView === 'all') return tables;
    return tables.filter((table) => getTableLocationKey(table) === tableView);
  }, [tableView, tables]);

  const clients = useMemo(() => {
    const map = new Map<string, { name: string; phone: string; bookings: number; guests: number; lastDate: string }>();

    todayBookings.forEach((booking) => {
      const phone = booking.client?.phone || '-';
      const current = map.get(phone) || {
        name: booking.client?.fullName || '-',
        phone,
        bookings: 0,
        guests: 0,
        lastDate: booking.bookingDate,
      };

      current.bookings += 1;
      current.guests += Number(booking.guestsCount || 0);
      if (booking.bookingDate > current.lastDate) current.lastDate = booking.bookingDate;
      map.set(phone, current);
    });

    return Array.from(map.values()).sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [todayBookings]);

  const locationCounts = useMemo(() => {
    const counts = Object.fromEntries(LOCATIONS.map((location) => [location.key, 0])) as Record<LocationKey, number>;

    activeBookings.forEach((booking) => {
      const key = getBookingLocationKey(booking);
      counts[key] += 1;
    });

    return counts;
  }, [activeBookings]);

  const selectedLocation = useMemo(
    () => LOCATIONS.find((location) => location.key === bookingsView) || null,
    [bookingsView],
  );

  const bookingSource = useMemo(() => {
    if (bookingsView === 'locations') return [] as Booking[];
    if (bookingsView === 'all') return todayBookings;
    if (bookingsView === 'pending') return todayBookings.filter((booking) => booking.status === 'pending');
    if (bookingsView === 'long_pending') return pendingReminders;
    return todayBookings.filter((booking) => getBookingLocationKey(booking) === bookingsView);
  }, [bookingsView, todayBookings, pendingReminders]);

  const visibleBookings = useMemo(() => {
    const searchValue = search.trim().toLowerCase();
    if (!searchValue) return bookingSource;

    return bookingSource.filter((booking) => {
      const haystack = [
        booking.table?.tableNumber,
        booking.table?.zone?.name,
        booking.client?.fullName,
        booking.client?.phone,
        booking.bookingDate,
        booking.bookingTime,
        booking.status,
        booking.wishes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(searchValue);
    });
  }, [bookingSource, search]);

  async function runRestaurantAction(
    action: 'open' | 'openBooking' | 'closeBooking' | 'close',
  ) {
    const key = `restaurant:${action}`;
    setBusyAction(key);
    setNotice(null);
    setError(null);

    try {
      if (action === 'open') {
        await restaurantApi.adminOpen();
        setNotice('Ресторан відкрито');
      }

      if (action === 'openBooking') {
        await restaurantApi.adminOpenBooking();
        setNotice('Онлайн-бронювання відкрито');
      }

      if (action === 'closeBooking') {
        await restaurantApi.adminCloseBooking();
        setNotice('Онлайн-бронювання закрито');
      }

      if (action === 'close') {
        await restaurantApi.adminClose(closeMessage);
        setNotice('Ресторан закрито');
      }

      await load();
    } catch (err: any) {
      setError(err?.message || 'Помилка дії');
    } finally {
      setBusyAction(null);
    }
  }

  async function saveSettings() {
    setBusyAction('settings:save');
    setNotice(null);
    setError(null);

    try {
      await restaurantApi.adminUpdateSettings({
        menuUrl: menuUrl.trim() || null,
        closeMessage: closeMessage.trim(),
        bookingClosedMessage: bookingClosedMessage.trim(),
      });
      setNotice('Дозволені налаштування збережено');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося зберегти');
    } finally {
      setBusyAction(null);
    }
  }

  async function changeSiteMode(nextMode: SiteMode) {
    setBusyAction(`site-mode:${nextMode}`);
    setNotice(null);
    setError(null);

    try {
      await restaurantApi.adminSetSiteMode(nextMode);
      setSiteMode(nextMode);
      setRestaurant((current) => (current ? { ...current, siteMode: nextMode } : current));
      setNotice(`Увімкнено режим: ${siteModeLabel(nextMode)}`);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося змінити режим сайту');
    } finally {
      setBusyAction(null);
    }
  }

  async function changeLocationState(zone: Zone | null, close: boolean, label: string) {
    if (!zone) {
      setError(`Локацію «${label}» ще не прив’язано до зони в базі`);
      return;
    }

    setBusyAction(`zone:${zone.id}:${close ? 'close' : 'open'}`);
    setNotice(null);
    setError(null);

    try {
      if (close) {
        await zonesApi.adminClose(zone.id);
      } else {
        await zonesApi.adminOpen(zone.id);
      }

      setNotice(close ? `Локацію «${label}» закрито` : `Локацію «${label}» відкрито`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося змінити стан локації');
    } finally {
      setBusyAction(null);
    }
  }

  async function runBookingAction(booking: Booking, action: BookingAction) {
    const key = `${booking.id}:${action}`;
    setBusyAction(key);
    setNotice(null);
    setError(null);

    try {
      if (action === 'approve') await bookingsApi.approve(booking.id);
      if (action === 'reject') await bookingsApi.reject(booking.id);
      if (action === 'cancel') await bookingsApi.cancel(booking.id);
      if (action === 'checkIn') await bookingsApi.checkIn(booking.id);
      if (action === 'complete') await bookingsApi.complete(booking.id);
      if (action === 'noShow') await bookingsApi.noShow(booking.id);

      if (action === 'prepareTable') {
        if (!booking.table?.id) throw new Error('Стіл не привʼязаний до бронювання');
        await tablesApi.cleaning(booking.table.id);
      }

      setNotice(actionText(action));
      setFlashId(booking.id);
      await load();
      window.setTimeout(() => setFlashId((current) => (current === booking.id ? null : current)), 1600);
    } catch (err: any) {
      setError(err?.message || 'Помилка бронювання');
    } finally {
      setBusyAction(null);
    }
  }

  async function runTableAction(table: AdminTable, action: TableAction) {
    const key = `table:${table.tableNumber}:${action}`;
    setBusyAction(key);
    setNotice(null);
    setError(null);

    try {
      if (table.isVirtual) {
        const nextStatus: TableStatus = action === 'open' ? 'free' : action === 'close' ? 'closed' : action;
        await tablesApi.setStatusByNumber(String(table.tableNumber), nextStatus);
      } else {
        if (action === 'free') await tablesApi.free(table.id);
        if (action === 'occupied') await tablesApi.occupied(table.id);
        if (action === 'cleaning') await tablesApi.cleaning(table.id);
        if (action === 'close') await tablesApi.close(table.id);
        if (action === 'open') await tablesApi.open(table.id);
      }

      const nextStatus: TableStatus = action === 'open' ? 'free' : action === 'close' ? 'closed' : action;

      setNotice(`Стіл №${table.tableNumber}: ${tableStatusLabel(nextStatus)}`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Не вдалося змінити статус столу');
    } finally {
      setBusyAction(null);
    }
  }

  function openBookingsView(view: BookingView) {
    setBookingsView(view);
    setSearch('');
  }

  function openTablesView(view: TableView) {
    setTableView(view);
  }

  return (
    <div className={settingsOnly ? 'text-white' : 'min-h-screen bg-black p-4 pb-28 text-white lg:p-8'}>
      {!settingsOnly && <header className="mb-5 rounded-[32px] border border-white/10 bg-neutral-950/90 p-5 shadow-2xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-amber-100/55">MOLO Restaurant</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Панель адміністратора</h1>
            <p className="mt-2 text-sm text-white/55">Бронювання, гості, статуси столів та швидкі дії зміни.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {restaurant?.adminCanManageRestaurant && (
              <RestaurantButton
                label="Відкрити ресторан"
                tone="green"
                busy={busyAction === 'restaurant:open'}
                onClick={() => runRestaurantAction('open')}
              />
            )}

            {restaurant?.adminCanManageOnlineBooking && restaurant.status === 'booking_closed' && (
              <RestaurantButton
                label="Відкрити бронювання"
                tone="green"
                busy={busyAction === 'restaurant:openBooking'}
                onClick={() => runRestaurantAction('openBooking')}
              />
            )}

            {restaurant?.adminCanManageOnlineBooking && restaurant.status !== 'closed' && restaurant.status !== 'booking_closed' && (
              <RestaurantButton
                label="Закрити бронювання"
                tone="yellow"
                busy={busyAction === 'restaurant:closeBooking'}
                onClick={() => runRestaurantAction('closeBooking')}
              />
            )}

            {restaurant?.adminCanManageRestaurant && (
              <RestaurantButton
                label="Закрити ресторан"
                tone="red"
                busy={busyAction === 'restaurant:close'}
                onClick={() => runRestaurantAction('close')}
              />
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
            Статус: <b className="text-white">{restaurant?.status || '-'}</b>
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-white/70">
            Заявок сьогодні: <b className="text-white">{todayBookings.length}</b>
          </span>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-full border border-amber-200/40 bg-amber-300/10 px-3 py-1 font-semibold text-amber-100 transition active:scale-95 disabled:opacity-50"
          >
            {loading ? 'Оновлюємо...' : 'Оновити'}
          </button>
        </div>

        {(notice || error) && (
          <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100'}`}>
            {error || notice}
          </div>
        )}
      </header>}

      {!settingsOnly && <nav className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">
        {(['dashboard', 'bookings', 'tables', 'clients', 'settings'] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`rounded-2xl px-4 py-4 text-sm font-semibold transition active:scale-[0.97] ${tab === item ? 'bg-amber-300 text-neutral-950 shadow-[0_0_26px_rgba(251,191,36,.18)]' : 'bg-neutral-900 text-white/80'}`}
          >
            {label(item)}
          </button>
        ))}
      </nav>}

      {!settingsOnly && pendingReminders.length > 0 && (
        <section className="mb-5 rounded-[28px] border border-amber-200/35 bg-amber-300/10 p-4 text-amber-100 shadow-[0_0_34px_rgba(251,191,36,.08)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-amber-100/65">Завислі заявки</p>
              <h2 className="mt-1 text-xl font-black">{pendingReminders.length} заявк(и) очікують понад {PENDING_REMINDER_MINUTES} хв</h2>
              <p className="mt-1 text-sm text-white/70">Потрібно підтвердити, відхилити або подзвонити гостю.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setTab('bookings');
                openBookingsView('long_pending');
              }}
              className="rounded-2xl border border-amber-200/55 bg-black/25 px-4 py-3 text-sm font-bold text-amber-100 transition active:scale-95"
            >
              Відкрити заявки
            </button>
          </div>
        </section>
      )}

      {tab === 'dashboard' && (
        <section className="space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <Stat label="Усього заявок" value={stats.bookings} />
            <Stat label="Активних" value={stats.active} />
            <Stat label="Гостей" value={stats.guests} />
            <Stat label="Очікують" value={stats.pending} tone="blue" />
            <Stat label="Чекають 15+ хв" value={stats.pendingLong} tone="yellow" />
            <Stat label="Підтверджені" value={stats.approved} tone="orange" />
            <Stat label="Завершені" value={stats.completed} tone="green" />
            <Stat label="Гість не прийшов" value={stats.noShow} tone="red" />
            <Stat label="Довгі броні" value={stats.longBookings} tone="purple" />
          </div>

          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Останні заявки</h2>
                <p className="mt-1 text-sm text-white/45">Швидкий перегляд останніх бронювань.</p>
              </div>
              <button type="button" onClick={() => setTab('bookings')} className="rounded-2xl border border-amber-200/40 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100 transition active:scale-95">
                Всі броні
              </button>
            </div>

            <div className="grid gap-3">
              {todayBookings.slice(0, 5).map((booking) => <SmallBookingRow key={booking.id} booking={booking} />)}
              {!todayBookings.length && <EmptyState text="Поки немає бронювань." />}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <h2 className="text-xl font-bold">Статуси столів</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-6">
              {(Object.keys(tableStats) as TableStatus[]).map((status) => (
                <div key={status} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full ${TABLE_STATUS_DOT[status]}`} />
                    <span className="text-xs text-white/55">{tableStatusLabel(status)}</span>
                  </div>
                  <p className="mt-3 text-2xl font-black">{tableStats[status]}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {tab === 'bookings' && (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-2xl font-black">Бронювання</h2>
                <p className="mt-1 text-sm text-white/45">По локаціях, без каші. Підтвердження, відхилення, дзвінок, прихід гостя та статус столу.</p>
              </div>

              <button
                type="button"
                onClick={() => openBookingsView('all')}
                className="rounded-[24px] border border-amber-200/55 bg-amber-300/15 px-5 py-4 text-sm font-black text-amber-100 shadow-[0_0_30px_rgba(251,191,36,.08)] transition active:scale-[0.99]"
              >
                Відкрити весь список броней на сьогодні
              </button>
            </div>
          </div>

          {bookingsView === 'locations' && (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <QuickOpenCard
                  title="Очікують підтвердження"
                  description="Нові заявки на сьогодні"
                  count={todayBookings.filter((booking) => booking.status === 'pending').length}
                  tone="blue"
                  onClick={() => openBookingsView('pending')}
                />
                <QuickOpenCard
                  title="Завислі заявки"
                  description={`Чекають понад ${PENDING_REMINDER_MINUTES} хв`}
                  count={pendingReminders.length}
                  tone="yellow"
                  onClick={() => openBookingsView('long_pending')}
                />
                <QuickOpenCard
                  title="Весь список"
                  description="Усі броні на сьогодні"
                  count={todayBookings.length}
                  tone="amber"
                  onClick={() => openBookingsView('all')}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {LOCATIONS.map((location) => (
                  <LocationCard
                    key={location.key}
                    location={location}
                    count={locationCounts[location.key] || 0}
                    onClick={() => openBookingsView(location.key)}
                  />
                ))}
              </div>
            </>
          )}

          {bookingsView !== 'locations' && (
            <>
              <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                      {bookingsView === 'all'
                        ? 'Всі броні на сьогодні'
                        : bookingsView === 'pending'
                          ? 'Нові заявки'
                          : bookingsView === 'long_pending'
                            ? `Очікують понад ${PENDING_REMINDER_MINUTES} хв`
                            : selectedLocation?.description || 'Локація'}
                    </p>
                    <h3 className="mt-1 text-2xl font-black">
                      {bookingsView === 'all'
                        ? 'Список бронювань'
                        : bookingsView === 'pending'
                          ? 'Очікують підтвердження'
                          : bookingsView === 'long_pending'
                            ? 'Завислі заявки'
                            : selectedLocation?.label}
                    </h3>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Пошук: стіл, імʼя, телефон..."
                      className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none sm:min-w-[280px]"
                    />
                    <button
                      type="button"
                      onClick={() => openBookingsView('locations')}
                      className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition active:scale-[0.98]"
                    >
                      Назад до локацій
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4">
                {visibleBookings.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    flash={flashId === booking.id}
                    busyAction={busyAction}
                    onAction={(action) => runBookingAction(booking, action)}
                  />
                ))}
                {!visibleBookings.length && <EmptyState text="У цьому списку бронювань немає." />}
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'tables' && (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-2xl font-black">Столи і статуси</h2>
                <p className="mt-2 text-sm text-white/45">Столи також розділені по локаціях, щоб не було каші.</p>
              </div>

              <button
                type="button"
                onClick={() => openTablesView('all')}
                className="rounded-[24px] border border-amber-200/55 bg-amber-300/15 px-5 py-4 text-sm font-black text-amber-100 shadow-[0_0_30px_rgba(251,191,36,.08)] transition active:scale-[0.99]"
              >
                Відкрити всі столи
              </button>
            </div>
          </div>

          {tableView === 'locations' && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {LOCATIONS.map((location) => (
                <TableLocationCard
                  key={location.key}
                  location={location}
                  stats={tableLocationStats[location.key]}
                  zone={locationZones[location.key]}
                  canManageZone={Boolean(restaurant?.adminCanManageZones)}
                  busyAction={busyAction}
                  onClick={() => openTablesView(location.key)}
                  onZoneAction={(close) =>
                    changeLocationState(locationZones[location.key], close, location.label)
                  }
                />
              ))}
            </div>
          )}

          {tableView !== 'locations' && (
            <>
              <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-white/40">
                      {tableView === 'all' ? 'Усі столи' : selectedTableLocation?.description}
                    </p>
                    <h3 className="mt-1 text-2xl font-black">
                      {tableView === 'all' ? 'Всі столи ресторану' : selectedTableLocation?.label}
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => openTablesView('locations')}
                    className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition active:scale-[0.98]"
                  >
                    Назад до локацій
                  </button>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleTables.map((table) => (
                  <TableCard key={table.id} table={table} busyAction={busyAction} onAction={(action) => runTableAction(table, action)} />
                ))}
                {!visibleTables.length && <EmptyState text="У цій локації столів немає або вони ще не завантажились." />}
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'clients' && (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <h2 className="text-2xl font-black">Клієнти</h2>
            <p className="mt-2 text-sm text-white/45">Поки список формується з бронювань. Повну базу гостей зробимо в пульті директора.</p>
          </div>

          <div className="grid gap-3">
            {clients.map((client) => (
              <div key={client.phone} className="rounded-[24px] border border-white/10 bg-neutral-950 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xl font-bold">{client.name}</p>
                    <a className="mt-1 block text-sm text-amber-100" href={`tel:${normalizePhone(client.phone)}`}>{client.phone}</a>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[280px]">
                    <MiniStat label="Броні" value={client.bookings} />
                    <MiniStat label="Гості" value={client.guests} />
                    <MiniStat label="Останній" value={formatDate(client.lastDate)} />
                  </div>
                </div>
              </div>
            ))}
            {!clients.length && <EmptyState text="Клієнтів поки немає." />}
          </div>
        </section>
      )}

      {tab === 'settings' && (
        <section className="space-y-4">
          <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
            <h2 className="text-2xl font-black">Додаткові права адміністратора</h2>
            <p className="mt-2 text-sm text-white/45">
              Бронювання, гості та всі столи доступні за замовчуванням. Нижче показані тільки можливості, які додав Директор.
            </p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <PermissionBadge enabled={Boolean(restaurant?.adminCanManageZones)} label="Локації" />
              <PermissionBadge enabled={Boolean(restaurant?.adminCanManageOnlineBooking)} label="Онлайн-бронювання" />
              <PermissionBadge enabled={Boolean(restaurant?.adminCanManageRestaurant)} label="Ресторан" />
              <PermissionBadge enabled={Boolean(restaurant?.adminCanChangeSiteMode)} label="День / Ніч / Свято" />
              <PermissionBadge enabled={Boolean(restaurant?.adminCanEditRestaurantSettings)} label="Меню та повідомлення" />
            </div>
          </div>

          {restaurant?.adminCanChangeSiteMode && (
            <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Оформлення гостьового сайту</p>
              <h3 className="mt-1 text-xl font-black">Режим: {siteModeLabel(siteMode)}</h3>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {([
                  ['day', 'День', 'Світле денне оформлення'],
                  ['night', 'Ніч', 'Темне вечірнє оформлення'],
                  ['holiday', 'Свято', 'Святкове оформлення'],
                ] as Array<[SiteMode, string, string]>).map(([mode, labelText, description]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => changeSiteMode(mode)}
                    disabled={busyAction === `site-mode:${mode}`}
                    className={`rounded-2xl border p-4 text-left transition active:scale-[0.98] disabled:opacity-50 ${
                      siteMode === mode
                        ? 'border-amber-200/60 bg-amber-300/15 text-amber-100'
                        : 'border-white/10 bg-white/[0.03] text-white/70'
                    }`}
                  >
                    <p className="font-black">{labelText}</p>
                    <p className="mt-1 text-xs opacity-65">{description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {restaurant?.adminCanEditRestaurantSettings && (
            <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Дозволені налаштування</p>
              <h3 className="mt-1 text-xl font-black">Меню та повідомлення гостям</h3>
              <p className="mt-2 text-sm text-white/45">
                Закріплений номер адміністратора змінює тільки Директор.
              </p>

              <div className="mt-5 grid gap-4">
                <label>
                  <span className="text-sm uppercase tracking-[0.18em] text-white/45">Посилання на меню</span>
                  <input
                    value={menuUrl}
                    onChange={(event) => setMenuUrl(event.target.value)}
                    placeholder="https://..."
                    className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none"
                  />
                </label>

                <label>
                  <span className="text-sm uppercase tracking-[0.18em] text-white/45">Повідомлення при закритті ресторану</span>
                  <textarea
                    value={closeMessage}
                    onChange={(event) => setCloseMessage(event.target.value)}
                    className="mt-3 min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none"
                  />
                </label>

                <label>
                  <span className="text-sm uppercase tracking-[0.18em] text-white/45">Повідомлення при закритому онлайн-бронюванні</span>
                  <textarea
                    value={bookingClosedMessage}
                    onChange={(event) => setBookingClosedMessage(event.target.value)}
                    className="mt-3 min-h-32 w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={saveSettings}
                disabled={busyAction === 'settings:save'}
                className="mt-4 rounded-2xl bg-amber-300 px-5 py-4 font-bold text-neutral-950 transition active:scale-95 disabled:opacity-60"
              >
                {busyAction === 'settings:save' ? 'Зберігаємо...' : 'Зберегти дозволені налаштування'}
              </button>
            </div>
          )}

          {!restaurant?.adminCanChangeSiteMode && !restaurant?.adminCanEditRestaurantSettings && (
            <div className="rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-white/45">
              Директор поки не додав права на режими сайту або налаштування ресторану.
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function BookingCard({
  booking,
  flash,
  busyAction,
  onAction,
}: {
  booking: Booking;
  flash: boolean;
  busyAction: string | null;
  onAction: (action: BookingAction) => void;
}) {
  const details = parseBookingDetails(booking);
  const phone = booking.client?.phone || '-';
  const tableStatus = booking.table?.status;
  const viewStatus = bookingViewStatus(booking);
  const canApprove = booking.status === 'pending' || booking.status === 'rejected';
  const canReject = booking.status === 'pending' || booking.status === 'approved';
  const canWork = booking.status === 'approved' && viewStatus !== 'no_show';
  const canNoShow = (booking.status === 'pending' || booking.status === 'approved') && viewStatus !== 'no_show';
  const canCancel = booking.status !== 'cancelled' && booking.status !== 'completed' && booking.status !== 'rejected';
  const pendingTooLong = isPendingTooLong(booking);
  const pendingAge = bookingAgeMinutes(booking);

  return (
    <article className={`rounded-[28px] border p-4 shadow-2xl transition ${flash ? 'border-emerald-300/45 bg-emerald-400/10' : 'border-white/10 bg-neutral-950'}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-2xl font-black">Стіл №{booking.table?.tableNumber || '-'}</h3>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${bookingStatusClass(booking)}`}>{bookingStatusLabel(booking)}</span>
            {tableStatus && (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">
                <span className={`h-2.5 w-2.5 rounded-full ${TABLE_STATUS_DOT[tableStatus]}`} />
                {tableStatusLabel(tableStatus)}
              </span>
            )}
            {details.isLong && <span className="rounded-full border border-purple-300/30 bg-purple-400/10 px-3 py-1 text-xs font-semibold text-purple-100">Довга бронь</span>}
            {pendingTooLong && <span className="rounded-full border border-amber-200/40 bg-amber-300/15 px-3 py-1 text-xs font-semibold text-amber-100">Чекає {pendingAge} хв</span>}
          </div>

          <p className="mt-2 text-sm text-white/50">{formatDate(booking.bookingDate)} · {details.period} · {booking.guestsCount} гостей</p>
          <p className="mt-1 text-xs text-white/35">Зона: {booking.table?.zone?.name || locationLabel(getBookingLocationKey(booking))}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex">
          <ActionButton label="✅ Прийняти" busyLabel="Приймаємо..." busy={busyAction === `${booking.id}:approve`} tone="green" disabled={!canApprove || Boolean(busyAction)} onClick={() => onAction('approve')} />
          <ActionButton label="❌ Відхилити" busyLabel="Відхиляємо..." busy={busyAction === `${booking.id}:reject`} tone="red" disabled={!canReject || Boolean(busyAction)} onClick={() => onAction('reject')} />
        </div>
      </div>

      {pendingTooLong && (
        <div className="mt-4 rounded-2xl border border-amber-200/35 bg-amber-300/10 p-4 text-amber-100">
          <p className="font-bold">Заявка очікує понад {PENDING_REMINDER_MINUTES} хв</p>
          <p className="mt-1 text-sm text-white/70">Підтвердь, відхили або подзвони гостю, щоб заявка не висіла.</p>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <InfoBox label="Гість" value={booking.client?.fullName || '-'} />
        <InfoBox label="Телефон" value={<a className="text-amber-100 underline decoration-amber-200/30" href={`tel:${normalizePhone(phone)}`}>{phone}</a>} />
        <InfoBox label="Дата" value={formatDate(booking.bookingDate)} />
        <InfoBox label="Час" value={details.period} />
        <InfoBox label="Відпочинок" value={details.durationText} />
        <InfoBox label="Вільний з" value={details.availableFrom} />
      </div>

      <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40">Побажання гостя</p>
        {details.guestWishes.length ? (
          <div className="mt-2 space-y-1 text-sm text-white/75">
            {details.guestWishes.map((line, index) => <p key={`${booking.id}-wish-${index}`}>{line}</p>)}
          </div>
        ) : (
          <p className="mt-2 text-sm text-white/35">Без побажань</p>
        )}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <a href={`tel:${normalizePhone(phone)}`} className="rounded-2xl border border-amber-200/35 bg-amber-300/10 px-4 py-3 text-center text-sm font-semibold text-amber-100 transition active:scale-95">📞 Подзвонити</a>
        <ActionButton label="👋 Гість прийшов" busyLabel="Відмічаємо..." busy={busyAction === `${booking.id}:checkIn`} tone="blue" disabled={!canWork || Boolean(busyAction)} onClick={() => onAction('checkIn')} />
        <ActionButton label="🧽 Стіл готується" busyLabel="Ставимо..." busy={busyAction === `${booking.id}:prepareTable`} tone="cyan" disabled={!booking.table?.id || Boolean(busyAction)} onClick={() => onAction('prepareTable')} />
        <ActionButton label="✅ Стіл вільний" busyLabel="Завершуємо..." busy={busyAction === `${booking.id}:complete`} tone="neutral" disabled={!canWork || Boolean(busyAction)} onClick={() => onAction('complete')} />
        <ActionButton label="Гість не прийшов" busyLabel="Знімаємо..." busy={busyAction === `${booking.id}:noShow`} tone="red" disabled={!canNoShow || Boolean(busyAction)} onClick={() => onAction('noShow')} />
        <ActionButton label="Скасувати" busyLabel="Скасовуємо..." busy={busyAction === `${booking.id}:cancel`} tone="neutral" disabled={!canCancel || Boolean(busyAction)} onClick={() => onAction('cancel')} />
      </div>
    </article>
  );
}

function TableCard({
  table,
  busyAction,
  onAction,
}: {
  table: AdminTable;
  busyAction: string | null;
  onAction: (action: TableAction) => void;
}) {
  const busyPrefix = `table:${table.tableNumber}:`;
  const isBusy = Boolean(busyAction?.startsWith(busyPrefix));

  return (
    <div className="rounded-[24px] border border-white/10 bg-neutral-950 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-black">Стіл №{table.tableNumber}</p>
          <p className="mt-1 text-sm text-white/45">до {table.seats} гостей</p>
          {table.isVirtual && (
            <p className="mt-1 text-xs text-amber-100/70">Стіл буде створено в базі після першої зміни статусу</p>
          )}
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70">
          <span className={`h-2.5 w-2.5 rounded-full ${TABLE_STATUS_DOT[table.status]}`} />
          {tableStatusLabel(table.status)}
        </span>
      </div>

      <p className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-white/55">Зона: {table.zone?.name || 'без зони'}</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <ActionButton label="Вільний" busyLabel="..." busy={busyAction === `${busyPrefix}free`} tone="neutral" disabled={Boolean(busyAction)} onClick={() => onAction('free')} />
        <ActionButton label="Зайнятий" busyLabel="..." busy={busyAction === `${busyPrefix}occupied`} tone="red" disabled={Boolean(busyAction)} onClick={() => onAction('occupied')} />
        <ActionButton label="Готується" busyLabel="..." busy={busyAction === `${busyPrefix}cleaning`} tone="cyan" disabled={Boolean(busyAction)} onClick={() => onAction('cleaning')} />
        {table.status === 'closed' ? (
          <ActionButton label="Відкрити" busyLabel="..." busy={busyAction === `${busyPrefix}open`} tone="green" disabled={Boolean(busyAction)} onClick={() => onAction('open')} />
        ) : (
          <ActionButton label="Закрити" busyLabel="..." busy={busyAction === `${busyPrefix}close`} tone="red" disabled={Boolean(busyAction)} onClick={() => onAction('close')} />
        )}
      </div>

      {isBusy && <p className="mt-3 text-center text-xs text-white/40">Змінюємо статус...</p>}
    </div>
  );
}

function SmallBookingRow({ booking }: { booking: Booking }) {
  const details = parseBookingDetails(booking);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">№{booking.table?.tableNumber || '-'} · {booking.client?.fullName || '-'}</p>
          <p className="mt-1 text-sm text-white/45">{formatDate(booking.bookingDate)} · {details.period}</p>
          {isPendingTooLong(booking) && <p className="mt-1 text-xs font-semibold text-amber-100">Чекає {bookingAgeMinutes(booking)} хв — треба дія</p>}
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs ${bookingStatusClass(booking)}`}>{bookingStatusLabel(booking)}</span>
      </div>
    </div>
  );
}

function RestaurantButton({ label, tone, busy, onClick }: { label: string; tone: 'green' | 'yellow' | 'red'; busy: boolean; onClick: () => void }) {
  const classes = { green: 'bg-emerald-500 text-white', yellow: 'bg-amber-400 text-neutral-950', red: 'bg-red-600 text-white' }[tone];

  return (
    <button type="button" onClick={onClick} disabled={busy} className={`rounded-2xl px-4 py-3 text-sm font-bold transition active:scale-95 disabled:opacity-60 ${classes}`}>
      {busy ? '...' : label}
    </button>
  );
}

function ActionButton({
  label,
  busyLabel,
  tone,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  busyLabel: string;
  tone: 'green' | 'red' | 'blue' | 'cyan' | 'neutral';
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const classes = {
    green: 'border-emerald-300/25 bg-emerald-500/90 text-white',
    red: 'border-red-300/25 bg-red-600/90 text-white',
    blue: 'border-sky-300/25 bg-sky-500/90 text-white',
    cyan: 'border-cyan-200/25 bg-cyan-400/90 text-neutral-950',
    neutral: 'border-white/10 bg-white/[0.05] text-white/75',
  }[tone];

  return (
    <button type="button" onClick={onClick} disabled={disabled || busy} className={`rounded-2xl border px-4 py-3 text-sm font-bold transition active:scale-95 disabled:opacity-35 ${classes}`}>
      {busy ? busyLabel : label}
    </button>
  );
}

function InfoBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-white/40">{label}</p>
      <div className="mt-2 text-base font-semibold text-white">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-white/35">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: number | string; tone?: 'default' | 'blue' | 'yellow' | 'orange' | 'red' | 'green' | 'purple' }) {
  const toneClass = {
    default: 'border-white/10 bg-neutral-950',
    blue: 'border-sky-300/25 bg-sky-400/10',
    yellow: 'border-amber-300/25 bg-amber-400/10',
    orange: 'border-orange-300/25 bg-orange-400/10',
    red: 'border-red-300/25 bg-red-400/10',
    green: 'border-emerald-300/25 bg-emerald-400/10',
    purple: 'border-purple-300/25 bg-purple-400/10',
  }[tone];

  return (
    <div className={`rounded-[26px] border p-5 ${toneClass}`}>
      <p className="text-sm text-white/45">{label}</p>
      <p className="mt-3 text-4xl font-black">{value}</p>
    </div>
  );
}

function QuickOpenCard({
  title,
  description,
  count,
  tone,
  onClick,
}: {
  title: string;
  description: string;
  count: number;
  tone: 'blue' | 'yellow' | 'amber';
  onClick: () => void;
}) {
  const toneClass = {
    blue: 'border-sky-300/30 bg-sky-400/10 text-sky-100',
    yellow: 'border-amber-300/30 bg-amber-400/10 text-amber-100',
    amber: 'border-orange-300/30 bg-orange-400/10 text-orange-100',
  }[tone];

  return (
    <button type="button" onClick={onClick} className={`rounded-[28px] border p-5 text-left transition active:scale-[0.99] ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">{title}</h3>
          <p className="mt-1 text-sm text-white/65">{description}</p>
        </div>
        <span className="min-w-12 rounded-2xl border border-white/15 bg-black/20 px-3 py-2 text-center text-xl font-black text-white">{count}</span>
      </div>
    </button>
  );
}

function LocationCard({
  location,
  count,
  onClick,
}: {
  location: LocationInfo;
  count: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="rounded-[30px] border border-white/10 bg-neutral-950 p-5 text-left shadow-xl transition active:scale-[0.99]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-white">{location.label}</h3>
          <p className="mt-1 text-sm text-white/50">{location.description}</p>
        </div>
        <span className="min-w-12 rounded-2xl border border-amber-200/45 bg-amber-300/15 px-3 py-2 text-center text-xl font-black text-amber-100">{count}</span>
      </div>
      <p className="mt-4 text-sm font-semibold text-amber-100/85">Відкрити локацію</p>
    </button>
  );
}

function TableLocationCard({
  location,
  stats,
  zone,
  canManageZone,
  busyAction,
  onClick,
  onZoneAction,
}: {
  location: LocationInfo;
  stats: { total: number; occupied: number; cleaning: number; closed: number; reserved: number; pending: number };
  zone: Zone | null;
  canManageZone: boolean;
  busyAction: string | null;
  onClick: () => void;
  onZoneAction: (close: boolean) => void;
}) {
  const busyCount = stats.occupied + stats.cleaning + stats.closed + stats.reserved + stats.pending;
  const isClosed = zone?.isClosed === true;

  return (
    <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5 text-left shadow-xl">
      <button type="button" onClick={onClick} className="w-full text-left transition active:scale-[0.99]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-white">{location.label}</h3>
            <p className="mt-1 text-sm text-white/50">{location.description}</p>
            <span
              className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-bold ${
                !zone
                  ? 'border-white/10 bg-white/5 text-white/45'
                  : isClosed
                    ? 'border-red-300/30 bg-red-500/10 text-red-100'
                    : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
              }`}
            >
              {!zone ? 'Зона не прив’язана' : isClosed ? 'Локація закрита' : 'Локація відкрита'}
            </span>
          </div>
          <span className="min-w-12 rounded-2xl border border-amber-200/45 bg-amber-300/15 px-3 py-2 text-center text-xl font-black text-amber-100">{stats.total}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <span className="rounded-2xl border border-red-300/25 bg-red-500/10 px-3 py-2 text-red-100">Зайняті: {stats.occupied}</span>
          <span className="rounded-2xl border border-cyan-200/25 bg-cyan-300/10 px-3 py-2 text-cyan-100">Готуються: {stats.cleaning}</span>
          <span className="rounded-2xl border border-orange-300/25 bg-orange-400/10 px-3 py-2 text-orange-100">Бронь: {stats.reserved + stats.pending}</span>
          <span className="rounded-2xl border border-neutral-300/20 bg-neutral-400/10 px-3 py-2 text-neutral-200">Закриті: {stats.closed}</span>
        </div>

        <p className="mt-4 text-sm font-semibold text-amber-100/85">
          {busyCount > 0 ? 'Відкрити столи локації' : 'Всі столи вільні'}
        </p>
      </button>

      {canManageZone && (
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={() => onZoneAction(false)}
            disabled={!zone || !isClosed || busyAction === `zone:${zone?.id}:open`}
            className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:opacity-35"
          >
            Відкрити локацію
          </button>
          <button
            type="button"
            onClick={() => onZoneAction(true)}
            disabled={!zone || isClosed || busyAction === `zone:${zone?.id}:close`}
            className="rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-100 disabled:opacity-35"
          >
            Закрити локацію
          </button>
        </div>
      )}
    </div>
  );
}

function PermissionBadge({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={`rounded-full border px-3 py-2 font-semibold ${
        enabled
          ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
          : 'border-white/10 bg-white/[0.03] text-white/35'
      }`}
    >
      {enabled ? '✓' : '—'} {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-white/45">{text}</div>;
}

function locationLabel(key: LocationKey) {
  return LOCATIONS.find((location) => location.key === key)?.label || 'Інша локація';
}

function label(tab: Tab) {
  return { dashboard: 'Головна', bookings: 'Бронювання', tables: 'Столи', clients: 'Клієнти', settings: 'Налаштування' }[tab];
}
