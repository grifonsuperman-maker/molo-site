require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { ConflictException } = require('@nestjs/common');

const { BookingsService } = require('../dist/bookings/bookings.service.js');

function createService(requestStatus = 'pending') {
  const booking = {
    id: 'booking-1',
    bookingDate: '2026-08-28',
    bookingTime: '19:00:00',
    guestNotification: null,
  };
  const request = {
    id: 'reschedule-1',
    booking: { id: booking.id },
    status: requestStatus,
    adminComment: null,
    resolvedAt: null,
  };

  const locks = [];
  const saves = [];
  let transactions = 0;

  const bookingRepository = {
    async findOne(options) {
      if (options?.lock) locks.push({ entity: 'Booking', lock: options.lock });
      return booking;
    },
    async save(value) {
      saves.push({ entity: 'Booking', value });
      return value;
    },
  };

  const requestRepository = {
    async findOne(options) {
      if (options?.lock) locks.push({ entity: 'BookingRescheduleRequest', lock: options.lock });
      return request;
    },
    async save(value) {
      saves.push({ entity: 'BookingRescheduleRequest', value });
      return value;
    },
  };

  const manager = {
    getRepository(entity) {
      if (entity.name === 'Booking') return bookingRepository;
      if (entity.name === 'BookingRescheduleRequest') return requestRepository;
      throw new Error(`Unexpected repository: ${entity.name}`);
    },
  };

  const bookingsRepository = {
    manager: {
      async transaction(work) {
        transactions += 1;
        return work(manager);
      },
    },
  };

  const service = new BookingsService(
    bookingsRepository,
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
  );

  return { service, booking, request, locks, saves, getTransactions: () => transactions };
}

test('reschedule rejection is atomic, preserves the booking slot and notifies the guest', async () => {
  const state = createService('pending');
  const originalDate = state.booking.bookingDate;
  const originalTime = state.booking.bookingTime;

  const result = await state.service.rejectReschedule('reschedule-1', {
    adminComment: '  На цей час уже немає можливості перенесення.  ',
  });

  assert.deepEqual(result, { message: 'Перенесення відхилено' });
  assert.equal(state.getTransactions(), 1);
  assert.equal(state.booking.bookingDate, originalDate);
  assert.equal(state.booking.bookingTime, originalTime);
  assert.equal(state.request.status, 'rejected');
  assert.equal(state.request.adminComment, 'На цей час уже немає можливості перенесення.');
  assert.ok(state.request.resolvedAt instanceof Date);
  assert.equal(state.booking.guestNotification.type, 'booking_updated');
  assert.equal(state.booking.guestNotification.title, 'Перенесення відхилено');
  assert.equal(
    state.booking.guestNotification.message,
    'На цей час уже немає можливості перенесення.',
  );
  assert.deepEqual(state.locks, [
    { entity: 'Booking', lock: { mode: 'pessimistic_write' } },
    { entity: 'BookingRescheduleRequest', lock: { mode: 'pessimistic_write' } },
  ]);
  assert.deepEqual(state.saves.map((item) => item.entity), [
    'Booking',
    'BookingRescheduleRequest',
  ]);
});

for (const processedStatus of ['approved', 'rejected']) {
  test(`reschedule rejection cannot overwrite an already ${processedStatus} request`, async () => {
    const state = createService(processedStatus);

    await assert.rejects(
      () => state.service.rejectReschedule('reschedule-1', {}),
      (error) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.message, 'Цей запит уже опрацьовано');
        return true;
      },
    );

    assert.equal(state.request.status, processedStatus);
    assert.equal(state.saves.length, 0);
  });
}
