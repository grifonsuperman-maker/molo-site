import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import type { Booking } from '../bookings/entities/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import { TelegramService } from '../notifications/telegram.service';
import type { TableEntity } from '../tables/entities/table.entity';
import { TablesService } from '../tables/tables.service';
import { WaiterCallsService } from '../waiter-calls/waiter-calls.service';

type TodayBooking = Booking & {
  assignedWaiterId?: string | null;
  assignedWaiterName?: string | null;
};

type BookingListMode = 'active' | 'mine' | 'history';

const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: 'Очікує',
  approved: 'Підтверджено',
  rejected: 'Відхилено',
  cancelled: 'Скасовано',
  completed: 'Завершено',
};

const TABLE_STATUS_LABELS: Record<string, string> = {
  free: 'Вільний',
  pending: 'Очікує',
  reserved: 'Заброньований',
  occupied: 'Зайнятий',
  cleaning: 'Готується',
  closed: 'Закритий',
};

const LOCATIONS = [
  { key: 'hall', label: 'Зал ресторану', range: '1–14', accepts: (value: number) => value >= 1 && value <= 14 },
  { key: 'canopy', label: 'Навіс', range: '15–20', accepts: (value: number) => value >= 15 && value <= 20 },
  { key: 'gazebo', label: 'Велика альтанка', range: '21–36', accepts: (value: number) => value >= 21 && value <= 36 },
  { key: 'rotang', label: 'Ротанг', range: '37–39', accepts: (value: number) => value >= 37 && value <= 39 },
  { key: 'embankment', label: 'Набережна', range: '40–44', accepts: (value: number) => value >= 40 && value <= 44 },
  { key: 'glass-gazebo', label: 'Скляна альтанка', range: '45–50', accepts: (value: number) => value >= 45 && value <= 50 },
  { key: 'water-gazebo', label: 'Альтанка на воді', range: '100–109', accepts: (value: number) => value >= 100 && value <= 109 },
] as const;

@Injectable()
export class TelegramWaiterMenuService {
  constructor(
    private readonly bookings: BookingsService,
    private readonly waiterCalls: WaiterCallsService,
    private readonly tables: TablesService,
    private readonly telegram: TelegramService,
  ) {}

  async sendMenu(chatId: string | number, waiterAppUrl?: string | null) {
    const keyboard: Array<Array<Record<string, unknown>>> = [
      [
        { text: '🔔 Виклики', callback_data: 'waiter:calls' },
        { text: '🪑 Мої столи', callback_data: 'waiter:mine' },
      ],
      [
        { text: '📋 Усі бронювання', callback_data: 'waiter:bookings' },
        { text: '🧾 Історія', callback_data: 'waiter:history' },
      ],
      [{ text: '🪑 Столи без бронювання', callback_data: 'waiter:tables' }],
    ];

    if (waiterAppUrl) {
      keyboard.push([
        {
          text: '📱 Відкрити повний пульт',
          web_app: { url: waiterAppUrl },
        },
      ]);
    }

    await this.telegram.sendMessage(
      chatId,
      '👨‍🍳 <b>Пульт Офіціанта</b>\n\nОберіть дію:',
      { inline_keyboard: keyboard },
    );
  }

  async handle(
    action: string,
    id: string | undefined,
    chatId: string | number,
    actor: AuthUser | null,
  ) {
    if (!actor?.staffId || actor.role !== 'waiter') {
      throw new BadRequestException('Команда доступна лише Офіціанту на зміні');
    }

    switch (action) {
      case 'calls':
        await this.sendCalls(chatId, actor);
        return true;
      case 'call':
        await this.sendCall(chatId, id, actor);
        return true;
      case 'call_accept':
        await this.acceptCall(chatId, id, actor);
        return true;
      case 'call_close':
        await this.closeCall(chatId, id, actor);
        return true;
      case 'mine':
        await this.sendBookings(chatId, actor, 'mine');
        return true;
      case 'bookings':
        await this.sendBookings(chatId, actor, 'active');
        return true;
      case 'history':
        await this.sendBookings(chatId, actor, 'history');
        return true;
      case 'booking':
        await this.sendBooking(chatId, id);
        return true;
      case 'booking_checkin':
        await this.checkInBooking(chatId, id, actor);
        return true;
      case 'booking_cleaning':
        await this.startCleaning(chatId, id);
        return true;
      case 'booking_complete':
        await this.completeBooking(chatId, id, actor);
        return true;
      case 'tables':
        await this.sendTableLocations(chatId);
        return true;
      case 'zone':
        await this.sendZone(chatId, id);
        return true;
      case 'table':
        await this.sendTable(chatId, id);
        return true;
      case 'table_occupied':
        await this.setTableStatus(chatId, id, 'occupied');
        return true;
      case 'table_free':
        await this.setTableStatus(chatId, id, 'free');
        return true;
      default:
        return false;
    }
  }

