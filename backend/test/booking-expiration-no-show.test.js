require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingExpirationService,
} = require('../dist/bookings/booking-expiration.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

function createService(
  expiredBookings,
  { assignmentsReady = false, tableStatuses = {}, activeBookingsByTable = {} } = {},
) {
  const calls = [];
  const bookingById = new Map(expiredBookings.map((booking) => [booking.id, booking]));
  const tableIds = new Set();
  for (const booking of expiredBookings) {
    if (booking.table?.id) tableIds.add(booking.table.id);
    for (const assignment of booking.tableAssignments || []) {
      if (assignment.table?.id) tableIds.add(assignment.table.id);
    }
  }
  const tableById = new Map(
    [...tableIds].map((id) => [id, { id, status: tableStatuses[id] || 'reserved' }]),
  );
  let inTransaction = false;

  const bookingRepo = {
    async find(options) {
      const date = options?.where?.bookingDate;
      if (typeof date === 'string') {
        const tableId = options?.where?.table?.id;
        calls.push(['bookings.find.active', tableId]);
        return activeBookingsByTable[tableId] || [];
      }
      calls.push(['bookings.find.expired']);
      return expiredBookings;
    },
    async findOne(options) {
      const booking = bookingById.get(options.where.id) || null;
      if (options.lock) {
        assert.equal(inTransaction, true);
        calls.push(['booking.lock', options.where.id, options.lock.mode]);
      } else {
        calls.push(['booking.reload', options.where.id, options.relations || null]);
      }
      return booking;
    },
    async save(values) {
      assert.equal(inTransaction, true);
      calls.push(['bookings.save', values.map((value) => value.id)]);
      return values;
    },
    createQueryBuilder(alias) {
      assert.equal(alias, 'booking');
      let tableId = null;
      const query = {
        leftJoinAndSelect() { return query; },
        leftJoin() { return query; },
        where(_sql, params) {
          tableId = params?.tableId || tableId;
          return query;
        },
        andWhere() { return query; },
        distinct() { return query; },
        orderBy() { return query; },
        async getMany() {
          calls.push(['bookings.query.active', tableId]);
          return activeBookingsByTable[tableId] || [];
        },
      };
      return query;
    },
  };

  const tableRepo = {
    async findOne({ where, lock }) {
      assert.equal(inTransaction, true);
      assert.equal(lock?.mode, 'pessimistic_write');
      calls.push(['table.lock', where.id, lock.mode]);
      return tableById.get(where.id) || null;
    },
    async save(value) {
      assert.equal(inTransaction, true);
      calls.push(['tables.save', value.id, value.status]);
      const current = tableById.get(value.id);
      if (current) current.status = value.status;
      return value;
    },
  };

  const manager = {
    async query() {
      return [{ ready: assignmentsReady }];
    },
    getRepository(entity) {
      if (entity === Booking) return bookingRepo;
      if (entity === TableEntity) return tableRepo;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };

  const bookings = {
    manager: {
      async transaction(work) {
        calls.push(['transaction.begin']);
        inTransaction = true;
        try {
          const result = await work(manager);
          calls.push(['transaction.commit']);
          return result;
        } catch (error) {
          calls.push(['transaction.rollback']);
          throw error;
        } finally {
          inTransaction = false;
        }
      },
    },
  };

  const service = new BookingExpirationService(bookings, {});
  service.getKyivDate = () => '2026-08-28';
  return { service, calls, tableById };
}

test('day rollover does not complete an approved booking that never checked in', async () => {
  const booking = {
    id: 'late-guest',
    bookingDate: '2026-08-27',
    bookingTime: '23:45',
    status: 'approved',
    checkedInAt: null,
    completedAt: null,
    table: { id: 'table-1' },
  };
  const { service, calls } = createService([booking]);

  await service.completeExpiredBookings();

  assert.equal(booking.status, 'approved');
  assert.equal(booking.completedAt, null);
  assert.equal(calls.some((call) => call[0] === 'bookings.save'), false);
  assert.deepEqual(calls.slice(0, 2).map((call) => call[0]), [
    'transaction.begin',
    'bookings.find.expired',
  ]);
  assert.equal(calls.at(-1)[0], 'transaction.commit');
});

test('day rollover completes a checked-in booking inside the transaction', async () => {
  const booking = {
    id: 'visited-guest',
    bookingDate: '2026-08-27',
    bookingTime: '22:30',
    status: 'approved',
    checkedInAt: new Date('2026-08-27T19:30:00.000Z'),
    completedAt: null,
    table: { id: 'table-1' },
  };
  const { service, calls } = createService([booking]);

  await service.completeExpiredBookings();

  assert.equal(booking.status, 'completed');
  assert.ok(booking.completedAt instanceof Date);
  assert.ok(calls.some((call) => call[0] === 'booking.lock' && call[1] === booking.id));
  assert.ok(calls.some((call) => call[0] === 'bookings.save'));
  assert.ok(calls.some((call) => call[0] === 'table.lock' && call[1] === 'table-1'));
  assert.equal(calls.at(-1)[0], 'transaction.commit');
});

test('overnight completion locks and releases every banquet table assignment atomically', async () => {
  const booking = {
    id: 'banquet-visited',
    bookingDate: '2026-08-27',
    bookingTime: '22:30',
    status: 'approved',
    checkedInAt: new Date('2026-08-27T19:30:00.000Z'),
    completedAt: null,
    table: { id: 'table-1' },
    tableAssignments: [
      { table: { id: 'table-1' }, isPrimary: true },
      { table: { id: 'table-2' }, isPrimary: false },
    ],
  };
  const { service, calls, tableById } = createService([booking], {
    assignmentsReady: true,
  });

  await service.completeExpiredBookings();

  assert.equal(booking.status, 'completed');
  assert.equal(tableById.get('table-1').status, 'free');
  assert.equal(tableById.get('table-2').status, 'free');

  const lockedIds = calls
    .filter((call) => call[0] === 'table.lock')
    .map((call) => call[1]);
  assert.deepEqual(lockedIds, ['table-1', 'table-2']);

  const bookingSave = calls.findIndex((call) => call[0] === 'bookings.save');
  const firstTableLock = calls.findIndex((call) => call[0] === 'table.lock');
  const commit = calls.findIndex((call) => call[0] === 'transaction.commit');
  assert.ok(bookingSave >= 0 && firstTableLock > bookingSave && commit > firstTableLock);
});

test('overnight completion preserves a later approved booking on a banquet secondary table', async () => {
  const booking = {
    id: 'banquet-visited',
    bookingDate: '2026-08-27',
    bookingTime: '22:30',
    status: 'approved',
    checkedInAt: new Date('2026-08-27T19:30:00.000Z'),
    completedAt: null,
    table: { id: 'table-1' },
    tableAssignments: [
      { table: { id: 'table-1' }, isPrimary: true },
      { table: { id: 'table-2' }, isPrimary: false },
    ],
  };
  const { service, tableById } = createService([booking], {
    assignmentsReady: true,
    activeBookingsByTable: {
      'table-2': [{ id: 'today-approved', status: 'approved' }],
    },
  });

  await service.completeExpiredBookings();

  assert.equal(tableById.get('table-1').status, 'free');
  assert.equal(tableById.get('table-2').status, 'reserved');
});
