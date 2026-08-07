import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Armchair,
  BarChart3,
  Ban,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  CircleAlert,
  History,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  MapPin,
  MessageSquareText,
  MoreHorizontal,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';

import AdminVisualTablePlanner from '../admin/AdminVisualTablePlanner';
import { analyticsApi, type HourlyLoad, type TodayAnalytics } from '../api/analytics';
import { bookingsApi } from '../api/bookings';
import { broadcastsApi } from '../api/broadcasts';
import { clientsApi } from '../api/clients';
import { clearAccessToken, getAccessToken } from '../api/client';
import { logsApi, type LogRecord } from '../api/logs';
import { mapApi } from '../api/map';
import { restaurantApi } from '../api/restaurant';
import { reviewsApi, type GuestReviewRecord } from '../api/reviews';
import { staffApi, type StaffMember } from '../api/staff';
import type { Booking, Client, FullMapResponse, HolidayKey, Restaurant, SiteMode } from '../api/types';

type Tab = 'overview' | 'bookings' | 'locations' | 'guests' | 'blacklist' | 'activity' | 'stats' | 'team' | 'site' | 'more';
type BookingFilter = 'all' | 'pending' | 'approved' | 'completed' | 'cancelled' | 'no_show';
type LocationKey = 'hall' | 'canopy' | 'gazebo' | 'rotang' | 'embankment' | 'glass' | 'water';
type NoticeItem = { id: string; title: string; text: string; tone: 'gold' | 'red' | 'cyan' };
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

const TAB_STORAGE_KEY = 'molo:director:active-tab';
const NOTICE_STORAGE_KEY = 'molo:director:last-read-notices';
const VALID_TABS: Tab[] = ['overview', 'bookings', 'locations', 'guests', 'blacklist', 'activity', 'stats', 'team', 'site', 'more'];
const HOLIDAYS: Array<{ key: HolidayKey; label: string }> = [
  { key: 'new-year', label: 'Новий рік' },
  { key: 'christmas', label: 'Різдво' },
  { key: 'valentines', label: 'День закоханих' },
  { key: 'easter', label: 'Великдень' },
  { key: 'halloween', label: 'Геловін' },
  { key: 'march-8', label: '8 Березня' },
];
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

function readInitialTab(): Tab {
  const stored = window.sessionStorage.getItem(TAB_STORAGE_KEY) as Tab | null;
  return stored && VALID_TABS.includes(stored) ? stored : 'overview';
}

function currentStaffId(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { staffId?: string; sub?: string };
    return payload.staffId || payload.sub || null;
  } catch {
    return null;
  }
}

function kyivDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function dateLabel(value?: string | null): string {
  if (!value) return '-';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  return year && month && day ? `${day}.${month}.${year}` : String(value);
}

function timeLabel(value?: string | null): string {
  return value ? String(value).slice(0, 5) : '--:--';
}

function isNoShow(booking: Booking): boolean {
  return String(booking.wishes || '').includes('[NO_SHOW]');
}

function bookingStatus(booking: Booking): BookingFilter {
  return isNoShow(booking) ? 'no_show' : (booking.status as BookingFilter);
}

function locationKey(tableNumber?: string | number | null): LocationKey | null {
  const number = Number(tableNumber || 0);
  return LOCATIONS.find((item) => number >= item.from && number <= item.to)?.key || null;
}

