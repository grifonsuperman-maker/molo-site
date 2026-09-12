require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AutomaticNoShowService,
} = require('../dist/schedules/automatic-no-show.service.js');

function createHarness({
  checkedInAt = null,
  pendingTimeChange = false,
  bookingDate = '2026-08-27',
  bookingTime = '19:20',
  activeBookings = [],
} = {}) {
  const calls = [];
  const lockedBooking = {
    id: 'booking-1',
    bookingDate,
    bookingTime,
    status: 'approved',
    checkedInAt,
    cancelledAt: null,
    cancellationReason: null,
    wishes: null,
    guestNotification: null,
  };
  const table = { id: 'table-8', tableNumber: '8', status: 'reserved' };
  const relatedBooking = {
    ...lockedBooking,
    table,
    client: { id: 'client-1', fullName: 'Гість' },
  };

  let bookingFindOneCalls = 0;
  const bookingRepo = {
    async findOne(options) {
      bookingFindOneCalls += 1;
      calls.push(['booking.findOne', options]);
      if (bookingFindOneCalls === 1) return lockedBooking;
      return relatedBooking;
    },
    async save(value) {
      calls.push(['booking.save', value.status, value.cancellationReason]);
      return value;
    },
    async find(options) {
      calls.push(['booking.find.active', options]);
      return activeBookings;
    },
  };
  const rescheduleRepo = {
    async findOne() {
      calls.push(['reschedule.findOne']);
      return pendingTimeChange ? { id: 'request-1', status: 'pending' } : null;
    },
  };
  const historyRepo = {
    create(value) {
      calls.push(['history.create', value.action, value.actorRole, value.reason]);
      return value;
    },
    async save(value) {
      calls.push(['history.save', value.action]);
      return value;
    },
  };
  const tableRepo = {
    createQueryBuilder() {
      return {
        where() { return this; },
        setLock(mode) {
          calls.push(['table.lock', mode]);
          return this;
        },
        async getOne() { return table; },
      };
    },
    async save(value) {
      calls.push(['table.save', value.status]);
      return value;
    },
  };

  const manager = {
    getRepository(entity) {
      if (entity.name === 'Booking') return bookingRepo;
      if (entity.name === 'BookingRescheduleRequest') return rescheduleRepo;
      if (entity.name === 'BookingHistory') return historyRepo;
      if (entity.name === 'TableEntity') return tableRepo;
      throw new Error(`Unexpected repository ${entity.name}`);
    },
  };
  const dataSource = {
    async transaction(work) {
      calls.push(['transaction']);
      return work(manager);
    },
  };
  const notifications = {
    async notifyBookingCancelled(value) {
      calls.push(['notify.cancelled', value.id]);
    },
  };
  const logs = {
    async create(message) {
      calls.push(['log', message]);
    },
  };

  return {
    service: new AutomaticNoShowService(dataSource, notifications, logs),
    lockedBooking,
    table,
    calls,
  };
}

test('auto no-show cancels an unattended booking at +30 and frees the table', async () => {
  const { service, lockedBooking, table, calls } = createHarness();

  const result = await service.cancelIfDue('booking-1', '2026-08-27', 19 * 60 + 50);

  assert.equal(result, true);
  assert.equal(lockedBooking.status, 'cancelled');
  assert.equal(lockedBooking.cancellationReason, 'no_show');
  assert.equal(lockedBooking.guestNotification.type, 'no_show');
  assert.equal(lockedBooking.guestNotification.title, 'Ваше бронювання анульовано');
  assert.match(lockedBooking.guestNotification.message, /30 хвилин/);
  assert.equal(table.status, 'free');
  assert.ok(calls.some((call) => call[0] === 'history.create' && call[2] === 'system'));
  assert.ok(calls.some((call) => call[0] === 'notify.cancelled'));
});

test('auto no-show is paused while a guest time-change request is pending', async () => {
  const { service, lockedBooking, table, calls } = createHarness({ pendingTimeChange: true });

  const result = await service.cancelIfDue('booking-1', '2026-08-27', 20 * 60);

  assert.equal(result, false);
  assert.equal(lockedBooking.status, 'approved');
  assert.equal(table.status, 'reserved');
  assert.ok(!calls.some((call) => call[0] === 'booking.save'));
  assert.ok(!calls.some((call) => call[0] === 'notify.cancelled'));
});

test('auto no-show rechecks check-in under the transaction lock', async () => {
  const { service, lockedBooking, calls } = createHarness({
    checkedInAt: new Date('2026-08-27T16:49:59.000Z'),
  });

  const result = await service.cancelIfDue('booking-1', '2026-08-27', 19 * 60 + 50);

  assert.equal(result, false);
  assert.equal(lockedBooking.status, 'approved');
  assert.deepEqual(calls.map((call) => call[0]), ['transaction', 'booking.findOne']);
  assert.deepEqual(calls[1][1].lock, { mode: 'pessimistic_write' });
});

test('auto no-show uses the currently approved booking time', async () => {
  const { service, lockedBooking, calls } = createHarness({ bookingTime: '20:00' });

  const before = await service.cancelIfDue('booking-1', '2026-08-27', 20 * 60 + 29);
  assert.equal(before, false);
  assert.equal(lockedBooking.status, 'approved');
  assert.ok(!calls.some((call) => call[0] === 'booking.save'));
});

test('auto no-show deadline continues across Kyiv midnight', async () => {
  const { service, lockedBooking, calls } = createHarness({
    bookingDate: '2026-08-27',
    bookingTime: '23:45',
  });

  assert.equal(
    service.isDue('2026-08-27', '23:45', '2026-08-28', 14),
    false,
  );
  assert.equal(
    service.isDue('2026-08-27', '23:45', '2026-08-28', 15),
    true,
  );

  const result = await service.cancelIfDue('booking-1', '2026-08-28', 15);
  assert.equal(result, true);
  assert.equal(lockedBooking.status, 'cancelled');
  const activeLookup = calls.find((call) => call[0] === 'booking.find.active');
  assert.equal(activeLookup[1].where.bookingDate, '2026-08-28');
});

test('cross-midnight no-show preserves a reservation for the new Kyiv date', async () => {
  const { service, table, calls } = createHarness({
    bookingDate: '2026-08-27',
    bookingTime: '23:45',
    activeBookings: [{ status: 'approved' }],
  });

  const result = await service.cancelIfDue('booking-1', '2026-08-28', 15);

  assert.equal(result, true);
  assert.equal(table.status, 'reserved');
  assert.ok(!calls.some((call) => call[0] === 'table.save' && call[1] === 'free'));
});
