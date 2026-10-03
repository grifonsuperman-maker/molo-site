require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { BookingHistory } = require('../dist/bookings/entities/booking-history.entity.js');
const { BookingTableAssignment } = require('../dist/bookings/entities/booking-table-assignment.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

const TABLE_FREE = '11111111-1111-4111-8111-111111111111';
const TABLE_RESERVED = '22222222-2222-4222-8222-222222222222';
const TABLE_PENDING = '33333333-3333-4333-8333-333333333333';

test('cancelling a banquet projects each table from its remaining active bookings', async () => {
  const targetBooking = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'approved',
    bookingDate: '2026-10-03',
    bookingTime: '18:00:00',
    durationMinutes: 120,
    table: {
      id: TABLE_FREE,
      tableNumber: '8',
      status: 'reserved',
    },
    client: null,
    cancelledAt: null,
    cancellationReason: null,
    completedAt: null,
    expectedArrivalAt: null,
  };
  const tables = new Map([
    [TABLE_FREE, { id: TABLE_FREE, tableNumber: '8', status: 'reserved' }],
    [TABLE_RESERVED, { id: TABLE_RESERVED, tableNumber: '9', status: 'reserved' }],
    [TABLE_PENDING, { id: TABLE_PENDING, tableNumber: '10', status: 'reserved' }],
  ]);
  const remaining = new Map([
    [TABLE_FREE, []],
    [TABLE_RESERVED, [{ id: 'later-approved', status: 'approved' }]],
    [TABLE_PENDING, [{ id: 'later-pending', status: 'pending' }]],
  ]);
  const savedTableStatuses = [];
  const savedHistory = [];
  let bookingQueryCount = 0;

  const bookingRepository = {
    manager: {
      async query() {
        return [{ ready: true }];
      },
    },
    createQueryBuilder(alias) {
      bookingQueryCount += 1;
      const isTargetLookup = bookingQueryCount === 1;
      let tableId = null;
      const builder = {
        leftJoinAndSelect() { return builder; },
        leftJoin() { return builder; },
        where(_sql, params) {
          if (params?.tableId) tableId = params.tableId;
          return builder;
        },
        andWhere() { return builder; },
        distinct() { return builder; },
        setLock(mode, version, aliases) {
          if (isTargetLookup) {
            assert.equal(mode, 'pessimistic_write');
            assert.equal(version, undefined);
            assert.deepEqual(aliases, ['booking']);
          }
          return builder;
        },
        async getOne() {
          return isTargetLookup ? targetBooking : null;
        },
        async getMany() {
          return remaining.get(tableId) || [];
        },
      };
      return builder;
    },
    async save(value) {
      return value;
    },
  };

  const historyRepository = {
    create(value) { return value; },
    async save(value) {
      savedHistory.push(value);
      return value;
    },
  };

  const assignmentRepository = {
    async find() {
      return [
        { booking: targetBooking, table: tables.get(TABLE_FREE), isPrimary: true },
        { booking: targetBooking, table: tables.get(TABLE_RESERVED), isPrimary: false },
        { booking: targetBooking, table: tables.get(TABLE_PENDING), isPrimary: false },
      ];
    },
  };

  const tableRepository = {
    createQueryBuilder(alias) {
      assert.equal(alias, 'table');
      let tableId = null;
      const builder = {
        where(_sql, params) {
          tableId = params.tableId;
          return builder;
        },
        setLock(mode, version, aliases) {
          assert.equal(mode, 'pessimistic_write');
          assert.equal(version, undefined);
          assert.deepEqual(aliases, ['table']);
          return builder;
        },
        async getOne() {
          return tables.get(tableId) || null;
        },
      };
      return builder;
    },
    async save(value) {
      savedTableStatuses.push([value.id, value.status]);
      return value;
    },
  };

  const manager = {
    getRepository(entity) {
      if (entity === Booking) return bookingRepository;
      if (entity === BookingHistory) return historyRepository;
      if (entity === BookingTableAssignment) return assignmentRepository;
      if (entity === TableEntity) return tableRepository;
      throw new Error(`Unexpected repository ${entity?.name}`);
    },
  };

  const bookings = {
    manager: {
      async transaction(work) {
        return work(manager);
      },
    },
  };

  const service = new BookingsService(
    bookings,
    {},
    {},
    {},
    {},
    {},
    { async create() {} },
    { async notifyBookingCancelled() {} },
    {},
    {},
  );
  service.isBookingToday = () => true;

  const result = await service.cancel(targetBooking.id);

  assert.deepEqual(result, { message: 'Бронювання скасовано' });
  assert.equal(targetBooking.status, 'cancelled');
  assert.equal(savedHistory.length, 1);
  assert.equal(savedHistory[0].action, 'booking_cancelled');

  assert.equal(tables.get(TABLE_FREE).status, 'free');
  assert.equal(tables.get(TABLE_RESERVED).status, 'reserved');
  assert.equal(tables.get(TABLE_PENDING).status, 'pending');
  assert.deepEqual(savedTableStatuses, [
    [TABLE_FREE, 'free'],
    [TABLE_PENDING, 'pending'],
  ]);
});
