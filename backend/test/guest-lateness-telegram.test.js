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
  const rescheduleRequest = {
    id: 'reschedule-1',
    booking: {
      id: 'booking-1',
      bookingDate: '2026-08-16',
      bookingTime: '16:37',
      table: { tableNumber: '8' },
      client: { fullName: 'Гість', phone: '+380000000000' },
    },
    requestedDate: '2026-08-16',
    requestedTime: '16:52:00',
    status: 'pending',
  };

  const guestService = {
    async reportLateness(id, token, dto) {
      calls.push({ type: 'report', id, token, dto });
      return {
        message: 'Адміністратора та офіціанта повідомлено про запізнення',
        booking,
        rescheduleRequest,
      };
    },
  };

  const notifications = {
    async notifyRescheduleRequest(payload) {
      calls.push({ type: 'notify', payload });
      if (notificationError) throw notificationError;
    },
  };

  return {
    booking,
    rescheduleRequest,
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

test('guest lateness sends the pending reschedule request to Telegram after report succeeds', async () => {
  const { booking, rescheduleRequest, calls, controller } = createController();

  const result = await controller.guestLateness(
    'booking-1',
    'guest-token',
    { hours: 0, minutes: 15 },
  );

  assert.deepEqual(calls.map((call) => call.type), ['report', 'notify']);
  assert.equal(calls[1].payload, rescheduleRequest);
  assert.equal(result.message, 'Запит на перенесення надіслано адміністратору');
  assert.equal(result.booking, booking);
  assert.equal('rescheduleRequest' in result, false);
});

test('Telegram failure does not undo an already saved guest lateness reschedule request', async () => {
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
    assert.equal(result.message, 'Запит на перенесення надіслано адміністратору');
    assert.equal(result.booking, booking);
    assert.equal('rescheduleRequest' in result, false);
  } finally {
    console.error = originalConsoleError;
  }
});
