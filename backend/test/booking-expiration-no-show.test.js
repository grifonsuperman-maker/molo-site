require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingExpirationService,
} = require('../dist/bookings/booking-expiration.service.js');

function createService(expiredBookings) {
  const calls = [];
  let findCalls = 0;
  const bookings = {
    async find() {
      findCalls += 1;
      calls.push(['bookings.find', findCalls]);
      return findCalls === 1 ? expiredBookings : [];
    },
    async save(values) {
      calls.push(['bookings.save', values.map((value) => value.id)]);
      return values;
    },
  };
  const tables = {
    async findOne() {
      calls.push(['tables.findOne']);
      return { id: 'table-1', status: 'reserved' };
    },
    async save(value) {
      calls.push(['tables.save', value.status]);
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
