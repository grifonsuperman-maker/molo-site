import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { zonesApi } from '../api/zones';
import type { Booking, FullMapResponse, Restaurant, SiteMode, TableItem, TableStatus, Zone } from '../api/types';

type Tab = 'overview' | 'restaurant' | 'locations' | 'analytics' | 'staff' | 'system';
type LocationKey = 'hall' | 'canopy' | 'gazebo' | 'rotang' | 'embankment' | 'glass_gazebo' | 'water_gazebo' | 'other';

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

const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  free: 'Вільний',
  pending: 'Очікує',
  reserved: 'Заброньований',
  occupied: 'Зайнятий',
  cleaning: 'Готується',
  closed: 'Закритий',
};

const TABLE_STATUS_TONE: Record<TableStatus, string> = {
  free: 'border-white/15 bg-white/[0.04] text-white/75',
  pending: 'border-sky-300/30 bg-sky-400/10 text-sky-100',
  reserved: 'border-orange-300/30 bg-orange-400/10 text-orange-100',
  occupied: 'border-red-300/30 bg-red-500/10 text-red-100',
  cleaning: 'border-cyan-200/30 bg-cyan-300/10 text-cyan-100',
  closed: 'border-neutral-300/20 bg-neutral-500/10 text-neutral-200',
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: 'Очікує',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  cancelled: 'Скасовано',
  completed: 'Завершено',
};

function unwrapData<T>(value: T | { data?: T }): T {
  if (value && typeof value === 'object' && 'data' in value && (value as { data?: T }).data) {
    return (value as { data: T }).data;
  }

  return value as T;
}

function todayInKyiv() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';

  return `${year}-${month}-${day}`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return '-';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return String(value);
  return `${day}.${month}.${year}`;
}

