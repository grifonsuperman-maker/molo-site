import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { TableEntity } from '../tables/entities/table.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';

export const RAW_BOOKINGS_SERVICE = Symbol('RAW_BOOKINGS_SERVICE');

type BookingDecision = 'reject' | 'cancel' | 'noShow' | 'complete';

type BookingInternals = {
  bookingSnapshot(value: Booking): Record<string, unknown>;
  markNoShowInWishes(value: Booking): string;
  safeLog(action: string, details?: Record<string, unknown>): Promise<void>;
  safeNotify(action: () => Promise<unknown>): Promise<void>;
  notifications: {
    notifyBookingApproved(booking: Booking): Promise<unknown>;
    notifyBookingCancelled(booking: Booking): Promise<unknown>;
  };
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

async function coordinatedApprove(
  rawBookings: BookingsService,
  dataSource: DataSource,
  bookingId: string,
) {
  const internals = rawBookings as unknown as BookingInternals;

  // The lock covers the status change, booking history and today's table state.
  // Every web and Telegram approval goes through this shared BookingsService proxy.
  const approvedBooking = await dataSource.transaction(async (manager) => {
    const bookings = manager.getRepository(Booking);
    const locked = await bookings.findOne({
      where: { id: bookingId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locked) throw new NotFoundException('Бронювання не знайдено');
    if (locked.status === 'approved') return null;
    if (locked.status !== 'pending') {
      throw new ConflictException('Це бронювання вже опрацьовано');
    }

    // Lock the booking row alone: PostgreSQL does not allow FOR UPDATE on
    // nullable sides of the LEFT JOIN used to load the table and client.
    const booking = await bookings.findOne({
      where: { id: bookingId },
      relations: ['table', 'client'],
    });
    if (!booking) throw new NotFoundException('Бронювання не знайдено');

    const previousData = internals.bookingSnapshot(booking);
    booking.status = 'approved';
    booking.approvedAt = new Date();
    await bookings.save(booking);

    const histories = manager.getRepository(BookingHistory);
    await histories.save(
      histories.create({
        booking,
        action: 'booking_approved',
        actorRole: 'admin',
        actorStaffId: null,
        actorName: null,
        previousData,
        newData: internals.bookingSnapshot(booking),
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
      // Keep the existing priority of physical occupied/cleaning/closed states.
      if (table && !['occupied', 'cleaning', 'closed'].includes(table.status)) {
        table.status = 'reserved';
        await tables.save(table);
      }
    }

    return booking;
  });

  if (!approvedBooking) {
    return { message: 'Бронювання вже підтверджено' };
  }

  await internals.safeLog('Підтверджено бронювання', { bookingId });
  await internals.safeNotify(() => internals.notifications.notifyBookingApproved(approvedBooking));
  return { message: 'Бронювання підтверджено' };
}

/**
 * These existing admin/waiter actions must use the same booking-row lock as
 * approve. Otherwise a stale reject/cancel can overwrite the approved row
 * after its transaction commits and send contradictory Telegram messages.
 */
async function coordinatedDecision(
  rawBookings: BookingsService,
  dataSource: DataSource,
  bookingId: string,
  decision: BookingDecision,
  actor?: AuthUser,
) {
  const internals = rawBookings as unknown as BookingInternals;
  const booking = await dataSource.transaction(async (manager) => {
    const bookings = manager.getRepository(Booking);
    const locked = await bookings.findOne({
      where: { id: bookingId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locked) throw new NotFoundException('Бронювання не знайдено');
    if (!['pending', 'approved'].includes(locked.status)) {
      throw new ConflictException('Це бронювання вже опрацьовано');
    }
    // Reject is a decision on a pending request. To revoke an approved
    // booking, use the existing separate admin cancel action.
    if (decision === 'reject' && locked.status !== 'pending') {
      throw new ConflictException('Бронювання вже підтверджено');
    }
    if (decision === 'noShow' && locked.checkedInAt) {
      throw new BadRequestException('Гість уже відмічений як присутній');
    }

    const current = await bookings.findOne({
      where: { id: bookingId },
      relations: ['table', 'client'],
    });
    if (!current) throw new NotFoundException('Бронювання не знайдено');
    const previousData = internals.bookingSnapshot(current);
    const now = new Date();
    if (decision === 'reject') {
      current.status = 'rejected';
      current.rejectedAt = now;
      current.cancellationReason = 'admin_rejected';
    } else if (decision === 'cancel') {
      current.status = 'cancelled';
      current.cancelledAt = now;
      current.cancellationReason = 'admin_cancelled';
    } else if (decision === 'noShow') {
      current.status = 'cancelled';
      current.cancelledAt = now;
      current.cancellationReason = 'no_show';
      current.wishes = internals.markNoShowInWishes(current);
      current.guestNotification = {
        type: 'no_show',
        title: 'Бронювання завершено через неявку',
        createdAt: now.toISOString(),
      };
    } else {
      current.status = 'completed';
      current.completedAt = now;
    }
    await bookings.save(current);

    const historyAction = {
      reject: 'booking_rejected',
      cancel: 'booking_cancelled',
      noShow: 'booking_no_show',
      complete: 'booking_completed',
    }[decision];
    const histories = manager.getRepository(BookingHistory);
    await histories.save(histories.create({
      booking: current,
      action: historyAction,
      actorRole: decision === 'complete' ? actor?.role || 'admin' : 'admin',
      actorStaffId: decision === 'complete' ? actor?.staffId || null : null,
      actorName: decision === 'complete' ? actor?.name || null : null,
      previousData,
      newData: internals.bookingSnapshot(current),
      reason: decision === 'noShow' ? 'no_show' : null,
      isManualMode: false,
    }));

    if (current.table?.id && current.bookingDate === restaurantDateToday()) {
      const tables = manager.getRepository(TableEntity);
      const table = await tables.findOne({
        where: { id: current.table.id },
        lock: { mode: 'pessimistic_write' },
      });
      // Completing a visit keeps the existing force-release behavior; other
      // decisions never release a closed, occupied or cleaning physical table.
      if (table && table.status !== 'closed' &&
          (decision === 'complete' || !['occupied', 'cleaning'].includes(table.status))) {
        table.status = 'free';
        await tables.save(table);
      }
    }
    return current;
  });

  if (decision === 'reject') {
    await internals.safeLog('Відхилено бронювання', { bookingId });
  } else if (decision === 'cancel') {
    await internals.safeLog('Скасовано бронювання', { bookingId });
  } else if (decision === 'noShow') {
    await internals.safeLog('No-show: гість не прийшов', {
      bookingId,
      tableNumber: booking.table?.tableNumber || null,
    });
  } else {
    await internals.safeLog('Стіл звільнено', {
      bookingId,
      staffId: actor?.staffId || null,
      staffName: actor?.name || null,
      role: actor?.role || 'admin',
    });
  }
  if (decision !== 'complete') {
    await internals.safeNotify(() => internals.notifications.notifyBookingCancelled(booking));
  }
  return {
    message: {
      reject: 'Бронювання відхилено',
      cancel: 'Бронювання скасовано',
      noShow: 'Гість не прийшов. Бронювання знято, стіл вільний.',
      complete: 'Стіл звільнено',
    }[decision],
  };
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
    if (locked.status !== 'pending' && locked.status !== 'approved') {
      throw new ConflictException('Це бронювання вже опрацьовано');
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
      if (property === 'approve') {
        return (bookingId: string) => coordinatedApprove(target, dataSource, bookingId);
      }
      if (property === 'reject' || property === 'cancel' || property === 'noShow') {
        return (bookingId: string) => coordinatedDecision(target, dataSource, bookingId, property);
      }
      if (property === 'complete') {
        return (bookingId: string, actor?: AuthUser) =>
          coordinatedDecision(target, dataSource, bookingId, 'complete', actor);
      }
      if (property === 'checkIn') {
        return (bookingId: string, actor?: AuthUser) =>
          coordinatedCheckIn(target, dataSource, bookingId, actor);
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
