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


test('Admin Plan same-day transfer preserves a later banquet reservation on the old table', async () => {
  const bookingDate = '2099-05-01';
  const currentTable = {
    id: 'table-current',
    tableNumber: '4',
    seats: 4,
    status: 'reserved',
    isVisible: true,
    zone: { id: 'zone-1', isClosed: false, isVisible: true },
  };
  const nextTable = {
    id: 'table-next',
    tableNumber: '6',
    seats: 4,
    status: 'free',
    isVisible: true,
    zone: { id: 'zone-1', isClosed: false, isVisible: true },
  };
  const movingBooking = {
    id: 'booking-moving',
    status: 'approved',
    bookingDate,
    bookingTime: '19:00:00',
    durationMinutes: 120,
    guestsCount: 2,
    table: currentTable,
    client: null,
  };
  const assignment = {
    id: 'assignment-moving',
    booking: movingBooking,
    table: currentTable,
    isPrimary: true,
  };
  const remainingByTable = new Map([
    [currentTable.id, [{ id: 'later-banquet', status: 'approved' }]],
    [nextTable.id, [movingBooking]],
  ]);
  const tableSaves = [];
  const historySaves = [];
  let activeTableId = null;

  const bookingRepository = {
    async findOne() { return movingBooking; },
    createQueryBuilder(alias) {
      activeTableId = null;
      const query = {
        leftJoinAndSelect() { return query; },
        leftJoin() { return query; },
        where(_sql, params) {
          if (params?.tableId) activeTableId = params.tableId;
          return query;
        },
        andWhere() { return query; },
        distinct() { return query; },
        async getMany() {
          if (alias === 'booking') return [];
          assert.equal(alias, 'activeBooking');
          return remainingByTable.get(activeTableId) || [];
        },
      };
      return query;
    },
    async save(value) {
      return value;
    },
  };
  const tableRepository = {
    async findOne({ where }) {
      if (where.id === nextTable.id) return nextTable;
      if (where.id === currentTable.id) return currentTable;
      return null;
    },
    async save(value) {
      tableSaves.push([value.id, value.status]);
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
    async save(value) {
      return value;
    },
    create(value) { return value; },
  };
  const historyRepository = {
    create(value) { return value; },
    async save(value) {
      historySaves.push(value);
      return value;
    },
  };
  const availabilityRepository = {
    async find() { return []; },
  };
  const manager = {
    async query() { return [{ ready: true }]; },
    getRepository(entity) {
      if (entity === Booking) return bookingRepository;
      if (entity === TableEntity) return tableRepository;
      if (entity.name === 'BookingTableAssignment') return assignmentRepository;
      if (entity.name === 'BookingHistory') return historyRepository;
      if (entity.name === 'AvailabilityBlock') return availabilityRepository;
      throw new Error(`Unexpected repository: ${entity?.name}`);
    },
  };
  const service = new AvailabilityBlocksService(
    { async transaction(work) { return work(manager); } },
    {},
    {},
    {},
    {},
    {},
    { async create() {} },
    { async sendMessage() {} },
  );
  service.today = () => bookingDate;

  const result = await service.transferBooking(
    movingBooking.id,
    { tableId: nextTable.id, reason: 'Перенесення Адміністратором' },
    { role: 'admin', staffId: 'admin-1', name: 'Admin' },
  );

  assert.equal(result.booking.table.id, nextTable.id);
  assert.equal(assignment.table.id, nextTable.id);
  assert.equal(currentTable.status, 'reserved');
  assert.equal(nextTable.status, 'reserved');
  assert.equal(historySaves.length, 1);
  assert.ok(tableSaves.some(([id, status]) => id === nextTable.id && status === 'reserved'));
  assert.equal(
    tableSaves.some(([id, status]) => id === currentTable.id && status === 'free'),
    false,
  );
});

function createSimpleTransferFixture(destinationStatus = 'free', persisted = true) {
  const date = '2099-05-01';
  const oldTable = {
    id: 'table-41', tableNumber: '41', seats: 4, status: 'occupied', isVisible: true,
    zone: { id: 'zone-1', isClosed: false, isVisible: true },
  };
  const newTable = {
    id: 'table-42', tableNumber: '42', seats: 4, status: destinationStatus, isVisible: true,
    zone: { id: 'zone-1', isClosed: false, isVisible: true },
  };
  const booking = {
    id: 'booking-41', status: 'approved', bookingDate: date, bookingTime: '19:00:00',
    durationMinutes: 120, guestsCount: 2, table: oldTable, client: null,
  };
  const calls = { reads: 0, writes: 0, history: 0, logs: 0 };
  const bookingRepository = {
    async findOne() {
      calls.reads += 1;
      // The first read loads the booking; the second must reflect persisted storage.
      return calls.reads === 1 ? booking : { ...booking, table: persisted ? newTable : oldTable };
    },
    createQueryBuilder() {
      return {
        leftJoinAndSelect() { return this; },
        where() { return this; },
        andWhere() { return this; },
        distinct() { return this; },
        async getMany() { return []; },
      };
    },
    async save() { calls.writes += 1; },
  };
  const manager = {
    async query() { return [{ ready: false }]; },
    getRepository(entity) {
      if (entity === Booking) return bookingRepository;
      if (entity === TableEntity) return {
        async findOne({ where }) { return where.id === newTable.id ? newTable : oldTable; },
      };
      if (entity.name === 'AvailabilityBlock') return { async find() { return []; } };
      if (entity.name === 'BookingHistory') return {
        create(value) { return value; },
        async save() { calls.history += 1; },
      };
      throw new Error('Unexpected repository: ' + entity?.name);
    },
  };
  const service = new AvailabilityBlocksService(
    { async transaction(work) { return work(manager); } },
    {}, {}, {}, {}, {},
    { async create() { calls.logs += 1; } },
    { async sendMessage() {} },
  );
  service.today = () => date;
  return { service, booking, oldTable, newTable, calls };
}

test('Admin Plan does not acknowledge table 41 to 42 transfer without a persisted booking change', async () => {
  const { service, booking, newTable, calls } = createSimpleTransferFixture('free', false);
  // Use a future date so this test only exercises persistence read-back.
  service.today = () => '2099-04-30';
  await assert.rejects(
    () => service.transferBooking(booking.id, { tableId: newTable.id }, { role: 'admin' }),
    /Зміну столу не підтверджено у бронюванні/,
  );
  assert.equal(calls.reads, 2, 'the service must read the booking back after saving');
  assert.equal(calls.writes, 1);
  assert.equal(calls.history, 0, 'do not write a completed transfer history');
  assert.equal(calls.logs, 0, 'do not report a successful transfer');
});

test('Admin Plan refuses occupied or cleaning destinations for a booking today', async () => {
  for (const status of ['occupied', 'cleaning']) {
    const { service, booking, oldTable, newTable, calls } = createSimpleTransferFixture(status);
    await assert.rejects(
      () => service.transferBooking(booking.id, { tableId: newTable.id }, { role: 'admin' }),
      /Новий стіл зараз зайнятий або готується/,
    );
    assert.equal(calls.writes, 0);
    assert.equal(calls.reads, 1);
    assert.equal(booking.table.id, oldTable.id, 'the old reservation must remain assigned');
  }
});
