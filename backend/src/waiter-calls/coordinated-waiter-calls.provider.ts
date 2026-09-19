import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { TableOwnershipService } from '../tables/table-ownership.service';
import { WaiterCallRecord } from './entities/waiter-call.entity';
import { WaiterCallsService } from './waiter-calls.service';

export const RAW_WAITER_CALLS_SERVICE = Symbol('RAW_WAITER_CALLS_SERVICE');

export function createCoordinatedWaiterCallsService(
  raw: WaiterCallsService,
  dataSource: DataSource,
  ownership: TableOwnershipService,
): WaiterCallsService {
  const tables = dataSource.getRepository(TableEntity);

  async function callTableId(callId: string) {
    const call = await dataSource.getRepository(WaiterCallRecord).findOne({
      where: { id: callId },
      relations: ['booking', 'booking.table'],
    });
    if (!call) throw new NotFoundException('Виклик не знайдено');
    if (call.tableId && call.booking.table?.id && call.tableId !== call.booking.table.id) {
      throw new BadRequestException('Стіл цього виклику вже змінено');
    }
    return call.booking.table?.id || call.tableId;
  }

  async function visibleToWaiter<T extends { tableId: string | null }>(
    rows: T[], waiterId: string,
  ): Promise<T[]> {
    const ids = [...new Set(rows.map((row) => row.tableId).filter((id): id is string => Boolean(id)))];
    if (!ids.length) return rows;
    const current = await tables.find({ where: { id: In(ids) } });
    const owners = new Map(current.map((table) => [table.id, table.assignedWaiterId]));
    return rows.filter((row) => !row.tableId || !owners.get(row.tableId) || owners.get(row.tableId) === waiterId);
  }

  return new Proxy(raw, {
    get(target, property, receiver) {
      if (property === 'assign') {
        return async (dto: {
          bookingId: string; tableId?: string | null; tableNumber?: string | null;
          waiterId: string; waiterName: string;
        }) => {
          const booking = await dataSource.getRepository(Booking).findOne({
            where: { id: dto.bookingId }, relations: ['table'],
          });
          if (!booking) throw new NotFoundException('Бронювання не знайдено');
          if (!booking.table?.id) throw new BadRequestException('Стіл бронювання не знайдено');
          if (dto.tableId && dto.tableId !== booking.table.id) {
            throw new BadRequestException('Стіл бронювання не збігається');
          }
          return ownership.withWaiterTableLock(
            booking.table.id, dto.waiterId,
            () => target.assign({ ...dto, tableId: booking.table!.id, tableNumber: booking.table!.tableNumber }),
            Boolean(booking.checkedInAt && booking.status === 'approved'),
          );
        };
      }
      if (property === 'accept') {
        return async (id: string, dto: { waiterId: string; waiterName: string }) =>
          ownership.withWaiterTableLock(
            await callTableId(id), dto.waiterId,
            () => target.accept(id, dto),
            true,
          );
      }
      if (property === 'close') {
        return async (id: string, waiterId: string) =>
          ownership.withWaiterTableLock(await callTableId(id), waiterId, () => target.close(id, waiterId));
      }
      if (property === 'list') {
        return async (waiterId?: string) => {
          const rows = await target.list(waiterId);
          return waiterId ? visibleToWaiter(rows, waiterId) : rows;
        };
      }
      if (property === 'myAssignments') {
        return async (waiterId: string) => {
          const rows = await target.myAssignments(waiterId);
          return visibleToWaiter(rows, waiterId);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
