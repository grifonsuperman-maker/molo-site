require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingsController,
} = require('../dist/bookings/bookings.controller.js');

function createController({ notificationError = null } = {}) {
  const calls = [];
  const booking = {
    bookingId: 'booking-1',
    tableNumber: '8',
    bookingDate: '2026-08-16',
    bookingTime: '16:37',
    latenessHours: 0,
    latenessMinutes: 15,
  };

  const guestService = {
    async reportLateness(id, token, dto) {
      calls.push({ type: 'report', id, token, dto });
      return {
        message: 'Адміністратора та офіціанта повідомлено про запізнення',
        booking,
      };
    },
  };

  const notifications = {
    async notifyGuestReportedLateness(payload) {
      calls.push({ type: 'notify', payload });
      if (notificationError) throw notificationError;
    },
  };

  return {
    booking,
    calls,
    controller: new BookingsController(
      {},
      guestService,
      {},
      {},
      {},
      {},
      notifications,
    ),
  };
}

test('guest lateness sends the saved booking to Telegram notification after report succeeds', async () => {
  const { booking, calls, controller } = createController();

  const result = await controller.guestLateness(
    'booking-1',
    'guest-token',
    { hours: 0, minutes: 15 },
  );

  assert.deepEqual(calls.map((call) => call.type), ['report', 'notify']);
  assert.equal(calls[1].payload, booking);
  assert.equal(result.message, 'Адміністратора повідомлено про запізнення');
  assert.equal(result.booking, booking);
});

test('Telegram failure does not undo an already saved guest lateness report', async () => {
  const { booking, calls, controller } = createController({
    notificationError: new Error('telegram unavailable'),
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const result = await controller.guestLateness(
      'booking-1',
      'guest-token',
      { hours: 0, minutes: 15 },
    );

    assert.deepEqual(calls.map((call) => call.type), ['report', 'notify']);
    assert.equal(result.message, 'Адміністратора повідомлено про запізнення');
    assert.equal(result.booking, booking);
  } finally {
    console.error = originalConsoleError;
  }
});
