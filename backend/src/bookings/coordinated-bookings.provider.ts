import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { TableEntity } from '../tables/entities/table.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';

export const RAW_BOOKINGS_SERVICE = Symbol('RAW_BOOKINGS_SERVICE');

type Transition = 'approve' | 'checkIn';

// Reuse the existing booking snapshot and time-window rules rather than
// introducing a second interpretation of duration or legacy wishes.
type BookingOperations = {
  bookingSnapshot(booking: Booking): Record<string, unknown>;
  getBookingStartMinutes(booking: Booking): number;
  getBookingAvailableFromMinutes(booking: Booking): number;
  safeLog(action: string, details?: Record<string, unknown>): Promise<void>;
  safeNotify(action: () => Promise<unknown>): Promise<void>;
  notifications: { notifyBookingApproved(booking: Booking): Promise<unknown> };
};

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

async function assertNoTimeConflict(
  manager: EntityManager,
  operations: BookingOperations,
  booking: Booking,
  tableId: string,
) {
  const activeBookings = await manager.getRepository(Booking).find({
    where: {
      table: { id: tableId },
      bookingDate: booking.bookingDate,
      status: In(['pending', 'approved']),
    },
  });

  const requestedStart = operations.getBookingStartMinutes(booking);
  const requestedAvailableFrom = operations.getBookingAvailableFromMinutes(booking);
  const conflict = activeBookings.some((other) =>
    other.id !== booking.id &&
    requestedStart < operations.getBookingAvailableFromMinutes(other) &&
    requestedAvailableFrom > operations.getBookingStartMinutes(other),
  );

  if (conflict) {
    throw new ConflictException('Стіл уже заброньовано на цей час. Оновіть список бронювань');
  }
}

async function coordinatedTransition(
  rawBookings: BookingsService,
  dataSource: DataSource,
  bookingId: string,
  transition: Transition,
  actor?: AuthUser,
) {
  const operations = rawBookings as unknown as BookingOperations;
  let changedBooking: Booking | null = null;

  let result: { message: string };
  try {
    result = await dataSource.transaction(async (manager) => {
      const bookings = manager.getRepository(Booking);
      // Match the advisory table/date lock used by guest booking creation.
      // Acquire it BEFORE locking the booking row, as table transfers do.
      const initial = await bookings.findOne({
        where: { id: bookingId },
        relations: ['table'],
      });
      if (!initial) throw new NotFoundException('Бронювання не знайдено');
      if (!initial.table?.id) throw new BadRequestException('Стіл бронювання не знайдено');

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
        [initial.table.id, initial.bookingDate],
      );
      const locked = await bookings.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Бронювання не знайдено');

      // Load nullable relations separately: PostgreSQL cannot FOR UPDATE
      // the nullable side of the booking's LEFT JOINs.
      const booking = await bookings.findOne({
        where: { id: bookingId },
        relations: ['table', 'client'],
      });
      if (!booking) throw new NotFoundException('Бронювання не знайдено');
      if (booking.table?.id !== initial.table.id || booking.bookingDate !== initial.bookingDate) {
        throw new ConflictException('Бронювання змінилося. Оновіть список та повторіть дію');
      }

      if (booking.status === 'cancelled' && booking.cancellationReason === 'no_show') {
        throw new BadRequestException('Бронювання вже анульовано через неявку');
      }
      if (booking.status === 'cancelled' || booking.status === 'rejected' || booking.status === 'completed') {
        throw new BadRequestException('Закрите бронювання не можна повторно активувати');
      }

      const message = transition === 'approve'
        ? 'Бронювання підтверджено'
        : 'Гості відмічені як присутні';

      // Replayed website/Telegram actions must have no second history entry,
      // table update or notification.
      if (transition === 'approve' && booking.status === 'approved') return { message };
      if (transition === 'checkIn' && booking.status === 'approved' && booking.checkedInAt) {
        return { message };
      }
      if (booking.status !== 'pending' && booking.status !== 'approved') {
        throw new BadRequestException('Недопустимий стан бронювання');
      }

      const tables = manager.getRepository(TableEntity);
      const table = await tables.findOne({
        where: { id: initial.table.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table || table.status === 'closed') {
        throw new BadRequestException('Стіл зараз закритий або недоступний');
      }
      const tableWithZone = await tables.findOne({
        where: { id: table.id },
        relations: ['zone'],
      });
      if (
        tableWithZone?.isVisible === false ||
        tableWithZone?.zone?.isClosed ||
        tableWithZone?.zone?.isVisible === false
      ) {
        throw new BadRequestException('Стіл або локація зараз недоступні');
      }

      // Approval of a later slot must NOT overwrite the physical occupied/
      // cleaning status. Arrival, in contrast, cannot take such a table.
      if (
        transition === 'checkIn' &&
        booking.bookingDate === restaurantDateToday() &&
        (table.status === 'occupied' || table.status === 'cleaning')
      ) {
        throw new ConflictException('Стіл зараз зайнятий або прибирається');
      }

      await assertNoTimeConflict(manager, operations, booking, table.id);
      const previousData = operations.bookingSnapshot(booking);
      booking.status = 'approved';
      booking.approvedAt ??= new Date();
      if (transition === 'checkIn') booking.checkedInAt ??= new Date();
      await bookings.save(booking);

      const histories = manager.getRepository(BookingHistory);
      await histories.save(histories.create({
        booking,
        action: transition === 'approve' ? 'booking_approved' : 'booking_checked_in',
        actorRole: transition === 'approve' ? 'admin' : (actor?.role || 'admin'),
        actorStaffId: transition === 'approve' ? null : (actor?.staffId || null),
        actorName: transition === 'approve' ? null : (actor?.name || null),
        previousData,
        newData: operations.bookingSnapshot(booking),
        reason: null,
        isManualMode: false,
      }));

      if (booking.bookingDate === restaurantDateToday()) {
        const nextStatus = transition === 'approve' ? 'reserved' : 'occupied';
        if (table.status !== nextStatus && table.status !== 'occupied' && table.status !== 'cleaning') {
          table.status = nextStatus;
          await tables.save(table);
        }
      }
      changedBooking = booking;
      return { message };
    });
  } catch (error: unknown) {
    const pgError = error as { code?: string; driverError?: { code?: string } };
    if (pgError.code === '23505' || pgError.driverError?.code === '23505') {
      throw new ConflictException('На цю дату вже є активне бронювання з цього пристрою або номера телефону');
    }
    throw error;
  }

  // External effects run only after the transaction has committed.
  if (changedBooking) {
    if (transition === 'approve') {
      await operations.safeLog('Підтверджено бронювання', { bookingId });
      await operations.safeNotify(() => operations.notifications.notifyBookingApproved(changedBooking!));
    } else {
      await operations.safeLog('Гості прийшли', {
        bookingId,
        waiterId: actor?.staffId || null,
        waiterName: actor?.name || null,
      });
    }
  }
  return result;
}

export function createCoordinatedBookingsService(
  rawBookings: BookingsService,
  dataSource: DataSource,
): BookingsService {
  return new Proxy(rawBookings, {
    get(target, property, receiver) {
      if (property === 'approve') {
        return (bookingId: string) => coordinatedTransition(target, dataSource, bookingId, 'approve');
      }
      if (property === 'checkIn') {
        return (bookingId: string, actor?: AuthUser) =>
          coordinatedTransition(target, dataSource, bookingId, 'checkIn', actor);
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
