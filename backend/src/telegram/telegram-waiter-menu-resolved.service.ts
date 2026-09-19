import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import type { Booking } from '../bookings/entities/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import { waiterCanSeeBooking } from '../bookings/waiter-booking-visibility';
import { TelegramService } from '../notifications/telegram.service';
import { TablesService } from '../tables/tables.service';
import { WaiterCallsService } from '../waiter-calls/waiter-calls.service';
import { TelegramWaiterAssignmentLookupService } from './telegram-waiter-assignment-lookup.service';
import { TelegramWaiterMenuService } from './telegram-waiter-menu.service';

type TodayBooking = Booking & {
  assignedWaiterId?: string | null;
  assignedWaiterName?: string | null;
};

const PAGE_SIZE = 10;
const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);
const BOOKING_ACTIONS = new Set(['booking', 'booking_checkin', 'booking_cleaning', 'booking_complete']);

@Injectable()
export class TelegramWaiterMenuResolvedService extends TelegramWaiterMenuService {
  constructor(
    private readonly mineBookingsService: BookingsService,
    private readonly mineWaiterCalls: WaiterCallsService,
    tables: TablesService,
    private readonly mineTelegram: TelegramService,
    private readonly mineAssignmentLookup: TelegramWaiterAssignmentLookupService,
  ) {
    super(mineBookingsService, mineWaiterCalls, tables, mineTelegram);
  }

  async handle(
    action: string,
    id: string | undefined,
    chatId: string | number,
    actor: AuthUser | null,
  ) {
    if (action !== 'mine' && action !== 'bookings' && !BOOKING_ACTIONS.has(action)) {
      return super.handle(action, id, chatId, actor);
    }

    if (!actor?.staffId || actor.role !== 'waiter') {
      throw new BadRequestException('Команда доступна лише Офіціанту на зміні');
    }

    if (action === 'mine') {
      await this.sendMine(chatId, actor.staffId, this.parseMinePage(id));
      return true;
    }
    if (action === 'bookings') {
      await this.sendAvailable(chatId, actor.staffId, this.parseMinePage(id));
      return true;
    }

    // An old Telegram callback must not reveal a booking hidden from this waiter.
    const booking = ((await this.mineBookingsService.getToday()) as TodayBooking[])
      .find((item) => item.id === id);
    if (booking && ACTIVE_BOOKING_STATUSES.has(booking.status) &&
        !waiterCanSeeBooking(booking, actor.staffId)) {
      throw new NotFoundException('Бронювання не знайдено серед доступних бронювань');
    }
    return super.handle(action, id, chatId, actor);
  }

  private async sendAvailable(chatId: string | number, waiterId: string, requestedPage: number) {
    const available = ((await this.mineBookingsService.getToday()) as TodayBooking[])
      .filter((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status) &&
        waiterCanSeeBooking(booking, waiterId));
    const page = this.paginateMine(available, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map((booking) => [{
      text: this.mineBookingButtonLabel(booking),
      callback_data: `waiter:booking:${booking.id}`,
    }]);
    const pageButtons: Array<Record<string, unknown>> = [];
    if (page.pageIndex > 0) {
      pageButtons.push({ text: '⬅️', callback_data: `waiter:bookings:${page.pageIndex - 1}` });
    }
    if (page.pageIndex + 1 < page.totalPages) {
      pageButtons.push({ text: '➡️', callback_data: `waiter:bookings:${page.pageIndex + 1}` });
    }
    if (pageButtons.length) keyboard.push(pageButtons);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:waiter' }]);
    await this.mineTelegram.sendMessage(
      chatId,
      available.length
        ? `📋 <b>Усі бронювання на сьогодні</b> · ${available.length}\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
        : '📋 <b>Усі бронювання на сьогодні</b>\n\nБронювань немає.',
      { inline_keyboard: keyboard },
    );
  }

  private async sendMine(
    chatId: string | number,
    waiterId: string,
    requestedPage: number,
  ) {
    const active = ((await this.mineBookingsService.getToday()) as TodayBooking[])
      .filter((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status));
    const mine = await this.resolveMine(active, waiterId);
    const page = this.paginateMine(mine, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map(
      (booking) => [
        {
          text: this.mineBookingButtonLabel(booking),
          callback_data: `waiter:booking:${booking.id}`,
        },
      ],
    );

    const pageButtons: Array<Record<string, unknown>> = [];
    if (page.pageIndex > 0) {
      pageButtons.push({
        text: '⬅️',
        callback_data: `waiter:mine:${page.pageIndex - 1}`,
      });
    }
    if (page.pageIndex + 1 < page.totalPages) {
      pageButtons.push({
        text: '➡️',
        callback_data: `waiter:mine:${page.pageIndex + 1}`,
      });
    }
    if (pageButtons.length) keyboard.push(pageButtons);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:waiter' }]);

    await this.mineTelegram.sendMessage(
      chatId,
      mine.length
        ? `🪑 <b>Мої столи</b> · ${mine.length}\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
        : '🪑 <b>Мої столи</b>\n\nБронювань немає.',
      { inline_keyboard: keyboard },
    );
  }

  private async resolveMine(bookings: TodayBooking[], waiterId: string) {
    const withoutHistoryAssignment = bookings.filter(
      (booking) => !booking.assignedWaiterId,
    );
    const callAssignmentBookingIds = withoutHistoryAssignment.length
      ? new Set(
          await this.mineAssignmentLookup.bookingIdsForWaiter(
            withoutHistoryAssignment,
            waiterId,
          ),
        )
      : new Set<string>();

    return bookings.filter((booking) =>
      booking.assignedWaiterId
        ? booking.assignedWaiterId === waiterId
        : callAssignmentBookingIds.has(booking.id),
    );
  }

  private mineBookingButtonLabel(booking: TodayBooking) {
    const table = booking.table?.tableNumber || '—';
    const guest = booking.client?.fullName || 'Гість';
    return `№${table} · ${this.formatMineTime(booking.bookingTime)} · ${guest}`.slice(
      0,
      60,
    );
  }

  private parseMinePage(value: string | undefined) {
    const page = Number(value);
    return Number.isInteger(page) && page >= 0 ? page : 0;
  }

  private paginateMine<T>(items: T[], requestedPage: number) {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const pageIndex = Math.min(Math.max(0, requestedPage), totalPages - 1);
    const start = pageIndex * PAGE_SIZE;
    return {
      items: items.slice(start, start + PAGE_SIZE),
      pageIndex,
      totalPages,
    };
  }

  private formatMineTime(value: string | null | undefined) {
    return String(value || '--:--').slice(0, 5);
  }
}
