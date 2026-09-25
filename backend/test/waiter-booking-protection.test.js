require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { createWaiterBookingProtectionService } = require('../dist/bookings/waiter-booking-protection.provider.js');

function kyivToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function harness({ status = 'approved', checkedInAt = null, bookingDate = kyivToday(), owner = null } = {}) {
  const writes = [];
  const table = { id: 'table-8', status: 'reserved' };
  const booking = {
    id: 'booking-8', bookingDate, status, checkedInAt, completedAt: null,
    approvedAt: new Date(), table, client: null,
  };
  let arrival = owner && { action: 'booking_checked_in', actorRole: 'waiter', actorStaffId: owner };
  const bookingRepo = {
    async findOne() { return booking; },
    async save(value) { writes.push(['booking', value.status]); return value; },
    async exist() { return false; },
  };
  const historyRepo = {
    async findOne() { return arrival; },
    create(value) { return value; },
    async save(value) { writes.push(['history', value.action]); return value; },
  };
  const tableRepo = {
    async findOne() { return table; },
    async save(value) { writes.push(['table', value.status]); return value; },
  };
  const manager = {
    getRepository(entity) {
      if (entity.name === 'Booking') return bookingRepo;
      if (entity.name === 'BookingHistory') return historyRepo;
      if (entity.name === 'TableEntity') return tableRepo;
      throw new Error(`Unexpected repository: ${entity.name}`);
    },
  };
  const dataSource = {
    getRepository: manager.getRepository,
    async transaction(work) { writes.push(['transaction']); return work(manager); },
  };
  const coordinated = {
    async checkIn(id, actor) {
      writes.push(['checkIn', id]);
      if (!booking.checkedInAt) {
        booking.checkedInAt = new Date();
        arrival = { action: 'booking_checked_in', actorRole: actor?.role || 'admin', actorStaffId: actor?.staffId || null };
      }
      return { message: 'Гості відмічені як присутні' };
    },
    async complete(id) { writes.push(['original.complete', id]); return { message: 'Стіл звільнено' }; },
    bookingSnapshot(value) { return { status: value.status, checkedInAt: value.checkedInAt }; },
    async safeLog(action) { writes.push(['log', action]); },
    async getToday() { return ['unchanged']; },
  };
  return { service: createWaiterBookingProtectionService(coordinated, dataSource), booking, table, writes };
}

const waiter = (staffId) => ({ role: 'waiter', staffId, name: staffId });

test('approved manual booking is claimed only when the waiter marks arrival', async () => {
  const fixture = harness();
  assert.equal(fixture.booking.checkedInAt, null);
  await fixture.service.checkIn('booking-8', waiter('serhii'));
  assert.ok(fixture.booking.checkedInAt instanceof Date);
  assert.deepEqual(fixture.writes, [['checkIn', 'booking-8']]);
});

test('another waiter cannot replay arrival after the first waiter receives guests', async () => {
  const fixture = harness({ checkedInAt: new Date(), owner: 'serhii' });
  await assert.rejects(fixture.service.checkIn('booking-8', waiter('andrii')), /інший офіціант/);
  assert.equal(fixture.writes.some(([name]) => name === 'booking'), false);
  assert.equal(fixture.writes.some(([name]) => name === 'history'), false);
  await fixture.service.checkIn('booking-8', waiter('serhii'));
});

test('waiter cannot bypass the administrator by checking in pending booking', async () => {
  const fixture = harness({ status: 'pending' });
  await assert.rejects(fixture.service.checkIn('booking-8', waiter('serhii')), /підтвердженим бронюванням/);
  assert.deepEqual(fixture.writes, []);
});

test('waiter cannot check in a booking from a different date', async () => {
  const fixture = harness({ bookingDate: '2020-01-01' });
  await assert.rejects(fixture.service.checkIn('booking-8', waiter('serhii')), /підтвердженим бронюванням/);
  assert.deepEqual(fixture.writes, []);
});

test('another waiter cannot complete someone else\'s arrived booking', async () => {
  const fixture = harness({ checkedInAt: new Date(), owner: 'serhii' });
  fixture.table.status = 'occupied';
  await assert.rejects(fixture.service.complete('booking-8', waiter('andrii')), /інший офіціант/);
  assert.equal(fixture.booking.status, 'approved');
  assert.equal(fixture.table.status, 'occupied');
  assert.equal(fixture.writes.some(([name]) => ['booking', 'history', 'table', 'original.complete'].includes(name)), false);
});

test('accepting waiter completes booked visit atomically with history and table release', async () => {
  const fixture = harness({ checkedInAt: new Date(), owner: 'serhii' });
  fixture.table.status = 'cleaning';
  assert.deepEqual(await fixture.service.complete('booking-8', waiter('serhii')),
    { message: 'Стіл звільнено' });
  assert.equal(fixture.booking.status, 'completed');
  assert.equal(fixture.table.status, 'free');
  assert.deepEqual(fixture.writes, [
    ['transaction'], ['booking', 'completed'], ['history', 'booking_completed'],
    ['table', 'free'], ['log', 'Стіл звільнено'],
  ]);
});

test('an unassigned or transferred booking cannot be completed by arbitrary waiter', async () => {
  for (const owner of [null, 'andrii']) {
    const fixture = harness({ checkedInAt: new Date(), owner });
    fixture.table.status = 'occupied';
    await assert.rejects(fixture.service.complete('booking-8', waiter('serhii')), /інший офіціант/);
    assert.equal(fixture.booking.status, 'approved');
  }
});

test('administrator and Director retain existing booking actions', async () => {
  for (const role of ['admin', 'owner']) {
    const fixture = harness({ checkedInAt: new Date(), owner: 'serhii' });
    await fixture.service.complete('booking-8', { role });
    assert.deepEqual(fixture.writes, [['original.complete', 'booking-8']]);
  }
});

test('other service methods retain their original implementation', async () => {
  const fixture = harness();
  assert.deepEqual(await fixture.service.getToday(), ['unchanged']);
});