function locationName(tableNumber?: string | number | null): string {
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

function statusText(status?: Restaurant['status']): string {
  if (status === 'open') return 'Ресторан відкритий';
  if (status === 'booking_closed') return 'Онлайн-бронювання закрито';
  return 'Ресторан закритий';
}

export default function PremiumDirectorPanel() {
  const today = useMemo(() => kyivDate(), []);
  const selfId = useMemo(() => currentStaffId(), []);
  const [tab, setTab] = useState<Tab>(readInitialTab);
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
  const [todayAnalytics, setTodayAnalytics] = useState<TodayAnalytics | null>(null);
  const [hourlyLoad, setHourlyLoad] = useState<HourlyLoad | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [sendToAll, setSendToAll] = useState(false);
  const [adminRights, setAdminRights] = useState<AdminRights>(EMPTY_RIGHTS);
  const [rightsDirty, setRightsDirty] = useState(false);
  const [menuUrl, setMenuUrl] = useState('');
  const [menuDirty, setMenuDirty] = useState(false);
  const [holidayPickerOpen, setHolidayPickerOpen] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [employeeToRemove, setEmployeeToRemove] = useState<StaffMember | null>(null);
  const [employeeToRestore, setEmployeeToRestore] = useState<StaffMember | null>(null);
  const [reasonTarget, setReasonTarget] = useState<Client | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [lastReadSignature, setLastReadSignature] = useState(() => window.localStorage.getItem(NOTICE_STORAGE_KEY) || '');

  function selectTab(next: Tab) {
    setTab(next);
    window.sessionStorage.setItem(TAB_STORAGE_KEY, next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      restaurantApi.get(),
      selectedDate === today ? bookingsApi.getToday() : bookingsApi.getByDate(selectedDate),
      mapApi.get(), clientsApi.getAll(), staffApi.getAll(), reviewsApi.getAll(), logsApi.getAll(),
      analyticsApi.today(), analyticsApi.hourlyLoad(selectedDate),
    ]);
    const [restaurantResult, bookingsResult, mapResult, clientsResult, staffResult, reviewsResult, logsResult, todayAnalyticsResult, hourlyLoadResult] = results;
    if (restaurantResult.status === 'fulfilled') {
      setRestaurant(restaurantResult.value);
      if (!rightsDirty) setAdminRights(rightsFromRestaurant(restaurantResult.value));
      if (!menuDirty) setMenuUrl(restaurantResult.value.menuUrl || '');
    }
    if (bookingsResult.status === 'fulfilled') setBookings(bookingsResult.value);
    if (mapResult.status === 'fulfilled') setMap(mapResult.value);
    if (clientsResult.status === 'fulfilled') setClients(clientsResult.value);
    if (staffResult.status === 'fulfilled') setStaff(staffResult.value);
    if (reviewsResult.status === 'fulfilled') setReviews(reviewsResult.value);
    if (logsResult.status === 'fulfilled') setLogs(logsResult.value);
    if (todayAnalyticsResult.status === 'fulfilled') setTodayAnalytics(todayAnalyticsResult.value);
    else setTodayAnalytics(null);
    if (hourlyLoadResult.status === 'fulfilled') setHourlyLoad(hourlyLoadResult.value);
    else setHourlyLoad(null);
    const failed = [restaurantResult, bookingsResult, mapResult, todayAnalyticsResult, hourlyLoadResult].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) setError(failed.reason?.message || 'Не вдалося оновити пульт');
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(interval);
  }, [selectedDate, rightsDirty, menuDirty]);

  useEffect(() => {
    window.sessionStorage.setItem(TAB_STORAGE_KEY, tab);
  }, [tab]);

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
      .filter((booking) => !needle || [booking.client?.fullName, booking.client?.phone, booking.table?.tableNumber, booking.table?.zone?.name].filter(Boolean).join(' ').toLowerCase().includes(needle))
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
    return { ...location, zone, bookings: locationBookings.length, occupied: tables.filter((table) => table.status === 'occupied').length, cleaning: tables.filter((table) => table.status === 'cleaning').length };
  }), [map, bookings]);
  const attention = useMemo<NoticeItem[]>(() => {
    const items: NoticeItem[] = [];
    const pending = bookings.filter((booking) => booking.status === 'pending');
    const unansweredReviews = reviews.filter((review) => !review.responseText);
    if (pending.length) items.push({ id: `pending:${pending.length}`, title: `${pending.length} бронювань очікують`, text: 'Потрібне рішення Адміністратора', tone: 'gold' });
    if (stats.cleaning) items.push({ id: `cleaning:${stats.cleaning}`, title: `${stats.cleaning} столів готуються`, text: 'Перевірте тривалість підготовки', tone: 'cyan' });
    if (stats.closedLocations) items.push({ id: `closed:${stats.closedLocations}`, title: `${stats.closedLocations} локацій закрито`, text: 'Перевірте план роботи', tone: 'red' });
    if (unansweredReviews.length) items.push({ id: `reviews:${unansweredReviews.length}`, title: `${unansweredReviews.length} відгуків без відповіді`, text: 'Гості очікують відповідь', tone: 'gold' });
    return items;
  }, [bookings, stats, reviews]);
  const attentionSignature = useMemo(() => attention.map((item) => item.id).join('|'), [attention]);
  const unreadCount = attention.length > 0 && attentionSignature !== lastReadSignature ? attention.length : 0;

  function openNotifications() {
    setNotificationsOpen(true);
    setLastReadSignature(attentionSignature);
    window.localStorage.setItem(NOTICE_STORAGE_KEY, attentionSignature);
  }

  async function runRestaurant(action: 'open' | 'closeBooking' | 'close') {
    setBusy(`restaurant:${action}`);
    try {
      if (action === 'open') await restaurantApi.open();
      if (action === 'closeBooking') await restaurantApi.closeBooking();
      if (action === 'close') await restaurantApi.close(restaurant?.closeMessage || 'Ресторан тимчасово зачинений');
      setNotice('Стан ресторану оновлено');
      await load(true);
    } catch (cause: any) {
      setError(cause?.message || 'Не вдалося змінити стан ресторану');
    } finally { setBusy(null); }
  }

  async function changeMode(mode: SiteMode, holidayKey: HolidayKey | null = null) {
    setBusy(`mode:${mode}`);
    try {
      await restaurantApi.update({ siteMode: mode, holidayKey: mode === 'holiday' ? holidayKey : null });
      setNotice(mode === 'day' ? 'Увімкнено денний режим' : mode === 'night' ? 'Увімкнено нічний режим' : 'Увімкнено святковий режим');
      await load(true);
    } catch (cause: any) { setError(cause?.message || 'Не вдалося змінити оформлення'); }
    finally { setBusy(null); }
  }

  async function saveMenu() {
    setBusy('menu');
    try {
      await restaurantApi.update({ menuUrl: menuUrl.trim() || null });
      setMenuDirty(false);
      setNotice('Посилання на меню збережено');
      await load(true);
    } catch (cause: any) { setError(cause?.message || 'Не вдалося зберегти меню'); }
    finally { setBusy(null); }
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
      setRightsDirty(false);
      setNotice('Права Адміністратора збережено');
    } catch (cause: any) { setError(cause?.message || 'Не вдалося зберегти права'); }
    finally { setBusy(null); }
  }

  function updateRight<K extends keyof AdminRights>(key: K, value: AdminRights[K]) {
    setAdminRights((current) => ({ ...current, [key]: value }));
    setRightsDirty(true);
  }

  async function applyGuestReason() {
    if (!reasonTarget || !reasonText.trim()) return;
    setBusy(`client:${reasonTarget.id}`);
    try {
      if (reasonTarget.isBlacklisted) await clientsApi.unblacklist(reasonTarget.id, reasonText.trim());
      else await clientsApi.blacklist(reasonTarget.id, reasonText.trim());
      setNotice(reasonTarget.isBlacklisted ? 'Гостя розблоковано' : 'Гостя додано до чорного списку');
      setReasonTarget(null);
      setReasonText('');
      await load(true);
    } catch (cause: any) { setError(cause?.message || 'Не вдалося змінити статус гостя'); }
    finally { setBusy(null); }
  }

  async function sendBroadcast() {
    const message = broadcastText.trim();
    if (!message) return setError('Напишіть повідомлення');
    if (!sendToAll && selectedClients.size === 0) return setError('Оберіть хоча б одного гостя');
    setBusy('broadcast');
    try {
      const result = await broadcastsApi.sendNow({ message, target: sendToAll ? 'all_clients' : 'selected_clients', clientIds: sendToAll ? undefined : Array.from(selectedClients) });
      setNotice(`Розсилку надіслано. Отримувачів: ${result.recipientCount}`);
      setBroadcastOpen(false); setBroadcastText(''); setSelectedClients(new Set()); setSendToAll(false);
    } catch (cause: any) { setError(cause?.message || 'Не вдалося надіслати розсилку'); }
    finally { setBusy(null); }
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
    } catch (cause: any) { setError(cause?.message || 'Не вдалося відповісти на відгук'); }
    finally { setBusy(null); }
  }

  async function removeEmployee() {
    if (!employeeToRemove || employeeToRemove.id === selfId) return;
    setBusy(`remove:${employeeToRemove.id}`);
    try {
      await staffApi.remove(employeeToRemove.id);
      setNotice(`Працівника «${employeeToRemove.fullName}» видалено з активної команди`);
      setEmployeeToRemove(null);
      await load(true);
    } catch (cause: any) { setError(cause?.message || 'Не вдалося видалити працівника'); }
    finally { setBusy(null); }
  }

  async function restoreEmployee() {
    if (!employeeToRestore) return;
    setBusy(`restore:${employeeToRestore.id}`);
    try {
      await staffApi.restore(employeeToRestore.id, { performedBy: 'Директор', comment: 'Відновлено з Пульта Директора' });
      setNotice(`Працівника «${employeeToRestore.fullName}» відновлено`);
      setEmployeeToRestore(null);
      await load(true);
    } catch (cause: any) { setError(cause?.message || 'Не вдалося відновити працівника'); }
    finally { setBusy(null); }
  }

  function openAccessSettings() {
    window.dispatchEvent(new Event('molo:open-director-access'));
  }

  function logout() {
    clearAccessToken();
    window.location.hash = 'guest';
  }

  const activeStaff = staff.filter((member) => !member.isArchived);
  const archivedStaff = staff.filter((member) => member.isArchived);
  const eligibleBroadcastClients = clients.filter((client) => !client.isBlacklisted);
  const blacklistedClients = clients.filter((client) => client.isBlacklisted);
  const hourlyEntries = Object.entries(hourlyLoad?.hours || {}).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="min-h-screen bg-[#030403] pb-28 text-white [background-image:radial-gradient(circle_at_12%_0%,rgba(52,211,153,.055),transparent_30%),radial-gradient(circle_at_88%_8%,rgba(251,191,36,.07),transparent_28%)]">
      <header className="sticky top-0 z-40 border-b border-amber-100/10 bg-black/80 backdrop-blur-2xl">
        <div className="mx-auto max-w-7xl px-3 py-3 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[11px] font-black uppercase tracking-[0.3em] text-amber-100/55">MOLO · Пульт Директора</p>
              <div className="mt-1 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${restaurant?.status === 'open' ? 'bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,.9)]' : restaurant?.status === 'booking_closed' ? 'bg-amber-200 shadow-[0_0_14px_rgba(253,230,138,.65)]' : 'bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,.65)]'}`} />
                <span className="truncate text-sm text-white/60">{statusText(restaurant?.status)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IconButton label="Оновити" onClick={() => void load()} disabled={loading}><RefreshCcw size={18} className={loading ? 'animate-spin' : ''} /></IconButton>
              <button type="button" onClick={openNotifications} aria-label="Повідомлення" className={`relative grid h-11 w-11 place-items-center rounded-2xl border bg-black/45 text-rose-100 transition active:scale-95 ${unreadCount ? 'border-rose-100/80 shadow-[0_0_28px_rgba(244,63,94,.75),0_0_60px_rgba(244,63,94,.28)]' : 'border-white/12'}`}>
                {unreadCount > 0 && <><span className="absolute inset-0 rounded-2xl border border-rose-200/70 animate-ping" /><span className="absolute -inset-3 rounded-3xl bg-rose-500/25 blur-xl" /></>}
                <Bell size={18} className={unreadCount ? 'animate-pulse drop-shadow-[0_0_8px_rgba(251,113,133,.9)]' : ''} />
                {unreadCount > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full border border-rose-100/70 bg-rose-500 px-1 text-[10px] font-black shadow-[0_0_14px_rgba(244,63,94,.9)]">{unreadCount}</span>}
              </button>
              <IconButton label="Вийти" onClick={logout}><LogOut size={18} /></IconButton>
            </div>
          </div>
          <nav className="mt-3 grid grid-cols-7 gap-1 overflow-x-auto">
            <Nav active={tab === 'overview'} icon={<LayoutDashboard size={17} />} label="Огляд" onClick={() => selectTab('overview')} />
            <Nav active={tab === 'bookings'} icon={<CalendarDays size={17} />} label="Броні" onClick={() => selectTab('bookings')} />
            <Nav active={tab === 'locations'} icon={<MapPin size={17} />} label="Локації" onClick={() => selectTab('locations')} />
            <Nav active={tab === 'guests'} icon={<Users size={17} />} label="Гості" onClick={() => selectTab('guests')} />
            <Nav active={tab === 'team'} icon={<UserRoundCheck size={17} />} label="Команда" onClick={() => selectTab('team')} />
            <Nav active={tab === 'site'} icon={<Sparkles size={17} />} label="Сайт" onClick={() => selectTab('site')} />
            <Nav active={tab === 'more'} icon={<MoreHorizontal size={17} />} label="Ще" onClick={() => selectTab('more')} />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 p-3 sm:p-5 lg:p-6">
        {(notice || error) && <div className={`rounded-2xl border bg-black/55 px-4 py-3 text-sm shadow-[0_0_28px_rgba(0,0,0,.45)] ${error ? 'border-rose-300/35 text-rose-100' : 'border-emerald-200/35 text-emerald-100'}`}>{error || notice}</div>}

        <section className="grid grid-cols-3 gap-2">
          <QuickDirectorButton active={tab === 'blacklist'} label="Чорний список" count={blacklistedClients.length} icon={<Ban size={18} />} onClick={() => selectTab('blacklist')} tone="red" />
          <QuickDirectorButton active={tab === 'activity'} label="Дії персоналу" count={logs.length} icon={<History size={18} />} onClick={() => selectTab('activity')} tone="cyan" />
          <QuickDirectorButton active={tab === 'stats'} label="Статистика" icon={<BarChart3 size={18} />} onClick={() => selectTab('stats')} tone="gold" />
        </section>

        {tab === 'blacklist' && <section className="space-y-3"><Heading title="Чорний список" subtitle="Заблоковані гості без пошуку в загальній стрічці." /><div className="space-y-2">{blacklistedClients.map((client) => <PremiumCard key={client.id} className="border-rose-300/35"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-black">{client.fullName}</h3><p className="mt-1 text-sm text-amber-100">{client.phone}</p><p className="mt-2 text-xs text-white/45">{client.blacklistReason || 'Причину не вказано'}</p></div><OutlineAction label="Розблокувати" tone="green" disabled={Boolean(busy)} onClick={() => { setReasonTarget(client); setReasonText(''); }} /></div></PremiumCard>)}{!blacklistedClients.length && <Empty text="Чорний список порожній" />}</div></section>}

        {tab === 'activity' && <section className="space-y-3"><Heading title="Дії персоналу" subtitle="Останні дії працівників доступні одразу, без прокручування пульта." /><PremiumCard><div className="space-y-2">{logs.map((log) => <div key={log.id} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-3"><History size={16} className="mt-0.5 shrink-0 text-cyan-200" /><div><p className="text-sm font-bold">{log.action}</p><p className="mt-1 text-xs text-white/40">{log.staff?.role === 'owner' ? 'Директор' : log.staff?.fullName || 'Система'} · {new Date(log.createdAt).toLocaleString('uk-UA')}</p></div></div>)}{!logs.length && <Empty text="Історія поки порожня" />}</div></PremiumCard></section>}

        {tab === 'stats' && <section className="space-y-3"><Heading title="Статистика" subtitle="Відвідуваність, завантаженість столів і навантаження каси — без грошових сум." /><PremiumCard className="grid gap-2 sm:grid-cols-[auto_1fr]"><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="h-12 rounded-2xl border border-white/12 bg-black/45 px-4 text-sm [color-scheme:dark] outline-none focus:border-amber-100/45" /><p className="self-center text-sm text-white/45">Оберіть дату статистики</p></PremiumCard><section className="grid grid-cols-2 gap-2 lg:grid-cols-4"><Metric label="Бронювань сьогодні" value={todayAnalytics?.bookingsCount || 0} tone="gold" /><Metric label="Гостей сьогодні" value={todayAnalytics?.guestsCount || 0} tone="violet" /><Metric label="Зайнятих столів" value={todayAnalytics?.occupiedTables || 0} tone="red" /><Metric label="Вільних столів" value={todayAnalytics?.freeTables || 0} tone="cyan" /></section><PremiumCard><Eyebrow>{dateLabel(selectedDate)}</Eyebrow><h2 className="mt-1 text-xl font-black">Навантаження каси за годинами</h2><p className="mt-2 text-sm text-white/45">Кількість бронювань і гостей. Фінансові показники не відображаються.</p><div className="mt-4 space-y-2">{hourlyEntries.map(([hour, load]) => <div key={hour} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 rounded-2xl border border-cyan-200/20 bg-black/35 p-3"><span className="font-mono font-black text-cyan-100">{hour}</span><span className="h-2 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(103,232,249,.7)]" style={{ width: `${Math.min(100, Math.max(8, load.bookingsCount * 12))}%` }} /></span><span className="text-xs text-white/55">{load.bookingsCount} броней · {load.guestsCount} гостей</span></div>)}{!hourlyEntries.length && <Empty text="На цю дату навантаження ще немає" />}</div></PremiumCard></section>}

        {tab === 'overview' && <>
          <PremiumCard className="border-amber-100/25 shadow-[0_0_45px_rgba(251,191,36,.08)]">
            <div className="flex items-center justify-between gap-3"><div><Eyebrow>Потребує уваги</Eyebrow><h1 className="mt-1 text-2xl font-black tracking-tight">Операційний центр</h1></div><OutlinePill>{dateLabel(selectedDate)}</OutlinePill></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{attention.length ? attention.map((item) => <Attention key={item.id} item={item} />) : <div className="rounded-2xl border border-emerald-200/25 bg-black/35 p-4 text-emerald-100 sm:col-span-2 lg:col-span-4"><ShieldCheck size={20} className="drop-shadow-[0_0_8px_rgba(110,231,183,.8)]" /><p className="mt-2 font-black">Усе спокійно</p></div>}</div>
          </PremiumCard>
          <section className="grid grid-cols-2 gap-2 lg:grid-cols-4"><Metric label="Очікують рішення" value={stats.pending} tone="gold" /><Metric label="Гостей очікується" value={stats.guests} tone="violet" /><Metric label="Столів зайнято" value={stats.occupied} tone="red" /><Metric label="Працівників на зміні" value={stats.onShift} tone="cyan" /></section>
          <section className="grid gap-3 lg:grid-cols-[1.15fr_.85fr]">
            <PremiumCard><Eyebrow>{dateLabel(selectedDate)}</Eyebrow><h2 className="mt-1 text-xl font-black">Найближчі бронювання</h2><div className="mt-4 space-y-2">{activeBookings.slice(0, 5).sort((a, b) => String(a.bookingTime).localeCompare(String(b.bookingTime))).map((booking) => <BookingLine key={booking.id} booking={booking} />)}{!activeBookings.length && <Empty text="Бронювань немає" />}</div></PremiumCard>
            <PremiumCard><Eyebrow>Ресторан</Eyebrow><h2 className="mt-1 text-xl font-black">Швидке керування</h2><div className="mt-4 grid gap-2"><OutlineAction label="Відкрити ресторан" tone="green" disabled={Boolean(busy)} onClick={() => void runRestaurant('open')} /><OutlineAction label="Закрити онлайн-бронювання" tone="gold" disabled={Boolean(busy)} onClick={() => void runRestaurant('closeBooking')} /><OutlineAction label="Закрити ресторан" tone="red" disabled={Boolean(busy)} onClick={() => void runRestaurant('close')} /></div></PremiumCard>
          </section>
        </>}

        {tab === 'bookings' && <section className="space-y-3"><Heading title="Бронювання" subtitle="Сьогодні, майбутні дати та архів через календар." /><PremiumCard className="grid gap-2 sm:grid-cols-[auto_1fr]"><input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="h-12 rounded-2xl border border-white/12 bg-black/45 px-4 text-sm [color-scheme:dark] outline-none focus:border-amber-100/45" /><SearchInput value={search} onChange={setSearch} placeholder="Ім’я, телефон, стіл або локація" /></PremiumCard><div className="flex gap-2 overflow-x-auto pb-1">{([['all','Усі'],['pending','Очікують'],['approved','Підтверджені'],['no_show','Гості не прийшли'],['completed','Завершені'],['cancelled','Скасовані']] as Array<[BookingFilter,string]>).map(([value,label]) => <FilterButton key={value} active={bookingFilter === value} onClick={() => setBookingFilter(value)}>{label}</FilterButton>)}</div><div className="space-y-2">{filteredBookings.map((booking) => <BookingLine key={booking.id} booking={booking} detailed />)}{!filteredBookings.length && <Empty text="Бронювань не знайдено" />}</div></section>}

        {tab === 'locations' && <section className="space-y-3"><Heading title="Локації" subtitle="Перегляд існуючих карт і лише два робочі стани столу: зайнятий або вільний." /><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{locations.map((location) => <PremiumCard key={location.key}><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${location.zone?.isClosed ? 'bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,.7)]' : 'bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.75)]'}`} /><h3 className="font-black">{location.label}</h3></div><p className="mt-2 text-xs text-white/40">{location.bookings} бронювань · {location.occupied} зайнято · {location.cleaning} готується</p></div><Armchair size={19} className="text-amber-100/35" /></div></PremiumCard>)}</div><button type="button" onClick={() => setPlannerOpen(true)} className="flex w-full items-center justify-between rounded-[24px] border border-fuchsia-200/30 bg-black/45 p-4 text-left text-fuchsia-100 shadow-[0_0_26px_rgba(217,70,239,.09)] transition active:scale-[.995]"><div><p className="font-black">Відкрити карти локацій</p><p className="mt-1 text-xs text-white/45">Натисніть на стіл і оберіть «зайнятий» або «вільний»</p></div><CalendarClock size={21} className="drop-shadow-[0_0_9px_rgba(232,121,249,.8)]" /></button></section>}

        {tab === 'guests' && <section className="space-y-3"><Heading title="База гостей" subtitle="Відвідування, чорний список і ручна розсилка." /><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><SearchInput value={search} onChange={setSearch} placeholder="Ім’я або телефон" /><OutlineAction label="Обрати гостей" tone="violet" disabled={false} onClick={() => setBroadcastOpen(true)} icon={<Send size={16} />} /></div><div className="space-y-2">{filteredClients.map((client) => <PremiumCard key={client.id} className={client.isBlacklisted ? 'border-rose-300/30' : ''}><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black">{client.fullName}</h3>{client.isRegular && <Badge text="Постійний гість" tone="violet" />}{client.isBlacklisted && <Badge text="Чорний список" tone="red" />}</div><p className="mt-1 text-sm text-amber-100">{client.phone}</p><p className="mt-2 text-xs text-white/40">{client.visitsCount} відвідувань · {client.totalGuests} гостей загалом</p></div><OutlineAction label={client.isBlacklisted ? 'Розблокувати' : 'Заблокувати'} tone={client.isBlacklisted ? 'green' : 'red'} disabled={Boolean(busy)} onClick={() => { setReasonTarget(client); setReasonText(''); }} /></div></PremiumCard>)}{!filteredClients.length && <Empty text="Гостей не знайдено" />}</div></section>}

        {tab === 'team' && <section className="space-y-3"><Heading title="Команда" subtitle="Працівники, зміни, видалення та права Адміністратора." /><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{activeStaff.map((member) => <EmployeeCard key={member.id} member={member} isSelf={member.id === selfId} onRemove={() => setEmployeeToRemove(member)} />)}</div>{archivedStaff.length > 0 && <PremiumCard><Eyebrow>Архів</Eyebrow><h2 className="mt-1 text-xl font-black">Видалені працівники</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{archivedStaff.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/30 p-3"><div><p className="text-sm font-black">{member.fullName}</p><p className="mt-1 text-xs text-white/35">{roleLabel(member.role)}</p></div><button type="button" onClick={() => setEmployeeToRestore(member)} className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-200/30 text-emerald-100 shadow-[0_0_14px_rgba(52,211,153,.08)]"><RotateCcw size={16} /></button></div>)}</div></PremiumCard>}<PremiumCard><Eyebrow>Директор керує доступом</Eyebrow><h2 className="mt-1 text-xl font-black">Права Адміністратора</h2><div className="mt-4 grid gap-2 sm:grid-cols-2"><RightToggle label="Керувати локаціями" value={adminRights.zones} onChange={(value) => updateRight('zones', value)} /><RightToggle label="Керувати онлайн-бронюванням" value={adminRights.onlineBooking} onChange={(value) => updateRight('onlineBooking', value)} /><RightToggle label="Відкривати та закривати ресторан" value={adminRights.restaurant} onChange={(value) => updateRight('restaurant', value)} /><RightToggle label="Перемикати День / Ніч / Свято" value={adminRights.siteMode} onChange={(value) => updateRight('siteMode', value)} /><RightToggle label="Змінювати меню та повідомлення" value={adminRights.settings} onChange={(value) => updateRight('settings', value)} /><RightToggle label="Керувати чорним списком" value={adminRights.blacklist} onChange={(value) => updateRight('blacklist', value)} /><RightToggle label="Відповідати на відгуки" value={adminRights.reviews} onChange={(value) => updateRight('reviews', value)} /><RightToggle label="Керувати змінами персоналу" value={adminRights.shifts} onChange={(value) => updateRight('shifts', value)} /><RightToggle label="Створювати ручні розсилки" value={adminRights.broadcasts} onChange={(value) => updateRight('broadcasts', value)} /></div><OutlineAction className="mt-3 w-full" label={rightsDirty ? 'Зберегти змінені права' : 'Права збережено'} tone="gold" disabled={busy === 'rights' || !rightsDirty} onClick={() => void saveRights()} icon={rightsDirty ? <Check size={16} /> : undefined} /></PremiumCard></section>}

        {tab === 'site' && (
          <section className="space-y-3">
            <Heading title="Сайт" subtitle="Режим оформлення та посилання на меню без зміни фотографій, SVG і карт столів." />
            <PremiumCard>
              <Eyebrow>День · Ніч · Свято</Eyebrow>
              <h2 className="mt-1 text-xl font-black">Оформлення</h2>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <OutlineAction label="День" tone="green" disabled={Boolean(busy)} onClick={() => { setHolidayPickerOpen(false); void changeMode('day'); }} />
                <OutlineAction label="Ніч" tone="gold" disabled={Boolean(busy)} onClick={() => { setHolidayPickerOpen(false); void changeMode('night'); }} />
                <OutlineAction label="Свято" tone="violet" disabled={Boolean(busy)} onClick={() => setHolidayPickerOpen(true)} />
              </div>
              {(holidayPickerOpen || restaurant?.siteMode === 'holiday') && (
                <div className="mt-5 border-t border-white/10 pt-4">
                  <Eyebrow>Оберіть свято</Eyebrow>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {HOLIDAYS.map((holiday) => (
                      <button
                        key={holiday.key}
                        type="button"
                        onClick={() => void changeMode('holiday', holiday.key)}
                        disabled={Boolean(busy)}
                        className={`rounded-2xl border bg-black/40 px-3 py-3 text-sm font-bold transition active:scale-[.98] disabled:opacity-40 ${
                          restaurant.holidayKey === holiday.key
                            ? 'border-rose-200/65 text-rose-50 shadow-[0_0_22px_rgba(251,113,133,.22)]'
                            : 'border-white/12 text-white/60'
                        }`}
                      >
                        {holiday.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </PremiumCard>
            <PremiumCard>
              <Eyebrow>Меню ресторану</Eyebrow>
              <h2 className="mt-1 text-xl font-black">Посилання на меню</h2>
              <input
                value={menuUrl}
                onChange={(event) => { setMenuUrl(event.target.value); setMenuDirty(true); }}
                placeholder="https://..."
                className="mt-4 h-12 w-full rounded-2xl border border-white/12 bg-black/45 px-4 text-sm outline-none focus:border-amber-100/40"
              />
              <OutlineAction
                className="mt-3 w-full"
                label={busy === 'menu' ? 'Зберігаємо...' : menuDirty ? 'Зберегти посилання' : 'Посилання збережено'}
                tone="gold"
                disabled={busy === 'menu' || !menuDirty}
                onClick={() => void saveMenu()}
              />
            </PremiumCard>
          </section>
        )}

        {tab === 'more' && <section className="space-y-3"><Heading title="Ще" subtitle="Вхід, письмові відгуки, історія та інтеграції." /><button type="button" onClick={openAccessSettings} className="flex w-full items-center justify-between rounded-[24px] border border-amber-100/35 bg-black/50 p-4 text-left text-amber-50 shadow-[0_0_32px_rgba(251,191,36,.1)] transition active:scale-[.995]"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-100/35 bg-black/40"><LockKeyhole size={19} className="drop-shadow-[0_0_8px_rgba(253,230,138,.8)]" /></span><div><p className="font-black">Налаштування входу</p><p className="mt-1 text-xs text-white/45">Змінити ім’я, логін або пароль</p></div></div><KeyRound size={20} className="text-amber-100/60" /></button><PremiumCard><Eyebrow>{reviews.length} відгуків</Eyebrow><h2 className="mt-1 text-xl font-black">Письмові відгуки гостей</h2><div className="mt-4 space-y-2">{reviews.slice(0, 30).map((review) => <article key={review.id} className="rounded-2xl border border-white/10 bg-black/30 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{review.booking?.client?.fullName || 'Гість'}</p><p className="mt-1 text-xs text-white/40">{dateLabel(review.booking?.bookingDate)} · Стіл №{review.booking?.table?.tableNumber || '-'}</p></div><MessageSquareText size={18} className="text-violet-200" /></div><p className="mt-3 whitespace-pre-wrap text-sm text-white/70">{review.text}</p>{review.responseText ? <div className="mt-3 rounded-2xl border border-emerald-200/25 bg-black/30 p-3"><Eyebrow>Відповідь</Eyebrow><p className="mt-2 whitespace-pre-wrap text-sm text-emerald-50">{review.responseText}</p></div> : <div className="mt-3"><textarea value={reviewDrafts[review.id] || ''} onChange={(event) => setReviewDrafts((current) => ({ ...current, [review.id]: event.target.value }))} placeholder="Напишіть відповідь гостю" className="min-h-24 w-full resize-none rounded-2xl border border-white/12 bg-black/45 p-3 text-sm outline-none focus:border-violet-200/40" /><OutlineAction className="mt-2 w-full" label="Відповісти" tone="violet" disabled={busy === `review:${review.id}` || !String(reviewDrafts[review.id] || '').trim()} onClick={() => void respondToReview(review)} /></div>}</article>)}{!reviews.length && <Empty text="Письмових відгуків ще немає" />}</div></PremiumCard><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><SystemCard title="Syrve" status="Налаштовується окремою кнопкою" text="Підключення Cloud API доступне тільки Директору." tone="gold" /><SystemCard title="Expz" status="Не підключено" text="Інтеграція ще не реалізована." tone="neutral" /><SystemCard title="POS" status="Не підключено" text="Інтеграція ще не реалізована." tone="neutral" /></div></section>}
      </main>

      {plannerOpen && <AdminVisualTablePlanner mode="director" onClose={() => setPlannerOpen(false)} />}
      {notificationsOpen && <NotificationsDrawer items={attention} onClose={() => setNotificationsOpen(false)} />}
      {broadcastOpen && <BroadcastModal clients={eligibleBroadcastClients} text={broadcastText} setText={setBroadcastText} selected={selectedClients} setSelected={setSelectedClients} all={sendToAll} setAll={setSendToAll} busy={busy === 'broadcast'} onClose={() => setBroadcastOpen(false)} onSend={() => void sendBroadcast()} />}
      {employeeToRemove && <ConfirmModal title="Видалити працівника?" text={`«${employeeToRemove.fullName}» зникне з активної команди, але історія змін збережеться.`} confirm="Видалити" tone="red" busy={busy === `remove:${employeeToRemove.id}`} onCancel={() => setEmployeeToRemove(null)} onConfirm={() => void removeEmployee()} />}
      {employeeToRestore && <ConfirmModal title="Відновити працівника?" text={`«${employeeToRestore.fullName}» знову з’явиться в активній команді.`} confirm="Відновити" tone="green" busy={busy === `restore:${employeeToRestore.id}`} onCancel={() => setEmployeeToRestore(null)} onConfirm={() => void restoreEmployee()} />}
      {reasonTarget && <ReasonModal client={reasonTarget} value={reasonText} setValue={setReasonText} busy={busy === `client:${reasonTarget.id}`} onCancel={() => { setReasonTarget(null); setReasonText(''); }} onConfirm={() => void applyGuestReason()} />}
    </div>
  );
}

function roleLabel(role: StaffMember['role']): string {
  return role === 'owner' ? 'Директор' : role === 'admin' ? 'Адміністратор' : role === 'waiter' ? 'Офіціант' : 'Кальянник';
}

function PremiumCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[24px] border border-amber-100/15 bg-black/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.035),0_0_28px_rgba(251,191,36,.055),0_18px_50px_rgba(0,0,0,.28)] backdrop-blur-xl ${className}`}>{children}</section>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-100/45">{children}</p>;
}

function OutlinePill({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-white/12 bg-black/35 px-3 py-1.5 text-xs font-bold text-white/60">{children}</span>;
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) {
  return <PremiumCard><h1 className="text-2xl font-black tracking-tight">{title}</h1><p className="mt-1 text-sm text-white/45">{subtitle}</p></PremiumCard>;
}

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="grid h-11 w-11 place-items-center rounded-2xl border border-amber-100/30 bg-black/45 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.08)] transition active:scale-95 disabled:opacity-40">{children}</button>;
}

function QuickDirectorButton({ active, label, count, icon, onClick, tone }: { active: boolean; label: string; count?: number; icon: ReactNode; onClick: () => void; tone: 'red' | 'cyan' | 'gold' }) {
  const style = tone === 'red' ? 'border-rose-300/45 text-rose-100 shadow-[0_0_24px_rgba(244,63,94,.16)]' : tone === 'cyan' ? 'border-cyan-200/45 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,.15)]' : 'border-amber-100/45 text-amber-100 shadow-[0_0_24px_rgba(251,191,36,.16)]';
  return <button type="button" onClick={onClick} className={`flex min-h-16 items-center justify-center gap-2 rounded-2xl border bg-black/55 px-2 text-xs font-black transition active:scale-[.98] ${style} ${active ? 'ring-1 ring-current' : 'opacity-85 hover:opacity-100'}`}>{icon}<span>{label}</span>{typeof count === 'number' && <span className="rounded-full border border-current/35 px-1.5 py-0.5 text-[10px]">{count}</span>}</button>;
}

function Nav({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex min-w-[54px] flex-col items-center gap-1 rounded-2xl border bg-black/30 px-1 py-2 text-[9px] font-bold transition active:scale-95 sm:text-[10px] ${active ? 'border-amber-100/55 text-amber-100 shadow-[0_0_22px_rgba(251,191,36,.16),inset_0_0_18px_rgba(251,191,36,.04)]' : 'border-white/10 text-white/38'}`}>{icon}<span>{label}</span></button>;
}

function Attention({ item }: { item: NoticeItem }) {
  const style = item.tone === 'red' ? 'border-rose-300/30 text-rose-100 shadow-[0_0_22px_rgba(244,63,94,.08)]' : item.tone === 'cyan' ? 'border-cyan-200/30 text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,.07)]' : 'border-amber-100/30 text-amber-100 shadow-[0_0_22px_rgba(251,191,36,.08)]';
  return <div className={`rounded-2xl border bg-black/40 p-4 ${style}`}><CircleAlert size={18} /><p className="mt-2 font-black">{item.title}</p><p className="mt-1 text-xs text-white/45">{item.text}</p></div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'gold' | 'violet' | 'red' | 'cyan' }) {
  const style = { gold: 'border-amber-100/25 text-amber-100 shadow-[0_0_26px_rgba(251,191,36,.06)]', violet: 'border-violet-200/25 text-violet-100 shadow-[0_0_26px_rgba(167,139,250,.06)]', red: 'border-rose-200/25 text-rose-100 shadow-[0_0_26px_rgba(244,63,94,.06)]', cyan: 'border-cyan-200/25 text-cyan-100 shadow-[0_0_26px_rgba(34,211,238,.06)]' }[tone];
  return <div className={`rounded-[22px] border bg-black/45 p-4 ${style}`}><p className="text-xs font-bold text-white/45">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}

function OutlineAction({ label, tone, disabled, onClick, className = '', icon }: { label: string; tone: 'green' | 'gold' | 'red' | 'violet'; disabled: boolean; onClick: () => void; className?: string; icon?: ReactNode }) {
  const style = tone === 'green' ? 'border-emerald-200/35 text-emerald-100 shadow-[0_0_18px_rgba(52,211,153,.06)]' : tone === 'red' ? 'border-rose-200/35 text-rose-100 shadow-[0_0_18px_rgba(244,63,94,.06)]' : tone === 'violet' ? 'border-violet-200/35 text-violet-100 shadow-[0_0_18px_rgba(167,139,250,.06)]' : 'border-amber-100/40 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.07)]';
  return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-2xl border bg-black/35 px-4 py-3 text-sm font-black transition hover:bg-white/[0.025] active:scale-[.985] disabled:opacity-35 ${style} ${className}`}>{icon}{label}</button>;
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`whitespace-nowrap rounded-2xl border bg-black/35 px-3 py-2.5 text-xs font-bold ${active ? 'border-amber-100/50 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,.1)]' : 'border-white/10 text-white/45'}`}>{children}</button>;
}

function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="relative"><Search size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-12 w-full rounded-2xl border border-white/12 bg-black/45 pl-11 pr-4 text-sm outline-none focus:border-amber-100/40" /></label>;
}

function BookingLine({ booking, detailed = false }: { booking: Booking; detailed?: boolean }) {
  const status = bookingStatus(booking);
  return <article className="rounded-2xl border border-white/10 bg-black/30 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-black">{timeLabel(booking.bookingTime)} · Стіл №{booking.table?.tableNumber || '-'}</p><p className="mt-1 truncate text-xs text-white/45">{booking.client?.fullName || 'Гість'} · {booking.guestsCount} гостей · {locationName(booking.table?.tableNumber)}</p>{detailed && <p className="mt-2 text-xs text-amber-100">{booking.client?.phone || '-'}</p>}</div><Badge text={STATUS_LABEL[status] || status} tone={status === 'pending' ? 'gold' : status === 'approved' ? 'violet' : status === 'no_show' ? 'red' : 'neutral'} /></div></article>;
}

function Badge({ text, tone }: { text: string; tone: 'gold' | 'violet' | 'red' | 'neutral' }) {
  const style = tone === 'gold' ? 'border-amber-100/30 text-amber-100' : tone === 'violet' ? 'border-violet-200/30 text-violet-100' : tone === 'red' ? 'border-rose-200/30 text-rose-100' : 'border-white/10 text-white/45';
  return <span className={`shrink-0 rounded-full border bg-black/35 px-2.5 py-1 text-[10px] font-bold ${style}`}>{text}</span>;
}

function RightToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" onClick={() => onChange(!value)} className={`flex items-center justify-between gap-3 rounded-2xl border bg-black/35 p-3 text-left transition ${value ? 'border-emerald-200/35 shadow-[0_0_18px_rgba(52,211,153,.07)]' : 'border-white/10'}`}><span className="text-sm font-bold text-white/70">{label}</span><span className={`relative h-7 w-12 rounded-full border ${value ? 'border-emerald-200/55 shadow-[inset_0_0_12px_rgba(52,211,153,.25)]' : 'border-white/15'}`}><span className={`absolute top-1 h-5 w-5 rounded-full border transition ${value ? 'left-6 border-emerald-100 bg-emerald-200 shadow-[0_0_10px_rgba(110,231,183,.85)]' : 'left-1 border-white/25 bg-white/45'}`} /></span></button>;
}

function EmployeeCard({ member, isSelf, onRemove }: { member: StaffMember; isSelf: boolean; onRemove: () => void }) {
  return <PremiumCard><div className="flex items-center justify-between gap-3"><div><p className="font-black">{member.fullName}</p><p className="mt-1 text-xs text-white/40">{roleLabel(member.role)}</p></div><span className={`h-3 w-3 rounded-full ${member.isOnShift ? 'bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,.85)]' : 'bg-white/20'}`} /></div><p className="mt-3 text-xs text-white/45">{member.isOnShift ? `На зміні${member.shiftStartedAt ? ` з ${new Date(member.shiftStartedAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}` : ''}` : 'Не на зміні'}</p><button type="button" disabled={isSelf} onClick={onRemove} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200/30 bg-black/30 px-3 py-2.5 text-xs font-black text-rose-100 shadow-[0_0_16px_rgba(244,63,94,.05)] disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/25"><Trash2 size={15} />{isSelf ? 'Не можна видалити себе' : 'Видалити працівника'}</button></PremiumCard>;
}

function SystemCard({ title, status, text, tone }: { title: string; status: string; text: string; tone: 'gold' | 'neutral' }) {
  return <PremiumCard className={tone === 'gold' ? 'border-amber-100/25' : ''}><p className="font-black">{title}</p><p className="mt-2 text-xs font-bold text-white/55">{status}</p><p className="mt-2 text-xs text-white/35">{text}</p></PremiumCard>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-white/30">{text}</div>;
}

function NotificationsDrawer({ items, onClose }: { items: NoticeItem[]; onClose: () => void }) {
  return <div className="fixed inset-0 z-[90] bg-black/75 p-3 backdrop-blur-xl" onMouseDown={onClose}><aside className="ml-auto h-full w-full max-w-md overflow-y-auto rounded-[28px] border border-rose-100/25 bg-[#050505]/95 p-4 shadow-[0_0_70px_rgba(244,63,94,.12)]" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><Eyebrow>Центр подій</Eyebrow><h2 className="mt-1 text-2xl font-black">Повідомлення</h2></div><IconButton label="Закрити" onClick={onClose}><X size={18} /></IconButton></div><div className="mt-5 space-y-2">{items.map((item) => <Attention key={item.id} item={item} />)}{!items.length && <Empty text="Нових подій немає" />}</div></aside></div>;
}

function ConfirmModal({ title, text, confirm, tone, busy, onCancel, onConfirm }: { title: string; text: string; confirm: string; tone: 'red' | 'green'; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-3 backdrop-blur-xl"><div className="w-full max-w-md rounded-[28px] border border-amber-100/20 bg-[#070707] p-5 shadow-[0_0_70px_rgba(251,191,36,.08)]"><h2 className="text-xl font-black">{title}</h2><p className="mt-3 text-sm leading-6 text-white/55">{text}</p><div className="mt-5 grid grid-cols-2 gap-2"><OutlineAction label="Скасувати" tone="gold" disabled={busy} onClick={onCancel} /><OutlineAction label={busy ? 'Зачекайте...' : confirm} tone={tone} disabled={busy} onClick={onConfirm} /></div></div></div>;
}

function ReasonModal({ client, value, setValue, busy, onCancel, onConfirm }: { client: Client; value: string; setValue: (value: string) => void; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-3 backdrop-blur-xl"><div className="w-full max-w-md rounded-[28px] border border-amber-100/20 bg-[#070707] p-5"><h2 className="text-xl font-black">{client.isBlacklisted ? 'Розблокувати гостя' : 'Додати до чорного списку'}</h2><p className="mt-2 text-sm text-white/45">{client.fullName}</p><textarea value={value} onChange={(event) => setValue(event.target.value)} placeholder="Обов’язкова причина" className="mt-4 min-h-28 w-full resize-none rounded-2xl border border-white/12 bg-black/45 p-3 text-sm outline-none focus:border-amber-100/40" /><div className="mt-4 grid grid-cols-2 gap-2"><OutlineAction label="Скасувати" tone="gold" disabled={busy} onClick={onCancel} /><OutlineAction label={client.isBlacklisted ? 'Розблокувати' : 'Заблокувати'} tone={client.isBlacklisted ? 'green' : 'red'} disabled={busy || !value.trim()} onClick={onConfirm} /></div></div></div>;
}

function BroadcastModal({ clients, text, setText, selected, setSelected, all, setAll, busy, onClose, onSend }: { clients: Client[]; text: string; setText: (value: string) => void; selected: Set<string>; setSelected: (value: Set<string>) => void; all: boolean; setAll: (value: boolean) => void; busy: boolean; onClose: () => void; onSend: () => void }) {
  function toggle(id: string) { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); setSelected(next); setAll(false); }
  const count = all ? clients.length : selected.size;
  return <div className="fixed inset-0 z-[90] bg-black/80 p-3 backdrop-blur-xl"><div className="mx-auto flex h-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-violet-200/25 bg-[#060606]"><div className="flex items-center justify-between border-b border-white/10 p-4"><div><Eyebrow>Ручна розсилка</Eyebrow><h2 className="mt-1 text-xl font-black">Обрати гостей</h2></div><IconButton label="Закрити" onClick={onClose}><X size={18} /></IconButton></div><div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-4 md:grid-cols-2"><div className="min-h-0 overflow-y-auto"><FilterButton active={all} onClick={() => { setAll(true); setSelected(new Set()); }}>Усім доступним гостям</FilterButton><div className="mt-2 space-y-1.5">{clients.map((client) => <button key={client.id} type="button" onClick={() => toggle(client.id)} className={`flex w-full items-center justify-between rounded-2xl border bg-black/30 p-3 text-left ${selected.has(client.id) ? 'border-violet-200/45 text-violet-100 shadow-[0_0_18px_rgba(167,139,250,.08)]' : 'border-white/10'}`}><div><p className="text-sm font-bold">{client.fullName}</p><p className="mt-1 text-xs text-white/35">{client.phone}</p></div><span className={`grid h-5 w-5 place-items-center rounded-md border ${selected.has(client.id) ? 'border-violet-100 text-violet-100' : 'border-white/20'}`}>{selected.has(client.id) && <Check size={13} />}</span></button>)}</div></div><div className="flex flex-col"><Eyebrow>Текст повідомлення</Eyebrow><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Напишіть повідомлення гостям" className="mt-2 min-h-48 flex-1 resize-none rounded-2xl border border-white/12 bg-black/35 p-4 text-sm outline-none focus:border-violet-200/40" /><p className="mt-2 text-xs text-white/40">Отримувачів: {count}</p><OutlineAction className="mt-3 w-full" label={all ? `Надіслати всім · ${count}` : `Надіслати вибраним · ${count}`} tone="violet" disabled={busy || count === 0 || !text.trim()} onClick={onSend} /></div></div></div></div>;
}
