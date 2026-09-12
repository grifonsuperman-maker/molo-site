require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCoordinatedBookingsService,
} = require('../dist/bookings/coordinated-bookings.provider.js');

test('all BookingsService check-in callers use the shared arrival lock', async () => {
  const calls = [];
  const rawBookings = {
    async checkIn(id, actor) {
      calls.push(['raw.checkIn', id, actor?.role || null]);
      return { message: 'ok' };
    },
    async getToday() {
      calls.push(['raw.getToday']);
      return [];
    },
  };
  const arrivalLock = {
    async withCheckInLock(id, work) {
      calls.push(['lock', id]);
      return work();
    },
  };

  const coordinated = createCoordinatedBookingsService(
    rawBookings,
    arrivalLock,
  );

  const result = await coordinated.checkIn('booking-1', { role: 'waiter' });
  assert.deepEqual(result, { message: 'ok' });
  assert.deepEqual(calls, [
    ['lock', 'booking-1'],
    ['raw.checkIn', 'booking-1', 'waiter'],
  ]);

  calls.length = 0;
  await coordinated.getToday();
  assert.deepEqual(calls, [['raw.getToday']]);
});
