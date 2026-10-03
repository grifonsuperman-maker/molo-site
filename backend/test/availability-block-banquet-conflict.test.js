require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { AvailabilityBlocksService } = require('../dist/bookings/availability-blocks.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');

function createHarness({ ready = true, target = 'table', conflicts = true } = {}) {
  const calls = [];
  let blockSaved = false;
  const banquet = {
    id: 'banquet-1',
    bookingDate: '2099-05-01',
    bookingTime: '19:00:00',
    durationMinutes: 180,
    status: 'approved',
    table: { id: 'table-primary', tableNumber: '8' },
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
    andWhere(...args) {
      calls.push(['andWhere', ...args]);
      return this;
    },
    distinct(...args) {
      calls.push(['distinct', ...args]);
      return this;
    },
    orderBy(...args) {
      calls.push(['orderBy', ...args]);
      return this;
    },
    async getMany() {
      return conflicts ? [banquet] : [];
    },
  };

  const manager = {
    async query() {
      return [{ ready }];
    },
    getRepository(entity) {
      assert.equal(entity, Booking);
      return {
        createQueryBuilder(alias) {
          assert.equal(alias, 'booking');
          return query;
        },
      };
    },
  };

  const blocks = {
    manager,
    async find() { return []; },
    create(value) { return value; },
    async save(value) {
      blockSaved = true;
      return { id: 'block-1', ...value };
    },
    async findOne() { return null; },
  };
  const bookings = { manager };
  const tables = {
    async findOne() {
      return target === 'table'
        ? {
            id: 'table-secondary',
            tableNumber: '9',
            zone: { id: 'zone-a', name: 'Зал A' },
          }
        : null;
    },
  };
  const zones = {
    async findOne() {
      return target === 'zone' ? { id: 'zone-a', name: 'Зал A' } : null;
    },
  };
  const service = new AvailabilityBlocksService(
    {},
    blocks,
    bookings,
    {},
    tables,
    zones,
    { async create() {} },
    { async sendMessage() {} },
  );
  service.today = () => '2099-01-01';

  return { service, manager, calls, get blockSaved() { return blockSaved; } };
}

test('availability block cannot cover a banquet secondary table', async () => {
  const h = createHarness({ target: 'table' });

  await assert.rejects(
    () => h.service.create({
      tableId: 'table-secondary',
      blockDate: '2099-05-01',
      startTime: '19:30',
      endTime: '20:00',
      reason: 'Технічні роботи',
    }),
    /Є активні бронювання/,
  );

  assert.equal(h.blockSaved, false);
  assert.ok(h.calls.some((call) =>
    call[0] === 'leftJoin' &&
    call[1] === 'booking.tableAssignments' &&
    call[2] === 'tableAssignment'
  ));
  assert.ok(h.calls.some((call) =>
    call[0] === 'andWhere' &&
    String(call[1]).includes('assignedTable.id = :tableId')
  ));
});

test('availability block cannot cover a zone containing a banquet secondary table', async () => {
  const h = createHarness({ target: 'zone' });

  await assert.rejects(
    () => h.service.create({
      zoneId: 'zone-a',
      blockDate: '2099-05-01',
      startTime: '19:30',
      endTime: '20:00',
      reason: 'Закриття локації',
    }),
    /Є активні бронювання/,
  );

  assert.equal(h.blockSaved, false);
  assert.ok(h.calls.some((call) =>
    call[0] === 'leftJoin' &&
    call[1] === 'assignedTable.zone' &&
    call[2] === 'assignedZone'
  ));
  assert.ok(h.calls.some((call) =>
    call[0] === 'andWhere' &&
    String(call[1]).includes('assignedZone.id = :zoneId')
  ));
});

test('availability block keeps legacy primary-table query before assignment schema adoption', async () => {
  const h = createHarness({ ready: false, target: 'table', conflicts: false });

  const result = await h.service.findBookingConflicts(
    h.manager,
    '2099-05-01',
    'table-secondary',
    null,
    '19:30:00',
    '20:00:00',
  );

  assert.deepEqual(result, []);
  assert.equal(
    h.calls.some((call) => call[0] === 'leftJoin' && call[1] === 'booking.tableAssignments'),
    false,
  );
  assert.ok(h.calls.some((call) =>
    call[0] === 'andWhere' && call[1] === 'table.id = :tableId'
  ));
});
