import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { TableEntity } from '../tables/entities/table.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';

const ASSIGNMENT_ACTIONS = [
  'booking_checked_in',
  'waiter_manual_visit_claimed',
  'waiter_table_transfer',
];

type BookingOperations = {
  bookingSnapshot(booking: Booking): Record<string, unknown>;
  safeLog(action: string, details?: Record<string, unknown>): Promise<void>;
};

function kyivToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function assignedWaiter(history: BookingHistory | null): string | null {
  if (
    history &&
    (history.action === 'booking_checked_in' ||
      history.action === 'waiter_manual_visit_claimed') &&
    history.actorRole === 'waiter' &&
    history.actorStaffId
  ) {
    return history.actorStaffId;
  }
  return null;
}

async function latestAssignment(
  manager: EntityManager,
  bookingId: string,
): Promise<BookingHistory | null> {
  return manager.getRepository(BookingHistory).findOne({
    where: {
      booking: { id: bookingId },
      action: In(ASSIGNMENT_ACTIONS),
    },
    order: { createdAt: 'DESC', id: 'DESC' },
  });
}

async function claimOrAssertManualVisit(
  manager: EntityManager,
  booking: Booking,
  actor: AuthUser,
) {
  if (!actor.staffId) throw new ForbiddenException('Не вдалося визначити офіціанта');

  const histories = manager.getRepository(BookingHistory);
  const latest = await latestAssignment(manager, booking.id);
  const owner = assignedWaiter(latest);

  if (owner && owner !== actor.staffId) {
    throw new ForbiddenException('Цей стіл обслуговує інший офіціант');
  }
  if (owner) return;

  await histories.save(
    histories.create({
      booking,
      action: 'waiter_manual_visit_claimed',
      actorRole: 'waiter',
      actorStaffId: actor.staffId,
      actorName: actor.name || null,
      previousData: null,
      newData: null,
      reason: null,
      isManualMode: false,
    }),
  );
}

async function claimAfterCheckIn(
  dataSource: DataSource,
  bookingId: string,
  actor: AuthUser,
) {
  return dataSource.transaction(async (manager) => {
    const bookings = manager.getRepository(Booking);
    const locked = await bookings.findOne({
      where: { id: bookingId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locked) throw new NotFoundException('Бронювання не знайдено');
    if (
      locked.source !== 'admin_manual' ||
      locked.status !== 'approved' ||
      !locked.checkedInAt ||
      locked.bookingDate !== kyivToday()
    ) {
      throw new BadRequestException(
        'Офіціант може прийняти гостей лише за підтвердженим ручним бронюванням на сьогодні',
      );
    }

    await claimOrAssertManualVisit(manager, locked, actor);
  });
}

/**
 * Protect only manual-booking ownership for waiter actions.
 * Administrator/Director controls and online-booking behavior stay unchanged.
 */
export function createWaiterBookingProtectionService(
  coordinated: BookingsService,
  dataSource: DataSource,
): BookingsService {
  return new Proxy(coordinated, {
    get(target, property, receiver) {
      if (property === 'checkIn') {
        return async (bookingId: string, actor?: AuthUser) => {
          if (actor?.role !== 'waiter') return target.checkIn(bookingId, actor);
          if (!actor.staffId) throw new ForbiddenException('Не вдалося визначити офіціанта');

          const booking = await dataSource.getRepository(Booking).findOne({
            where: { id: bookingId },
          });
          if (!booking) throw new NotFoundException('Бронювання не знайдено');
          if (booking.source !== 'admin_manual') {
            return target.checkIn(bookingId, actor);
          }
          if (booking.status !== 'approved' || booking.bookingDate !== kyivToday()) {
            throw new BadRequestException(
              'Офіціант може прийняти гостей лише за підтвердженим ручним бронюванням на сьогодні',
            );
          }

          const result = await target.checkIn(bookingId, actor);
          await claimAfterCheckIn(dataSource, bookingId, actor);
          return result;
        };
      }

      if (property === 'complete') {
        return async (bookingId: string, actor?: AuthUser) => {
          if (actor?.role !== 'waiter') return target.complete(bookingId, actor);
          if (!actor.staffId) throw new ForbiddenException('Не вдалося визначити офіціанта');

          const existing = await dataSource.getRepository(Booking).findOne({
            where: { id: bookingId },
          });
          if (!existing) throw new NotFoundException('Бронювання не знайдено');
          if (existing.source !== 'admin_manual') {
            return target.complete(bookingId, actor);
          }

          const operations = target as unknown as BookingOperations;
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
            if (
              !booking?.table?.id ||
              booking.source !== 'admin_manual' ||
              booking.status !== 'approved' ||
              !booking.checkedInAt ||
              booking.bookingDate !== kyivToday()
            ) {
              throw new BadRequestException(
                'Завершити можна лише підтверджене ручне відвідування після приходу гостей',
              );
            }

            const tables = manager.getRepository(TableEntity);
            const table = await tables.findOne({
              where: { id: booking.table.id },
              lock: { mode: 'pessimistic_write' },
            });
            if (!table || (table.status !== 'occupied' && table.status !== 'cleaning')) {
              throw new ConflictException('Стіл уже звільнено або недоступний');
            }

            const anotherVisit = await bookings.exist({
              where: {
                id: Not(booking.id),
                table: { id: table.id },
                bookingDate: booking.bookingDate,
                status: 'approved',
                checkedInAt: Not(IsNull()),
              },
            });
            if (anotherVisit) {
              throw new ConflictException(
                'За цим столом триває інше відвідування. Зверніться до Адміністратора',
              );
            }

            await claimOrAssertManualVisit(manager, booking, actor);

            const previousData = operations.bookingSnapshot(booking);
            booking.status = 'completed';
            booking.completedAt = new Date();
            await bookings.save(booking);

            const histories = manager.getRepository(BookingHistory);
            await histories.save(
              histories.create({
                booking,
                action: 'booking_completed',
                actorRole: actor.role,
                actorStaffId: actor.staffId,
                actorName: actor.name || null,
                previousData,
                newData: operations.bookingSnapshot(booking),
                reason: null,
                isManualMode: false,
              }),
            );

            table.status = 'free';
            await tables.save(table);
            return { message: 'Стіл звільнено' };
          });

          await operations.safeLog('Стіл звільнено', {
            bookingId,
            staffId: actor.staffId,
            staffName: actor.name || null,
            role: actor.role,
          });
          return result;
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
