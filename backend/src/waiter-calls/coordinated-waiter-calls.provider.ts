import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { TableOwnershipService } from '../tables/table-ownership.service';
import { WaiterCallRecord } from './entities/waiter-call.entity';
import { WaiterCallsService } from './waiter-calls.service';

export const RAW_WAITER_CALLS_SERVICE = Symbol('RAW_WAITER_CALLS_SERVICE');

/** Serialize the committed call using the existing public response shape. */
function publicCall(call: WaiterCallRecord) {
  return {
    id: call.id,
    bookingId: call.booking.id,
    tableId: call.tableId,
    tableNumber: call.tableNumber,
    clientName: call.clientName,
    waiterId: call.waiterId,
    waiterName: call.waiterName,
    status: call.status,
    createdAt: call.createdAt.toISOString(),
    acceptedAt: call.acceptedAt?.toISOString() || null,
    closedAt: call.closedAt?.toISOString() || null,
  };
}

/** The caller already holds the table lock; never acquire a second connection here. */
async function mutateCall(
  manager: EntityManager,
  id: string,
  waiterId: string,
  operation: 'accept' | 'close',
  waiterName?: string,
) {
  const calls = manager.getRepository(WaiterCallRecord);
  const call = await calls.findOne({
    where: { id },
    relations: { booking: true },
    relationLoadStrategy: 'query',
    lock: { mode: 'pessimistic_write' },
  });
  if (!call) throw new NotFoundException('Виклик не знайдено');
  if (call.status === 'closed') throw new BadRequestException('Виклик вже закрито');
  if (!waiterId) throw new BadRequestException('waiterId обовʼязковий');

  if (operation === 'accept') {
    if (call.waiterId && call.waiterId !== waiterId) {
      throw new ForbiddenException('Цей виклик призначено іншому офіціанту');
    }
    if (call.status === 'accepted') {
      return { message: 'Виклик вже прийнято', call: publicCall(call) };
    }
    call.status = 'accepted';
    call.waiterId = waiterId;
    call.waiterName = waiterName || 'Офіціант';
    call.assignmentActive = true;
    call.acceptedAt = new Date();
    const saved = await calls.save(call);
    return { message: 'Виклик прийнято', call: publicCall(saved) };
  }

  if (call.status !== 'accepted') throw new BadRequestException('Спочатку прийміть виклик');
  if (call.waiterId !== waiterId) {
    throw new ForbiddenException('Цей виклик призначено іншому офіціанту');
  }
  call.status = 'closed';
  call.closedAt = new Date();
  const saved = await calls.save(call);
  return { message: 'Виклик закрито', call: publicCall(saved) };
}

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
          if (!dto.bookingId) throw new BadRequestException('bookingId обовʼязковий');
          const booking = await dataSource.getRepository(Booking).findOne({
            where: { id: dto.bookingId }, relations: ['table'],
          });
          if (!booking) throw new NotFoundException('Бронювання не знайдено');
          if (!booking.table?.id) throw new BadRequestException('Стіл бронювання не знайдено');
          if (dto.tableId && dto.tableId !== booking.table.id) {
            throw new BadRequestException('Стіл бронювання не збігається');
          }

          // The UI calls this endpoint only after "Гість прийшов". A direct API call
          // must not create an in-memory assignment for a reservation that has no guests.
          // Re-read inside the table lock: a booking/table may have changed since lookup.
          const current = await ownership.withWaiterTableLock(
            booking.table.id,
            dto.waiterId,
            async (manager) => {
              const visit = await manager.getRepository(Booking).findOne({
                where: { id: dto.bookingId }, relations: ['table'],
              });
              if (!visit?.table?.id || visit.table.id !== booking.table!.id) {
                throw new BadRequestException('Стіл бронювання вже змінено');
              }
              const table = await manager.getRepository(TableEntity).findOne({
                where: { id: visit.table.id },
              });
              if (visit.status !== 'approved' || !visit.checkedInAt || table?.status !== 'occupied') {
                throw new BadRequestException('Офіціанта можна закріпити лише після приходу гостей');
              }
              return { tableId: table.id, tableNumber: table.tableNumber };
            },
            true,
          );

          // The durable claim must commit before the legacy in-memory call routing is updated.
          return target.assign({ ...dto, tableId: current.tableId, tableNumber: current.tableNumber });
        };
      }
      if (property === 'accept') {
        return async (id: string, dto: { waiterId: string; waiterName: string }) =>
          ownership.withWaiterTableLock(
            await callTableId(id), dto.waiterId,
            async (manager) => {
              const call = await manager.getRepository(WaiterCallRecord).findOne({
                where: { id }, relations: ['booking', 'booking.table'],
              });
              if (!call || !call.booking?.table || call.booking.table.id !== call.tableId ||
                  call.booking.status !== 'approved' || !call.booking.checkedInAt) {
                throw new BadRequestException('Виклик не належить чинному відвідуванню за цим столом');
              }
              // Ownership is locked, but a booking can retain checkedInAt after the
              // physical table was released. Do not accept or claim that old call.
              const table = await manager.getRepository(TableEntity).findOne({
                where: { id: call.tableId },
              });
              if (!table || table.status !== 'occupied') {
                throw new BadRequestException('Виклик не належить зайнятому столу');
              }
              return mutateCall(manager, id, dto.waiterId, 'accept', dto.waiterName);
            },
            true,
          );
      }
      if (property === 'close') {
        return async (id: string, waiterId: string) =>
          ownership.withWaiterTableLock(
            await callTableId(id), waiterId,
            (manager) => mutateCall(manager, id, waiterId, 'close'),
          );
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