  private async sendCalls(chatId: string | number, actor: AuthUser) {
    const calls = await this.waiterCalls.list(actor.staffId || undefined);
    const keyboard = calls.slice(0, 20).map((call) => [
      {
        text: `${call.status === 'accepted' ? '✅' : '🔔'} Стіл №${call.tableNumber || '—'} · ${call.clientName || 'Гість'}`.slice(0, 60),
        callback_data: `waiter:call:${call.id}`,
      },
    ]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:waiter' }]);

    await this.telegram.sendMessage(
      chatId,
      calls.length
        ? `🔔 <b>Виклики Офіціанта</b> · ${calls.length}`
        : '🔔 <b>Виклики Офіціанта</b>\n\nНових викликів немає.',
      { inline_keyboard: keyboard },
    );
  }

  private async sendCall(chatId: string | number, id: string | undefined, actor: AuthUser) {
    if (!id) throw new BadRequestException('Виклик не вказано');
    const calls = await this.waiterCalls.list(actor.staffId || undefined);
    const call = calls.find((item) => item.id === id);
    if (!call) throw new NotFoundException('Виклик не знайдено або він уже закритий');

    const keyboard: Array<Array<Record<string, unknown>>> = [];
    if (call.status === 'new') {
      keyboard.push([{ text: '✅ Прийняв', callback_data: `waiter:call_accept:${call.id}` }]);
    } else if (call.status === 'accepted') {
      keyboard.push([{ text: '🟢 Закрити виклик', callback_data: `waiter:call_close:${call.id}` }]);
    }
    keyboard.push([{ text: '⬅️ До викликів', callback_data: 'waiter:calls' }]);

    await this.telegram.sendMessage(
      chatId,
      [
        '🔔 <b>Виклик Офіціанта</b>',
        `Стіл №${this.escapeHtml(call.tableNumber || '—')}`,
        `Гість: ${this.escapeHtml(call.clientName || 'Гість')}`,
        `Статус: ${call.status === 'accepted' ? 'Прийнято' : 'Новий'}`,
        `Час: ${this.formatDateTime(call.createdAt)}`,
      ].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private async acceptCall(chatId: string | number, id: string | undefined, actor: AuthUser) {
    if (!id || !actor.staffId) throw new BadRequestException('Виклик не вказано');
    await this.waiterCalls.accept(id, {
      waiterId: actor.staffId,
      waiterName: actor.name || 'Офіціант',
    });
    await this.telegram.sendMessage(chatId, '✅ Виклик прийнято');
    await this.sendCalls(chatId, actor);
  }

  private async closeCall(chatId: string | number, id: string | undefined, actor: AuthUser) {
    if (!id || !actor.staffId) throw new BadRequestException('Виклик не вказано');
    await this.waiterCalls.close(id, actor.staffId);
    await this.telegram.sendMessage(chatId, '🟢 Виклик закрито');
    await this.sendCalls(chatId, actor);
  }

  private async sendBookings(
    chatId: string | number,
    actor: AuthUser,
    mode: BookingListMode,
  ) {
    let bookings = (await this.bookings.getToday()) as TodayBooking[];

    if (mode === 'history') {
      bookings = bookings.filter((booking) => !ACTIVE_BOOKING_STATUSES.has(booking.status));
    } else {
      bookings = bookings.filter((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status));
    }

    if (mode === 'mine') {
      const assignments = await this.waiterCalls.myAssignments(actor.staffId || '');
      const bookingIds = new Set(assignments.map((item) => item.bookingId));
      bookings = bookings.filter((booking) => bookingIds.has(booking.id));
    }

    const title = mode === 'mine'
      ? '🪑 <b>Мої столи</b>'
      : mode === 'history'
        ? '🧾 <b>Історія за сьогодні</b>'
        : '📋 <b>Усі бронювання на сьогодні</b>';

    const keyboard = bookings.slice(0, 20).map((booking) => [
      {
        text: this.bookingButtonLabel(booking),
        callback_data: `waiter:booking:${booking.id}`,
      },
    ]);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:waiter' }]);

    await this.telegram.sendMessage(
      chatId,
      bookings.length ? `${title} · ${bookings.length}` : `${title}\n\nБронювань немає.`,
      { inline_keyboard: keyboard },
    );
  }

  private async sendBooking(chatId: string | number, id: string | undefined) {
    const booking = await this.findTodayBooking(id);
    const tableStatus = booking.table?.status || null;
    const checkedIn = Boolean(booking.checkedInAt);
    const displayStatus =
      booking.status === 'approved' && checkedIn && (tableStatus === 'occupied' || tableStatus === 'cleaning')
        ? TABLE_STATUS_LABELS[tableStatus]
        : BOOKING_STATUS_LABELS[booking.status] || booking.status;

    const keyboard: Array<Array<Record<string, unknown>>> = [];
    if (
      booking.status === 'approved' &&
      booking.table &&
      !checkedIn &&
      tableStatus !== 'occupied' &&
      tableStatus !== 'cleaning' &&
      tableStatus !== 'closed'
    ) {
      keyboard.push([{ text: '👋 Гість прийшов', callback_data: `waiter:booking_checkin:${booking.id}` }]);
    } else if (booking.status === 'approved' && booking.table && checkedIn && tableStatus === 'occupied') {
      keyboard.push([{ text: '🧹 Гості пішли, почати прибирання', callback_data: `waiter:booking_cleaning:${booking.id}` }]);
    } else if (booking.status === 'approved' && booking.table && checkedIn && tableStatus === 'cleaning') {
      keyboard.push([{ text: '✅ Стіл готовий', callback_data: `waiter:booking_complete:${booking.id}` }]);
    }
    keyboard.push([{ text: '⬅️ До бронювань', callback_data: 'waiter:bookings' }]);

    await this.telegram.sendMessage(
      chatId,
      [
        `🪑 <b>Стіл №${this.escapeHtml(booking.table?.tableNumber || '—')}</b>`,
        `${this.formatTime(booking.bookingTime)} · ${this.escapeHtml(booking.client?.fullName || 'Гість')}`,
        `${this.escapeHtml(booking.table?.zone?.name || 'Без локації')} · ${booking.guestsCount} гостей`,
        `Статус: ${this.escapeHtml(displayStatus)}`,
      ].join('\n'),
      { inline_keyboard: keyboard },
    );
  }

  private async checkInBooking(chatId: string | number, id: string | undefined, actor: AuthUser) {
    const booking = await this.findTodayBooking(id);
    const tableStatus = booking.table?.status || null;
    if (
      booking.status !== 'approved' ||
      !booking.table ||
      booking.checkedInAt ||
      tableStatus === 'occupied' ||
      tableStatus === 'cleaning' ||
      tableStatus === 'closed'
    ) {
      throw new BadRequestException('Для цієї броні дія «Гість прийшов» зараз недоступна');
    }

    await this.bookings.checkIn(booking.id, actor);
    if (actor.staffId) {
      await this.waiterCalls.assign({
        bookingId: booking.id,
        tableId: booking.table.id,
        tableNumber: booking.table.tableNumber,
        waiterId: actor.staffId,
        waiterName: actor.name || 'Офіціант',
      });
    }
    await this.telegram.sendMessage(chatId, '⚫ Гість прийшов, стіл зайнятий');
    await this.sendBooking(chatId, booking.id);
  }

  private async startCleaning(chatId: string | number, id: string | undefined) {
    const booking = await this.findTodayBooking(id);
    if (
      booking.status !== 'approved' ||
      !booking.table ||
      !booking.checkedInAt ||
      booking.table.status !== 'occupied'
    ) {
      throw new BadRequestException('Почати прибирання для цієї броні зараз не можна');
    }

    await this.tables.markCleaning(booking.table.id);
    await this.telegram.sendMessage(chatId, '🧹 Гості пішли, почато прибирання');
    await this.sendBooking(chatId, booking.id);
  }

  private async completeBooking(chatId: string | number, id: string | undefined, actor: AuthUser) {
    const booking = await this.findTodayBooking(id);
    if (
      booking.status !== 'approved' ||
      !booking.table ||
      !booking.checkedInAt ||
      booking.table.status !== 'cleaning'
    ) {
      throw new BadRequestException('Позначити стіл готовим для цієї броні зараз не можна');
    }

    await this.bookings.complete(booking.id, actor);
    await this.telegram.sendMessage(chatId, '✅ Стіл готовий і вільний');
    await this.sendBookings(chatId, actor, 'active');
  }

  private async sendTableLocations(chatId: string | number) {
    const tables = (await this.tables.findAll()).filter((table) => table.isVisible !== false);
    const keyboard: Array<Array<Record<string, unknown>>> = LOCATIONS.map((location) => {
      const count = tables.filter((table) => location.accepts(Number(table.tableNumber))).length;
      return [{
        text: `${location.label} · ${count}`,
        callback_data: `waiter:zone:${location.key}`,
      }];
    });

    const unassigned = tables.filter(
      (table) => !LOCATIONS.some((location) => location.accepts(Number(table.tableNumber))),
    );
    if (unassigned.length) {
      keyboard.push([{ text: `Без локації · ${unassigned.length}`, callback_data: 'waiter:zone:none' }]);
    }
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:waiter' }]);

    await this.telegram.sendMessage(
      chatId,
      '🪑 <b>Столи без бронювання</b>\n\nОберіть локацію:',
      { inline_keyboard: keyboard },
    );
  }

  private async sendZone(chatId: string | number, key: string | undefined) {
    if (!key) throw new BadRequestException('Локацію не вказано');
    const allTables = (await this.tables.findAll()).filter((table) => table.isVisible !== false);
    const location = LOCATIONS.find((item) => item.key === key);
    const tables = allTables
      .filter((table) =>
        location
          ? location.accepts(Number(table.tableNumber))
          : key === 'none' && !LOCATIONS.some((item) => item.accepts(Number(table.tableNumber))),
      )
      .sort((left, right) => Number(left.tableNumber) - Number(right.tableNumber));

    if (!location && key !== 'none') throw new NotFoundException('Локацію не знайдено');

    const keyboard: Array<Array<Record<string, unknown>>> = [];
    for (let index = 0; index < tables.length; index += 2) {
      keyboard.push(
        tables.slice(index, index + 2).map((table) => ({
          text: `№${table.tableNumber} · ${TABLE_STATUS_LABELS[table.status] || table.status}`,
          callback_data: `waiter:table:${table.id}`,
        })),
      );
    }
    keyboard.push([{ text: '⬅️ До локацій', callback_data: 'waiter:tables' }]);

    await this.telegram.sendMessage(
      chatId,
      `🪑 <b>${this.escapeHtml(location?.label || 'Без локації')}</b>${location ? ` · столи ${location.range}` : ''}`,
      { inline_keyboard: keyboard },
    );
  }

  private async sendTable(chatId: string | number, id: string | undefined) {
    const table = await this.findVisibleTable(id);
    await this.telegram.sendMessage(
      chatId,
      [
        `🪑 <b>Стіл №${this.escapeHtml(table.tableNumber)}</b>`,
        `${this.escapeHtml(table.zone?.name || 'Без локації')} · ${table.seats} місць`,
        `Статус: ${TABLE_STATUS_LABELS[table.status] || table.status}`,
        '',
        'Для гостя без бронювання:',
      ].join('\n'),
      {
        inline_keyboard: [
          [
            { text: '🔴 Зайнятий', callback_data: `waiter:table_occupied:${table.id}` },
            { text: '⚪ Вільний', callback_data: `waiter:table_free:${table.id}` },
          ],
          [{ text: '⬅️ До локацій', callback_data: 'waiter:tables' }],
        ],
      },
    );
  }

  private async setTableStatus(
    chatId: string | number,
    id: string | undefined,
    status: 'occupied' | 'free',
  ) {
    const table = await this.findVisibleTable(id);
    const updated = await this.tables.setWaiterStatus(table.id, status);
    await this.telegram.sendMessage(
      chatId,
      `🪑 Стіл №${this.escapeHtml(updated.tableNumber)}: <b>${TABLE_STATUS_LABELS[updated.status] || updated.status}</b>`,
    );
    await this.sendTable(chatId, updated.id);
  }

  private async findTodayBooking(id: string | undefined) {
    if (!id) throw new BadRequestException('Бронювання не вказано');
    const bookings = (await this.bookings.getToday()) as TodayBooking[];
    const booking = bookings.find((item) => item.id === id);
    if (!booking) throw new NotFoundException('Бронювання не знайдено серед бронювань на сьогодні');
    return booking;
  }

  private async findVisibleTable(id: string | undefined): Promise<TableEntity> {
    if (!id) throw new BadRequestException('Стіл не вказано');
    const table = (await this.tables.findAll()).find((item) => item.id === id && item.isVisible !== false);
    if (!table) throw new NotFoundException('Стіл не знайдено');
    return table;
  }

  private bookingButtonLabel(booking: TodayBooking) {
    const table = booking.table?.tableNumber || '—';
    const guest = booking.client?.fullName || 'Гість';
    return `№${table} · ${this.formatTime(booking.bookingTime)} · ${guest}`.slice(0, 60);
  }

  private formatTime(value: string | null | undefined) {
    return String(value || '--:--').slice(0, 5);
  }

  private formatDateTime(value: string) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat('uk-UA', {
      timeZone: 'Europe/Kyiv',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private escapeHtml(value: string) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
