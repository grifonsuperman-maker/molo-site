require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingExpirationService,
} = require('../dist/bookings/booking-expiration.service.js');

function createService(expiredBookings, { assignmentsReady = false, tableStatuses = {} } = {}) {
  const calls = [];
  let findCalls = 0;
  const bookings = {
    manager: {
      async query() {
        return [{ ready: assignmentsReady }];
      },
    },
    async find() {
      findCalls += 1;
      calls.push(['bookings.find', findCalls]);
      return findCalls === 1 ? expiredBookings : [];
    },
    async save(values) {
      calls.push(['bookings.save', values.map((value) => value.id)]);
      return values;
    },
    createQueryBuilder() {
      const query = {
        leftJoinAndSelect() { return query; },
        leftJoin() { return query; },
        where() { return query; },
        andWhere() { return query; },
        distinct() { return query; },
        orderBy() { return query; },
        async getMany() { return []; },
      };
      return query;
    },
  };
  const tables = {
    async findOne({ where }) {
      calls.push(['tables.findOne', where.id]);
      return {
        id: where.id,
        status: tableStatuses[where.id] || 'reserved',
      };
    },
    async save(value) {
      calls.push(['tables.save', value.id, value.status]);
      return value;
    },
  };
  const service = new BookingExpirationService(bookings, tables);
  service.getKyivDate = () => '2026-08-28';
  return { service, calls };
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
  assert.ok(!calls.some((call) => call[0] === 'bookings.save'));
});

test('day rollover still completes an approved booking that actually checked in', async () => {
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
  assert.ok(calls.some((call) => call[0] === 'bookings.save'));
});


test('overnight completion releases every banquet table assignment', async () => {
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
  const { service, calls } = createService([booking], {
    assignmentsReady: true,
  });

  await service.completeExpiredBookings();

  assert.equal(booking.status, 'completed');
  const releasedIds = calls
    .filter((call) => call[0] === 'tables.save' && call[2] === 'free')
    .map((call) => call[1])
    .sort();
  assert.deepEqual(releasedIds, ['table-1', 'table-2']);
});
