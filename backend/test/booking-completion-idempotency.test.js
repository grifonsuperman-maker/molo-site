require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { BookingHistory } = require('../dist/bookings/entities/booking-history.entity.js');
const { BookingTableAssignment } = require('../dist/bookings/entities/booking-table-assignment.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

function scenario({ status = 'approved', remaining = [] } = {}) {
  const tables = [
    { id: 'table-1', tableNumber: '1', status: 'occupied' },
    { id: 'table-2', tableNumber: '2', status: 'occupied' },
  ];
  const booking = {
    id: 'booking-1', status, bookingDate: '2026-10-11', bookingTime: '18:00:00',
    table: tables[0], client: null, checkedInAt: new Date(), completedAt: null,
  };
  const history = [], writes = [], logs = [];
  let tableReads = 0;
  let transactionTail = Promise.resolve();
  const bookingRepository = {
    createQueryBuilder(alias) {
      let tableId, locked = false;
      return {
        leftJoinAndSelect() { return this; },
        leftJoin() { return this; },
        where(_sql, params) { tableId = params?.tableId; return this; },
        andWhere() { return this; },
        distinct() { return this; },
        setLock(mode, _version, aliases) {
          assert.equal(mode, 'pessimistic_write');
          assert.deepEqual(aliases, ['booking']);
          locked = true;
          return this;
        },
        async getOne() {
          assert.equal(alias, 'booking');
          assert.ok(locked, 'read the current booking inside the row lock');
          return booking;
        },
        async getMany() {
          assert.equal(alias, 'activeBooking');
          assert.ok(tableId);
          return remaining;
        },
      };
    },
    async save(value) { writes.push(['booking', value.status]); return value; },
  };
  const tableRepository = {
    createQueryBuilder() {
      let tableId;
      return {
        where(_sql, params) { tableId = params.tableId; return this; },
        setLock() { return this; },
        async getOne() {
          tableReads += 1;
          return tables.find(table => table.id === tableId);
        },
      };
    },
    async save(value) { writes.push([value.id, value.status]); return value; },
  };
  const manager = {
    async query() { return [{ ready: true }]; },
    getRepository(entity) {
      if (entity === Booking) return bookingRepository;
      if (entity === TableEntity) return tableRepository;
      if (entity === BookingHistory) return {
        create: value => value,
        async save(value) { history.push(value); return value; },
      };
      if (entity === BookingTableAssignment) return {
        async find() { return tables.map(table => ({ booking, table })); },
      };
      throw new Error(`Unexpected repository ${entity.name}`);
    },
    transaction(work) {
      // Model PostgreSQL serialization of competing requests for this booking.
      const result = transactionTail.then(() => work(manager));
      transactionTail = result.catch(() => {});
      return result;
    },
  };
  bookingRepository.manager = manager;
  const service = new BookingsService(bookingRepository, {}, {}, {}, {}, {},
    { async create(...args) { logs.push(args); } }, {}, {}, {});
  service.isBookingToday = () => true;
  return { service, booking, tables, history, writes, logs, tableReads: () => tableReads };
}

test('a repeated completion preserves new physical statuses on every banquet table', async () => {
  const h = scenario();
  assert.deepEqual(await h.service.complete(h.booking.id), { message: 'Стіл звільнено' });
  assert.ok(h.tables.every(table => table.status === 'free'));
  const completedAt = h.booking.completedAt;
  const originalWrites = h.writes.length;
  const originalReads = h.tableReads();

  for (const status of ['occupied', 'cleaning', 'closed', 'reserved', 'pending', 'free']) {
    h.tables.forEach(table => table.status = status);
    assert.deepEqual(await h.service.complete(h.booking.id), { message: 'Бронювання вже завершено' });
    assert.ok(h.tables.every(table => table.status === status));
  }

  assert.equal(h.booking.completedAt, completedAt);
  assert.equal(h.history.length, 1);
  assert.equal(h.logs.length, 1);
  assert.equal(h.writes.length, originalWrites);
  assert.equal(h.tableReads(), originalReads);
});

test('a delayed completion preserves occupancy from a new checked-in booking', async () => {
  const h = scenario({ remaining: [{ id: 'new-booking', status: 'approved', checkedInAt: new Date() }] });
  await h.service.complete(h.booking.id);
  h.tables.forEach(table => table.status = 'occupied');
  await h.service.complete(h.booking.id);
  assert.ok(h.tables.every(table => table.status === 'occupied'));
  assert.equal(h.history.length, 1);
});

test('simultaneous completion requests release the table and write history once', async () => {
  const h = scenario();
  const results = await Promise.all([
    h.service.complete(h.booking.id, { role: 'admin', staffId: 'admin-1' }),
    h.service.complete(h.booking.id, { role: 'waiter', staffId: 'waiter-1' }),
  ]);
  assert.deepEqual(results.map(result => result.message), ['Стіл звільнено', 'Бронювання вже завершено']);
  assert.equal(h.history.length, 1);
  assert.equal(h.history[0].actorStaffId, 'admin-1');
  assert.equal(h.logs.length, 1);
  assert.equal(h.writes.filter(([id]) => id === 'booking').length, 1);
  assert.equal(h.tableReads(), 2);
});

for (const status of ['cancelled', 'rejected']) {
  test(`completion of an archived ${status} booking cannot release new guests`, async () => {
    const h = scenario({ status });
    await assert.rejects(() => h.service.complete(h.booking.id), /Завершити можна лише активне бронювання/);
    assert.equal(h.booking.status, status);
    assert.ok(h.tables.every(table => table.status === 'occupied'));
    assert.equal(h.history.length, 0);
    assert.equal(h.logs.length, 0);
    assert.equal(h.writes.length, 0);
  });
}
