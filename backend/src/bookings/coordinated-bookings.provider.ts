import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { TableEntity } from '../tables/entities/table.entity';
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

async function coordinatedCheckIn(
  rawBookings: BookingsService,
  dataSource: DataSource,
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

    const snapshot = (rawBookings as unknown as {
      bookingSnapshot(value: Booking): Record<string, unknown>;
    }).bookingSnapshot.bind(rawBookings);
    const previousData = snapshot(booking);

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
        newData: snapshot(booking),
        reason: null,
        isManualMode: false,
      }),
    );

    if (booking.table?.id && booking.bookingDate === restaurantDateToday()) {
      const tables = manager.getRepository(TableEntity);
      const table = await tables.findOne({
        where: { id: booking.table.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (table && table.status !== 'closed') {
        table.status = 'occupied';
        await tables.save(table);
      }
    }

    return { message: 'Гості відмічені як присутні' };
  });

  await (rawBookings as unknown as {
    safeLog(action: string, details?: Record<string, unknown>): Promise<void>;
  }).safeLog('Гості прийшли', {
    bookingId,
    waiterId: actor?.staffId || null,
    waiterName: actor?.name || null,
  });

  return result;
}

export function createCoordinatedBookingsService(
  rawBookings: BookingsService,
  dataSource: DataSource,
): BookingsService {
  return new Proxy(rawBookings, {
    get(target, property, receiver) {
      if (property === 'checkIn') {
        return (bookingId: string, actor?: AuthUser) =>
          coordinatedCheckIn(target, dataSource, bookingId, actor);
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
