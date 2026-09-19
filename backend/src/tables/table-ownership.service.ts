import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthUser } from '../auth/types/auth-user.type';
import { TableEntity } from './entities/table.entity';

/** The table row is the single durable owner of both walk-ins and checked-in bookings. */
@Injectable()
export class TableOwnershipService {
  constructor(private readonly dataSource: DataSource) {}

  assertCanModify(table: Pick<TableEntity, 'assignedWaiterId'>, actor?: AuthUser | null) {
    if (actor?.role !== 'waiter') return;
    if (!actor.staffId) {
      throw new ForbiddenException('Не вдалося визначити офіціанта');
    }
    if (table.assignedWaiterId && table.assignedWaiterId !== actor.staffId) {
      throw new ForbiddenException('Цей стіл закріплено за іншим офіціантом');
    }
  }

  claim(table: TableEntity, actor?: AuthUser | null) {
    this.assertCanModify(table, actor);
    if (actor?.role === 'waiter') table.assignedWaiterId = actor.staffId!;
  }

  /** Locks the table while a call assignment is checked and written, including Telegram calls. */
  async withWaiterTableLock<T>(
    tableId: string | null | undefined,
    waiterId: string,
    action: () => Promise<T>,
    claimIfOccupied = false,
  ): Promise<T> {
    if (!waiterId) throw new ForbiddenException('Не вдалося визначити офіціанта');
    if (!tableId) throw new NotFoundException('Стіл не знайдено');

    return this.dataSource.transaction(async (manager) => {
      const tables = manager.getRepository(TableEntity);
      const table = await tables.findOne({
        where: { id: tableId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) throw new NotFoundException('Стіл не знайдено');
      this.assertCanModify(table, { role: 'waiter', staffId: waiterId } as AuthUser);
      const result = await action();
      if (claimIfOccupied && table.status === 'occupied' && !table.assignedWaiterId) {
        table.assignedWaiterId = waiterId;
        await tables.save(table);
      }
      return result;
    });
  }
}
