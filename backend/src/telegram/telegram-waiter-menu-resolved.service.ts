import { BadRequestException, Injectable } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import type { Booking } from '../bookings/entities/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import { TelegramService } from '../notifications/telegram.service';
import { TablesService } from '../tables/tables.service';
import { WaiterCallsService } from '../waiter-calls/waiter-calls.service';
import { TelegramWaiterMenuService } from './telegram-waiter-menu.service';

type TodayBooking = Booking & {
  assignedWaiterId?: string | null;
  assignedWaiterName?: string | null;
};

const PAGE_SIZE = 10;
const RESOLUTION_BATCH_SIZE = 10;
const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);

@Injectable()
export class TelegramWaiterMenuResolvedService extends TelegramWaiterMenuService {
  constructor(
    private readonly mineBookingsService: BookingsService,
    private readonly mineWaiterCalls: WaiterCallsService,
    tables: TablesService,
    private readonly mineTelegram: TelegramService,
  ) {
    super(mineBookingsService, mineWaiterCalls, tables, mineTelegram);
  }

  async handle(
    action: string,
    id: string | undefined,
    chatId: string | number,
    actor: AuthUser | null,
  ) {
    if (action !== 'mine') {
      return super.handle(action, id, chatId, actor);
    }

    if (!actor?.staffId || actor.role !== 'waiter') {
      throw new BadRequestException('Команда доступна лише Офіціанту на зміні');
    }

    await this.sendMine(chatId, actor.staffId, this.parsePage(id));
    return true;
  }

  private async sendMine(
    chatId: string | number,
    waiterId: string,
    requestedPage: number,
  ) {
    const active = ((await this.mineBookingsService.getToday()) as TodayBooking[])
      .filter((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status));
    const mine = await this.resolveMine(active, waiterId);
    const page = this.paginate(mine, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map(
      (booking) => [
        {
          text: this.bookingButtonLabel(booking),
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
    const mine: TodayBooking[] = [];

    for (let offset = 0; offset < bookings.length; offset += RESOLUTION_BATCH_SIZE) {
      const chunk = bookings.slice(offset, offset + RESOLUTION_BATCH_SIZE);
      const matches = await Promise.all(
        chunk.map(async (booking) => {
          if (booking.assignedWaiterId) {
            return booking.assignedWaiterId === waiterId;
          }

          const assignment = await this.mineWaiterCalls.assignmentForBooking(booking);
          return assignment?.waiterId === waiterId;
        }),
      );

      matches.forEach((matchesWaiter, index) => {
        if (matchesWaiter) mine.push(chunk[index]);
      });
    }

    return mine;
  }

  private bookingButtonLabel(booking: TodayBooking) {
    const table = booking.table?.tableNumber || '—';
    const guest = booking.client?.fullName || 'Гість';
    return `№${table} · ${this.formatTime(booking.bookingTime)} · ${guest}`.slice(
      0,
      60,
    );
  }

  private parsePage(value: string | undefined) {
    const page = Number(value);
    return Number.isInteger(page) && page >= 0 ? page : 0;
  }

  private paginate<T>(items: T[], requestedPage: number) {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const pageIndex = Math.min(Math.max(0, requestedPage), totalPages - 1);
    const start = pageIndex * PAGE_SIZE;
    return {
      items: items.slice(start, start + PAGE_SIZE),
      pageIndex,
      totalPages,
    };
  }

  private formatTime(value: string | null | undefined) {
    return String(value || '--:--').slice(0, 5);
  }
}
