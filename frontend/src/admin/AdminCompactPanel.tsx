import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

import { bookingCalendarApi } from '../api/bookingCalendar';
import type { UpcomingBookingCalendar } from '../api/bookingCalendar';
import { bookingsApi } from '../api/bookings';
import { mapApi } from '../api/map';
import { tablesApi } from '../api/tables';
import type { Booking, FullMapResponse, TableItem, TableStatus } from '../api/types';

type View = 'bookings' | 'tables';
type BookingAction = 'approve' | 'reject' | 'cancel' | 'checkIn' | 'complete' | 'noShow' | 'cleaning';
type TableAction = 'free' | 'occupied' | 'cleaning' | 'close' | 'open';
type Filter = 'all' | 'pending' | 'approved' | 'attention';
type Location = 'all' | 'hall' | 'canopy' | 'gazebo' | 'rotang' | 'embankment' | 'glass' | 'water' | 'other';
type AdminTable = TableItem & { isVirtual?: boolean };

const ACTIVE = new Set(['pending', 'approved']);
const REMINDER_MINUTES = 15;
const LOCATIONS: Array<{ key: Exclude<Location, 'all'>; label: string }> = [
  { key: 'hall', label: 'Зал' }, { key: 'canopy', label: 'Навіс' },
  { key: 'gazebo', label: 'Велика альтанка' }, { key: 'rotang', label: 'Ротанг' },
  { key: 'embankment', label: 'Набережна' }, { key: 'glass', label: 'Скляна альтанка' },
  { key: 'water', label: 'На воді' }, { key: 'other', label: 'Інші' },
];
const TABLE_NUMBERS = [
  ...Array.from({ length: 14 }, (_, i) => i + 1), ...Array.from({ length: 6 }, (_, i) => i + 15),
  ...Array.from({ length: 16 }, (_, i) => i + 21), 37, 38, 39, 40, 41, 42, 43, 44,
  45, 46, 47, 48, 49, 50, ...Array.from({ length: 10 }, (_, i) => i + 100),
];
const BOOKING_LABEL: Record<string, string> = {
  pending: 'Очікує', approved: 'Підтверджено', rejected: 'Відхилено',
  cancelled: 'Скасовано', completed: 'Завершено', no_show: 'Не прийшов',
};
const BOOKING_TONE: Record<string, string> = {
  pending: 'border-sky-300/35 bg-sky-400/10 text-sky-100',
  approved: 'border-orange-300/35 bg-orange-400/10 text-orange-100',
  rejected: 'border-red-300/30 bg-red-400/10 text-red-100',
  cancelled: 'border-white/10 bg-white/5 text-white/55',
  completed: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100',
  no_show: 'border-red-300/40 bg-red-500/15 text-red-100',
};
const TABLE_LABEL: Record<TableStatus, string> = {
  free: 'Вільний', pending: 'Очікує', reserved: 'Бронь', occupied: 'Зайнятий',
  cleaning: 'Готується', closed: 'Закритий',
};
const TABLE_TONE: Record<TableStatus, string> = {
  free: 'border-white/15 bg-white/5 text-white/70',
  pending: 'border-sky-300/35 bg-sky-400/10 text-sky-100',
  reserved: 'border-orange-300/35 bg-orange-400/10 text-orange-100',
  occupied: 'border-red-300/35 bg-red-400/10 text-red-100',
  cleaning: 'border-cyan-200/35 bg-cyan-300/10 text-cyan-100',
  closed: 'border-neutral-300/25 bg-neutral-400/10 text-neutral-200',
};

