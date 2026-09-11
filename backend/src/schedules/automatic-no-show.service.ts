import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import { BookingHistory } from '../bookings/entities/booking-history.entity';
import { BookingRescheduleRequest } from '../bookings/entities/booking-reschedule-request.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { LogsService } from '../logs/logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TableEntity, type TableStatus } from '../tables/entities/table.entity';

const NO_SHOW_GRACE_MINUTES = 30;

@Injectable()
export class AutomaticNoShowService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly logs: LogsService,
  ) {}

  private minutesFromTime(time: string) {
    const [hours, minutes] = String(time).slice(0, 5).split(':').map(Number);
    return hours * 60 + minutes;
  }

  async cancelIfDue(bookingId: string, today: string, nowMinutes: number) {
    const cancelled = await this.dataSource.transaction(async (manager) => {
      const bookings = manager.getRepository(Booking);
      const locked = await bookings.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!locked || locked.status !== 'approved' || locked.checkedInAt) return null;
      if (locked.bookingDate !== today) return null;
      if (nowMinutes < this.minutesFromTime(locked.bookingTime) + NO_SHOW_GRACE_MINUTES) {
        return null;
      }

      const pendingTimeChange = await manager.getRepository(BookingRescheduleRequest).findOne({
        where: {
          booking: { id: locked.id },
          status: 'pending',
        } as any,
      });
      if (pendingTimeChange) return null;

      const withRelations = await bookings.findOne({
        where: { id: locked.id },
        relations: ['table', 'client'],
      });
      if (!withRelations) return null;

      const previousData = {
        status: locked.status,
        bookingDate: locked.bookingDate,
        bookingTime: locked.bookingTime,
        checkedInAt: locked.checkedInAt,
        tableId: withRelations.table?.id || null,
      };
      const cancelledAt = new Date();
      const noShowMarker = `[NO_SHOW] Бронювання автоматично анульовано через неявку протягом ${NO_SHOW_GRACE_MINUTES} хвилин ${cancelledAt.toISOString()}.`;

      locked.status = 'cancelled';
      locked.cancelledAt = cancelledAt;
      locked.cancellationReason = 'no_show';
      locked.wishes = locked.wishes?.includes('[NO_SHOW]')
        ? locked.wishes
        : [locked.wishes, noShowMarker].filter(Boolean).join('\n');
      locked.guestNotification = {
        type: 'no_show',
        title: 'Ваше бронювання анульовано',
        message: 'Бронювання анульовано через неявку протягом 30 хвилин після зазначеного часу прибуття.',
        reason: 'automatic_no_show_30m',
        createdAt: cancelledAt.toISOString(),
      };
      await bookings.save(locked);

      await manager.getRepository(BookingHistory).save(
        manager.getRepository(BookingHistory).create({
          booking: locked,
          action: 'booking_no_show',
          actorRole: 'system',
          actorStaffId: null,
          actorName: 'Система MOLO',
          previousData,
          newData: {
            status: locked.status,
            bookingDate: locked.bookingDate,
            bookingTime: locked.bookingTime,
            checkedInAt: locked.checkedInAt,
            tableId: withRelations.table?.id || null,
          },
          reason: 'automatic_no_show_30m',
          isManualMode: false,
        }),
      );

      if (withRelations.table?.id) {
        await this.synchronizeTableForToday(
          manager,
          withRelations.table.id,
          locked.bookingDate,
        );
      }

      return {
        ...withRelations,
        ...locked,
        table: withRelations.table,
        client: withRelations.client,
      } as Booking;
    });

    if (!cancelled) return false;

    try {
      await this.logs.create('Автоматично анульовано бронювання через неявку 30 хвилин', null, {
        bookingId: cancelled.id,
        tableNumber: cancelled.table?.tableNumber || null,
        bookingTime: cancelled.bookingTime,
      });
    } catch {
      // Скасування вже збережене; збій журналу не повертає бронювання назад.
    }

    try {
      await this.notifications.notifyBookingCancelled(cancelled);
    } catch {
      // Скасування вже збережене; Telegram не повинен створювати повторну бронь.
    }

    return true;
  }

  private async synchronizeTableForToday(
    manager: DataSource['manager'],
    tableId: string,
    bookingDate: string,
  ) {
    const tableRepository = manager.getRepository(TableEntity);
    const table = await tableRepository
      .createQueryBuilder('table')
      .where('table.id = :tableId', { tableId })
      .setLock('pessimistic_write')
      .getOne();
    if (!table) return;

    if (table.status === 'closed' || table.status === 'cleaning' || table.status === 'occupied') {
      return;
    }

    const active = await manager.getRepository(Booking).find({
      where: {
        table: { id: tableId },
        bookingDate,
        status: In(['pending', 'approved']),
      } as any,
    });

    let nextStatus: TableStatus = 'free';
    if (active.some((booking) => booking.status === 'approved')) nextStatus = 'reserved';
    else if (active.some((booking) => booking.status === 'pending')) nextStatus = 'pending';

    if (table.status !== nextStatus) {
      table.status = nextStatus;
      await tableRepository.save(table);
    }
  }
}
