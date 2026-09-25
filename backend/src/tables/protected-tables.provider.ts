import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { BookingHistory } from '../bookings/entities/booking-history.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { TableEntity } from './entities/table.entity';
import { TablesService } from './tables.service';

const ASSIGNMENT_ACTIONS = [
  'booking_checked_in',
  'waiter_manual_visit_claimed',
  'waiter_table_transfer',
];

function kyivToday() {
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

/**
 * Called inside a transaction that already holds the physical table row lock.
 * Only checked-in manual bookings gain waiter ownership; walk-ins and online
 * bookings keep their existing behavior.
 */
async function claimOrAssertBookedTableWaiter(
  manager: EntityManager,
  tableId: string,
  actor: AuthUser,
) {
  if (!actor.staffId) throw new ForbiddenException('Не вдалося визначити офіціанта');

  const visits = await manager.getRepository(Booking).find({
    where: {
      table: { id: tableId },
      bookingDate: kyivToday(),
      status: 'approved',
      source: 'admin_manual',
      checkedInAt: Not(IsNull()),
    },
  });
  const histories = manager.getRepository(BookingHistory);

  for (const visit of visits) {
    const history = await histories.findOne({
      where: {
        booking: { id: visit.id },
        action: In(ASSIGNMENT_ACTIONS),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const owner = assignedWaiter(history);

    if (owner && owner !== actor.staffId) {
      throw new ForbiddenException('Цей стіл обслуговує інший офіціант');
    }
    if (!owner) {
      await histories.save(
        histories.create({
          booking: visit,
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
  }
}

/**
 * Preserve existing walk-in status behavior. The proxy adds ownership checks
 * only when a waiter acts on a checked-in manual booking.
 */
export function createProtectedTablesService(
  raw: TablesService,
  dataSource: DataSource,
): TablesService {
  async function waiterStatus(
    id: string,
    status: 'occupied' | 'free',
    actor: AuthUser,
  ) {
    if (!actor.staffId) throw new ForbiddenException('Не вдалося визначити офіціанта');
    if (status !== 'occupied' && status !== 'free') {
      throw new BadRequestException(
        'Офіціант може встановити лише статус «Зайнятий» або «Вільний»',
      );
    }

    return dataSource.transaction(async (manager) => {
      const tables = manager.getRepository(TableEntity);
      const table = await tables.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) throw new NotFoundException('Стіл не знайдено');

      await claimOrAssertBookedTableWaiter(manager, id, actor);

      if (status === 'occupied') {
        if (table.status === 'closed') {
          throw new BadRequestException(
            'Закритий Адміністратором стіл не можна позначити зайнятим',
          );
        }
        if (table.status === 'reserved' || table.status === 'pending') {
          throw new BadRequestException('На цей стіл уже є активне бронювання');
        }
        table.status = 'occupied';
      } else {
        const bookings = await manager.getRepository(Booking).find({
          where: {
            table: { id },
            bookingDate: kyivToday(),
            status: In(['pending', 'approved']),
          },
        });
        table.status = bookings.some(
          (booking) => booking.status === 'approved' && booking.checkedInAt,
        )
          ? 'occupied'
          : bookings.some((booking) => booking.status === 'approved')
            ? 'reserved'
            : bookings.some((booking) => booking.status === 'pending')
              ? 'pending'
              : 'free';
      }

      await tables.save(table);
      return tables.findOne({ where: { id }, relations: ['zone'] });
    });
  }

  async function startCleaning(id: string, actor: AuthUser) {
    if (!actor.staffId) throw new ForbiddenException('Не вдалося визначити офіціанта');

    return dataSource.transaction(async (manager) => {
      const tables = manager.getRepository(TableEntity);
      const table = await tables.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) throw new NotFoundException('Стіл не знайдено');

      await claimOrAssertBookedTableWaiter(manager, id, actor);

      if (table.status !== 'occupied') {
        throw new BadRequestException(
          'Прибирання можна почати лише після того, як стіл був зайнятий',
        );
      }
      table.status = 'cleaning';
      return tables.save(table);
    });
  }

  return new Proxy(raw, {
    get(target, property, receiver) {
      if (property === 'setWaiterStatus') {
        return (
          id: string,
          status: 'occupied' | 'free',
          actor?: AuthUser,
        ) =>
          actor?.role === 'waiter'
            ? waiterStatus(id, status, actor)
            : target.setWaiterStatus(id, status);
      }
      if (property === 'markCleaning') {
        return (id: string, actor?: AuthUser) =>
          actor?.role === 'waiter'
            ? startCleaning(id, actor)
            : target.markCleaning(id);
      }
      if (property === 'markOccupied') {
        return (id: string, actor?: AuthUser) =>
          actor?.role === 'waiter'
            ? waiterStatus(id, 'occupied', actor)
            : target.markOccupied(id);
      }
      if (property === 'markFree') {
        return (id: string, actor?: AuthUser) =>
          actor?.role === 'waiter'
            ? waiterStatus(id, 'free', actor)
            : target.markFree(id);
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