function unwrap<T>(value: T | { data?: T }): T {
  return value && typeof value === 'object' && 'data' in value && (value as { data?: T }).data
    ? (value as { data: T }).data : value as T;
}
function todayKyiv() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
function dateLabel(date: string) { const [y, m, d] = date.split('-'); return y && m && d ? `${d}.${m}.${y}` : date; }
function shortDate(date: string) { const [, m, d] = date.split('-'); return m && d ? `${d}.${m}` : date; }
function timeLabel(value?: string | null) { const [h = '00', m = '00'] = String(value || '').split(':'); return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`; }
function phone(value?: string | null) { return String(value || '').replace(/[^\d+]/g, ''); }
function noShow(booking: Booking) { return String(booking.wishes || '').includes('[NO_SHOW]'); }
function status(booking: Booking) { return noShow(booking) ? 'no_show' : booking.status; }
function ageMinutes(booking: Booking) { const value = new Date(booking.createdAt).getTime(); return Number.isFinite(value) ? Math.max(0, Math.floor((Date.now() - value) / 60000)) : 0; }
function attention(booking: Booking) { return booking.status === 'pending' && ageMinutes(booking) >= REMINDER_MINUTES; }
function tableNumber(value: Booking | TableItem) { return Number('table' in value ? value.table?.tableNumber || 0 : value.tableNumber || 0); }
function location(number: number): Exclude<Location, 'all'> {
  if (number >= 1 && number <= 14) return 'hall'; if (number <= 20) return 'canopy';
  if (number <= 36) return 'gazebo'; if (number <= 39) return 'rotang'; if (number <= 44) return 'embankment';
  if (number <= 50) return 'glass'; if (number >= 100 && number <= 109) return 'water'; return 'other';
}
function locationLabel(key: Exclude<Location, 'all'>) { return LOCATIONS.find((item) => item.key === key)?.label || 'Інші'; }
function duration(booking: Booking) { const minutes = Number(booking.durationMinutes || 0); if (!minutes) return '-'; const h = Math.floor(minutes / 60); const m = minutes % 60; return h ? `${h} год${m ? ` ${m} хв` : ''}` : `${m} хв`; }
function wishes(booking: Booking) {
  return String(booking.wishes || '').split('\n').map((line) => line.trim()).filter(Boolean)
    .filter((line) => !/^Час відпочинку:/i.test(line) && !/^Підготовка столу/i.test(line) && !line.includes('[NO_SHOW]'));
}
function virtualTable(number: number): AdminTable {
  return { id: `virtual-table-${number}`, tableNumber: String(number), seats: 4, shape: 'rectangle', photoUrl: null,
    status: 'free', x: 0, y: 0, width: 100, height: 80, rotation: 0, isVisible: true, zone: null, isVirtual: true };
}

export default function AdminCompactPanel() {
  const today = useMemo(todayKyiv, []);
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<View>('bookings');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [calendar, setCalendar] = useState<UpcomingBookingCalendar | null>(null);
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [locationFilter, setLocationFilter] = useState<Location>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isToday = selectedDate === today;
  const calendarMap = useMemo(() => new Map((calendar?.dates || []).map((item) => [item.date, item])), [calendar]);

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true); setError(null);
    const [bookingResult, calendarResult, mapResult] = await Promise.allSettled([
      bookingsApi.getByDate(selectedDate), bookingCalendarApi.upcoming(180), mapApi.get(),
    ]);
    if (bookingResult.status === 'fulfilled') setBookings(unwrap<Booking[]>(bookingResult.value));
    else setError(bookingResult.reason?.message || 'Не вдалося завантажити бронювання');
    if (calendarResult.status === 'fulfilled') setCalendar(unwrap<UpcomingBookingCalendar>(calendarResult.value));
    if (mapResult.status === 'fulfilled') setMap(unwrap<FullMapResponse>(mapResult.value));
    if (showSpinner) setLoading(false);
  }
  useEffect(() => {
    void load(); const timer = window.setInterval(() => void load(false), 15_000);
    return () => window.clearInterval(timer);
  }, [selectedDate]);

  const sorted = useMemo(() => [...bookings].sort((a, b) => String(a.bookingTime).localeCompare(String(b.bookingTime)) || tableNumber(a) - tableNumber(b)), [bookings]);
  const visibleBookings = useMemo(() => sorted.filter((booking) => {
    if (filter === 'pending' && booking.status !== 'pending') return false;
    if (filter === 'approved' && booking.status !== 'approved') return false;
    if (filter === 'attention' && !attention(booking)) return false;
    if (locationFilter !== 'all' && location(tableNumber(booking)) !== locationFilter) return false;
    const query = search.trim().toLowerCase(); if (!query) return true;
    return [booking.table?.tableNumber, booking.client?.fullName, booking.client?.phone, booking.bookingTime, booking.wishes]
      .filter(Boolean).join(' ').toLowerCase().includes(query);
  }), [sorted, filter, locationFilter, search]);
  const tables = useMemo(() => {
    const byNumber = new Map<string, AdminTable>(); (map?.tables || []).forEach((item) => byNumber.set(item.tableNumber, item as AdminTable));
    TABLE_NUMBERS.forEach((number) => { if (!byNumber.has(String(number))) byNumber.set(String(number), virtualTable(number)); });
    return Array.from(byNumber.values()).filter((item) => locationFilter === 'all' || location(Number(item.tableNumber)) === locationFilter)
      .sort((a, b) => Number(a.tableNumber) - Number(b.tableNumber));
  }, [map, locationFilter]);
  const active = sorted.filter((booking) => ACTIVE.has(booking.status) && !noShow(booking));
  const stats = { total: sorted.length, active: active.length, pending: sorted.filter((item) => item.status === 'pending').length,
    approved: sorted.filter((item) => item.status === 'approved').length, guests: active.reduce((sum, item) => sum + Number(item.guestsCount || 0), 0) };

  function selectDate(date: string) { setSelectedDate(date); setFilter('all'); setLocationFilter('all'); setSearch(''); }
  async function bookingAction(booking: Booking, action: BookingAction) {
    setBusy(`${booking.id}:${action}`); setMessage(null); setError(null);
    try {
      if (action === 'approve') await bookingsApi.approve(booking.id); if (action === 'reject') await bookingsApi.reject(booking.id);
      if (action === 'cancel') await bookingsApi.cancel(booking.id); if (action === 'checkIn') await bookingsApi.checkIn(booking.id);
      if (action === 'complete') await bookingsApi.complete(booking.id); if (action === 'noShow') await bookingsApi.noShow(booking.id);
      if (action === 'cleaning') { if (!booking.table?.id) throw new Error('Стіл не привʼязаний'); await tablesApi.cleaning(booking.table.id); }
      setMessage('Дію виконано'); await load(false);
    } catch (value: any) { setError(value?.message || 'Не вдалося виконати дію'); } finally { setBusy(null); }
  }
  async function tableAction(table: AdminTable, action: TableAction) {
    const key = `table:${table.tableNumber}:${action}`; setBusy(key); setMessage(null); setError(null);
    try {
      const next: TableStatus = action === 'open' ? 'free' : action === 'close' ? 'closed' : action;
      if (table.isVirtual) await tablesApi.setStatusByNumber(table.tableNumber, next);
      else if (action === 'free') await tablesApi.free(table.id); else if (action === 'occupied') await tablesApi.occupied(table.id);
      else if (action === 'cleaning') await tablesApi.cleaning(table.id); else if (action === 'close') await tablesApi.close(table.id); else await tablesApi.open(table.id);
      setMessage(`Стіл №${table.tableNumber}: ${TABLE_LABEL[next]}`); await load(false);
    } catch (value: any) { setError(value?.message || 'Не вдалося змінити стіл'); } finally { setBusy(null); }
  }

  return (
    <main className="mx-auto max-w-7xl p-3 pb-28 sm:p-4 lg:p-6">
      <section className="rounded-[22px] border border-white/10 bg-neutral-950/95 p-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-[10px] uppercase tracking-[.25em] text-amber-100/50">MOLO · адміністратор</p><h1 className="mt-1 text-2xl font-black">Швидкий пульт</h1></div>
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-amber-200/40 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-100 disabled:opacity-40">{loading ? '...' : 'Оновити'}</button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <DateButton label="Сьогодні" date={today} selected={selectedDate === today} count={calendarMap.get(today)?.total || 0} onClick={() => selectDate(today)} />
          <DateButton label="Завтра" date={addDays(today, 1)} selected={selectedDate === addDays(today, 1)} count={calendarMap.get(addDays(today, 1))?.total || 0} onClick={() => selectDate(addDays(today, 1))} />
          <DateButton label="Післязавтра" date={addDays(today, 2)} selected={selectedDate === addDays(today, 2)} count={calendarMap.get(addDays(today, 2))?.total || 0} onClick={() => selectDate(addDays(today, 2))} />
        </div>
        <label className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2"><span><small className="block text-white/35">Обрана дата</small><b>{dateLabel(selectedDate)}</b></span><input type="date" value={selectedDate} onChange={(event: ChangeEvent<HTMLInputElement>) => selectDate(event.target.value)} className="max-w-[165px] rounded-lg border border-white/10 bg-neutral-900 px-2 py-2 text-sm" /></label>
        {(message || error) && <p className={`mt-2 rounded-xl border px-3 py-2 text-sm ${error ? 'border-red-300/30 bg-red-500/10 text-red-100' : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-100'}`}>{error || message}</p>}
      </section>

      <section className="mt-3 rounded-[20px] border border-purple-300/20 bg-purple-400/[.07] p-3">
        <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.2em] text-purple-100/55">Майбутні бронювання</p><p className="mt-1 font-black">{calendar?.total || 0} активних броней на 180 днів</p></div><span className="rounded-xl bg-black/25 px-3 py-2 font-black text-purple-100">{calendar?.dates.filter((item) => item.date > today).length || 0}</span></div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">{(calendar?.dates || []).filter((item) => item.date > today).map((item) => <button key={item.date} type="button" onClick={() => selectDate(item.date)} className="min-w-[82px] rounded-xl border border-purple-200/25 bg-black/25 p-2 text-left"><small className="text-purple-100/60">{shortDate(item.date)}</small><b className="mt-1 block text-xl">{item.total}</b><small className="text-white/35">гостей {item.guests}</small></button>)}{!calendar?.dates.some((item) => item.date > today) && <span className="text-sm text-white/35">Поки немає.</span>}</div>
      </section>

      <div className="mt-3 grid grid-cols-5 gap-2">{[['Усього', stats.total], ['Активні', stats.active], ['Гості', stats.guests], ['Очікують', stats.pending], ['Підтв.', stats.approved]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-neutral-950 p-2 text-center"><small className="text-[9px] text-white/35">{label}</small><b className="block text-xl">{value}</b></div>)}</div>

      <div className="mt-3 grid grid-cols-2 gap-2"><TabButton active={view === 'bookings'} onClick={() => setView('bookings')}>Бронювання</TabButton><TabButton active={view === 'tables'} onClick={() => setView('tables')}>Столи</TabButton></div>
      <LocationStrip value={locationFilter} onChange={setLocationFilter} />

      {view === 'bookings' ? <section className="mt-3 space-y-3">
        <div className="rounded-[18px] border border-white/10 bg-neutral-950 p-3"><div className="flex items-center justify-between"><b>Броні на {dateLabel(selectedDate)}</b><span className="rounded-lg bg-white/5 px-2 py-1 text-xs">{visibleBookings.length}</span></div><input value={search} onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)} placeholder="Пошук: стіл, імʼя, телефон" className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none" /><div className="mt-2 flex gap-2 overflow-x-auto"><Chip active={filter === 'all'} onClick={() => setFilter('all')}>Усі</Chip><Chip active={filter === 'pending'} onClick={() => setFilter('pending')}>Очікують</Chip><Chip active={filter === 'approved'} onClick={() => setFilter('approved')}>Підтверджені</Chip><Chip active={filter === 'attention'} onClick={() => setFilter('attention')}>15+ хв</Chip></div></div>
        {selectedDate > today && <p className="rounded-xl border border-purple-300/25 bg-purple-400/10 px-3 py-2 text-sm text-purple-100">Майбутня дата: доступні підтвердження, відхилення, дзвінок і скасування. Дії зі столом зʼявляться в день бронювання.</p>}
        <div className="grid gap-3 lg:grid-cols-2">{visibleBookings.map((booking) => <BookingCard key={booking.id} booking={booking} isToday={isToday} busy={busy} onAction={(action) => void bookingAction(booking, action)} />)}{!visibleBookings.length && <Empty>На цю дату бронювань немає.</Empty>}</div>
      </section> : <section className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{tables.map((table) => <TableCard key={table.id} table={table} busy={busy} onAction={(action) => void tableAction(table, action)} />)}</section>}
    </main>
  );
}

