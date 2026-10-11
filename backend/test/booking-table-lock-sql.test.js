require('reflect-metadata');

const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { before, test } = require('node:test');
const { NotFoundException } = require('@nestjs/common');
const { DataSource } = require('typeorm');

const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { GuestBookingsService } = require('../dist/bookings/guest-bookings.service.js');
const { AvailabilityBlocksService } = require('../dist/bookings/availability-blocks.service.js');
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

for (const entryPoint of ['planner', 'legacy']) {
  test(`${entryPoint} transfer locks only its primary rows with nullable relations`, async () => {
    const captured = [];
    const booking = {
      id: BOOKING_ID, status: 'approved', bookingDate: '2099-05-01',
      table: { id: TABLE_ID, tableNumber: '46' },
    };
    const manager = {
      getRepository(entity) {
        return {
          async findOne(options) {
            const alias = entity === Booking ? 'moving_booking' : 'destination_table';
            const query = source.getRepository(entity).createQueryBuilder(alias)
              .setFindOptions({ ...options, take: 1 });
            const sql = query.getSql();
            assert.equal(query.expressionMap.lockMode, 'pessimistic_write');
            if (options.relations?.length) {
              assert.deepEqual(query.expressionMap.lockTables, [`"${alias}"`]);
              assert.ok(sql.endsWith(` FOR UPDATE OF "${alias}"`), sql);
              assert.match(sql, /LEFT JOIN/);
            } else {
              assert.match(sql, / FOR UPDATE$/);
            }
            captured.push(entity);
            return entity === Booking ? booking : null;
          },
        };
      },
      async transaction(work) { return work(manager); },
    };
    const bookings = { manager };
    const planner = new AvailabilityBlocksService(manager, {}, {}, {}, {}, {}, {}, {});
    const legacy = new BookingsService(bookings, {}, {}, {}, {}, {}, {}, {}, {}, {});
    legacy.restaurantDateToday = () => booking.bookingDate;
    const action = entryPoint === 'planner'
      ? () => planner.transferBooking(BOOKING_ID, { tableId: TABLE_ID }, { role: 'admin' })
      : () => legacy.waiterTransfer(BOOKING_ID, TABLE_ID, { role: 'admin' });

    await assert.rejects(action, /Новий стіл закритий або недоступний|Обраний стіл закритий або зайнятий/);
    assert.deepEqual(captured, [Booking, TableEntity]);
  });
}
