require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createWaiterBookingProtectionService,
} = require('../dist/bookings/waiter-booking-protection.provider.js');

function kyivToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const waiter = (staffId) => ({ role: 'waiter', staffId, name: staffId });

function harness({
  source = 'admin_manual',
  status = 'approved',
  checkedInAt = null,
  owner = null,
  bookingDate = kyivToday(),
  anotherVisit = false,
} = {}) {
  const writes = [];
  const table = { id: 'table-8', status: checkedInAt ? 'occupied' : 'reserved' };
  const booking = {
    id: 'booking-8',
    source,
    bookingDate,
    status,
    checkedInAt,
    completedAt: null,
    table,
    client: null,
  };
  let assignment = owner
    ? {
        action: 'booking_checked_in',
        actorRole: 'waiter',
        actorStaffId: owner,
        actorName: owner,
      }
    : checkedInAt
      ? {
          action: 'booking_checked_in',
          actorRole: 'admin',
          actorStaffId: null,
          actorName: 'Admin',
        }
      : null;

  const bookingRepo = {
    async findOne() { return booking; },
    async save(value) {
      writes.push(['booking.save', value.status]);
      return value;
    },
    async exist() { return anotherVisit; },
  };
  const historyRepo = {
    async findOne() { return assignment; },
    create(value) { return value; },
    async save(value) {
      writes.push(['history.save', value.action, value.actorStaffId || null]);
      if (
        value.action === 'booking_checked_in' ||
        value.action === 'waiter_manual_visit_claimed'
      ) {
        assignment = value;
      }
      return value;
    },
  };
  const tableRepo = {
    async findOne() { return table; },
    async save(value) {
      writes.push(['table.save', value.status]);
      return value;
    },
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
    async transaction(work) {
      writes.push(['transaction']);
      return work(manager);
    },
  };
  const coordinated = {
    async checkIn(id, actor) {
      writes.push(['checkIn', id]);
      if (!booking.checkedInAt) {
        booking.checkedInAt = new Date();
        table.status = 'occupied';
        assignment = {
          action: 'booking_checked_in',
          actorRole: actor?.role || 'admin',
          actorStaffId: actor?.staffId || null,
          actorName: actor?.name || null,
        };
        writes.push(['history.save', 'booking_checked_in', actor?.staffId || null]);
      }
      return { message: 'Гості відмічені як присутні' };
    },
    async complete(id) {
      writes.push(['original.complete', id]);
      return { message: 'Стіл звільнено' };
    },
    bookingSnapshot(value) {
      return { status: value.status, checkedInAt: value.checkedInAt };
    },
    async safeLog(action) {
      writes.push(['log', action]);
    },
  };

  return {
    service: createWaiterBookingProtectionService(coordinated, dataSource),
    booking,
    table,
    writes,
    getAssignment: () => assignment,
  };
}

test('waiter who marks arrival owns a manual visit', async () => {
  const fixture = harness();
  await fixture.service.checkIn('booking-8', waiter('serhii'));

  assert.equal(fixture.getAssignment().action, 'booking_checked_in');
  assert.equal(fixture.getAssignment().actorStaffId, 'serhii');
  assert.equal(
    fixture.writes.filter((item) => item[1] === 'waiter_manual_visit_claimed').length,
    0,
  );
});

test('manual visit checked in by administrator can be claimed by first waiter', async () => {
  const fixture = harness({ checkedInAt: new Date() });

  await fixture.service.checkIn('booking-8', waiter('serhii'));

  assert.equal(fixture.getAssignment().action, 'waiter_manual_visit_claimed');
  assert.equal(fixture.getAssignment().actorStaffId, 'serhii');
});

test('second waiter cannot take an already claimed manual visit', async () => {
  const fixture = harness({ checkedInAt: new Date(), owner: 'serhii' });

  await assert.rejects(
    fixture.service.checkIn('booking-8', waiter('andrii')),
    /інший офіціант/,
  );
});

test('pending manual booking cannot bypass administrator approval', async () => {
  const fixture = harness({ status: 'pending' });

  await assert.rejects(
    fixture.service.checkIn('booking-8', waiter('serhii')),
    /підтвердженим ручним бронюванням/,
  );
});

test('online booking keeps existing check-in behavior', async () => {
  const fixture = harness({ source: 'mini_app' });

  await fixture.service.checkIn('booking-8', waiter('serhii'));

  assert.deepEqual(fixture.writes, [
    ['checkIn', 'booking-8'],
    ['history.save', 'booking_checked_in', 'serhii'],
  ]);
});

test('administrator-checked-in manual visit can be completed by first waiter without 403', async () => {
  const fixture = harness({ checkedInAt: new Date() });
  fixture.table.status = 'cleaning';

  assert.deepEqual(
    await fixture.service.complete('booking-8', waiter('serhii')),
    { message: 'Стіл звільнено' },
  );
  assert.equal(fixture.booking.status, 'completed');
  assert.equal(fixture.table.status, 'free');
  assert.equal(fixture.getAssignment().actorStaffId, 'serhii');
});

test('another waiter cannot complete claimed manual visit', async () => {
  const fixture = harness({ checkedInAt: new Date(), owner: 'serhii' });
  fixture.table.status = 'cleaning';

  await assert.rejects(
    fixture.service.complete('booking-8', waiter('andrii')),
    /інший офіціант/,
  );
  assert.equal(fixture.booking.status, 'approved');
  assert.equal(fixture.table.status, 'cleaning');
});

test('administrator and Director keep existing completion behavior', async () => {
  for (const role of ['admin', 'owner']) {
    const fixture = harness({ checkedInAt: new Date(), owner: 'serhii' });
    await fixture.service.complete('booking-8', { role });
    assert.deepEqual(fixture.writes, [['original.complete', 'booking-8']]);
  }
});
