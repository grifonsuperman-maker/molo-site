import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUser } from '../auth/types/auth-user.type';
import type { Booking } from '../bookings/entities/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import { TelegramService } from '../notifications/telegram.service';
import type { TableEntity } from '../tables/entities/table.entity';
import { TablesService } from '../tables/tables.service';
import { WaiterCallsService } from '../waiter-calls/waiter-calls.service';
import { TelegramWaiterAssignmentLookupService } from './telegram-waiter-assignment-lookup.service';
import { TelegramWaiterMenuService } from './telegram-waiter-menu.service';

type TodayBooking = Booking & {
  assignedWaiterId?: string | null;
  assignedWaiterName?: string | null;
};
type MineEntry = { kind: 'booking'; booking: TodayBooking } | { kind: 'table'; table: TableEntity };

const PAGE_SIZE = 10;
const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'approved']);
const TABLE_STATUS_LABELS: Record<string, string> = {
  free: 'Вільний', pending: 'Очікує', reserved: 'Заброньований',
  occupied: 'Зайнятий', cleaning: 'Готується', closed: 'Закритий',
};

@Injectable()
export class TelegramWaiterMenuResolvedService extends TelegramWaiterMenuService {
  constructor(
    private readonly mineBookingsService: BookingsService,
    private readonly mineWaiterCalls: WaiterCallsService,
    private readonly mineTables: TablesService,
    private readonly mineTelegram: TelegramService,
    private readonly mineAssignmentLookup: TelegramWaiterAssignmentLookupService,
  ) {
    super(mineBookingsService, mineWaiterCalls, mineTables, mineTelegram);
  }

  async handle(
    action: string,
    id: string | undefined,
    chatId: string | number,
    actor: AuthUser | null,
  ) {
    if (!['mine', 'booking', 'table', 'booking_cleaning', 'table_occupied', 'table_free'].includes(action)) {
      return super.handle(action, id, chatId, actor);
    }
    if (!actor?.staffId || actor.role !== 'waiter') {
      throw new BadRequestException('Команда доступна лише Офіціанту на зміні');
    }

    if (action === 'mine') {
      await this.sendMine(chatId, actor.staffId, this.parseMinePage(id));
      return true;
    }

    if (action === 'booking' || action === 'booking_cleaning') {
      if (!id) throw new BadRequestException('Бронювання не вказано');
      const booking = ((await this.mineBookingsService.getToday()) as TodayBooking[])
        .find((item) => item.id === id);
      if (!booking) throw new NotFoundException('Бронювання не знайдено серед бронювань на сьогодні');
      const table = booking.table;
      if (action === 'booking') {
        if (table?.assignedWaiterId && table.assignedWaiterId !== actor.staffId) {
          await this.mineTelegram.sendMessage(chatId,
            `🪑 Стіл №${this.escape(table.tableNumber)} · ${TABLE_STATUS_LABELS[table.status] || table.status}\nЗакріплений за іншим офіціантом. Дії недоступні.`,
            { inline_keyboard: [[{ text: '⬅️ До бронювань', callback_data: 'waiter:bookings' }]] },
          );
          return true;
        }
        return super.handle(action, id, chatId, actor);
      }
      if (booking.status !== 'approved' || !table || !booking.checkedInAt || table.status !== 'occupied') {
        throw new BadRequestException('Почати прибирання для цієї броні зараз не можна');
      }
      await this.mineTables.markCleaning(table.id, actor);
      await this.mineTelegram.sendMessage(chatId, '🧹 Гості пішли, почато прибирання');
      return this.handle('booking', id, chatId, actor);
    }

    if (!id) throw new BadRequestException('Стіл не вказано');
    const table = (await this.mineTables.findAll()).find((item) => item.id === id && item.isVisible !== false);
    if (!table) throw new NotFoundException('Стіл не знайдено');
    if (action === 'table') {
      if (table.assignedWaiterId && table.assignedWaiterId !== actor.staffId) {
        await this.mineTelegram.sendMessage(chatId,
          `🪑 Стіл №${this.escape(table.tableNumber)} · ${TABLE_STATUS_LABELS[table.status] || table.status}\nЗакріплений за іншим офіціантом. Дії недоступні.`,
          { inline_keyboard: [[{ text: '⬅️ До локацій', callback_data: 'waiter:tables' }]] },
        );
        return true;
      }
      return super.handle(action, id, chatId, actor);
    }

    const status = action === 'table_occupied' ? 'occupied' : 'free';
    const updated = await this.mineTables.setWaiterStatus(table.id, status, actor);
    if (!updated) throw new NotFoundException('Стіл не знайдено');
    await this.mineTelegram.sendMessage(chatId,
      `🪑 Стіл №${this.escape(updated.tableNumber)}: <b>${TABLE_STATUS_LABELS[updated.status] || updated.status}</b>`,
    );
    return this.handle('table', updated.id, chatId, actor);
  }

