require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const { BookingHistory } = require('../dist/bookings/entities/booking-history.entity.js');
const { BookingTableAssignment } = require('../dist/bookings/entities/booking-table-assignment.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');

test('legacy admin transfer preserves a later banquet reservation on the old table', async () => {
  const bookingDate = '2099-05-01';
  const oldTable = {
    id: 'table-old',
    tableNumber: '4',
    seats: 4,
    status: 'reserved',
    isVisible: true,
  };
  const nextTable = {
    id: 'table-next',
    tableNumber: '6',
    seats: 4,
    status: 'free',
    isVisible: true,
  };
  const movingBooking = {
    id: 'booking-moving',
    status: 'approved',
    bookingDate,
    bookingTime: '19:00:00',
    durationMinutes: 120,
    guestsCount: 2,
    table: oldTable,
    client: null,
    checkedInAt: null,
  };
  const assignment = {
    id: 'assignment-moving',
    booking: movingBooking,
    table: oldTable,
    isPrimary: true,
  };
  const remainingByTable = new Map([
    [oldTable.id, [{ id: 'later-banquet', status: 'approved' }]],
    [nextTable.id, [movingBooking]],
  ]);
  const tableSaves = [];
  let queryTableId = null;

  const bookingRepository = {
    async findOne() { return movingBooking; },
    async save(value) { return value; },
    createQueryBuilder(alias) {
      assert.equal(alias, 'activeBooking');
      queryTableId = null;
      const query = {
        leftJoin() { return query; },
        where(_sql, params) {
          queryTableId = params?.tableId || queryTableId;
          return query;
        },
        andWhere() { return query; },
        distinct() { return query; },
        async getMany() {
          return remainingByTable.get(queryTableId) || [];
        },
      };
      return query;
    },
  };
  const tableRepository = {
    async findOne({ where }) {
      if (where.id === oldTable.id) return oldTable;
      if (where.id === nextTable.id) return nextTable;
      return null;
    },
    async save(value) {
      if (Array.isArray(value)) {
        for (const item of value) tableSaves.push([item.id, item.status]);
      } else {
        tableSaves.push([value.id, value.status]);
      }
      return value;
    },
  };
  const assignmentRepository = {
    createQueryBuilder(alias) {
      assert.equal(alias, 'assignment');
      const query = {
        innerJoinAndSelect() { return query; },
        where() { return query; },
        setLock() { return query; },
        async getMany() { return [assignment]; },
      };
      return query;
    },
    async save(value) { return value; },
    create(value) { return value; },
  };
  const historyRepository = {
    create(value) { return value; },
    async save(value) { return value; },
  };
  const manager = {
    async query() { return [{ ready: true }]; },
    getRepository(entity) {
      if (entity === Booking) return bookingRepository;
      if (entity === TableEntity) return tableRepository;
      if (entity === BookingTableAssignment) return assignmentRepository;
      if (entity === BookingHistory) return historyRepository;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const waiterCalls = {
    closed: 0,
    closeActiveCallsAndDetachBooking() { this.closed += 1; },
  };
  const service = new BookingsService(
    { manager: { async transaction(work) { return work(manager); } } },
    {},
    {},
    {},
    {},
    {},
    { async create() {} },
    {},
    waiterCalls,
    {},
  );
  service.restaurantDateToday = () => bookingDate;
  service.checkAvailability = async () => ({ isAvailable: true });

  const result = await service.waiterTransfer(
    movingBooking.id,
    nextTable.id,
    { role: 'admin', staffId: 'admin-1', name: 'Admin' },
  );

  assert.deepEqual(result, { message: 'Гостей пересаджено на новий стіл' });
  assert.equal(movingBooking.table.id, nextTable.id);
  assert.equal(assignment.table.id, nextTable.id);
  assert.equal(oldTable.status, 'reserved');
  assert.equal(nextTable.status, 'reserved');
  assert.equal(waiterCalls.closed, 1);
  assert.ok(tableSaves.some(([id, status]) => id === nextTable.id && status === 'reserved'));
  assert.equal(
    tableSaves.some(([id, status]) => id === oldTable.id && status === 'free'),
    false,
  );
});
