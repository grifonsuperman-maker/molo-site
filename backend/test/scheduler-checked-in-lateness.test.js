require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SchedulesService,
} = require('../dist/schedules/schedules.service.js');

function createHarness(booking, nowMinutes) {
  const calls = [];
  const bookingsRepo = {
    async find() {
      calls.push(['find']);
      return [booking];
    },
  };
  const restaurantRepo = {};
  const notifications = {};
  const logs = {};
  const automaticNoShow = {
    async cancelIfDue(bookingId, today, currentMinutes) {
      calls.push(['cancelIfDue', bookingId, today, currentMinutes]);
      return true;
    },
  };

  const service = new SchedulesService(
    bookingsRepo,
    restaurantRepo,
    notifications,
    logs,
    automaticNoShow,
  );
  service.getKyivClock = () => ({
    date: '2026-08-27',
    time: `${String(Math.floor(nowMinutes / 60)).padStart(2, '0')}:${String(nowMinutes % 60).padStart(2, '0')}`,
    minutes: nowMinutes,
  });

  return { service, calls };
}

test('automatic no-show does nothing for a guest who already checked in', async () => {
  const booking = {
    id: 'booking-checked-in',
    bookingDate: '2026-08-27',
    bookingTime: '19:20',
    status: 'approved',
    checkedInAt: new Date('2026-08-27T16:19:00.000Z'),
  };
  const { service, calls } = createHarness(booking, 19 * 60 + 50);

  await service.checkLateGuests();

  assert.deepEqual(calls, [['find']]);
});

test('automatic no-show does not run before 30 minutes', async () => {
  const booking = {
    id: 'booking-not-due',
    bookingDate: '2026-08-27',
    bookingTime: '19:20',
    status: 'approved',
    checkedInAt: null,
  };
  const { service, calls } = createHarness(booking, 19 * 60 + 49);

  await service.checkLateGuests();

  assert.deepEqual(calls, [['find']]);
});

test('automatic no-show runs exactly 30 minutes after current booking time', async () => {
  const booking = {
    id: 'booking-due',
    bookingDate: '2026-08-27',
    bookingTime: '19:20',
    status: 'approved',
    checkedInAt: null,
  };
  const { service, calls } = createHarness(booking, 19 * 60 + 50);

  await service.checkLateGuests();

  assert.deepEqual(calls, [
    ['find'],
    ['cancelIfDue', 'booking-due', '2026-08-27', 19 * 60 + 50],
  ]);
});

test('approved time change automatically moves the 30-minute deadline', async () => {
  const booking = {
    id: 'booking-rescheduled',
    bookingDate: '2026-08-27',
    bookingTime: '20:00',
    status: 'approved',
    checkedInAt: null,
  };
  const before = createHarness(booking, 20 * 60 + 29);
  await before.service.checkLateGuests();
  assert.deepEqual(before.calls, [['find']]);

  const due = createHarness(booking, 20 * 60 + 30);
  await due.service.checkLateGuests();
  assert.deepEqual(due.calls, [
    ['find'],
    ['cancelIfDue', 'booking-rescheduled', '2026-08-27', 20 * 60 + 30],
  ]);
});
