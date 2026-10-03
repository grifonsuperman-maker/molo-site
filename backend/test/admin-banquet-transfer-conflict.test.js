require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { AvailabilityBlocksService } = require('../dist/bookings/availability-blocks.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

test('Admin Plan transfer rejects a destination used as a banquet secondary table', async () => {
  const calls = [];
  let bookingSaved = false;
  const currentTable = {
    id: 'table-current',
    tableNumber: '4',
    seats: 4,
    status: 'reserved',
    isVisible: true,
    zone: { id: 'zone-1', isClosed: false, isVisible: true },
  };
  const nextTable = {
    id: 'table-secondary',
    tableNumber: '9',
    seats: 6,
    status: 'free',
    isVisible: true,
    zone: { id: 'zone-1', isClosed: false, isVisible: true },
  };
  const movingBooking = {
    id: 'booking-moving',
    status: 'approved',
    bookingDate: '2099-05-01',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    guestsCount: 2,
    table: currentTable,
    client: null,
  };
  const banquetBooking = {
    id: 'banquet-1',
    status: 'approved',
    bookingDate: '2099-05-01',
    bookingTime: '18:30:00',
    durationMinutes: 180,
  };
  const query = {
    leftJoinAndSelect(...args) {
      calls.push(['leftJoinAndSelect', ...args]);
      return this;
    },
    leftJoin(...args) {
      calls.push(['leftJoin', ...args]);
      return this;
    },
    where(...args) {
      calls.push(['where', ...args]);
      return this;
    },
    distinct(...args) {
      calls.push(['distinct', ...args]);
      return this;
    },
    andWhere(...args) {
      calls.push(['andWhere', ...args]);
      return this;
    },
    async getMany() {
      return [banquetBooking];
    },
  };
  const bookingRepository = {
    async findOne() {
      return movingBooking;
    },
    createQueryBuilder(alias) {
      assert.equal(alias, 'booking');
      return query;
    },
    async save() {
      bookingSaved = true;
      throw new Error('booking must not be moved into a banquet secondary table');
    },
  };
  const tableRepository = {
    async findOne({ where }) {
      if (where.id === nextTable.id) return nextTable;
      if (where.id === currentTable.id) return currentTable;
      return null;
    },
  };
  const manager = {
    async query(sql) {
      calls.push(['query', sql]);
      return [{ ready: true }];
    },
    getRepository(entity) {
      if (entity === Booking) return bookingRepository;
      if (entity === TableEntity) return tableRepository;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const dataSource = {
    async transaction(work) {
      return work(manager);
    },
  };
  const service = new AvailabilityBlocksService(
    dataSource,
    {},
    {},
    {},
    {},
    {},
    {},
    {},
  );

  await assert.rejects(
    () => service.transferBooking(
      movingBooking.id,
      { tableId: nextTable.id, reason: 'Перенесення Адміністратором' },
      { role: 'admin', staffId: 'admin-1', name: 'Admin' },
    ),
    /На новому столі вже є бронювання у цей час/,
  );

  assert.equal(bookingSaved, false);
  assert.ok(calls.some((call) =>
    call[0] === 'leftJoin' &&
    call[1] === 'booking.tableAssignments' &&
    call[2] === 'tableAssignment'
  ));
  assert.ok(calls.some((call) =>
    call[0] === 'where' &&
    String(call[1]).includes('assignedTable.id = :tableId')
  ));
});
