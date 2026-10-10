require('reflect-metadata');

const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { before, test } = require('node:test');
const { NotFoundException } = require('@nestjs/common');
const { DataSource } = require('typeorm');

const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { GuestBookingsService } = require('../dist/bookings/guest-bookings.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { BookingHistory } = require('../dist/bookings/entities/booking-history.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

// Build the real PostgreSQL metadata and SQL without opening a database connection.
const source = new DataSource({
  type: 'postgres',
  entities: [resolve(__dirname, '../dist/**/*.entity.js')],
});
before(async () => source.buildMetadatas());

const STOP_AFTER_SQL = new NotFoundException('table lock SQL captured');
const TABLE_ID = '11111111-1111-4111-8111-111111111111';
const BOOKING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function harness({ assignmentsReady = false } = {}) {
  const booking = {
    id: BOOKING_ID, status: 'approved', bookingDate: '2026-10-10',
    bookingTime: '16:00:00', durationMinutes: 120, wishes: '',
    table: { id: TABLE_ID, tableNumber: '46', status: 'reserved' },
  };
  const bookingQuery = {
    leftJoinAndSelect() { return this; },
    where() { return this; },
    andWhere() { return this; },
    setLock() { return this; },
    async getOne() { return booking; },
  };
  const bookings = {
    createQueryBuilder() { return bookingQuery; },
    async save(value) { return value; },
  };
  const tables = {
    createQueryBuilder(alias) {
      const query = source.getRepository(TableEntity).createQueryBuilder(alias);
      const capture = async () => {
        const sql = query.getSql();
        // TypeORM appends lockTables verbatim: unquoted TABLE is a PostgreSQL keyword.
        assert.doesNotMatch(sql, / FOR UPDATE OF table(?:\s|$)/,
          'physical table lock must not emit the reserved keyword TABLE unquoted');
        assert.match(sql, / FOR UPDATE OF (?:"[a-z_]+"|[a-z_]+)$/i);
        assert.equal(query.expressionMap.lockMode, 'pessimistic_write');
        assert.deepEqual(query.expressionMap.lockTables.map((name) => name.replaceAll('"', '')), [alias],
          'lock only the selected physical table, excluding nullable zone joins');
        throw STOP_AFTER_SQL;
      };
      query.getOne = capture;
      query.getMany = capture;
      return query;
    },
  };
  const histories = { create: (value) => value, save: async (value) => value };
  const manager = {
    async query() { return [{ ready: assignmentsReady }]; },
    async transaction(work) { return work(manager); },
    getRepository(entity) {
      if (entity === Booking) return bookings;
      if (entity === BookingHistory) return histories;
      if (entity === TableEntity) return tables;
      return {};
    },
  };
  bookings.manager = manager;
  return { bookings, manager };
}

for (const action of ['cancel', 'reject', 'noShow', 'complete']) {
  test(`${action} generates a valid PostgreSQL physical-table lock`, async () => {
    const { bookings } = harness();
    const service = new BookingsService(bookings, {}, {}, {}, {}, {}, {}, {}, {}, {});
    service.isBookingToday = () => true;
    await assert.rejects(service[action](BOOKING_ID), (error) => error === STOP_AFTER_SQL);
  });
}

test('banquet creation locks physical rows without locking their nullable zones', async () => {
  const { bookings } = harness({ assignmentsReady: true });
  const service = new BookingsService(bookings, {}, {}, {}, {}, {}, {}, {}, {}, {});
  await assert.rejects(service.createManualBanquet({
    tableIds: [TABLE_ID, '22222222-2222-4222-8222-222222222222'],
    primaryTableId: TABLE_ID, bookingDate: '2026-10-10', bookingTime: '16:00',
    fullName: 'Тест', guestsCount: 8,
  }), (error) => error === STOP_AFTER_SQL);
});

for (const destination of [{ tableId: TABLE_ID }, { tableNumber: '46' }]) {
  test(`guest table selection by ${Object.keys(destination)[0]} generates a valid physical-table lock`, async () => {
    const { bookings, manager } = harness();
    const service = new GuestBookingsService(bookings, {}, {}, manager);
    await assert.rejects(service.changeTable(BOOKING_ID, 'synthetic-test-token', destination),
      (error) => error === STOP_AFTER_SQL);
  });
}
