require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsService } = require('../dist/bookings/bookings.service.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const {
  BookingRescheduleRequest,
} = require('../dist/bookings/entities/booking-reschedule-request.entity.js');

function createHarness(status = 'pending') {
  const booking = {
    id: 'booking-1',
    status: 'approved',
    bookingDate: '2026-08-29',
    bookingTime: '19:00:00',
    client: { telegramId: 'guest-telegram-1' },
    guestNotification: null,
  };
  const request = {
    id: 'reschedule-1',
    status,
    booking: { id: booking.id },
    adminComment: null,
    resolvedAt: null,
  };
  const observed = {
    transaction: false,
    transactionCompleted: false,
    lockOrder: [],
    requestSaves: 0,
    bookingSaves: 0,
    guestNotifications: [],
  };

  const requestRepository = {
    async findOne(options) {
      if (options?.lock?.mode) observed.lockOrder.push('request');
      return options?.where?.id === request.id ? request : null;
    },
    async save(value) {
      observed.requestSaves += 1;
      return value;
    },
  };
  const bookingRepository = {
    async findOne(options) {
      if (options?.lock?.mode) observed.lockOrder.push('booking');
      return options?.where?.id === booking.id ? booking : null;
    },
    async save(value) {
      observed.bookingSaves += 1;
      return value;
    },
  };

  const manager = {
    getRepository(entity) {
      if (entity === BookingRescheduleRequest) return requestRepository;
      if (entity === Booking) return bookingRepository;
      throw new Error('Unexpected repository');
    },
  };

  const reschedules = {
    manager: {
      async transaction(callback) {
        observed.transaction = true;
        try {
          return await callback(manager);
        } finally {
          observed.transactionCompleted = true;
        }
      },
    },
  };
  const notifications = {
    async notifyGuestRescheduleDecision(payload) {
      assert.equal(observed.transactionCompleted, true);
      observed.guestNotifications.push(payload);
    },
  };

  const service = new BookingsService(
    {},
    {},
    reschedules,
    {},
    {},
    {},
    {},
    notifications,
    {},
  );

  return { booking, request, observed, service };
}

test('reschedule rejection locks booking before request and publishes guest decision after commit', async () => {
  const { booking, request, observed, service } = createHarness('pending');

  const result = await service.rejectReschedule('reschedule-1', {
    adminComment: 'Час уже зайнятий',
  });

  assert.equal(observed.transaction, true);
  assert.equal(observed.transactionCompleted, true);
  assert.deepEqual(observed.lockOrder, ['booking', 'request']);
  assert.equal(observed.requestSaves, 1);
  assert.equal(observed.bookingSaves, 1);
  assert.equal(request.status, 'rejected');
  assert.equal(request.adminComment, 'Час уже зайнятий');
  assert.ok(request.resolvedAt instanceof Date);
  assert.equal(booking.bookingTime, '19:00:00');
  assert.equal(booking.guestNotification.type, 'reschedule_decision');
  assert.equal(booking.guestNotification.decision, 'rejected');
  assert.match(booking.guestNotification.message, /19:00/);
  assert.match(booking.guestNotification.message, /Час уже зайнятий/);
  assert.deepEqual(observed.guestNotifications, [
    {
      telegramId: 'guest-telegram-1',
      decision: 'rejected',
      bookingDate: '2026-08-29',
      bookingTime: '19:00:00',
      adminComment: 'Час уже зайнятий',
    },
  ]);
  assert.deepEqual(result, { message: 'Перенесення відхилено' });
});

test('stale reject cannot overwrite an already processed reschedule', async () => {
  const { booking, request, observed, service } = createHarness('approved');

  await assert.rejects(
    () => service.rejectReschedule('reschedule-1', { adminComment: 'Запізніле рішення' }),
    (error) => {
      assert.equal(error?.getStatus?.(), 400);
      assert.equal(error?.message, 'Цей запит уже опрацьовано');
      return true;
    },
  );

  assert.equal(observed.transaction, true);
  assert.deepEqual(observed.lockOrder, ['booking', 'request']);
  assert.equal(observed.requestSaves, 0);
  assert.equal(observed.bookingSaves, 0);
  assert.equal(request.status, 'approved');
  assert.equal(request.adminComment, null);
  assert.equal(request.resolvedAt, null);
  assert.equal(booking.guestNotification, null);
  assert.deepEqual(observed.guestNotifications, []);
});