function timeLabel(value: string | null | undefined) {
  if (!value) return '--:--';
  const [hours = '00', minutes = '00'] = String(value).split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
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

function locationLabel(key: LocationKey) {
  return LOCATIONS.find((location) => location.key === key)?.label || 'Інші столи';
}

function bookingLocationKey(booking: Booking): LocationKey {
  return getLocationKeyByTableNumber(Number(booking.table?.tableNumber || 0));
}

function tableLocationKey(table: TableItem): LocationKey {
  return getLocationKeyByTableNumber(Number(table.tableNumber || 0));
}

function restaurantStatusLabel(status: Restaurant['status'] | undefined) {
  if (status === 'open') return 'Ресторан відкритий';
  if (status === 'booking_closed') return 'Онлайн-бронювання закрито';
  if (status === 'closed') return 'Ресторан закритий';
  return 'Статус невідомий';
}

function restaurantStatusTone(status: Restaurant['status'] | undefined) {
  if (status === 'open') return 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100';
  if (status === 'booking_closed') return 'border-amber-300/35 bg-amber-400/10 text-amber-100';
  if (status === 'closed') return 'border-red-300/35 bg-red-500/10 text-red-100';
  return 'border-white/15 bg-white/5 text-white/70';
}

function isNoShow(booking: Booking) {
  return String(booking.wishes || '').includes('[NO_SHOW]');
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
  return zones.find((zone) => {
    const normalized = normalizeZoneName(zone.name);
    return aliases.some((alias) => normalized.includes(normalizeZoneName(alias)));
  }) || null;
}

function linkedZoneForLocation(tables: TableItem[], zones: Zone[], key: LocationKey) {
  const counts = new Map<string, number>();

  tables
    .filter((table) => tableLocationKey(table) === key)
    .forEach((table) => {
      const zoneId = table.zone?.id;
      if (!zoneId) return;
      counts.set(zoneId, (counts.get(zoneId) || 0) + 1);
    });

  const bestZoneId = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  if (!bestZoneId) return null;
  return zones.find((zone) => zone.id === bestZoneId) || null;
}

function siteModeLabel(mode: SiteMode | undefined) {
  if (mode === 'day') return 'Денний режим';
  if (mode === 'holiday') return 'Святковий режим';
  return 'Нічний режим';
}

export default function DirectorPanel() {
  const [tab, setTab] = useState<Tab>('overview');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [fullMap, setFullMap] = useState<FullMapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState('');
  const [menuUrl, setMenuUrl] = useState('');
  const [closeMessage, setCloseMessage] = useState('');
  const [bookingClosedMessage, setBookingClosedMessage] = useState('');
  const [siteMode, setSiteMode] = useState<SiteMode>('night');
  const [adminCanManageZones, setAdminCanManageZones] = useState(false);
  const [adminCanManageOnlineBooking, setAdminCanManageOnlineBooking] = useState(false);
  const [adminCanManageRestaurant, setAdminCanManageRestaurant] = useState(false);
  const [adminCanChangeSiteMode, setAdminCanChangeSiteMode] = useState(false);
  const [adminCanEditRestaurantSettings, setAdminCanEditRestaurantSettings] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);

    const [restaurantResult, bookingsResult, mapResult] = await Promise.allSettled([
      restaurantApi.get(),
      bookingsApi.getToday(),
      mapApi.get(),
    ]);

    if (restaurantResult.status === 'fulfilled') {
      const value = unwrapData<Restaurant>(restaurantResult.value);
      setRestaurant(value);
      setPhone(value?.phone || '');
      setMenuUrl(value?.menuUrl || '');
      setCloseMessage(value?.closeMessage || '');
      setBookingClosedMessage(value?.bookingClosedMessage || '');
      setSiteMode(value?.siteMode || 'night');
      setAdminCanManageZones(Boolean(value?.adminCanManageZones));
      setAdminCanManageOnlineBooking(Boolean(value?.adminCanManageOnlineBooking));
      setAdminCanManageRestaurant(Boolean(value?.adminCanManageRestaurant));
      setAdminCanChangeSiteMode(Boolean(value?.adminCanChangeSiteMode));
      setAdminCanEditRestaurantSettings(Boolean(value?.adminCanEditRestaurantSettings));
    } else {
      setError(restaurantResult.reason?.message || 'Не вдалося завантажити ресторан');
    }

    if (bookingsResult.status === 'fulfilled') {
      setBookings(unwrapData<Booking[]>(bookingsResult.value));
    }

    if (mapResult.status === 'fulfilled') {
      setFullMap(unwrapData<FullMapResponse>(mapResult.value));
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const today = useMemo(() => todayInKyiv(), []);

  const todayBookings = useMemo(() => {
    return bookings
      .filter((booking) => String(booking.bookingDate).slice(0, 10) === today)
      .sort((a, b) => String(a.bookingTime || '').localeCompare(String(b.bookingTime || '')));
  }, [bookings, today]);

  const tables = useMemo(() => {
    return [...(fullMap?.tables || [])].sort(
      (a, b) => Number(a.tableNumber || 0) - Number(b.tableNumber || 0),
    );
  }, [fullMap]);

  const stats = useMemo(() => {
    const activeBookings = todayBookings.filter(
      (booking) => booking.status === 'pending' || booking.status === 'approved',
    );
    const guests = activeBookings.reduce((sum, booking) => sum + Number(booking.guestsCount || 0), 0);
    const tableStatusCounts: Record<TableStatus, number> = {
      free: 0,
      pending: 0,
      reserved: 0,
      occupied: 0,
      cleaning: 0,
      closed: 0,
    };

    tables.forEach((table) => {
      tableStatusCounts[table.status] += 1;
    });

    return {
      bookings: todayBookings.length,
      active: activeBookings.length,
      pending: todayBookings.filter((booking) => booking.status === 'pending').length,
      approved: todayBookings.filter((booking) => booking.status === 'approved').length,
      completed: todayBookings.filter((booking) => booking.status === 'completed').length,
      cancelled: todayBookings.filter((booking) => booking.status === 'cancelled').length,
      noShow: todayBookings.filter(isNoShow).length,
      guests,
      tableStatusCounts,
    };
  }, [todayBookings, tables]);

  const locationStats = useMemo(() => {
    const zones = fullMap?.zones || [];

    return LOCATIONS.map((location) => {
      const locationTables = tables.filter((table) => tableLocationKey(table) === location.key);
      const locationBookings = todayBookings.filter((booking) => bookingLocationKey(booking) === location.key);
      const guests = locationBookings
        .filter((booking) => booking.status === 'pending' || booking.status === 'approved')
        .reduce((sum, booking) => sum + Number(booking.guestsCount || 0), 0);
      const zone =
        linkedZoneForLocation(locationTables, zones, location.key) ||
        namedZoneForLocation(zones, location.key);

      return {
        ...location,
        zone,
        isClosed: zone?.isClosed === true,
        tables: locationTables.length,
        bookings: locationBookings.length,
        guests,
        occupied: locationTables.filter((table) => table.status === 'occupied').length,
        cleaning: locationTables.filter((table) => table.status === 'cleaning').length,
        closed: locationTables.filter((table) => table.status === 'closed').length,
        free: locationTables.filter((table) => table.status === 'free').length,
      };
    });
  }, [tables, todayBookings, fullMap]);

  const topTables = useMemo(() => {
    const counts = new Map<string, number>();

    todayBookings.forEach((booking) => {
      const number = String(booking.table?.tableNumber || '-');
      counts.set(number, (counts.get(number) || 0) + 1);
    });

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [todayBookings]);

  const topLocations = useMemo(() => {
    return [...locationStats]
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 5);
  }, [locationStats]);

  async function runRestaurantAction(action: 'open' | 'closeBooking' | 'close') {
    setBusyAction(`restaurant:${action}`);
    setNotice(null);
    setError(null);

    try {
      if (action === 'open') await restaurantApi.open();
      if (action === 'closeBooking') await restaurantApi.closeBooking();
      if (action === 'close') await restaurantApi.close(closeMessage);

      setNotice(
        action === 'open'
          ? 'Ресторан відкрито'
          : action === 'closeBooking'
            ? 'Онлайн-бронювання закрито'
            : 'Ресторан закрито',
      );

      await load();
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося змінити статус ресторану');
    } finally {
      setBusyAction(null);
    }
  }

  async function saveRestaurantSettings() {
    setBusyAction('settings:save');
    setNotice(null);
    setError(null);

    try {
      await restaurantApi.update({
        phone: phone.trim() || null,
        menuUrl: menuUrl.trim() || null,
        closeMessage: closeMessage.trim(),
        bookingClosedMessage: bookingClosedMessage.trim(),
        siteMode,
      });

      setNotice('Налаштування ресторану збережено');
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || 'Не вдалося зберегти налаштування');
    } finally {
      setBusyAction(null);
    }
  }


  async function saveAdminAccess() {
    setBusyAction('admin-access:save');
    setNotice(null);
    setError(null);

    try {
      await restaurantApi.update({
        phone: phone.trim() || null,
        adminCanManageZones,
        adminCanManageOnlineBooking,
        adminCanManageRestaurant,
        adminCanChangeSiteMode,
        adminCanEditRestaurantSettings,
      });

      setNotice('Номер адміністратора та додаткові права збережено');
      await load();
    } catch (saveError: any) {
      setError(saveError?.message || 'Не вдалося зберегти права адміністратора');
    } finally {
      setBusyAction(null);
    }
  }

  async function changeSiteMode(nextMode: SiteMode) {
    setBusyAction(`site-mode:${nextMode}`);
    setNotice(null);
    setError(null);

    try {
      await restaurantApi.update({ siteMode: nextMode });
      setSiteMode(nextMode);
      setRestaurant((current) => (current ? { ...current, siteMode: nextMode } : current));
      setNotice(`Увімкнено: ${siteModeLabel(nextMode)}`);
    } catch (modeError: any) {
      setError(modeError?.message || 'Не вдалося змінити режим сайту');
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
        await zonesApi.close(zone.id);
      } else {
        await zonesApi.open(zone.id);
      }

      setNotice(close ? `Локацію «${label}» закрито` : `Локацію «${label}» відкрито`);
      await load();
    } catch (zoneError: any) {
      setError(zoneError?.message || 'Не вдалося змінити стан локації');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="min-h-screen bg-black px-4 py-5 pb-28 text-white lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[34px] border border-amber-200/20 bg-neutral-950 p-5 shadow-2xl lg:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-100/55">MOLO Restaurant</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight lg:text-4xl">Пульт директора</h1>
              <p className="mt-2 max-w-2xl text-sm text-white/50">
                Контроль ресторану, бронювань, столів, локацій, аналітики та системних підключень.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-4 py-2 text-sm font-bold ${restaurantStatusTone(restaurant?.status)}`}>
                {restaurantStatusLabel(restaurant?.status)}
              </span>

              <span className="rounded-full border border-violet-300/25 bg-violet-400/10 px-4 py-2 text-sm font-bold text-violet-100">
                {siteModeLabel(restaurant?.siteMode || siteMode)}
              </span>

              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/75 disabled:opacity-50"
              >
                {loading ? 'Оновлюємо...' : 'Оновити'}
              </button>
            </div>
          </div>

          {(notice || error) && (
            <div className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'}`}>
              {error || notice}
            </div>
          )}
        </header>

        <nav className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {([
            ['overview', 'Огляд'],
            ['restaurant', 'Ресторан'],
            ['locations', 'Локації'],
            ['analytics', 'Аналітика'],
            ['staff', 'Команда'],
            ['system', 'Система'],
          ] as Array<[Tab, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-2xl px-4 py-4 text-sm font-bold transition active:scale-[0.98] ${
                tab === key
                  ? 'bg-amber-300 text-neutral-950 shadow-[0_0_30px_rgba(251,191,36,.14)]'
                  : 'border border-white/10 bg-neutral-950 text-white/70'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === 'overview' && (
          <section className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DirectorStat label="Бронювань сьогодні" value={stats.bookings} note={`${stats.active} активних`} />
              <DirectorStat label="Гостей сьогодні" value={stats.guests} note="У активних бронюваннях" />
              <DirectorStat label="Очікують рішення" value={stats.pending} note={`${stats.approved} підтверджено`} tone="blue" />
              <DirectorStat label="Зайняті столи" value={stats.tableStatusCounts.occupied} note={`${stats.tableStatusCounts.cleaning} готуються`} tone="red" />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
              <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-white/40">Сьогодні</p>
                    <h2 className="mt-1 text-2xl font-black">Стан ресторану</h2>
                  </div>
                  <span className="text-sm text-white/45">{dateLabel(today)}</span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <MiniMetric label="Вільні" value={stats.tableStatusCounts.free} />
                  <MiniMetric label="Очікують" value={stats.tableStatusCounts.pending} />
                  <MiniMetric label="Заброньовані" value={stats.tableStatusCounts.reserved} />
                  <MiniMetric label="Зайняті" value={stats.tableStatusCounts.occupied} />
                  <MiniMetric label="Готуються" value={stats.tableStatusCounts.cleaning} />
                  <MiniMetric label="Закриті" value={stats.tableStatusCounts.closed} />
                </div>
              </div>

              <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-white/40">Швидке керування</p>
                <h2 className="mt-1 text-2xl font-black">Режим роботи</h2>

                <div className="mt-5 grid gap-2">
                  <DirectorAction
                    label="Відкрити ресторан"
                    description="Ресторан і онлайн-бронювання працюють"
                    tone="green"
                    busy={busyAction === 'restaurant:open'}
                    onClick={() => runRestaurantAction('open')}
                  />
                  <DirectorAction
                    label="Закрити онлайн-бронювання"
                    description="Ресторан працює, нові заявки не приймаються"
                    tone="amber"
                    busy={busyAction === 'restaurant:closeBooking'}
                    onClick={() => runRestaurantAction('closeBooking')}
                  />
                  <DirectorAction
                    label="Закрити ресторан"
                    description="Гостьовий застосунок покаже повідомлення про закриття"
                    tone="red"
                    busy={busyAction === 'restaurant:close'}
                    onClick={() => runRestaurantAction('close')}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-white/40">Останні бронювання</p>
                  <h2 className="mt-1 text-2xl font-black">Події зміни</h2>
                </div>
                <span className="text-sm text-white/45">{todayBookings.length} записів</span>
              </div>

              <div className="mt-4 grid gap-2">
                {todayBookings.slice(0, 8).map((booking) => (
                  <div key={booking.id} className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-bold">Стіл №{booking.table?.tableNumber || '-'} · {booking.client?.fullName || 'Гість'}</p>
                      <p className="mt-1 text-xs text-white/45">{timeLabel(booking.bookingTime)} · {locationLabel(bookingLocationKey(booking))} · {booking.guestsCount} гостей</p>
                    </div>
                    <span className="w-fit rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70">
                      {isNoShow(booking) ? 'Гість не прийшов' : BOOKING_STATUS_LABELS[booking.status] || booking.status}
                    </span>
                  </div>
                ))}
                {!todayBookings.length && <EmptyState text="На сьогодні бронювань ще немає." />}
              </div>
            </div>
          </section>
        )}

        {tab === 'restaurant' && (
          <section className="mt-5 grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
            <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-white/40">Статус ресторану</p>
              <h2 className="mt-1 text-2xl font-black">Глобальне керування</h2>

              <div className="mt-5 grid gap-2">
                <DirectorAction
                  label="Відкрити ресторан"
                  description="Увімкнути повну роботу"
                  tone="green"
                  busy={busyAction === 'restaurant:open'}
                  onClick={() => runRestaurantAction('open')}
                />
                <DirectorAction
                  label="Закрити онлайн-бронювання"
                  description="Зал працює, онлайн-заявки зупинені"
                  tone="amber"
                  busy={busyAction === 'restaurant:closeBooking'}
                  onClick={() => runRestaurantAction('closeBooking')}
                />
                <DirectorAction
                  label="Закрити ресторан"
                  description="Повністю закрити гостьовий доступ"
                  tone="red"
                  busy={busyAction === 'restaurant:close'}
                  onClick={() => runRestaurantAction('close')}
                />
              </div>
            </div>

            <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-white/40">Контакти та повідомлення</p>
              <h2 className="mt-1 text-2xl font-black">Налаштування ресторану</h2>

              <div className="mt-5 grid gap-4">
                <Field label="Номер адміністратора (Telegram і дзвінок гостя)">
                  <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+380..." className="director-input" />
                </Field>

                <Field label="Посилання на меню">
                  <input value={menuUrl} onChange={(event) => setMenuUrl(event.target.value)} placeholder="https://..." className="director-input" />
                </Field>

                <Field label="Повідомлення при закритті ресторану">
                  <textarea value={closeMessage} onChange={(event) => setCloseMessage(event.target.value)} className="director-input min-h-28 resize-y" />
                </Field>

                <Field label="Повідомлення при закритому онлайн-бронюванні">
                  <textarea value={bookingClosedMessage} onChange={(event) => setBookingClosedMessage(event.target.value)} className="director-input min-h-28 resize-y" />
                </Field>

                <button
                  type="button"
                  onClick={saveRestaurantSettings}
                  disabled={busyAction === 'settings:save'}
                  className="rounded-2xl bg-amber-300 px-5 py-4 font-black text-neutral-950 transition active:scale-[0.98] disabled:opacity-50"
                >
                  {busyAction === 'settings:save' ? 'Зберігаємо...' : 'Зберегти налаштування'}
                </button>
              </div>
            </div>

            <div className="rounded-[30px] border border-violet-300/15 bg-neutral-950 p-5 xl:col-span-2">
              <p className="text-xs uppercase tracking-[0.2em] text-white/40">Вигляд гостьового сайту</p>
              <h2 className="mt-1 text-2xl font-black">Режим: день, ніч або свято</h2>
              <p className="mt-2 text-sm text-white/45">
                Режим змінюється одразу для гостей і зберігається в базі.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {([
                  ['day', 'День', 'Світліший і тепліший вигляд'],
                  ['night', 'Ніч', 'Темний ресторанний вигляд'],
                  ['holiday', 'Свято', 'Святкове золоте оформлення'],
                ] as Array<[SiteMode, string, string]>).map(([mode, label, description]) => {
                  const active = siteMode === mode;
                  const busy = busyAction === `site-mode:${mode}`;

                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => changeSiteMode(mode)}
                      disabled={busy}
                      className={`rounded-2xl border p-4 text-left transition active:scale-[0.98] disabled:opacity-50 ${
                        active
                          ? 'border-amber-200/60 bg-amber-300/15 text-amber-100'
                          : 'border-white/10 bg-white/[0.03] text-white/70'
                      }`}
                    >
                      <p className="text-lg font-black">{busy ? 'Змінюємо...' : label}</p>
                      <p className="mt-1 text-xs opacity-65">{description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {tab === 'locations' && (
          <section className="mt-5 space-y-5">
            <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-white/40">Локації та столи</p>
              <h2 className="mt-1 text-2xl font-black">Завантаження ресторану</h2>
              <p className="mt-2 text-sm text-white/45">Директор бачить стан усіх локацій і може відкрити або закрити кожну зону. Закрита локація недоступна для нових бронювань.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {locationStats.map((location) => (
                <div key={location.key} className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-black">{location.label}</h3>
                      <p className="mt-1 text-sm text-white/45">{location.description}</p>
                      <span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-bold ${
                        location.isClosed
                          ? 'border-red-300/30 bg-red-500/10 text-red-100'
                          : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
                      }`}>
                        {location.zone
                          ? location.isClosed
                            ? 'Локація закрита'
                            : 'Локація відкрита'
                          : 'Зона не прив’язана'}
                      </span>
                    </div>
                    <span className="rounded-2xl border border-amber-200/35 bg-amber-300/10 px-3 py-2 text-xl font-black text-amber-100">
                      {location.tables}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <MiniMetric label="Бронювання" value={location.bookings} compact />
                    <MiniMetric label="Гості" value={location.guests} compact />
                    <MiniMetric label="Зайняті" value={location.occupied} compact />
                    <MiniMetric label="Вільні" value={location.free} compact />
                    <MiniMetric label="Готуються" value={location.cleaning} compact />
                    <MiniMetric label="Закриті" value={location.closed} compact />
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => changeLocationState(location.zone, false, location.label)}
                      disabled={!location.zone || busyAction === `zone:${location.zone?.id}:open` || !location.isClosed}
                      className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-4 py-3 text-sm font-black text-emerald-100 disabled:opacity-35"
                    >
                      Відкрити
                    </button>
                    <button
                      type="button"
                      onClick={() => changeLocationState(location.zone, true, location.label)}
                      disabled={!location.zone || busyAction === `zone:${location.zone?.id}:close` || location.isClosed}
                      className="rounded-2xl border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-100 disabled:opacity-35"
                    >
                      Закрити
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
              <h2 className="text-2xl font-black">Усі столи</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
                {tables.map((table) => (
                  <div key={table.id} className={`rounded-2xl border p-3 ${TABLE_STATUS_TONE[table.status]}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black">Стіл №{table.tableNumber}</span>
                      <span className="text-xs">{TABLE_STATUS_LABELS[table.status]}</span>
                    </div>
                    <p className="mt-1 text-xs opacity-70">{locationLabel(tableLocationKey(table))}</p>
                  </div>
                ))}
                {!tables.length && <EmptyState text="Столи ще не завантажилися." />}
              </div>
            </div>
          </section>
        )}

        {tab === 'analytics' && (
          <section className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DirectorStat label="Завершено" value={stats.completed} note="Бронювань сьогодні" tone="green" />
              <DirectorStat label="Скасовано" value={stats.cancelled} note="Включно з no-show" />
              <DirectorStat label="Гість не прийшов" value={stats.noShow} note="Позначено адміністратором" tone="red" />
              <DirectorStat label="Завантаження столів" value={`${stats.tableStatusCounts.occupied}/${tables.length || 0}`} note="Зайнято зараз" tone="blue" />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-white/40">Сьогодні</p>
                <h2 className="mt-1 text-2xl font-black">Популярні столи</h2>
                <div className="mt-4 grid gap-2">
                  {topTables.map(([tableNumber, count], index) => (
                    <RankRow key={tableNumber} rank={index + 1} label={`Стіл №${tableNumber}`} value={`${count} бронювань`} />
                  ))}
                  {!topTables.length && <EmptyState text="Ще немає даних для рейтингу." />}
                </div>
              </div>

              <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-white/40">Сьогодні</p>
                <h2 className="mt-1 text-2xl font-black">Популярні локації</h2>
                <div className="mt-4 grid gap-2">
                  {topLocations.map((location, index) => (
                    <RankRow key={location.key} rank={index + 1} label={location.label} value={`${location.bookings} бронювань`} />
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-amber-200/20 bg-amber-300/[0.06] p-5">
              <h2 className="text-xl font-black text-amber-100">Наступне підключення аналітики</h2>
              <p className="mt-2 text-sm text-white/55">
                Далі підключимо періоди: день, тиждень, місяць; виручку з POS/Expz; швидкість відповіді офіціантів; історію no-show та постійних гостей.
              </p>
            </div>
          </section>
        )}

        {tab === 'staff' && (
          <section className="mt-5 space-y-5">
            <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-white/40">Адміністратор</p>
              <h2 className="mt-1 text-2xl font-black">Один закріплений номер і додаткові права</h2>
              <p className="mt-2 text-sm text-white/45">
                У ресторані один номер адміністратора. Бронювання, гості й керування столами доступні йому за замовчуванням. Нижче Директор додає тільки розширені можливості.
              </p>
            </div>

            <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
              <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-white/40">Закріплений номер</p>
                <h3 className="mt-1 text-xl font-black">Адміністратор ресторану</h3>
                <p className="mt-2 text-sm text-white/45">
                  Цей номер використовується для Telegram адміністратора та показується гостю для дзвінка.
                </p>

                <label className="mt-5 block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/45">Номер телефону</span>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+380..."
                    className="director-input"
                  />
                </label>

                <div className="mt-5 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] p-4">
                  <p className="font-black text-emerald-100">Права за замовчуванням</p>
                  <div className="mt-3 grid gap-2 text-sm text-white/65">
                    <span>✓ Бронювання: прийняти, відхилити, перенести</span>
                    <span>✓ Гість прийшов / гість не прийшов</span>
                    <span>✓ Статуси всіх столів</span>
                    <span>✓ Клієнти та дзвінок гостю</span>
                  </div>
                </div>
              </div>

              <div className="rounded-[30px] border border-amber-200/20 bg-neutral-950 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-100/55">Додаткові права від Директора</p>
                <h3 className="mt-1 text-xl font-black">Що зʼявиться в панелі адміністратора</h3>

                <div className="mt-5 grid gap-3">
                  <PermissionToggle
                    checked={adminCanManageZones}
                    onChange={setAdminCanManageZones}
                    title="Відкривати та закривати локації"
                    description="Навіс, альтанки, набережна та інші зони."
                  />
                  <PermissionToggle
                    checked={adminCanManageOnlineBooking}
                    onChange={setAdminCanManageOnlineBooking}
                    title="Відкривати та закривати онлайн-бронювання"
                    description="Ресторан працює, але нові заявки можна зупинити або відновити."
                  />
                  <PermissionToggle
                    checked={adminCanManageRestaurant}
                    onChange={setAdminCanManageRestaurant}
                    title="Відкривати та закривати весь ресторан"
                    description="Повне керування глобальним статусом ресторану."
                  />
                  <PermissionToggle
                    checked={adminCanChangeSiteMode}
                    onChange={setAdminCanChangeSiteMode}
                    title="Перемикати День / Ніч / Свято"
                    description="Зміна оформлення гостьового сайту."
                  />
                  <PermissionToggle
                    checked={adminCanEditRestaurantSettings}
                    onChange={setAdminCanEditRestaurantSettings}
                    title="Змінювати меню та повідомлення"
                    description="Посилання на меню, текст закриття і текст зупинки бронювання. Закріплений номер змінює тільки Директор."
                  />
                </div>

                <button
                  type="button"
                  onClick={saveAdminAccess}
                  disabled={busyAction === 'admin-access:save'}
                  className="mt-5 w-full rounded-2xl bg-amber-300 px-5 py-4 font-black text-neutral-950 transition active:scale-[0.98] disabled:opacity-50"
                >
                  {busyAction === 'admin-access:save' ? 'Зберігаємо...' : 'Зберегти номер і права адміністратора'}
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <RoleCard
                title="Директор"
                description="Завжди має повний доступ."
                permissions={['Ресторан і локації', 'Режими сайту', 'Налаштування', 'Аналітика', 'Додаткові права адміністратора']}
              />
              <RoleCard
                title="Адміністратор"
                description="Один закріплений номер. Основні робочі функції вже доступні."
                permissions={['Бронювання', 'Гості', 'Всі столи', 'No-show', 'Тільки дозволені Директором додаткові кнопки']}
              />
              <RoleCard
                title="Офіціант"
                description="Працює зі своїми столами та викликами гостей."
                permissions={['Мої столи', 'Гість прийшов', 'Стіл готується', 'Стіл вільний', 'Виклики']}
              />
            </div>
          </section>
        )}

        {tab === 'system' && (
          <section className="mt-5 space-y-5">
            <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-white/40">Системні підключення</p>
              <h2 className="mt-1 text-2xl font-black">Telegram, POS та Expz</h2>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <SystemCard title="Telegram Bot" status="Наступний етап" description="Бронювання, підтвердження, no-show, виклики офіціанта та термінові сповіщення." />
              <SystemCard title="Telegram Mini App" status="Після бота" description="Запуск гостьового застосунку безпосередньо всередині Telegram." />
              <SystemCard title="POS" status="Підготовлено" description="Окремий фізичний статус столу та статус рахунку." />
              <SystemCard title="Expz" status="Підготовлено" description="Майбутня синхронізація столів, замовлень і закриття рахунків." />
              <SystemCard title="Журнал дій" status="Наступний етап" description="Хто змінив статус, підтвердив бронь, закрив стіл або прийняв виклик." />
              <SystemCard title="Аварійний режим" status="Наступний етап" description="Швидке вимкнення сайту, бронювання або окремих локацій." />
            </div>

            <div className="rounded-[30px] border border-white/10 bg-neutral-950 p-5">
              <h2 className="text-xl font-black">Поточний стан</h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <SystemMetric label="Backend" value="Підключено" />
                <SystemMetric label="База бронювань" value="Підключено" />
                <SystemMetric label="Карти столів" value="Підключено" />
                <SystemMetric label="Виклики офіціанта" value="Тестовий режим" />
              </div>
            </div>
          </section>
        )}
      </div>

      <style>
        {`
          .director-input {
            width: 100%;
            border-radius: 1rem;
            border: 1px solid rgba(255,255,255,.12);
            background: rgba(255,255,255,.04);
            padding: .9rem 1rem;
            color: white;
            outline: none;
          }

          .director-input:focus {
            border-color: rgba(253,230,138,.5);
            box-shadow: 0 0 0 3px rgba(251,191,36,.08);
          }
        `}
      </style>
    </div>
  );
}

function DirectorStat({
  label,
  value,
  note,
  tone = 'amber',
}: {
  label: string;
  value: number | string;
  note: string;
  tone?: 'amber' | 'blue' | 'red' | 'green';
}) {
  const valueClass =
    tone === 'blue'
      ? 'text-sky-200'
      : tone === 'red'
        ? 'text-red-200'
        : tone === 'green'
          ? 'text-emerald-200'
          : 'text-amber-200';

  return (
    <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
      <p className="text-sm text-white/45">{label}</p>
      <p className={`mt-3 text-4xl font-black ${valueClass}`}>{value}</p>
      <p className="mt-2 text-xs text-white/35">{note}</p>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: number | string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/[0.03] ${compact ? 'p-3' : 'p-4'}`}>
      <p className="text-xs text-white/40">{label}</p>
      <p className={`${compact ? 'mt-1 text-xl' : 'mt-2 text-2xl'} font-black text-white`}>{value}</p>
    </div>
  );
}

function DirectorAction({
  label,
  description,
  tone,
  busy,
  onClick,
}: {
  label: string;
  description: string;
  tone: 'green' | 'amber' | 'red';
  busy: boolean;
  onClick: () => void;
}) {
  const toneClass =
    tone === 'green'
      ? 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100'
      : tone === 'red'
        ? 'border-red-300/30 bg-red-500/10 text-red-100'
        : 'border-amber-300/30 bg-amber-400/10 text-amber-100';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded-2xl border p-4 text-left transition active:scale-[0.99] disabled:opacity-50 ${toneClass}`}
    >
      <p className="font-black">{busy ? 'Зачекайте...' : label}</p>
      <p className="mt-1 text-xs opacity-70">{description}</p>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/45">{label}</span>
      {children}
    </label>
  );
}

function RankRow({ rank, label, value }: { rank: number; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-200/30 bg-amber-300/10 font-black text-amber-100">
          {rank}
        </span>
        <span className="font-bold">{label}</span>
      </div>
      <span className="text-sm text-white/50">{value}</span>
    </div>
  );
}

function PermissionToggle({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between gap-4 rounded-2xl border p-4 text-left transition active:scale-[0.99] ${
        checked
          ? 'border-emerald-300/35 bg-emerald-400/10'
          : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <div>
        <p className={checked ? 'font-black text-emerald-100' : 'font-black text-white'}>{title}</p>
        <p className="mt-1 text-xs text-white/45">{description}</p>
      </div>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${
          checked ? 'bg-emerald-400' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
            checked ? 'left-6' : 'left-1'
          }`}
        />
      </span>
    </button>
  );
}

function RoleCard({
  title,
  description,
  permissions,
}: {
  title: string;
  description: string;
  permissions: string[];
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
      <h3 className="text-xl font-black">{title}</h3>
      <p className="mt-2 text-sm text-white/45">{description}</p>
      <div className="mt-4 grid gap-2">
        {permissions.map((permission) => (
          <div key={permission} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70">
            {permission}
          </div>
        ))}
      </div>
    </div>
  );
}

function SystemCard({
  title,
  status,
  description,
}: {
  title: string;
  status: string;
  description: string;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-neutral-950 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xl font-black">{title}</h3>
        <span className="rounded-full border border-amber-200/25 bg-amber-300/10 px-3 py-1 text-xs text-amber-100">{status}</span>
      </div>
      <p className="mt-3 text-sm text-white/45">{description}</p>
    </div>
  );
}

function SystemMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-white/40">{label}</p>
      <p className="mt-2 font-black text-emerald-100">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-center text-sm text-white/40">
      {text}
    </div>
  );
}
