import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { WaiterCallsService } from './waiter-calls.service';
import { WaiterCallRecord } from './entities/waiter-call.entity';

function createService(initialCalls: any[] = []) {
  const calls = initialCalls.map((call) => ({
    createdAt: new Date('2026-07-21T12:00:00.000Z'),
    updatedAt: new Date('2026-07-21T12:00:00.000Z'),
    ...call,
  }));

  const bookings = {
    exist: async () => true,
    findOne: async ({ where }: any) => ({
      id: where.id,
      status: 'approved',
      table: { id: 'table-1', tableNumber: '1', status: 'occupied' },
      client: { fullName: 'Гість' },
    }),
    createQueryBuilder: () => ({
      where() { return this; },
      setLock() { return this; },
      async getOne() { return { id: 'booking-1' }; },
    }),
  };

  const histories = {
    createQueryBuilder: () => ({
      leftJoin() { return this; },
      where() { return this; },
      andWhere() { return this; },
      orderBy() { return this; },
      async getOne() { return null; },
    }),
  };

  const callRepo = {
    create: (value: any) => ({
      ...value,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    async save(value: any) {
      const index = calls.findIndex((item) => item.id === value.id);
      value.updatedAt = new Date();
      if (index >= 0) calls[index] = value;
      else calls.push(value);
      return value;
    },
    async find() {
      return calls.filter((call) => call.status !== 'closed');
    },
    async findOne({ where }: any) {
      if (where?.id) return calls.find((call) => call.id === where.id) || null;
      if (where?.booking?.id) {
        return calls.find(
          (call) => call.booking?.id === where.booking.id && call.status !== 'closed',
        ) || null;
      }
      return null;
    },
    createQueryBuilder: () => {
      let bookingId = '';
      let values: Record<string, unknown> = {};
      return {
        update() { return this; },
        set(next: Record<string, unknown>) { values = next; return this; },
        where(_sql: string, params: { bookingId: string }) {
          bookingId = params.bookingId;
          return this;
        },
        andWhere() { return this; },
        async execute() {
          calls.forEach((call) => {
            if (call.booking?.id === bookingId && call.status !== 'closed') {
              Object.assign(call, values);
            }
          });
          return { affected: calls.length };
        },
      };
    },
  };

  const dataSource = {
    transaction: async (work: (manager: any) => Promise<unknown>) => work({
      getRepository(entity: { name: string }) {
        return entity === WaiterCallRecord || entity.name === 'WaiterCallRecord'
          ? callRepo
          : bookings;
      },
    }),
  };

  return {
    calls,
    service: new WaiterCallsService(
      bookings as any,
      histories as any,
      callRepo as any,
      dataSource as any,
    ),
  };
}

function call(overrides: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    booking: { id: 'booking-1' },
    tableId: 'table-1',
    tableNumber: '1',
    clientName: null,
    waiterId: null,
    waiterName: null,
    status: 'new',
    acceptedAt: null,
    closedAt: null,
    ...overrides,
  };
}

test('closeActiveCallsAndDetachBooking persists closed state', async () => {
  const { service, calls } = createService([
    call(),
    call({ id: 'call-2', status: 'accepted', waiterId: 'waiter-1' }),
  ]);

  await service.closeActiveCallsAndDetachBooking('booking-1');

  assert.deepEqual(calls.map((item) => item.status), ['closed', 'closed']);
  assert.equal(calls.every((item) => item.closedAt instanceof Date), true);
  assert.deepEqual(await service.list('waiter-1'), []);
});

test('accept rejects a waiter when a new call is already assigned to another waiter', async () => {
  const { service, calls } = createService([
    call({ waiterId: 'waiter-1', waiterName: 'Офіціант 1' }),
  ]);

  await assert.rejects(
    () => service.accept('call-1', { waiterId: 'waiter-2', waiterName: 'Офіціант 2' }),
    (error: any) => error.getStatus() === 403,
  );
  assert.equal(calls[0].status, 'new');
  assert.equal(calls[0].waiterId, 'waiter-1');
});

test('accept allows the waiter already assigned to a new call', async () => {
  const { service } = createService([
    call({ waiterId: 'waiter-1', waiterName: 'Офіціант 1' }),
  ]);

  const result = await service.accept('call-1', {
    waiterId: 'waiter-1',
    waiterName: 'Офіціант 1',
  });

  assert.equal(result.call.status, 'accepted');
  assert.equal(result.call.waiterId, 'waiter-1');
  assert.ok(result.call.acceptedAt);
});

test('close rejects a waiter who is not assigned to the call', async () => {
  const { service, calls } = createService([
    call({
      status: 'accepted',
      waiterId: 'waiter-1',
      waiterName: 'Офіціант 1',
      acceptedAt: new Date('2026-07-21T12:01:00.000Z'),
    }),
  ]);

  await assert.rejects(
    () => service.close('call-1', 'waiter-2'),
    (error: any) => error.getStatus() === 403,
  );
  assert.equal(calls[0].status, 'accepted');
});

test('close allows the assigned waiter to close an accepted call', async () => {
  const { service } = createService([
    call({
      status: 'accepted',
      waiterId: 'waiter-1',
      waiterName: 'Офіціант 1',
      acceptedAt: new Date('2026-07-21T12:01:00.000Z'),
    }),
  ]);

  const result = await service.close('call-1', 'waiter-1');

  assert.equal(result.call.status, 'closed');
  assert.ok(result.call.closedAt);
});

test('close rejects a new call until it has been accepted', async () => {
  const { service, calls } = createService([call()]);

  await assert.rejects(
    () => service.close('call-1', 'waiter-1'),
    /Спочатку прийміть виклик/,
  );
  assert.equal(calls[0].status, 'new');
});
