import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Armchair,
  Bell,
  CalendarClock,
  CalendarDays,
  CircleAlert,
  History,
  LayoutDashboard,
  MapPin,
  MessageSquareText,
  MoreHorizontal,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';

import AdminVisualTablePlanner from '../admin/AdminVisualTablePlanner';
import { bookingsApi } from '../api/bookings';
import { broadcastsApi } from '../api/broadcasts';
import { clientsApi } from '../api/clients';
import { logsApi, type LogRecord } from '../api/logs';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { reviewsApi, type GuestReviewRecord } from '../api/reviews';
import { staffApi, type StaffMember } from '../api/staff';
import { zonesApi } from '../api/zones';
import type { Booking, Client, FullMapResponse, Restaurant, SiteMode, Zone } from '../api/types';

type Tab = 'overview' | 'bookings' | 'locations' | 'guests' | 'team' | 'site' | 'more';
type BookingFilter = 'all' | 'pending' | 'approved' | 'completed' | 'cancelled' | 'no_show';
type LocationKey = 'hall' | 'canopy' | 'gazebo' | 'rotang' | 'embankment' | 'glass' | 'water';

type AdminRights = {
  zones: boolean;
  onlineBooking: boolean;
  restaurant: boolean;
  siteMode: boolean;
  settings: boolean;
  blacklist: boolean;
  reviews: boolean;
  shifts: boolean;
  broadcasts: boolean;
};

const EMPTY_RIGHTS: AdminRights = {
  zones: false,
  onlineBooking: false,
  restaurant: false,
  siteMode: false,
  settings: false,
  blacklist: false,
  reviews: false,
  shifts: false,
  broadcasts: false,
};

const LOCATIONS: Array<{ key: LocationKey; label: string; from: number; to: number }> = [
  { key: 'hall', label: 'Зал ресторану', from: 1, to: 14 },
  { key: 'canopy', label: 'Навіс', from: 15, to: 20 },
  { key: 'gazebo', label: 'Велика альтанка', from: 21, to: 36 },
  { key: 'rotang', label: 'Ротанг', from: 37, to: 39 },
  { key: 'embankment', label: 'Набережна', from: 40, to: 44 },
  { key: 'glass', label: 'Скляна альтанка', from: 45, to: 50 },
  { key: 'water', label: 'Альтанка на воді', from: 100, to: 109 },
];

const STATUS_LABEL: Record<string, string> = {
  pending: 'Очікує',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  cancelled: 'Скасовано',
  completed: 'Завершено',
  no_show: 'Гість не прийшов',
};

function kyivDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '-';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}.${month}.${year}` : String(value);
}

function timeLabel(value: string | null | undefined): string {
  if (!value) return '--:--';
  return String(value).slice(0, 5);
}

function isNoShow(booking: Booking): boolean {
  return String(booking.wishes || '').includes('[NO_SHOW]');
}

function bookingStatus(booking: Booking): BookingFilter {
  return isNoShow(booking) ? 'no_show' : (booking.status as BookingFilter);
}

function locationKey(tableNumber: string | number | null | undefined): LocationKey | null {
  const number = Number(tableNumber || 0);
  return LOCATIONS.find((item) => number >= item.from && number <= item.to)?.key || null;
}

function locationName(tableNumber: string | number | null | undefined): string {
  const key = locationKey(tableNumber);
  return LOCATIONS.find((item) => item.key === key)?.label || 'Інша локація';
}

function rightsFromRestaurant(restaurant: Restaurant): AdminRights {
  return {
    zones: Boolean(restaurant.adminCanManageZones),
    onlineBooking: Boolean(restaurant.adminCanManageOnlineBooking),
    restaurant: Boolean(restaurant.adminCanManageRestaurant),
    siteMode: Boolean(restaurant.adminCanChangeSiteMode),
    settings: Boolean(restaurant.adminCanEditRestaurantSettings),
    blacklist: Boolean(restaurant.adminCanManageBlacklist),
    reviews: Boolean(restaurant.adminCanRespondReviews),
    shifts: Boolean(restaurant.adminCanManageStaffShifts),
    broadcasts: Boolean(restaurant.adminCanSendBroadcasts),
  };
}

function statusText(status: Restaurant['status'] | undefined): string {
  if (status === 'open') return 'Ресторан відкритий';
  if (status === 'booking_closed') return 'Онлайн-бронювання закрито';
  return 'Ресторан закритий';
}

export default function CompactDirectorPanel() {
  const today = useMemo(() => kyivDate(), []);
  const [tab, setTab] = useState<Tab>('overview');
  const [selectedDate, setSelectedDate] = useState(today);
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>('all');
  const [search, setSearch] = useState('');
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [reviews, setReviews] = useState<GuestReviewRecord[]>([]);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [sendToAll, setSendToAll] = useState(false);
  const [adminRights, setAdminRights] = useState<AdminRights>(EMPTY_RIGHTS);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    const [restaurantResult, bookingsResult, mapResult, clientsResult, staffResult, reviewsResult, logsResult] = await Promise.allSettled([
      restaurantApi.get(),
      selectedDate === today ? bookingsApi.getToday() : bookingsApi.getByDate(selectedDate),
      mapApi.get(),
      clientsApi.getAll(),
      staffApi.getAll(),
      reviewsApi.getAll(),
      logsApi.getAll(),
    ]);

    if (restaurantResult.status === 'fulfilled') {
      setRestaurant(restaurantResult.value);
      setAdminRights(rightsFromRestaurant(restaurantResult.value));
    }
    if (bookingsResult.status === 'fulfilled') setBookings(bookingsResult.value);
    if (mapResult.status === 'fulfilled') setMap(mapResult.value);
    if (clientsResult.status === 'fulfilled') setClients(clientsResult.value);
    if (staffResult.status === 'fulfilled') setStaff(staffResult.value);
    if (reviewsResult.status === 'fulfilled') setReviews(reviewsResult.value);
    if (logsResult.status === 'fulfilled') setLogs(logsResult.value);

    const failed = [restaurantResult, bookingsResult, mapResult].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) setError(failed.reason?.message || 'Не вдалося оновити пульт');
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(interval);
  }, [selectedDate]);

  const activeBookings = useMemo(
    () => bookings.filter((booking) => ['pending', 'approved'].includes(booking.status) && !isNoShow(booking)),
    [bookings],
  );

  const stats = useMemo(() => ({
    pending: bookings.filter((booking) => booking.status === 'pending').length,
    guests: activeBookings.reduce((sum, booking) => sum + Number(booking.guestsCount || 0), 0),
    occupied: (map?.tables || []).filter((table) => table.status === 'occupied').length,
    cleaning: (map?.tables || []).filter((table) => table.status === 'cleaning').length,
    closedLocations: (map?.zones || []).filter((zone) => zone.isClosed).length,
    onShift: staff.filter((member) => member.isOnShift && member.active && !member.isArchived).length,
  }), [bookings, activeBookings, map, staff]);

  const filteredBookings = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...bookings]
      .filter((booking) => bookingFilter === 'all' || bookingStatus(booking) === bookingFilter)
      .filter((booking) => !needle || [
        booking.client?.fullName,
        booking.client?.phone,
        booking.table?.tableNumber,
        booking.table?.zone?.name,
      ].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((left, right) => String(left.bookingTime).localeCompare(String(right.bookingTime)));
  }, [bookings, bookingFilter, search]);

  const filteredClients = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...clients]
      .filter((client) => !needle || `${client.fullName} ${client.phone}`.toLowerCase().includes(needle))
      .sort((left, right) => Number(right.visitsCount || 0) - Number(left.visitsCount || 0));
  }, [clients, search]);

  const locations = useMemo(() => LOCATIONS.map((location) => {
    const tables = (map?.tables || []).filter((table) => locationKey(table.tableNumber) === location.key);
    const zone = (map?.zones || []).find((candidate) => tables.some((table) => table.zone?.id === candidate.id)) || null;
    const locationBookings = bookings.filter((booking) => locationKey(booking.table?.tableNumber) === location.key);
    return {
      ...location,
      zone,
      bookings: locationBookings.length,
      occupied: tables.filter((table) => table.status === 'occupied').length,
      cleaning: tables.filter((table) => table.status === 'cleaning').length,
    };
  }), [map, bookings]);

  const attention = useMemo(() => {
    const items: Array<{ title: string; text: string; tone: 'amber' | 'red' | 'cyan' }> = [];
    const pending = bookings.filter((booking) => booking.status === 'pending');
    const unansweredReviews = reviews.filter((review) => !review.responseText);
    if (pending.length) items.push({ title: `${pending.length} бронювань очікують`, text: 'Потрібне рішення Адміністратора', tone: 'amber' });
    if (stats.cleaning) items.push({ title: `${stats.cleaning} столів готуються`, text: 'Перевірте тривалість підготовки', tone: 'cyan' });
    if (stats.closedLocations) items.push({ title: `${stats.closedLocations} локацій закрито`, text: 'Перевірте план роботи', tone: 'red' });
    if (unansweredReviews.length) items.push({ title: `${unansweredReviews.length} відгуків без відповіді`, text: 'Письмові відгуки гостей без оцінок і зірок', tone: 'amber' });
    return items.slice(0, 4);
  }, [bookings, stats, reviews]);

  async function runRestaurant(action: 'open' | 'closeBooking' | 'close') {
    setBusy(`restaurant:${action}`);
    setError(null);
    try {
      if (action === 'open') await restaurantApi.open();
      if (action === 'closeBooking') await restaurantApi.closeBooking();
      if (action === 'close') await restaurantApi.close(restaurant?.closeMessage || 'Ресторан тимчасово зачинений');
      setNotice('Стан ресторану оновлено');
      await load(true);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося змінити стан ресторану');
    } finally {
      setBusy(null);
    }
  }

  async function changeMode(mode: SiteMode) {
    setBusy(`mode:${mode}`);
    try {
      await restaurantApi.update({ siteMode: mode, holidayKey: mode === 'holiday' ? restaurant?.holidayKey || 'new-year' : null });
      setNotice(mode === 'day' ? 'Увімкнено денний режим' : mode === 'night' ? 'Увімкнено нічний режим' : 'Увімкнено святковий режим');
      await load(true);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося змінити оформлення');
    } finally {
      setBusy(null);
    }
  }

  async function saveRights() {
    setBusy('rights');
    try {
      await restaurantApi.update({
        adminCanManageZones: adminRights.zones,
        adminCanManageOnlineBooking: adminRights.onlineBooking,
        adminCanManageRestaurant: adminRights.restaurant,
        adminCanChangeSiteMode: adminRights.siteMode,
        adminCanEditRestaurantSettings: adminRights.settings,
        adminCanManageBlacklist: adminRights.blacklist,
        adminCanRespondReviews: adminRights.reviews,
        adminCanManageStaffShifts: adminRights.shifts,
        adminCanSendBroadcasts: adminRights.broadcasts,
      });
      setNotice('Права Адміністратора збережено');
      await load(true);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося зберегти права');
    } finally {
      setBusy(null);
    }
  }

  async function changeZone(zone: Zone, close: boolean) {
    setBusy(`zone:${zone.id}`);
    try {
      if (close) await zonesApi.close(zone.id);
      else await zonesApi.open(zone.id);
      setNotice(close ? `Локацію «${zone.name}» закрито` : `Локацію «${zone.name}» відкрито`);
      await load(true);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося змінити локацію');
    } finally {
      setBusy(null);
    }
  }

  async function toggleBlacklist(client: Client) {
    const reason = window.prompt(client.isBlacklisted ? 'Причина розблокування гостя' : 'Обов’язкова причина блокування гостя', '');
    if (!reason?.trim()) return;
    setBusy(`client:${client.id}`);
    try {
      if (client.isBlacklisted) await clientsApi.unblacklist(client.id, reason.trim());
      else await clientsApi.blacklist(client.id, reason.trim());
      setNotice(client.isBlacklisted ? 'Гостя розблоковано' : 'Гостя додано до чорного списку');
      await load(true);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося змінити статус гостя');
    } finally {
      setBusy(null);
    }
  }

  async function sendBroadcast() {
    const message = broadcastText.trim();
    if (!message) return setError('Напишіть повідомлення');
    if (!sendToAll && selectedClients.size === 0) return setError('Оберіть хоча б одного гостя');
    const count = sendToAll ? clients.filter((client) => !client.isBlacklisted).length : selectedClients.size;
    const confirmation = sendToAll ? `Надіслати повідомлення всім доступним гостям? Отримувачів: ${count}` : `Надіслати повідомлення вибраним гостям? Отримувачів: ${count}`;
    if (!window.confirm(confirmation)) return;
    setBusy('broadcast');
    try {
      const result = await broadcastsApi.sendNow({
        message,
        target: sendToAll ? 'all_clients' : 'selected_clients',
        clientIds: sendToAll ? undefined : Array.from(selectedClients),
      });
      setNotice(`Розсилку надіслано. Отримувачів: ${result.recipientCount}`);
      setBroadcastOpen(false);
      setBroadcastText('');
      setSelectedClients(new Set());
      setSendToAll(false);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося надіслати розсилку');
    } finally {
      setBusy(null);
    }
  }

  async function respondToReview(review: GuestReviewRecord) {
    const text = String(reviewDrafts[review.id] || '').trim();
    if (!text) return setError('Напишіть відповідь гостю');
    setBusy(`review:${review.id}`);
    try {
      await reviewsApi.respond(review.id, text);
      setReviewDrafts((current) => ({ ...current, [review.id]: '' }));
      setNotice('Відповідь на відгук збережено');
      await load(true);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося відповісти на відгук');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-black pb-28 text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/85 backdrop-blur-2xl">
        <div className="mx-auto max-w-7xl px-3 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-xs font-black uppercase tracking-[0.22em] text-amber-100/55">MOLO · Пульт Директора</p>
              <div className="mt-1 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${restaurant?.status === 'open' ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.75)]' : restaurant?.status === 'booking_closed' ? 'bg-amber-300' : 'bg-red-500'}`} />
                <span className="truncate text-sm text-white/60">{statusText(restaurant?.status)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void load()} disabled={loading} className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-200/35 bg-amber-300/10 text-amber-100 shadow-[0_0_22px_rgba(251,191,36,.1)] disabled:opacity-40">
                <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
              <div className="relative grid h-11 w-11 place-items-center rounded-2xl border border-rose-200/30 bg-rose-400/10 text-rose-100">
                <Bell size={18} />
                {attention.length > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-black">{attention.length}</span>}
              </div>
            </div>
          </div>
          <nav className="mt-3 grid grid-cols-7 gap-1 overflow-x-auto">
            <Nav active={tab === 'overview'} icon={<LayoutDashboard size={17} />} label="Огляд" onClick={() => setTab('overview')} />
            <Nav active={tab === 'bookings'} icon={<CalendarDays size={17} />} label="Броні" onClick={() => setTab('bookings')} />
            <Nav active={tab === 'locations'} icon={<MapPin size={17} />} label="Локації" onClick={() => setTab('locations')} />
            <Nav active={tab === 'guests'} icon={<Users size={17} />} label="Гості" onClick={() => setTab('guests')} />
            <Nav active={tab === 'team'} icon={<UserRoundCheck size={17} />} label="Команда" onClick={() => setTab('team')} />
            <Nav active={tab === 'site'} icon={<Sparkles size={17} />} label="Сайт" onClick={() => setTab('site')} />
            <Nav active={tab === 'more'} icon={<MoreHorizontal size={17} />} label="Ще" onClick={() => setTab('more')} />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 p-3 sm:p-5 lg:p-6">
        {(notice || error) && <div className={`rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-300/35 bg-red-500/10 text-red-100' : 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100'}`}>{error || notice}</div>}

        {tab === 'overview' && <>
          <section className="rounded-[26px] border border-amber-200/25 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,.12),transparent_45%)] p-4 shadow-[0_0_42px_rgba(251,191,36,.08)] sm:p-5">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-100/55">Потребує уваги</p><h1 className="mt-1 text-2xl font-black">Операційний центр</h1></div><span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/65">{dateLabel(selectedDate)}</span></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{attention.length ? attention.map((item) => <Attention key={item.title} {...item} />) : <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/10 p-4 text-emerald-100 sm:col-span-2 lg:col-span-4"><ShieldCheck size={20} /><p className="mt-2 font-black">Усе спокійно</p></div>}</div>
          </section>
          <section className="grid grid-cols-2 gap-2 lg:grid-cols-4"><Metric label="Очікують рішення" value={stats.pending} tone="amber" /><Metric label="Гостей очікується" value={stats.guests} tone="violet" /><Metric label="Столів зайнято" value={stats.occupied} tone="red" /><Metric label="Працівників на зміні" value={stats.onShift} tone="cyan" /></section>
          <section className="grid gap-3 lg:grid-cols-[1.15fr_.85fr]">
            <GlassCard title="Найближчі бронювання" eyebrow={dateLabel(selectedDate)}><div className="space-y-2">{filteredBookings.slice(0, 5).map((booking) => <BookingLine key={booking.id} booking={booking} />)}{!filteredBookings.length && <Empty text="Бронювань немає" />}</div></GlassCard>
            <GlassCard title="Швидке керування" eyebrow="Ресторан"><div className="grid gap-2"><Action label="Відкрити ресторан" tone="green" disabled={Boolean(busy)} onClick={() => void runRestaurant('open')} /><Action label="Закрити онлайн-бронювання" tone="amber" disabled={Boolean(busy)} onClick={() => void runRestaurant('closeBooking')} /><Action label="Закрити ресторан" tone="red" disabled={Boolean(busy)} onClick={() => void runRestaurant('close')} /></div></GlassCard>
          </section>
        </>}

        {tab === 'bookings' && <section className="space-y-3"><Heading title="Бронювання" subtitle="Сьогодні, майбутні дати та архів через календар." /><div className="grid gap-2 rounded-[22px] border border-white/10 bg-neutral-950 p-3 sm:grid-cols-[auto_1fr]"><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="h-12 rounded-2xl border border-white/10 bg-black/40 px-4 text-sm [color-scheme:dark]" /><label className="relative"><Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ім’я, телефон, стіл або локація" className="h-12 w-full rounded-2xl border border-white/10 bg-black/40 pl-11 pr-4 text-sm outline-none focus:border-amber-200/40" /></label></div><div className="flex gap-2 overflow-x-auto pb-1">{([['all','Усі'],['pending','Очікують'],['approved','Підтверджені'],['no_show','Гості не прийшли'],['completed','Завершені'],['cancelled','Скасовані']] as Array<[BookingFilter,string]>).map(([value,label]) => <button key={value} type="button" onClick={() => setBookingFilter(value)} className={`whitespace-nowrap rounded-2xl border px-3 py-2.5 text-xs font-bold ${bookingFilter === value ? 'border-amber-200/50 bg-amber-300/15 text-amber-100' : 'border-white/10 bg-white/[0.03] text-white/50'}`}>{label}</button>)}</div><div className="space-y-2">{filteredBookings.map((booking) => <BookingLine key={booking.id} booking={booking} detailed />)}{!filteredBookings.length && <Empty text="Бронювань не знайдено" />}</div></section>}

        {tab === 'locations' && <section className="space-y-3"><Heading title="Локації" subtitle="Компактний стан зон і окреме планування майбутніх дат." /><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{locations.map((location) => <article key={location.key} className="rounded-[22px] border border-white/10 bg-neutral-950 p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${location.zone?.isClosed ? 'bg-red-500' : 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.7)]'}`} /><h3 className="font-black">{location.label}</h3></div><p className="mt-2 text-xs text-white/40">{location.bookings} бронювань · {location.occupied} зайнято · {location.cleaning} готується</p></div><Armchair size={19} className="text-white/30" /></div>{location.zone && <button type="button" disabled={Boolean(busy)} onClick={() => void changeZone(location.zone as Zone, !location.zone?.isClosed)} className={`mt-3 w-full rounded-2xl border px-3 py-2.5 text-xs font-black ${location.zone.isClosed ? 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100' : 'border-red-300/30 bg-red-500/10 text-red-100'}`}>{location.zone.isClosed ? 'Відкрити локацію' : 'Закрити локацію'}</button>}</article>)}</div><button type="button" onClick={() => setPlannerOpen(true)} className="flex w-full items-center justify-between rounded-[22px] border border-fuchsia-200/30 bg-fuchsia-400/10 p-4 text-left text-fuchsia-100 shadow-[0_0_26px_rgba(217,70,239,.08)]"><div><p className="font-black">Планування на майбутні дати</p><p className="mt-1 text-xs text-white/45">Доступність столів і локацій за датою та часом</p></div><CalendarClock size={21} /></button></section>}

        {tab === 'guests' && <section className="space-y-3"><Heading title="База гостей" subtitle="Відвідування, чорний список і ручна розсилка." /><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><label className="relative"><Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ім’я або телефон" className="h-12 w-full rounded-2xl border border-white/10 bg-neutral-950 pl-11 pr-4 text-sm outline-none focus:border-violet-200/40" /></label><button type="button" onClick={() => setBroadcastOpen(true)} className="rounded-2xl border border-violet-200/35 bg-violet-400/10 px-5 py-3 text-sm font-black text-violet-100 shadow-[0_0_24px_rgba(167,139,250,.09)]"><Send size={16} className="mr-2 inline" />Обрати гостей</button></div><div className="space-y-2">{filteredClients.map((client) => <article key={client.id} className={`rounded-[22px] border p-4 ${client.isBlacklisted ? 'border-red-300/30 bg-red-500/[0.07]' : 'border-white/10 bg-neutral-950'}`}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{client.fullName}</h3>{client.isRegular && <Badge text="Постійний гість" tone="violet" />}{client.isBlacklisted && <Badge text="Чорний список" tone="red" />}</div><p className="mt-1 text-sm text-amber-100">{client.phone}</p><p className="mt-2 text-xs text-white/40">{client.visitsCount} відвідувань · {client.totalGuests} гостей загалом</p></div><button type="button" disabled={Boolean(busy)} onClick={() => void toggleBlacklist(client)} className={`rounded-2xl border px-3 py-2.5 text-xs font-black ${client.isBlacklisted ? 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100' : 'border-red-300/30 bg-red-500/10 text-red-100'}`}>{client.isBlacklisted ? 'Розблокувати' : 'Заблокувати'}</button></div></article>)}{!filteredClients.length && <Empty text="Гостей не знайдено" />}</div></section>}

        {tab === 'team' && <section className="space-y-3"><Heading title="Команда" subtitle="Хто зараз на зміні та які права має Адміністратор." /><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{staff.filter((member) => !member.isArchived).map((member) => <article key={member.id} className="rounded-[22px] border border-white/10 bg-neutral-950 p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-black">{member.fullName}</p><p className="mt-1 text-xs text-white/40">{member.role === 'owner' ? 'Директор' : member.role === 'admin' ? 'Адміністратор' : member.role === 'waiter' ? 'Офіціант' : 'Кальянник'}</p></div><span className={`h-3 w-3 rounded-full ${member.isOnShift ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.7)]' : 'bg-white/20'}`} /></div><p className="mt-3 text-xs text-white/45">{member.isOnShift ? `На зміні${member.shiftStartedAt ? ` з ${new Date(member.shiftStartedAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}` : ''}` : 'Не на зміні'}</p></article>)}</div><GlassCard title="Права Адміністратора" eyebrow="Директор керує доступом"><div className="grid gap-2 sm:grid-cols-2"><RightToggle label="Керувати локаціями" value={adminRights.zones} onChange={(value) => setAdminRights((current) => ({ ...current, zones: value }))} /><RightToggle label="Керувати онлайн-бронюванням" value={adminRights.onlineBooking} onChange={(value) => setAdminRights((current) => ({ ...current, onlineBooking: value }))} /><RightToggle label="Відкривати та закривати ресторан" value={adminRights.restaurant} onChange={(value) => setAdminRights((current) => ({ ...current, restaurant: value }))} /><RightToggle label="Перемикати День / Ніч / Свято" value={adminRights.siteMode} onChange={(value) => setAdminRights((current) => ({ ...current, siteMode: value }))} /><RightToggle label="Змінювати меню та повідомлення" value={adminRights.settings} onChange={(value) => setAdminRights((current) => ({ ...current, settings: value }))} /><RightToggle label="Керувати чорним списком" value={adminRights.blacklist} onChange={(value) => setAdminRights((current) => ({ ...current, blacklist: value }))} /><RightToggle label="Відповідати на відгуки" value={adminRights.reviews} onChange={(value) => setAdminRights((current) => ({ ...current, reviews: value }))} /><RightToggle label="Керувати змінами персоналу" value={adminRights.shifts} onChange={(value) => setAdminRights((current) => ({ ...current, shifts: value }))} /><RightToggle label="Створювати ручні розсилки" value={adminRights.broadcasts} onChange={(value) => setAdminRights((current) => ({ ...current, broadcasts: value }))} /></div><button type="button" onClick={() => void saveRights()} disabled={busy === 'rights'} className="mt-3 w-full rounded-2xl border border-amber-200/45 bg-amber-300/15 px-4 py-3 text-sm font-black text-amber-100 disabled:opacity-40">Зберегти права</button></GlassCard></section>}

        {tab === 'site' && <section className="space-y-3"><Heading title="Сайт" subtitle="Режим оформлення без зміни фотографій, SVG і карт столів." /><GlassCard title="Оформлення" eyebrow="День · Ніч · Свято"><div className="grid gap-2 sm:grid-cols-3"><Action label="День" tone="green" disabled={Boolean(busy)} onClick={() => void changeMode('day')} /><Action label="Ніч" tone="amber" disabled={Boolean(busy)} onClick={() => void changeMode('night')} /><button type="button" disabled={Boolean(busy)} onClick={() => void changeMode('holiday')} className="rounded-2xl border border-fuchsia-200/35 bg-fuchsia-400/10 px-4 py-3 text-sm font-black text-fuchsia-100 disabled:opacity-40">Свято</button></div></GlassCard></section>}

        {tab === 'more' && <section className="space-y-3"><Heading title="Ще" subtitle="Письмові відгуки, історія та інтеграції." /><GlassCard title="Письмові відгуки гостей" eyebrow={`${reviews.length} відгуків`}><div className="space-y-2">{reviews.slice(0, 30).map((review) => <article key={review.id} className="rounded-2xl border border-white/10 bg-black/25 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{review.booking?.client?.fullName || 'Гість'}</p><p className="mt-1 text-xs text-white/40">{dateLabel(review.booking?.bookingDate)} · Стіл №{review.booking?.table?.tableNumber || '-'}</p></div><MessageSquareText size={18} className="text-violet-200" /></div><p className="mt-3 whitespace-pre-wrap text-sm text-white/70">{review.text}</p>{review.responseText ? <div className="mt-3 rounded-2xl border border-emerald-300/25 bg-emerald-400/[0.07] p-3"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-100/55">Відповідь</p><p className="mt-2 whitespace-pre-wrap text-sm text-emerald-50">{review.responseText}</p></div> : <div className="mt-3"><textarea value={reviewDrafts[review.id] || ''} onChange={(event) => setReviewDrafts((current) => ({ ...current, [review.id]: event.target.value }))} placeholder="Напишіть відповідь гостю" className="min-h-24 w-full resize-none rounded-2xl border border-white/10 bg-black/40 p-3 text-sm outline-none focus:border-violet-200/40" /><button type="button" disabled={busy === `review:${review.id}` || !String(reviewDrafts[review.id] || '').trim()} onClick={() => void respondToReview(review)} className="mt-2 w-full rounded-2xl border border-violet-200/35 bg-violet-400/10 px-3 py-2.5 text-xs font-black text-violet-100 disabled:opacity-40">Відповісти</button></div>}</article>)}{!reviews.length && <Empty text="Письмових відгуків ще немає" />}</div></GlassCard><GlassCard title="Історія дій" eyebrow="Останні записи"><div className="space-y-2">{logs.slice(0, 30).map((log) => <div key={log.id} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/25 p-3"><History size={16} className="mt-0.5 shrink-0 text-cyan-200" /><div><p className="text-sm font-bold">{log.action}</p><p className="mt-1 text-xs text-white/40">{log.staff?.role === 'owner' ? 'Директор' : log.staff?.fullName || ''}{log.staff ? ' · ' : ''}{new Date(log.createdAt).toLocaleString('uk-UA')}</p></div></div>)}{!logs.length && <Empty text="Історія поки порожня" />}</div></GlassCard><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><SystemCard title="Syrve" status="Налаштовується окремою кнопкою" text="Підключення Cloud API доступне тільки Директору." tone="amber" /><SystemCard title="Expz" status="Не підключено" text="Інтеграція ще не реалізована." tone="neutral" /><SystemCard title="POS" status="Не підключено" text="Інтеграція ще не реалізована." tone="neutral" /></div></section>}
      </main>

      {plannerOpen && <AdminVisualTablePlanner onClose={() => setPlannerOpen(false)} />}
      {broadcastOpen && <BroadcastModal clients={filteredClients.filter((client) => !client.isBlacklisted)} text={broadcastText} setText={setBroadcastText} selected={selectedClients} setSelected={setSelectedClients} all={sendToAll} setAll={setSendToAll} busy={busy === 'broadcast'} onClose={() => setBroadcastOpen(false)} onSend={() => void sendBroadcast()} />}
    </div>
  );
}

function Nav({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex min-w-[54px] flex-col items-center gap-1 rounded-2xl border px-1 py-2 text-[9px] font-bold transition active:scale-95 sm:text-[10px] ${active ? 'border-amber-200/55 bg-amber-300/15 text-amber-100 shadow-[0_0_20px_rgba(251,191,36,.1)]' : 'border-white/10 bg-white/[0.03] text-white/40'}`}>{icon}<span>{label}</span></button>;
}

function Attention({ title, text, tone }: { title: string; text: string; tone: 'amber' | 'red' | 'cyan' }) {
  const style = tone === 'red' ? 'border-red-300/30 bg-red-500/10 text-red-100' : tone === 'cyan' ? 'border-cyan-200/30 bg-cyan-300/10 text-cyan-100' : 'border-amber-200/30 bg-amber-300/10 text-amber-100';
  return <div className={`rounded-2xl border p-4 ${style}`}><CircleAlert size={18} /><p className="mt-2 font-black">{title}</p><p className="mt-1 text-xs text-white/45">{text}</p></div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'violet' | 'red' | 'cyan' }) {
  const style = { amber: 'border-amber-200/25 bg-amber-300/[0.07] text-amber-100', violet: 'border-violet-200/25 bg-violet-400/[0.07] text-violet-100', red: 'border-red-200/25 bg-red-500/[0.07] text-red-100', cyan: 'border-cyan-200/25 bg-cyan-300/[0.07] text-cyan-100' }[tone];
  return <div className={`rounded-[22px] border p-4 ${style}`}><p className="text-xs font-bold text-white/45">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}

function GlassCard({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return <section className="rounded-[24px] border border-white/10 bg-neutral-950 p-4"><p className="text-xs font-black uppercase tracking-[0.18em] text-white/35">{eyebrow}</p><h2 className="mt-1 text-xl font-black">{title}</h2><div className="mt-4">{children}</div></section>;
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return <section className="rounded-[24px] border border-white/10 bg-neutral-950 p-4"><h1 className="text-2xl font-black">{title}</h1><p className="mt-1 text-sm text-white/45">{subtitle}</p></section>;
}

function BookingLine({ booking, detailed = false }: { booking: Booking; detailed?: boolean }) {
  const status = bookingStatus(booking);
  return <article className="rounded-2xl border border-white/10 bg-black/25 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-black">{timeLabel(booking.bookingTime)} · Стіл №{booking.table?.tableNumber || '-'}</p><p className="mt-1 truncate text-xs text-white/45">{booking.client?.fullName || 'Гість'} · {booking.guestsCount} гостей · {locationName(booking.table?.tableNumber)}</p>{detailed && <p className="mt-2 text-xs text-amber-100">{booking.client?.phone || '-'}</p>}</div><Badge text={STATUS_LABEL[status] || status} tone={status === 'pending' ? 'amber' : status === 'approved' ? 'violet' : status === 'no_show' ? 'red' : 'neutral'} /></div></article>;
}

function Action({ label, tone, disabled, onClick }: { label: string; tone: 'green' | 'amber' | 'red'; disabled: boolean; onClick: () => void }) {
  const style = tone === 'green' ? 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100' : tone === 'red' ? 'border-red-300/35 bg-red-500/10 text-red-100' : 'border-amber-200/35 bg-amber-300/10 text-amber-100';
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-2xl border px-4 py-3 text-sm font-black transition active:scale-95 disabled:opacity-40 ${style}`}>{label}</button>;
}

function Badge({ text, tone }: { text: string; tone: 'amber' | 'violet' | 'red' | 'neutral' }) {
  const style = tone === 'amber' ? 'border-amber-200/30 bg-amber-300/10 text-amber-100' : tone === 'violet' ? 'border-violet-200/30 bg-violet-400/10 text-violet-100' : tone === 'red' ? 'border-red-200/30 bg-red-500/10 text-red-100' : 'border-white/10 bg-white/5 text-white/45';
  return <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${style}`}>{text}</span>;
}

function RightToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" onClick={() => onChange(!value)} className={`flex items-center justify-between gap-3 rounded-2xl border p-3 text-left ${value ? 'border-emerald-300/30 bg-emerald-400/10' : 'border-white/10 bg-white/[0.03]'}`}><span className="text-sm font-bold text-white/70">{label}</span><span className={`relative h-7 w-12 rounded-full ${value ? 'bg-emerald-400' : 'bg-white/15'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${value ? 'left-6' : 'left-1'}`} /></span></button>;
}

function SystemCard({ title, status, text, tone }: { title: string; status: string; text: string; tone: 'amber' | 'neutral' }) {
  const style = tone === 'amber' ? 'border-amber-200/25 bg-amber-300/[0.06]' : 'border-white/10 bg-neutral-950';
  return <div className={`rounded-[22px] border p-4 ${style}`}><p className="font-black">{title}</p><p className="mt-2 text-xs font-bold text-white/55">{status}</p><p className="mt-2 text-xs text-white/35">{text}</p></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/30">{text}</div>;
}

function BroadcastModal({ clients, text, setText, selected, setSelected, all, setAll, busy, onClose, onSend }: { clients: Client[]; text: string; setText: (value: string) => void; selected: Set<string>; setSelected: (value: Set<string>) => void; all: boolean; setAll: (value: boolean) => void; busy: boolean; onClose: () => void; onSend: () => void }) {
  function toggle(id: string) { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); setSelected(next); setAll(false); }
  const count = all ? clients.length : selected.size;
  return <div className="fixed inset-0 z-[80] bg-black/80 p-3 backdrop-blur-xl"><div className="mx-auto flex h-full max-w-2xl flex-col overflow-hidden rounded-[26px] border border-violet-200/25 bg-neutral-950"><div className="flex items-center justify-between border-b border-white/10 p-4"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-100/55">Ручна розсилка</p><h2 className="mt-1 text-xl font-black">Обрати гостей</h2></div><button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/5"><X size={18} /></button></div><div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-4 md:grid-cols-2"><div className="min-h-0 overflow-y-auto"><button type="button" onClick={() => { setAll(true); setSelected(new Set()); }} className={`mb-2 w-full rounded-2xl border px-3 py-3 text-sm font-black ${all ? 'border-violet-200/50 bg-violet-400/15 text-violet-100' : 'border-white/10 bg-white/[0.03] text-white/55'}`}>Усім гостям</button><div className="space-y-1.5">{clients.map((client) => <button key={client.id} type="button" onClick={() => toggle(client.id)} className={`flex w-full items-center justify-between rounded-2xl border p-3 text-left ${selected.has(client.id) ? 'border-violet-200/45 bg-violet-400/10' : 'border-white/10 bg-black/25'}`}><div><p className="text-sm font-bold">{client.fullName}</p><p className="mt-1 text-xs text-white/35">{client.phone}</p></div><span className={`h-5 w-5 rounded-md border ${selected.has(client.id) ? 'border-violet-200 bg-violet-400' : 'border-white/20'}`} /></button>)}</div></div><div className="flex flex-col"><label className="text-xs font-black uppercase tracking-[0.18em] text-white/35">Текст повідомлення</label><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Напишіть повідомлення гостям" className="mt-2 min-h-48 flex-1 resize-none rounded-2xl border border-white/10 bg-black/35 p-4 text-sm outline-none focus:border-violet-200/40" /><p className="mt-2 text-xs text-white/40">Отримувачів: {count}</p><button type="button" onClick={onSend} disabled={busy || count === 0 || !text.trim()} className="mt-3 rounded-2xl border border-violet-200/45 bg-violet-400/15 px-4 py-3 text-sm font-black text-violet-100 disabled:opacity-40">{all ? 'Надіслати усім гостям' : `Надіслати вибраним · ${count}`}</button></div></div></div></div>;
}