  private async sendMine(chatId: string | number, waiterId: string, requestedPage: number) {
    const active = ((await this.mineBookingsService.getToday()) as TodayBooking[])
      .filter((booking) => ACTIVE_BOOKING_STATUSES.has(booking.status));
    const mine = await this.resolveMine(active, waiterId);
    const bookingTableIds = new Set(mine.map((booking) => booking.table?.id).filter(Boolean));
    const walkIns = (await this.mineTables.findAll()).filter((table) =>
      table.assignedWaiterId === waiterId && !bookingTableIds.has(table.id),
    );
    const entries: MineEntry[] = [
      ...mine.map((booking): MineEntry => ({ kind: 'booking', booking })),
      ...walkIns.map((table): MineEntry => ({ kind: 'table', table })),
    ];
    const page = this.paginateMine(entries, requestedPage);
    const keyboard: Array<Array<Record<string, unknown>>> = page.items.map((entry) => [
      entry.kind === 'booking'
        ? { text: this.mineBookingButtonLabel(entry.booking), callback_data: `waiter:booking:${entry.booking.id}` }
        : { text: `№${entry.table.tableNumber} · ${TABLE_STATUS_LABELS[entry.table.status] || entry.table.status}`,
            callback_data: `waiter:table:${entry.table.id}` },
    ]);

    const pageButtons: Array<Record<string, unknown>> = [];
    if (page.pageIndex > 0) {
      pageButtons.push({ text: '⬅️', callback_data: `waiter:mine:${page.pageIndex - 1}` });
    }
    if (page.pageIndex + 1 < page.totalPages) {
      pageButtons.push({ text: '➡️', callback_data: `waiter:mine:${page.pageIndex + 1}` });
    }
    if (pageButtons.length) keyboard.push(pageButtons);
    keyboard.push([{ text: '⬅️ Назад', callback_data: 'menu:waiter' }]);

    await this.mineTelegram.sendMessage(chatId,
      entries.length
        ? `🪑 <b>Мої столи</b> · ${entries.length}\nСторінка ${page.pageIndex + 1}/${page.totalPages}`
        : '🪑 <b>Мої столи</b>\n\nСтолів немає.',
      { inline_keyboard: keyboard },
    );
  }

  private async resolveMine(bookings: TodayBooking[], waiterId: string) {
    const withoutOwner = bookings.filter((booking) => !booking.table?.assignedWaiterId && !booking.assignedWaiterId);
    const callAssignmentBookingIds = withoutOwner.length
      ? new Set(await this.mineAssignmentLookup.bookingIdsForWaiter(withoutOwner, waiterId))
      : new Set<string>();

    return bookings.filter((booking) =>
      booking.table?.assignedWaiterId
        ? booking.table.assignedWaiterId === waiterId
        : booking.assignedWaiterId
          ? booking.assignedWaiterId === waiterId
          : callAssignmentBookingIds.has(booking.id),
    );
  }

  private mineBookingButtonLabel(booking: TodayBooking) {
    const table = booking.table?.tableNumber || '—';
    const guest = booking.client?.fullName || 'Гість';
    return `№${table} · ${this.formatMineTime(booking.bookingTime)} · ${guest}`.slice(0, 60);
  }

  private parseMinePage(value: string | undefined) {
    const page = Number(value);
    return Number.isInteger(page) && page >= 0 ? page : 0;
  }

  private paginateMine<T>(items: T[], requestedPage: number) {
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const pageIndex = Math.min(Math.max(0, requestedPage), totalPages - 1);
    const start = pageIndex * PAGE_SIZE;
    return { items: items.slice(start, start + PAGE_SIZE), pageIndex, totalPages };
  }

  private formatMineTime(value: string | null | undefined) {
    return String(value || '--:--').slice(0, 5);
  }

  private escape(value: string) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
