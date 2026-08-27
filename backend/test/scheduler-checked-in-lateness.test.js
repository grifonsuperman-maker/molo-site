require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SchedulesService,
} = require('../dist/schedules/schedules.service.js');

function createHarness(booking) {
  const calls = [];
  const bookingsRepo = {
    async find() {
      calls.push(['find']);
      return [booking];
    },
    async save(value) {
      calls.push(['save', value.id]);
      return value;
    },
  };
  const restaurantRepo = {};
  const notifications = {
    async notifyLateGuest(value) {
      calls.push(['notify', value.id]);
    },
  };
  const logs = {
    async create(message) {
      calls.push(['log', message]);
    },
  };

  const service = new SchedulesService(
    bookingsRepo,
    restaurantRepo,
    notifications,
    logs,
  );
  service.getKyivClock = () => ({
    date: '2026-08-27',
    time: '19:20',
    minutes: 19 * 60 + 20,
  });

  return { service, calls };
}

test('automatic lateness does not notify a guest who already checked in', async () => {
  const booking = {
    id: 'booking-checked-in',
    bookingDate: '2026-08-27',
    bookingTime: '19:00',
    status: 'approved',
    checkedInAt: new Date('2026-08-27T15:58:00.000Z'),
    lateNotifiedAt: null,
    table: { tableNumber: '8' },
    client: { fullName: 'Гість' },
  };
  const { service, calls } = createHarness(booking);

  await service.checkLateGuests();

  assert.equal(booking.lateNotifiedAt, null);
  assert.deepEqual(calls, [['find']]);
});

test('automatic lateness still notifies an approved guest who has not checked in', async () => {
  const booking = {
    id: 'booking-late',
    bookingDate: '2026-08-27',
    bookingTime: '19:00',
    status: 'approved',
    checkedInAt: null,
    lateNotifiedAt: null,
    table: { tableNumber: '8' },
    client: { fullName: 'Гість' },
  };
  const { service, calls } = createHarness(booking);

  await service.checkLateGuests();

  assert.ok(booking.lateNotifiedAt instanceof Date);
  assert.deepEqual(calls, [
    ['find'],
    ['save', 'booking-late'],
    ['notify', 'booking-late'],
    ['log', 'Відправлено сповіщення про запізнення гостя'],
  ]);
});
