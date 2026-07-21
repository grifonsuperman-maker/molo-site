import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { BookingHistory } from './entities/booking-history.entity';
import { TableEntity } from '../tables/entities/table.entity';

test('waiterTransfer preserves an occupied table used by an earlier booking', async () => {
  const oldTable = {
    id: 'old-table',
    tableNumber: '1',
    status: 'occupied',
    isVisible: true,
  } as TableEntity;
  const nextTable = {
    id: 'next-table',
    tableNumber: '2',
    status: 'free',
    isVisible: true,
  } as TableEntity;
  const followingBooking = {
    id: 'following-booking',
    status: 'approved',
    bookingDate: '2026-07-21',
    bookingTime: '20:00:00',
    durationMinutes: 120,
    checkedInAt: null,
    table: oldTable,
    client: null,
  } as Booking;
  const savedTables: TableEntity[][] = [];
  let transactionCompleted = false;
  let callsClosedAfterTransaction = false;

  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Booking) {
        return { findOne: async () => followingBooking, save: async () => followingBooking };
      }
      if (entity === TableEntity) {
        return {
          findOne: async ({ where }: { where: { id: string } }) =>
            where.id === oldTable.id ? oldTable : nextTable,
          save: async (tables: TableEntity[]) => savedTables.push(tables),
        };
      }
      if (entity === BookingHistory) {
        return { create: (history: unknown) => history, save: async () => undefined };
      }
      throw new Error('Unexpected repository');
    },
  };
  const bookings = {
    manager: {
      transaction: async (work: (value: typeof manager) => Promise<unknown>) => {
        const result = await work(manager);
        transactionCompleted = true;
        return result;
      },
    },
  };
  const service = new BookingsService(
    bookings as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {
      closeActiveCallsAndDetachBooking: (bookingId: string) => {
        assert.equal(bookingId, followingBooking.id);
        assert.equal(transactionCompleted, true);
        callsClosedAfterTransaction = true;
      },
    } as any,
  );

  (service as any).restaurantDateToday = () => '2026-07-21';
  (service as any).checkAvailability = async () => ({ isAvailable: true });
  (service as any).safeLog = async () => undefined;

  await service.waiterTransfer(followingBooking.id, nextTable.id, {
    sub: 'waiter-user',
    telegramId: null,
    role: 'waiter',
  });

  assert.equal(oldTable.status, 'occupied');
  assert.equal(nextTable.status, 'reserved');
  assert.deepEqual(savedTables, [[oldTable, nextTable]]);
  assert.equal(callsClosedAfterTransaction, true);
});

test('waiterTransfer preserves a closed source table', async () => {
  const oldTable = {
    id: 'old-table',
    tableNumber: '1',
    status: 'closed',
    isVisible: true,
  } as TableEntity;
  const nextTable = {
    id: 'next-table',
    tableNumber: '2',
    status: 'free',
    isVisible: true,
  } as TableEntity;
  const booking = {
    id: 'approved-booking',
    status: 'approved',
    bookingDate: '2026-07-21',
    bookingTime: '20:00:00',
    durationMinutes: 120,
    checkedInAt: null,
    table: oldTable,
    client: null,
  } as Booking;
  const savedTables: TableEntity[][] = [];
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Booking) return { findOne: async () => booking, save: async () => booking };
      if (entity === TableEntity) {
        return {
          findOne: async ({ where }: { where: { id: string } }) => where.id === oldTable.id ? oldTable : nextTable,
          save: async (tables: TableEntity[]) => savedTables.push(tables),
        };
      }
      if (entity === BookingHistory) return { create: (history: unknown) => history, save: async () => undefined };
      throw new Error('Unexpected repository');
    },
  };
  const service = new BookingsService(
    { manager: { transaction: async (work: (value: typeof manager) => Promise<unknown>) => work(manager) } } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    { closeActiveCallsAndDetachBooking: () => undefined } as any,
  );

  (service as any).restaurantDateToday = () => '2026-07-21';
  (service as any).checkAvailability = async () => ({ isAvailable: true });
  (service as any).safeLog = async () => undefined;

  await service.waiterTransfer(booking.id, nextTable.id, { sub: 'waiter-user', telegramId: null, role: 'waiter' });

  assert.equal(oldTable.status, 'closed');
  assert.equal(nextTable.status, 'reserved');
  assert.deepEqual(savedTables, [[oldTable, nextTable]]);
});
