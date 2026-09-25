import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, In, IsNull, Not } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { TableEntity } from '../tables/entities/table.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { Booking } from './entities/booking.entity';
import { BookingsService } from './bookings.service';

const ASSIGNMENT_ACTIONS = ['booking_checked_in', 'waiter_table_transfer'];

type BookingOperations = {
  bookingSnapshot(booking: Booking): Record<string, unknown>;
  safeLog(action: string, details?: Record<string, unknown>): Promise<void>;
};

function kyivToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function currentWaiter(dataSource: DataSource, bookingId: string): Promise<string | null> {
  const history = await dataSource.getRepository(BookingHistory).findOne({
    where: { booking: { id: bookingId }, action: In(ASSIGNMENT_ACTIONS) },
    order: { createdAt: 'DESC', id: 'DESC' },
  });
  return history?.action === 'booking_checked_in' && history.actorRole === 'waiter'
    ? history.actorStaffId
    : null;
}

/** Only protect waiter actions; the existing administrator and Director controls stay unchanged. */
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
          const booking = await dataSource.getRepository(Booking).findOne({ where: { id: bookingId } });
          if (!booking) throw new NotFoundException('Бронювання не знайдено');
          if (booking.status !== 'approved' || booking.bookingDate !== kyivToday()) {
            throw new BadRequestException('Офіціант може прийняти гостей лише за підтвердженим бронюванням на сьогодні');
          }
          // Coordinated check-in holds the booking row lock. If two waiters race,
          // only the first writes booking_checked_in; the other receives a no-op.
          const result = await target.checkIn(bookingId, actor);
          if (await currentWaiter(dataSource, bookingId) !== actor.staffId) {
            throw new ForbiddenException('Цих гостей уже прийняв інший офіціант');
          }
          return result;
        };
      }
      if (property === 'complete') {
        return async (bookingId: string, actor?: AuthUser) => {
          if (actor?.role !== 'waiter') return target.complete(bookingId, actor);
          if (!actor.staffId) throw new ForbiddenException('Не вдалося визначити офіціанта');
          const operations = target as unknown as BookingOperations;
          const result = await dataSource.transaction(async (manager) => {
            const bookings = manager.getRepository(Booking);
            const locked = await bookings.findOne({
              where: { id: bookingId }, lock: { mode: 'pessimistic_write' },
            });
            if (!locked) throw new NotFoundException('Бронювання не знайдено');
            const booking = await bookings.findOne({
              where: { id: bookingId }, relations: ['table', 'client'],
            });
            if (!booking?.table?.id || booking.status !== 'approved' ||
                !booking.checkedInAt || booking.bookingDate !== kyivToday()) {
              throw new BadRequestException('Завершити можна лише підтверджене відвідування після приходу гостей');
            }
            const tables = manager.getRepository(TableEntity);
            const table = await tables.findOne({
              where: { id: booking.table.id }, lock: { mode: 'pessimistic_write' },
            });
            if (!table || (table.status !== 'occupied' && table.status !== 'cleaning')) {
              throw new ConflictException('Стіл уже звільнено або недоступний');
            }
            const history = await manager.getRepository(BookingHistory).findOne({
              where: { booking: { id: bookingId }, action: In(ASSIGNMENT_ACTIONS) },
              order: { createdAt: 'DESC', id: 'DESC' },
            });
            if (history?.action !== 'booking_checked_in' ||
                history.actorRole !== 'waiter' || history.actorStaffId !== actor.staffId) {
              throw new ForbiddenException('Цей стіл обслуговує інший офіціант');
            }
            // Never report the table as free while a second checked-in visit still uses it.
            const anotherVisit = await bookings.exist({
              where: {
                id: Not(booking.id), table: { id: table.id },
                bookingDate: booking.bookingDate, status: 'approved',
                checkedInAt: Not(IsNull()),
              },
            });
            if (anotherVisit) {
              throw new ConflictException('За цим столом триває інше відвідування. Зверніться до Адміністратора');
            }
            const previousData = operations.bookingSnapshot(booking);
            booking.status = 'completed';
            booking.completedAt = new Date();
            await bookings.save(booking);
            const histories = manager.getRepository(BookingHistory);
            await histories.save(histories.create({
              booking, action: 'booking_completed', actorRole: actor.role,
              actorStaffId: actor.staffId, actorName: actor.name || null,
              previousData, newData: operations.bookingSnapshot(booking),
              reason: null, isManualMode: false,
            }));
            table.status = 'free';
            await tables.save(table);
            return { message: 'Стіл звільнено' };
          });
          await operations.safeLog('Стіл звільнено', {
            bookingId, staffId: actor.staffId, staffName: actor.name || null,
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
