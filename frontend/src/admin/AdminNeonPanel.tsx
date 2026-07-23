import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';

import { adminBookingsApi } from '../api/adminBookings';
import type { AdminBookingCalendar } from '../api/adminBookings';
import { bookingsApi } from '../api/bookings';
import { clientsApi } from '../api/clients';
import { mapApi } from '../api/map';
import { tablesApi } from '../api/tables';
import type { Booking, Client, FullMapResponse, TableItem } from '../api/types';
import AdminBookingCard from './AdminBookingCard';
import AdminManualBookingModal from './AdminManualBookingModal';
import type { ManualBookingForm } from './AdminManualBookingModal';
import {
  ACTIVE_STATUSES,
  DateButton,
  EmptyState,
  formatDate,
  isNoShow,
  localDate,
  locationLabel,
  NeonButton,
  normalizePhone,
  TABLE_STATUS_COLOR,
  TABLE_STATUS_LABEL,
  TabButton,
  tableNumber,
  unwrap,
} from './adminNeonShared';
import type { BookingAction, TableAction } from './adminNeonShared';

type Section = 'bookings' | 'tables' | 'blacklist';

export default function AdminNeonPanel() {
  const [section, setSection] = useState<Section>('bookings');
  const [selectedDate, setSelectedDate] = useState(localDate());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [map, setMap] = useState<FullMapResponse | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [calendar, setCalendar] = useState<AdminBookingCalendar | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [expandedTableId, setExpandedTableId] = useState<string | null>(null);
  const [openLocation, setOpenLocation] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [changeTableBookingId, setChangeTableBookingId] = useState<string | null>(null);
  const [changeTableId, setChangeTableId] = useState('');
  const [blacklistSearch, setBlacklistSearch] = useState('');
  const [manual, setManual] = useState<ManualBookingForm>({
    fullName: '', phone: '', bookingDate: localDate(), bookingTime: '19:00',
    guestsCount: 2, durationMinutes: 120, tableId: '', wishes: '',
  });

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    setError(null);
    const [bookingsResult, mapResult, clientsResult, calendarResult] = await Promise.allSettled([
      bookingsApi.getByDate(selectedDate),
      mapApi.get(),
      clientsApi.getAll(),
      adminBookingsApi.upcoming(180),
    ]);

    if (bookingsResult.status === 'fulfilled') setBookings(unwrap<Booking[]>(bookingsResult.value));
    else setError(bookingsResult.reason?.message || 'Не вдалося завантажити бронювання');
    if (mapResult.status === 'fulfilled') setMap(unwrap<FullMapResponse>(mapResult.value));
    if (clientsResult.status === 'fulfilled') setClients(unwrap<Client[]>(clientsResult.value));
    if (calendarResult.status === 'fulfilled') setCalendar(unwrap<AdminBookingCalendar>(calendarResult.value));
    if (showSpinner) setLoading(false);
  }

  useEffect(() => {
    setExpandedBookingId(null);
    setChangeTableBookingId(null);
    load();
    const timer = window.setInterval(() => load(false), 15000);
    return () => window.clearInterval(timer);
  }, [selectedDate]);

  const today = calendar?.today || localDate();
  const isToday = selectedDate === today;
  const sortedBookings = useMemo(() => [...bookings].sort((left, right) => {
    const time = String(left.bookingTime).localeCompare(String(right.bookingTime));
    return time || Number(tableNumber(left)) - Number(tableNumber(right));
  }), [bookings]);
  const activeCount = useMemo(() => sortedBookings.filter((booking) => ACTIVE_STATUSES.has(booking.status) && !isNoShow(booking)).length, [sortedBookings]);
  const tables = useMemo(() => [...(map?.tables || [])].filter((table) => table.isVisible !== false).sort((a, b) => Number(a.tableNumber) - Number(b.tableNumber)), [map]);
  const groupedTables = useMemo(() => {
    const groups = new Map<string, TableItem[]>();
    tables.forEach((table) => {
      const label = table.zone?.name || locationLabel(table.tableNumber);
      groups.set(label, [...(groups.get(label) || []), table]);
    });
    return Array.from(groups.entries());
  }, [tables]);
  const futureDates = useMemo(() => (calendar?.dates || []).filter((item) => item.date >= today).slice(0, 14), [calendar, today]);
  const blacklisted = useMemo(() => {
    const query = blacklistSearch.trim().toLowerCase();
    return clients.filter((client) => client.isBlacklisted).filter((client) => !query || `${client.fullName} ${client.phone}`.toLowerCase().includes(query));
  }, [clients, blacklistSearch]);

  async function runBookingAction(booking: Booking, action: BookingAction) {
    const key = `${booking.id}:${action}`;
    setBusy(key); setNotice(null); setError(null);
    try {
      if (action === 'approve') await bookingsApi.approve(booking.id);
      if (action === 'reject') await bookingsApi.reject(booking.id);
      if (action === 'cancel') await bookingsApi.cancel(booking.id);
      if (action === 'checkIn') await bookingsApi.checkIn(booking.id);
      if (action === 'complete') await bookingsApi.complete(booking.id);
      if (action === 'noShow') await bookingsApi.noShow(booking.id);
      if (action === 'cleaning') {
        if (!booking.table?.id) throw new Error('Стіл не прив’язаний до бронювання');
        await tablesApi.cleaning(booking.table.id);
      }
      setNotice(({
        approve: 'Бронювання підтверджено', reject: 'Бронювання відхилено',
        cancel: 'Бронювання скасовано', checkIn: 'Гостя відмічено, стіл зайнятий',
        cleaning: 'Стіл переведено у підготовку', complete: 'Бронювання завершено, стіл вільний',
        noShow: 'Бронювання знято через неявку',
      } as Record<BookingAction, string>)[action]);
      await load(false);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося виконати дію');
    } finally { setBusy(null); }
  }

  async function runTableAction(table: TableItem, action: TableAction) {
    const key = `table:${table.id}:${action}`;
    setBusy(key); setNotice(null); setError(null);
    try {
      if (action === 'free') await tablesApi.free(table.id);
      if (action === 'occupied') await tablesApi.occupied(table.id);
      if (action === 'cleaning') await tablesApi.cleaning(table.id);
      if (action === 'close') await tablesApi.close(table.id);
      if (action === 'open') await tablesApi.open(table.id);
      setNotice(`Стіл №${table.tableNumber}: статус змінено`);
      setExpandedTableId(null);
      await load(false);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося змінити статус столу');
    } finally { setBusy(null); }
  }

  async function toggleBlacklist(client: Client, nextValue: boolean) {
    const key = `client:${client.id}:${nextValue ? 'blacklist' : 'unblacklist'}`;
    setBusy(key); setNotice(null); setError(null);
    try {
      if (nextValue) await clientsApi.blacklist(client.id); else await clientsApi.unblacklist(client.id);
      setNotice(nextValue ? 'Клієнта додано до чорного списку' : 'Клієнта вилучено з чорного списку');
      await load(false);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося змінити чорний список');
    } finally { setBusy(null); }
  }

  async function submitManual() {
    setBusy('manual:create'); setNotice(null); setError(null);
    try {
      await adminBookingsApi.createManual({
        tableId: manual.tableId, fullName: manual.fullName.trim(), phone: manual.phone.trim(),
        bookingDate: manual.bookingDate, bookingTime: manual.bookingTime,
        guestsCount: Number(manual.guestsCount), durationMinutes: Number(manual.durationMinutes), wishes: manual.wishes.trim(),
      });
      setManualOpen(false);
      setSelectedDate(manual.bookingDate);
      setManual((current) => ({ ...current, fullName: '', phone: '', tableId: '', wishes: '' }));
      setNotice('Бронювання телефоном створено та підтверджено');
      await load(false);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося створити бронювання телефоном');
    } finally { setBusy(null); }
  }

  async function submitChangeTable(booking: Booking) {
    if (!changeTableId) return;
    const key = `${booking.id}:change-table`;
    setBusy(key); setNotice(null); setError(null);
    try {
      await adminBookingsApi.changeTable(booking.id, changeTableId);
      setChangeTableBookingId(null); setChangeTableId('');
      setNotice('Стіл у бронюванні змінено');
      await load(false);
    } catch (actionError: any) {
      setError(actionError?.message || 'Не вдалося змінити стіл');
    } finally { setBusy(null); }
  }

  function openManual() {
    setManual((current) => ({ ...current, bookingDate: selectedDate }));
    setManualOpen(true);
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl bg-black px-3 pb-28 pt-3 text-white sm:px-5 lg:px-8">
      <header className="sticky top-[72px] z-30 rounded-[24px] border border-amber-200/20 bg-neutral-950/95 p-3 shadow-[0_0_42px_rgba(251,191,36,.08)] backdrop-blur-xl sm:top-[76px]">
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-100/55">MOLO</p><h1 className="mt-1 text-xl font-black">Пульт адміністратора</h1></div>
          <NeonButton tone="amber" compact onClick={openManual}>＋ Бронь телефоном</NeonButton>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <TabButton active={section === 'bookings'} onClick={() => setSection('bookings')}>Бронювання</TabButton>
          <TabButton active={section === 'tables'} onClick={() => setSection('tables')}>Столи</TabButton>
          <TabButton active={section === 'blacklist'} onClick={() => setSection('blacklist')}>Чорний список</TabButton>
        </div>
      </header>

      {(notice || error) && <div className={`mt-3 rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-300/35 bg-red-500/10 text-red-100' : 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100'}`}>{error || notice}</div>}

      {section === 'bookings' && (
        <section className="mt-3 space-y-3">
          <div className="rounded-[24px] border border-white/10 bg-neutral-950 p-3">
            <div className="grid grid-cols-3 gap-2">
              <DateButton active={selectedDate === today} onClick={() => setSelectedDate(today)}>Сьогодні</DateButton>
              <DateButton active={selectedDate === localDate(1)} onClick={() => setSelectedDate(localDate(1))}>Завтра</DateButton>
              <DateButton active={selectedDate === localDate(2)} onClick={() => setSelectedDate(localDate(2))}>Післязавтра</DateButton>
            </div>
            <label className="mt-3 flex items-center gap-3 rounded-2xl border border-violet-300/25 bg-violet-400/5 px-3 py-2 shadow-[0_0_24px_rgba(167,139,250,.07)]">
              <span className="text-xs font-bold text-violet-100/70">Дата</span>
              <input type="date" value={selectedDate} min={today} onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedDate(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-bold text-white outline-none" />
              <span className="text-xs text-white/40">{formatDate(selectedDate)}</span>
            </label>
            {futureDates.length > 0 && <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{futureDates.map((item) => <button key={item.date} type="button" onClick={() => setSelectedDate(item.date)} className={`shrink-0 rounded-2xl border px-3 py-2 text-left transition active:scale-95 ${selectedDate === item.date ? 'border-violet-200/70 bg-violet-400/20 shadow-[0_0_24px_rgba(167,139,250,.22)]' : 'border-violet-300/20 bg-violet-400/5'}`}><p className="text-xs font-black text-violet-100">{formatDate(item.date)}</p><p className="mt-1 text-[10px] text-white/50">{item.total} броней · {item.guests} гостей</p></button>)}</div>}
          </div>

          <div className="flex items-center justify-between gap-3 px-1">
            <div><p className="text-xs uppercase tracking-[0.18em] text-white/40">{isToday ? 'Сьогодні' : 'Обрана дата'}</p><h2 className="mt-1 text-2xl font-black">{formatDate(selectedDate)}</h2></div>
            <div className="rounded-2xl border border-amber-200/25 bg-amber-300/10 px-4 py-2 text-center shadow-[0_0_20px_rgba(251,191,36,.08)]"><p className="text-2xl font-black text-amber-100">{activeCount}</p><p className="text-[10px] text-white/45">активних</p></div>
          </div>

          {loading && <EmptyState>Оновлюємо пульт...</EmptyState>}
          {!loading && sortedBookings.length === 0 && <EmptyState>На цю дату бронювань немає.</EmptyState>}
          <div className="grid gap-3 lg:grid-cols-2">{sortedBookings.map((booking) => <AdminBookingCard
            key={booking.id}
            booking={booking}
            isToday={isToday}
            tables={tables}
            busy={busy}
            expanded={expandedBookingId === booking.id}
            changingTable={changeTableBookingId === booking.id}
            changeTableId={changeTableId}
            onToggle={() => setExpandedBookingId(expandedBookingId === booking.id ? null : booking.id)}
            onAction={(action) => runBookingAction(booking, action)}
            onStartChangeTable={() => { setChangeTableBookingId(changeTableBookingId === booking.id ? null : booking.id); setChangeTableId(''); }}
            onChangeTableId={setChangeTableId}
            onSubmitChangeTable={() => submitChangeTable(booking)}
            onCancelChangeTable={() => { setChangeTableBookingId(null); setChangeTableId(''); }}
            onToggleBlacklist={toggleBlacklist}
          />)}</div>
        </section>
      )}

      {section === 'tables' && (
        <section className="mt-3 space-y-3">
          <div className="rounded-[24px] border border-cyan-200/20 bg-neutral-950 p-4 shadow-[0_0_32px_rgba(103,232,249,.06)]"><h2 className="text-xl font-black">Столи по локаціях</h2><p className="mt-1 text-sm text-white/45">Кнопки статусів приховані всередині кожного столу.</p></div>
          {groupedTables.map(([location, locationTables]) => {
            const opened = openLocation === location;
            const busyCount = locationTables.filter((table) => table.status !== 'free').length;
            return <div key={location} className="rounded-[24px] border border-white/10 bg-neutral-950 p-3">
              <button type="button" onClick={() => setOpenLocation(opened ? null : location)} className="flex w-full items-center justify-between gap-3 text-left"><div><h3 className="text-lg font-black">{location}</h3><p className="mt-1 text-xs text-white/40">{locationTables.length} столів · {busyCount} зі статусом</p></div><span className="rounded-2xl border border-cyan-200/25 bg-cyan-300/5 px-3 py-2 text-sm font-black text-cyan-100">{opened ? 'Сховати' : 'Відкрити'}</span></button>
              {opened && <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{locationTables.map((table) => {
                const expanded = expandedTableId === table.id;
                return <div key={table.id} className="rounded-2xl border border-white/10 bg-black/35 p-3">
                  <div className="flex items-center justify-between gap-2"><p className="font-black">Стіл №{table.tableNumber}</p><span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] font-bold" style={{ color: TABLE_STATUS_COLOR[table.status] }}>{TABLE_STATUS_LABEL[table.status]}</span></div>
                  <button type="button" onClick={() => setExpandedTableId(expanded ? null : table.id)} className="mt-3 w-full rounded-xl border border-cyan-200/25 bg-cyan-300/5 px-3 py-2 text-xs font-black text-cyan-100 shadow-[0_0_18px_rgba(103,232,249,.05)]">{expanded ? 'Сховати статуси' : 'Змінити статус'}</button>
                  {expanded && <div className="mt-2 grid grid-cols-2 gap-2">
                    <NeonButton compact tone="neutral" busy={busy === `table:${table.id}:free`} disabled={Boolean(busy)} onClick={() => runTableAction(table, 'free')}>Вільний</NeonButton>
                    <NeonButton compact tone="red" busy={busy === `table:${table.id}:occupied`} disabled={Boolean(busy)} onClick={() => runTableAction(table, 'occupied')}>Зайнятий</NeonButton>
                    <NeonButton compact tone="cyan" busy={busy === `table:${table.id}:cleaning`} disabled={Boolean(busy)} onClick={() => runTableAction(table, 'cleaning')}>Готується</NeonButton>
                    {table.status === 'closed' ? <NeonButton compact tone="green" busy={busy === `table:${table.id}:open`} disabled={Boolean(busy)} onClick={() => runTableAction(table, 'open')}>Відкрити</NeonButton> : <NeonButton compact tone="red" busy={busy === `table:${table.id}:close`} disabled={Boolean(busy)} onClick={() => runTableAction(table, 'close')}>Закрити</NeonButton>}
                  </div>}
                </div>;
              })}</div>}
            </div>;
          })}
        </section>
      )}

      {section === 'blacklist' && (
        <section className="mt-3 space-y-3">
          <div className="rounded-[24px] border border-red-300/20 bg-neutral-950 p-4 shadow-[0_0_34px_rgba(239,68,68,.06)]">
            <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-black">Чорний список</h2><p className="mt-1 text-sm text-white/45">Нові бронювання для цих номерів блокуються.</p></div><span className="rounded-2xl border border-red-300/25 bg-red-500/10 px-4 py-2 text-xl font-black text-red-100">{blacklisted.length}</span></div>
            <input value={blacklistSearch} onChange={(event: ChangeEvent<HTMLInputElement>) => setBlacklistSearch(event.target.value)} placeholder="Пошук за ім’ям або телефоном" className="mt-3 w-full rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-sm outline-none focus:border-red-300/40" />
          </div>
          {blacklisted.map((client) => <div key={client.id} className="rounded-[22px] border border-red-300/20 bg-neutral-950 p-4"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-lg font-black">{client.fullName}</p><a href={`tel:${normalizePhone(client.phone)}`} className="mt-1 block text-sm text-amber-100">{client.phone}</a></div><NeonButton compact tone="green" busy={busy === `client:${client.id}:unblacklist`} disabled={Boolean(busy)} onClick={() => toggleBlacklist(client, false)}>Вилучити</NeonButton></div></div>)}
          {blacklisted.length === 0 && <EmptyState>У чорному списку нікого немає.</EmptyState>}
        </section>
      )}

      {manualOpen && <AdminManualBookingModal form={manual} today={today} tables={tables} busy={busy === 'manual:create'} onChange={setManual} onSubmit={submitManual} onClose={() => setManualOpen(false)} />}
    </main>
  );
}
