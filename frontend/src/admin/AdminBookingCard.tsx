import type { ChangeEvent } from 'react';

import type { Booking, Client, TableItem } from '../api/types';
import {
  ACTIVE_STATUSES,
  bookingStatusClass,
  CompactInfo,
  formatDate,
  formatTime,
  guestWishes,
  isNoShow,
  locationLabel,
  NeonButton,
  normalizePhone,
  STATUS_LABEL,
  TABLE_STATUS_COLOR,
  TABLE_STATUS_LABEL,
  tableNumber,
} from './adminNeonShared';
import type { BookingAction, Tone } from './adminNeonShared';

export default function AdminBookingCard({
  booking,
  isToday,
  tables,
  busy,
  expanded,
  changingTable,
  changeTableId,
  onToggle,
  onAction,
  onStartChangeTable,
  onChangeTableId,
  onSubmitChangeTable,
  onCancelChangeTable,
  onToggleBlacklist,
}: {
  booking: Booking;
  isToday: boolean;
  tables: TableItem[];
  busy: string | null;
  expanded: boolean;
  changingTable: boolean;
  changeTableId: string;
  onToggle: () => void;
  onAction: (action: BookingAction) => void;
  onStartChangeTable: () => void;
  onChangeTableId: (id: string) => void;
  onSubmitChangeTable: () => void;
  onCancelChangeTable: () => void;
  onToggleBlacklist: (client: Client, nextValue: boolean) => void;
}) {
  const client = booking.client;
  const tableStatus = booking.table?.status;
  const active = ACTIVE_STATUSES.has(booking.status) && !isNoShow(booking);
  const physicalActions = isToday && booking.status === 'approved';
  const wishes = guestWishes(booking);
  const primary = booking.status === 'pending'
    ? { label: 'Підтвердити', action: 'approve' as BookingAction, tone: 'green' as Tone }
    : physicalActions && !booking.checkedInAt
      ? { label: 'Гість прийшов', action: 'checkIn' as BookingAction, tone: 'blue' as Tone }
      : physicalActions && tableStatus === 'occupied'
        ? { label: 'Стіл готується', action: 'cleaning' as BookingAction, tone: 'cyan' as Tone }
        : physicalActions && tableStatus === 'cleaning'
          ? { label: 'Стіл вільний', action: 'complete' as BookingAction, tone: 'green' as Tone }
          : null;

  return (
    <article className="rounded-[24px] border border-white/10 bg-neutral-950 p-3 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-black">Стіл №{tableNumber(booking)}</h3>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${bookingStatusClass(booking.status)}`}>
              {isNoShow(booking) ? 'Гість не прийшов' : STATUS_LABEL[booking.status] || booking.status}
            </span>
            {!isToday && active && <span className="rounded-full border border-violet-300/40 bg-violet-400/10 px-2.5 py-1 text-[10px] font-black text-violet-100 shadow-[0_0_18px_rgba(167,139,250,.12)]">МАЙБУТНЯ БРОНЬ</span>}
          </div>
          <p className="mt-2 truncate text-sm font-bold text-white/85">{client?.fullName || 'Гість без імені'}</p>
          <p className="mt-1 text-xs text-white/45">{formatTime(booking.bookingTime)} · {booking.guestsCount} гостей · {locationLabel(tableNumber(booking))}</p>
        </div>
        {tableStatus && <span className="shrink-0 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[10px] font-bold" style={{ color: TABLE_STATUS_COLOR[tableStatus] }}>{TABLE_STATUS_LABEL[tableStatus]}</span>}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {primary ? (
          <NeonButton tone={primary.tone} busy={busy === `${booking.id}:${primary.action}`} disabled={Boolean(busy)} onClick={() => onAction(primary.action)}>{primary.label}</NeonButton>
        ) : (
          <a href={`tel:${normalizePhone(client?.phone)}`} className="rounded-2xl border border-amber-200/30 bg-amber-300/5 px-3 py-3 text-center text-sm font-black text-amber-100 shadow-[0_0_20px_rgba(251,191,36,.06)]">Подзвонити</a>
        )}
        <NeonButton tone="neutral" onClick={onToggle}>{expanded ? 'Сховати' : 'Ще дії'}</NeonButton>
      </div>

      {expanded && (
        <div className="mt-3 rounded-[20px] border border-white/10 bg-black/35 p-3">
          <div className="grid grid-cols-2 gap-2">
            <CompactInfo label="Телефон" value={client?.phone || '-'} />
            <CompactInfo label="Дата" value={formatDate(booking.bookingDate)} />
            <CompactInfo label="Час" value={formatTime(booking.bookingTime)} />
            <CompactInfo label="Джерело" value={booking.source === 'admin_manual' ? 'Телефон' : 'Сайт'} />
          </div>

          {wishes.length > 0 && <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3"><p className="text-[10px] uppercase tracking-[0.14em] text-white/35">Побажання</p>{wishes.map((line, index) => <p key={`${booking.id}-${index}`} className="mt-1 text-sm text-white/70">{line}</p>)}</div>}

          {changingTable && (
            <div className="mt-2 rounded-2xl border border-violet-300/25 bg-violet-400/5 p-3">
              <label className="text-xs font-bold text-violet-100">Новий стіл</label>
              <select value={changeTableId} onChange={(event: ChangeEvent<HTMLSelectElement>) => onChangeTableId(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-neutral-950 px-3 py-3 text-sm outline-none">
                <option value="">Оберіть стіл</option>
                {tables.filter((table) => table.id !== booking.table?.id).map((table) => {
                  const unavailable = isToday && (table.status === 'occupied' || table.status === 'cleaning');
                  const closed = table.status === 'closed' || table.zone?.isClosed;
                  return <option key={table.id} value={table.id} disabled={closed || unavailable || table.seats < booking.guestsCount}>№{table.tableNumber} · {locationLabel(table.tableNumber)} · {TABLE_STATUS_LABEL[table.status]}</option>;
                })}
              </select>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <NeonButton tone="violet" busy={busy === `${booking.id}:change-table`} disabled={!changeTableId || Boolean(busy)} onClick={onSubmitChangeTable}>Зберегти стіл</NeonButton>
                <NeonButton tone="neutral" onClick={onCancelChangeTable}>Скасувати</NeonButton>
              </div>
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={`tel:${normalizePhone(client?.phone)}`} className="rounded-2xl border border-amber-200/30 bg-amber-300/5 px-3 py-3 text-center text-xs font-black text-amber-100">Подзвонити гостю</a>
            <NeonButton compact tone="violet" disabled={!active} onClick={onStartChangeTable}>Змінити стіл</NeonButton>
            {booking.status === 'pending' && <NeonButton compact tone="red" busy={busy === `${booking.id}:reject`} disabled={Boolean(busy)} onClick={() => onAction('reject')}>Відхилити</NeonButton>}
            {active && <NeonButton compact tone="red" busy={busy === `${booking.id}:cancel`} disabled={Boolean(busy)} onClick={() => onAction('cancel')}>Скасувати бронь</NeonButton>}
            {physicalActions && !booking.checkedInAt && <NeonButton compact tone="red" busy={busy === `${booking.id}:noShow`} disabled={Boolean(busy)} onClick={() => onAction('noShow')}>Гість не прийшов</NeonButton>}
            {physicalActions && booking.checkedInAt && tableStatus !== 'cleaning' && <NeonButton compact tone="cyan" busy={busy === `${booking.id}:cleaning`} disabled={Boolean(busy)} onClick={() => onAction('cleaning')}>Стіл готується</NeonButton>}
            {physicalActions && booking.checkedInAt && <NeonButton compact tone="green" busy={busy === `${booking.id}:complete`} disabled={Boolean(busy)} onClick={() => onAction('complete')}>Стіл вільний</NeonButton>}
            {client && <NeonButton compact tone={client.isBlacklisted ? 'green' : 'red'} busy={busy === `client:${client.id}:${client.isBlacklisted ? 'unblacklist' : 'blacklist'}`} disabled={Boolean(busy)} onClick={() => onToggleBlacklist(client, !client.isBlacklisted)}>{client.isBlacklisted ? 'Прибрати з чорного списку' : 'У чорний список'}</NeonButton>}
          </div>
        </div>
      )}
    </article>
  );
}
