import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';

import { Booking } from '../bookings/entities/booking.entity';
import { TableEntity } from '../tables/entities/table.entity';
import { TableOwnershipService } from '../tables/table-ownership.service';
import { WaiterCallRecord } from './entities/waiter-call.entity';
import { WaiterCallsService } from './waiter-calls.service';

export const RAW_WAITER_CALLS_SERVICE = Symbol('RAW_WAITER_CALLS_SERVICE');

function restaurantDateToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

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
              if (visit.status !== 'approved' || !visit.checkedInAt ||
                  visit.bookingDate !== restaurantDateToday() || table?.status !== 'occupied') {
                throw new BadRequestException('Офіціанта можна закріпити лише після приходу гостей за бронюванням на сьогодні');
              }
              return { tableId: table.id, tableNumber: table.tableNumber };
            },
            true,
          );

          // The database table is authoritative. Publishing a second in-memory
          // assignment after the transaction can race with the next visit and
          // redirect its guest call to the previous waiter.
          return {
            message: 'Офіціанта закріплено за столом',
            assignment: {
              bookingId: dto.bookingId,
              tableId: current.tableId,
              tableNumber: current.tableNumber,
              waiterId: dto.waiterId,
              waiterName: dto.waiterName || 'Офіціант',
              assignedAt: new Date().toISOString(),
            },
          };
        };
      }
      if (property === 'accept') {
        return async (id: string, dto: { waiterId: string; waiterName: string }) => {
          if (!dto.waiterId) throw new ForbiddenException('Не вдалося визначити офіціанта');
          // Resolve an identifier without locking. The booking is always locked
          // FIRST, followed by the table and call, matching check-in/completion.
          const initial = await dataSource.getRepository(WaiterCallRecord).findOne({
            where: { id }, relations: ['booking'],
          });
          if (!initial?.booking?.id) throw new NotFoundException('Виклик не знайдено');

          return dataSource.transaction(async (manager) => {
            const lockedBooking = await manager.getRepository(Booking).findOne({
              where: { id: initial.booking.id },
              lock: { mode: 'pessimistic_write' },
            });
            if (!lockedBooking) throw new NotFoundException('Бронювання не знайдено');
            const call = await manager.getRepository(WaiterCallRecord).findOne({
              where: { id }, relations: ['booking', 'booking.table'],
            });
            if (!call || call.booking?.id !== lockedBooking.id || !call.booking.table ||
                call.booking.table.id !== call.tableId || lockedBooking.status !== 'approved' ||
                !lockedBooking.checkedInAt || lockedBooking.bookingDate !== restaurantDateToday()) {
              throw new BadRequestException('Виклик не належить чинному відвідуванню за цим столом');
            }
            const tableRepo = manager.getRepository(TableEntity);
            const table = await tableRepo.findOne({
              where: { id: call.tableId },
              lock: { mode: 'pessimistic_write' },
            });
            if (!table || table.status !== 'occupied') {
              throw new BadRequestException('Виклик не належить зайнятому столу');
            }
            ownership.assertCanModify(table, { role: 'waiter', staffId: dto.waiterId } as Parameters<typeof ownership.assertCanModify>[1]);
            const result = await mutateCall(manager, id, dto.waiterId, 'accept', dto.waiterName);
            if (!table.assignedWaiterId) {
              table.assignedWaiterId = dto.waiterId;
              await tableRepo.save(table);
            }
            return result;
          });
        };
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
