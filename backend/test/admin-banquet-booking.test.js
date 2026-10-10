require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { ROLES_KEY } = require('../dist/common/decorators/roles.decorator.js');
const { BookingTableLockService } = require('../dist/bookings/booking-table-lock.service.js');
const { BookingsController } = require('../dist/bookings/bookings.controller.js');
const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { BookingHistory } = require('../dist/bookings/entities/booking-history.entity.js');
const { BookingTableAssignment } = require('../dist/bookings/entities/booking-table-assignment.entity.js');
const { Client } = require('../dist/clients/entities/client.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

const TABLE_A = '11111111-1111-4111-8111-111111111111';
const TABLE_B = '22222222-2222-4222-8222-222222222222';

function banquetDto() {
  return {
    tableIds: [TABLE_B, TABLE_A],
    primaryTableId: TABLE_A,
    fullName: 'Банкетний гість',
    bookingDate: '2026-10-03',
    bookingTime: '18:00',
    guestsCount: 10,
    durationMinutes: 180,
    wishes: 'День народження',
  };
}

test('admin banquet endpoint locks once, checks every table block and forwards actor', async () => {
  const calls = [];
  const actor = { role: 'admin', staffId: 'staff-1', name: 'Admin' };
  const dto = banquetDto();
  const service = {
    async createManualBanquet(payload, receivedActor) {
      calls.push(['service', payload, receivedActor]);
      return { message: 'Банкетне бронювання створено та підтверджено' };
    },
  };
  const tableLock = {
    async withBanquetCreateLock(payload, work) {
      calls.push(['lock', payload]);
      return work();
    },
  };
  const availability = {
    async assertBookable(payload) {
      calls.push(['availability', payload]);
    },
  };
  const controller = new BookingsController(
    service,
    {},
    {},
    tableLock,
    availability,
    {},
    {},
    {},
    {},
    {},
    {},
  );

  const result = await controller.createBanquet(dto, { user: actor });

  assert.deepEqual(result, { message: 'Банкетне бронювання створено та підтверджено' });
  assert.equal(calls[0][0], 'lock');
  assert.deepEqual(
    calls.filter(([kind]) => kind === 'availability').map(([, payload]) => payload.tableId),
    [TABLE_B, TABLE_A],
  );
  assert.equal(calls.at(-1)[0], 'service');
  assert.deepEqual(calls.at(-1)[2], actor);
  assert.deepEqual(
    Reflect.getMetadata(ROLES_KEY, BookingsController.prototype.createBanquet),
    ['admin', 'owner'],
  );
});

test('banquet create lock acquires all table/date locks in stable order and releases them in reverse', async () => {
  const queries = [];
  const runner = {
    async connect() {},
    async query(sql, params) {
      queries.push([sql, params]);
      return [];
    },
    async release() {},
  };
  const dataSource = { createQueryRunner: () => runner };
  const tables = {
    async findOne({ where }) {
      return { id: where.id };
    },
  };
  const service = new BookingTableLockService(
    dataSource,
    tables,
    {},
    {},
    {},
  );

  let worked = false;
  await service.withBanquetCreateLock(banquetDto(), async () => {
    worked = true;
    return 'ok';
  });

  assert.equal(worked, true);
  const lockCalls = queries.filter(([sql]) => sql.includes('pg_advisory_lock('));
  const unlockCalls = queries.filter(([sql]) => sql.includes('pg_advisory_unlock('));
  assert.deepEqual(lockCalls.map(([, params]) => params), [
    [TABLE_A, '2026-10-03'],
    [TABLE_B, '2026-10-03'],
  ]);
  assert.deepEqual(unlockCalls.map(([, params]) => params), [
    [TABLE_B, '2026-10-03'],
    [TABLE_A, '2026-10-03'],
  ]);
});

function createServiceHarness({ conflictOnSecond = false, failAssignments = false } = {}) {
  const writes = {
    bookings: [],
    assignments: [],
    histories: [],
    tableStatuses: [],
    logs: [],
    notifications: [],
  };
  const tables = [
    { id: TABLE_A, tableNumber: '8', status: 'free', isVisible: true, zone: { isClosed: false, isVisible: true } },
    { id: TABLE_B, tableNumber: '9', status: 'free', isVisible: true, zone: { isClosed: false, isVisible: true } },
  ];
  let conflictReads = 0;
  let committedBooking = null;

  const bookingRepository = {
    create(value) {
      return { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ...value };
    },
    async save(value) {
      writes.bookings.push(value);
      committedBooking = value;
      return value;
    },
    createQueryBuilder() {
      const builder = {
        leftJoinAndSelect() { return builder; },
        leftJoin() { return builder; },
        where() { return builder; },
        andWhere() { return builder; },
        distinct() { return builder; },
        orderBy() { return builder; },
        async getMany() {
          conflictReads += 1;
          if (conflictOnSecond && conflictReads === 2) {
            return [{
              id: 'conflict-booking',
              bookingDate: '2026-10-03',
              bookingTime: '18:30:00',
              durationMinutes: 60,
              wishes: null,
              status: 'approved',
            }];
          }
          return [];
        },
      };
      return builder;
    },
  };
  const historyRepository = {
    create: (value) => value,
    async save(value) {
      writes.histories.push(value);
      return value;
    },
  };
  const assignmentRepository = {
    create: (value) => value,
    async save(value) {
      if (failAssignments) throw new Error('assignment write failed');
      writes.assignments.push(...value);
      return value;
    },
  };
  const clientRepository = {};
  const tableRepository = {
    createQueryBuilder(alias) {
      assert.equal(alias, 'locked_table');
      const builder = {
        leftJoinAndSelect() { return builder; },
        where() { return builder; },
        orderBy() { return builder; },
        setLock(mode, version, aliases) {
          writes.tableLock = { mode, version, aliases };
          return builder;
        },
        async getMany() { return tables; },
      };
      return builder;
    },
    async save(value) {
      writes.tableStatuses.push({ id: value.id, status: value.status });
      return value;
    },
  };

  const manager = {
    async query() {
      return [{ ready: true }];
    },
    getRepository(entity) {
      if (entity === Booking) return bookingRepository;
      if (entity === BookingHistory) return historyRepository;
      if (entity === BookingTableAssignment) return assignmentRepository;
      if (entity === Client) return clientRepository;
      if (entity === TableEntity) return tableRepository;
      throw new Error(`unexpected repository ${entity?.name}`);
    },
  };

  const rootBookings = {
    manager: {
      async transaction(work) {
        return work(manager);
      },
    },
    async findOne() {
      if (!committedBooking) return null;
      return {
        ...committedBooking,
        tableAssignments: writes.assignments.map((assignment) => ({
          ...assignment,
          table: assignment.table,
        })),
      };
    },
  };

  const service = new BookingsService(
    rootBookings,
    {},
    {},
    {},
    {},
    {},
    {
      async create(action, _actor, details) {
        writes.logs.push([action, details]);
      },
    },
    {
      async notifyManualBookingCreated(value) {
        writes.notifications.push(value);
      },
    },
    {},
    {},
  );
  service.isBookingToday = () => true;

  return { service, writes };
}

test('banquet creation commits one booking with primary plus all assignments and today statuses', async () => {
  const { service, writes } = createServiceHarness();
  const result = await service.createManualBanquet(banquetDto(), {
    role: 'admin',
    staffId: 'staff-1',
    name: 'Admin',
  });

  assert.deepEqual(writes.tableLock, {
    mode: 'pessimistic_write',
    version: undefined,
    aliases: ['locked_table'],
  });
  assert.equal(writes.bookings.length, 1);
  assert.equal(writes.bookings[0].table.id, TABLE_A);
  assert.equal(writes.bookings[0].status, 'approved');
  assert.equal(writes.bookings[0].source, 'admin_manual');
  assert.equal(writes.assignments.length, 2);
  assert.deepEqual(
    writes.assignments.map((assignment) => [assignment.table.id, assignment.isPrimary]),
    [[TABLE_B, false], [TABLE_A, true]],
  );
  assert.equal(writes.histories.length, 1);
  assert.equal(writes.histories[0].newData.banquet, true);
  assert.deepEqual(
    writes.histories[0].newData.tableNumbers,
    ['9', '8'],
  );
  assert.deepEqual(writes.tableStatuses, [
    { id: TABLE_B, status: 'reserved' },
    { id: TABLE_A, status: 'reserved' },
  ]);
  assert.equal(writes.notifications.length, 1);
  assert.equal(result.primaryTableId, TABLE_A);
  assert.deepEqual(result.tableIds, [TABLE_B, TABLE_A]);
  assert.deepEqual(result.tableNumbers, ['9', '8']);
});

test('conflict on a secondary banquet table rejects before any booking or assignment write', async () => {
  const { service, writes } = createServiceHarness({ conflictOnSecond: true });

  await assert.rejects(
    () => service.createManualBanquet(banquetDto()),
    /Стіл №8 зайнятий/,
  );

  assert.equal(writes.bookings.length, 0);
  assert.equal(writes.assignments.length, 0);
  assert.equal(writes.histories.length, 0);
  assert.equal(writes.tableStatuses.length, 0);
  assert.equal(writes.notifications.length, 0);
});

test('assignment failure never sends post-commit log or notification', async () => {
  const { service, writes } = createServiceHarness({ failAssignments: true });

  await assert.rejects(
    () => service.createManualBanquet(banquetDto()),
    /Не вдалося створити банкетне бронювання/,
  );

  assert.equal(writes.histories.length, 0);
  assert.equal(writes.tableStatuses.length, 0);
  assert.equal(writes.logs.length, 0);
  assert.equal(writes.notifications.length, 0);
});