function DateButton({ label, date, selected, count, onClick }: { label: string; date: string; selected: boolean; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`rounded-xl border p-2 text-left ${selected ? 'border-amber-200/55 bg-amber-300/15 text-amber-100' : count ? 'border-purple-300/30 bg-purple-400/10 text-purple-100' : 'border-white/10 bg-white/[.03] text-white/55'}`}><span className="flex justify-between gap-1 text-xs font-black">{label}{count > 0 && <i className="not-italic">{count}</i>}</span><small className="text-[9px] opacity-50">{shortDate(date)}</small></button>;
}
function LocationStrip({ value, onChange }: { value: Location; onChange: (value: Location) => void }) {
  return <div className="mt-2 flex gap-2 overflow-x-auto rounded-[16px] border border-white/10 bg-neutral-950 p-2"><Chip active={value === 'all'} onClick={() => onChange('all')}>Усі локації</Chip>{LOCATIONS.map((item) => <Chip key={item.key} active={value === item.key} onClick={() => onChange(item.key)}>{item.label}</Chip>)}</div>;
}
function Chip({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-black ${active ? 'border-amber-200/55 bg-amber-300/15 text-amber-100' : 'border-white/10 bg-white/[.03] text-white/50'}`}>{children}</button>; }
function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) { return <button type="button" onClick={onClick} className={`rounded-xl border px-3 py-3 font-black ${active ? 'border-amber-200/55 bg-amber-300/15 text-amber-100' : 'border-white/10 bg-neutral-950 text-white/55'}`}>{children}</button>; }
function Action({ label, tone = 'neutral', disabled, busy, onClick }: { label: string; tone?: 'neutral' | 'green' | 'red' | 'blue' | 'cyan'; disabled: boolean; busy: boolean; onClick: () => void }) {
  const tones = { neutral: 'border-white/10 bg-white/[.04] text-white/65', green: 'border-emerald-300/30 bg-emerald-400/10 text-emerald-100', red: 'border-red-300/30 bg-red-400/10 text-red-100', blue: 'border-sky-300/30 bg-sky-400/10 text-sky-100', cyan: 'border-cyan-200/30 bg-cyan-300/10 text-cyan-100' };
  return <button type="button" onClick={onClick} disabled={disabled || busy} className={`rounded-xl border px-2 py-2.5 text-xs font-black disabled:opacity-30 ${tones[tone]}`}>{busy ? '...' : label}</button>;
}
function BookingCard({ booking, isToday, busy, onAction }: { booking: Booking; isToday: boolean; busy: string | null; onAction: (action: BookingAction) => void }) {
  const current = status(booking); const number = tableNumber(booking); const guestPhone = booking.client?.phone || '-'; const notes = wishes(booking);
  const checkedIn = Boolean(booking.checkedInAt) || booking.table?.status === 'occupied' || booking.table?.status === 'cleaning';
  const canCheckIn = isToday && booking.status === 'approved' && !noShow(booking) && !checkedIn;
  const canWork = isToday && booking.status === 'approved' && checkedIn;
  return <article className={`rounded-[18px] border p-3 ${attention(booking) ? 'border-amber-200/35 bg-amber-300/[.07]' : 'border-white/10 bg-neutral-950'}`}>
    <div className="flex items-start justify-between gap-2"><div><h3 className="text-lg font-black">{timeLabel(booking.bookingTime)} · Стіл №{number || '-'}</h3><p className="text-xs text-white/35">{locationLabel(location(number))} · {booking.guestsCount} гостей · {duration(booking)}</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-black ${BOOKING_TONE[current] || BOOKING_TONE.cancelled}`}>{BOOKING_LABEL[current] || current}</span></div>
    {!isToday && <p className="mt-2 w-fit rounded-full border border-purple-300/30 bg-purple-400/10 px-2 py-1 text-[9px] font-black text-purple-100">МАЙБУТНЯ БРОНЬ</p>}
    <div className="mt-2 grid grid-cols-2 gap-2"><Info label="Гість">{booking.client?.fullName || '-'}</Info><Info label="Телефон"><a href={`tel:${phone(guestPhone)}`} className="text-amber-100">{guestPhone}</a></Info></div>
    {notes.length > 0 && <div className="mt-2 rounded-xl border border-white/10 bg-black/25 p-2 text-xs text-white/60">{notes.map((note, index) => <p key={`${booking.id}-${index}`}>{note}</p>)}</div>}
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3"><Action label="Прийняти" tone="green" disabled={!['pending', 'rejected'].includes(booking.status) || Boolean(busy)} busy={busy === `${booking.id}:approve`} onClick={() => onAction('approve')} /><Action label="Відхилити" tone="red" disabled={!['pending', 'approved'].includes(booking.status) || Boolean(busy)} busy={busy === `${booking.id}:reject`} onClick={() => onAction('reject')} /><a href={`tel:${phone(guestPhone)}`} className="rounded-xl border border-amber-200/30 bg-amber-300/10 px-2 py-2.5 text-center text-xs font-black text-amber-100">Подзвонити</a>
      {isToday && <Action label="Гість прийшов" tone="blue" disabled={!canCheckIn || Boolean(busy)} busy={busy === `${booking.id}:checkIn`} onClick={() => onAction('checkIn')} />}{isToday && <Action label="Стіл готується" tone="cyan" disabled={!canWork || !booking.table?.id || Boolean(busy)} busy={busy === `${booking.id}:cleaning`} onClick={() => onAction('cleaning')} />}{isToday && <Action label="Стіл вільний" disabled={!canWork || Boolean(busy)} busy={busy === `${booking.id}:complete`} onClick={() => onAction('complete')} />}{isToday && <Action label="Не прийшов" tone="red" disabled={!ACTIVE.has(booking.status) || checkedIn || noShow(booking) || Boolean(busy)} busy={busy === `${booking.id}:noShow`} onClick={() => onAction('noShow')} />}<Action label="Скасувати" disabled={['cancelled', 'completed', 'rejected'].includes(booking.status) || Boolean(busy)} busy={busy === `${booking.id}:cancel`} onClick={() => onAction('cancel')} /></div>
  </article>;
}
function TableCard({ table, busy, onAction }: { table: AdminTable; busy: string | null; onAction: (action: TableAction) => void }) {
  const prefix = `table:${table.tableNumber}:`; return <article className="rounded-[16px] border border-white/10 bg-neutral-950 p-3"><div className="flex justify-between gap-2"><div><b>Стіл №{table.tableNumber}</b><p className="text-[10px] text-white/35">{locationLabel(location(Number(table.tableNumber)))}</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-black ${TABLE_TONE[table.status]}`}>{TABLE_LABEL[table.status]}</span></div><div className="mt-2 grid grid-cols-2 gap-2"><Action label="Вільний" disabled={Boolean(busy)} busy={busy === `${prefix}free`} onClick={() => onAction('free')} /><Action label="Зайнятий" tone="red" disabled={Boolean(busy)} busy={busy === `${prefix}occupied`} onClick={() => onAction('occupied')} /><Action label="Готується" tone="cyan" disabled={Boolean(busy)} busy={busy === `${prefix}cleaning`} onClick={() => onAction('cleaning')} />{table.status === 'closed' ? <Action label="Відкрити" tone="green" disabled={Boolean(busy)} busy={busy === `${prefix}open`} onClick={() => onAction('open')} /> : <Action label="Закрити" tone="red" disabled={Boolean(busy)} busy={busy === `${prefix}close`} onClick={() => onAction('close')} />}</div></article>;
}
function Info({ label, children }: { label: string; children: ReactNode }) { return <div className="rounded-xl border border-white/10 bg-black/25 p-2"><small className="text-[9px] uppercase text-white/30">{label}</small><div className="truncate text-sm font-black">{children}</div></div>; }
function Empty({ children }: { children: ReactNode }) { return <div className="rounded-[18px] border border-dashed border-white/10 p-6 text-center text-sm text-white/35">{children}</div>; }
