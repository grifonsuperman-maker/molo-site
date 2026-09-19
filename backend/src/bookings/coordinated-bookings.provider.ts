import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { TableEntity } from '../tables/entities/table.entity';
import { TableOwnershipService } from '../tables/table-ownership.service';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';

export const RAW_BOOKINGS_SERVICE = Symbol('RAW_BOOKINGS_SERVICE');

function restaurantDateToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function bookingSnapshot(rawBookings: BookingsService, booking: Booking) {
  return (rawBookings as unknown as {
    bookingSnapshot(value: Booking): Record<string, unknown>;
  }).bookingSnapshot(booking);
}

async function safeBookingLog(
  rawBookings: BookingsService,
  action: string,
  details: Record<string, unknown>,
) {
  await (rawBookings as unknown as {
    safeLog(value: string, data?: Record<string, unknown>): Promise<void>;
  }).safeLog(action, details);
}

async function coordinatedCheckIn(
  rawBookings: BookingsService,
  dataSource: DataSource,
  ownership: TableOwnershipService,
  bookingId: string,
  actor?: AuthUser,
) {
  const result = await dataSource.transaction(async (manager) => {
    const bookings = manager.getRepository(Booking);
    const locked = await bookings.findOne({
      where: { id: bookingId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!locked) throw new NotFoundException('Бронювання не знайдено');
    if (locked.status === 'cancelled' && locked.cancellationReason === 'no_show') {
      throw new BadRequestException('Бронювання вже анульовано через неявку');
    }

    const booking = await bookings.findOne({
      where: { id: bookingId },
      relations: ['table', 'client'],
    });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    if (actor?.role === 'waiter') {
      if (!booking.table || booking.bookingDate !== restaurantDateToday()) {
        throw new BadRequestException('Офіціант може прийняти гостей лише за столом із бронюванням на сьогодні');
      }
      // A forged/stale check-in must not bypass the administrator's approval.
      if (booking.status !== 'approved') {
        throw new BadRequestException('Спочатку Адміністратор має підтвердити бронювання');
      }
      if (booking.checkedInAt) {
        throw new BadRequestException('Прихід гостей за цим бронюванням уже відмічено');
      }
    }

    const tables = manager.getRepository(TableEntity);
    const table = booking.table?.id
      ? await tables.findOne({
          where: { id: booking.table.id },
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    if (booking.table?.id && !table) throw new NotFoundException('Стіл не знайдено');
    if (table) {
      ownership.assertCanModify(table, actor);
      if (actor?.role === 'waiter' && ['closed', 'occupied', 'cleaning'].includes(table.status)) {
        throw new BadRequestException('Стіл зараз зайнятий, прибирається або закритий');
      }
    }

    const previousData = bookingSnapshot(rawBookings, booking);
    booking.status = 'approved';
    if (!booking.approvedAt) booking.approvedAt = new Date();
    if (!booking.checkedInAt) booking.checkedInAt = new Date();
    await bookings.save(booking);

    const histories = manager.getRepository(BookingHistory);
    await histories.save(
      histories.create({
        booking,
        action: 'booking_checked_in',
        actorRole: actor?.role || 'admin',
        actorStaffId: actor?.staffId || null,
        actorName: actor?.name || null,
        previousData,
        newData: bookingSnapshot(rawBookings, booking),
        reason: null,
        isManualMode: false,
      }),
    );

    if (table && booking.bookingDate === restaurantDateToday() && table.status !== 'closed') {
      ownership.claim(table, actor);
      table.status = 'occupied';
      await tables.save(table);
    }

    return { message: 'Гості відмічені як присутні' };
  });

  await safeBookingLog(rawBookings, 'Гості прийшли', {
    bookingId,
    waiterId: actor?.staffId || null,
    waiterName: actor?.name || null,
  });

  return result;
}

async function coordinatedComplete(
  rawBookings: BookingsService,
  dataSource: DataSource,
  ownership: TableOwnershipService,
  bookingId: string,
  actor?: AuthUser,
) {
  const result = await dataSource.transaction(async (manager) => {
    const bookings = manager.getRepository(Booking);
    const locked = await bookings.findOne({
      where: { id: bookingId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locked) throw new NotFoundException('Бронювання не знайдено');

    const booking = await bookings.findOne({
      where: { id: bookingId },
      relations: ['table', 'client'],
    });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');
    if (actor?.role === 'waiter') {
      if (!booking.table?.id) {
        throw new BadRequestException('Стіл для цього бронювання не знайдено');
      }
      // Completion is for the actual current visit, never an unconfirmed or future reservation.
      if (booking.status !== 'approved' || !booking.checkedInAt || booking.bookingDate !== restaurantDateToday()) {
        throw new BadRequestException('Завершити можна лише підтверджене відвідування після приходу гостей');
      }
    }

    const tables = manager.getRepository(TableEntity);
    const table = booking.table?.id
      ? await tables.findOne({
          where: { id: booking.table.id },
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    if (booking.table?.id && !table) throw new NotFoundException('Стіл не знайдено');
    if (table) ownership.assertCanModify(table, actor);

    const previousData = bookingSnapshot(rawBookings, booking);
    booking.status = 'completed';
    booking.completedAt = new Date();
    await bookings.save(booking);
    const histories = manager.getRepository(BookingHistory);
    await histories.save(
      histories.create({
        booking,
        action: 'booking_completed',
        actorRole: actor?.role || 'admin',
        actorStaffId: actor?.staffId || null,
        actorName: actor?.name || null,
        previousData,
        newData: bookingSnapshot(rawBookings, booking),
        reason: null,
        isManualMode: false,
      }),
    );

    // A future booking cannot change today's physical table; a closed table stays closed.
    if (table && booking.bookingDate === restaurantDateToday() && table.status !== 'closed') {
      table.status = 'free';
      table.assignedWaiterId = null;
      await tables.save(table);
    }
    return { message: 'Стіл звільнено' };
  });

  await safeBookingLog(rawBookings, 'Стіл звільнено', {
    bookingId,
    staffId: actor?.staffId || null,
    staffName: actor?.name || null,
    role: actor?.role || 'admin',
  });
  return result;
}

export function createCoordinatedBookingsService(
  rawBookings: BookingsService,
  dataSource: DataSource,
  ownership: TableOwnershipService,
): BookingsService {
  return new Proxy(rawBookings, {
    get(target, property, receiver) {
      if (property === 'checkIn') {
        return (bookingId: string, actor?: AuthUser) =>
          coordinatedCheckIn(target, dataSource, ownership, bookingId, actor);
      }
      if (property === 'complete') {
        return (bookingId: string, actor?: AuthUser) =>
          coordinatedComplete(target, dataSource, ownership, bookingId, actor);
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
