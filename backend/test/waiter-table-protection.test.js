require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createProtectedTablesService,
} = require('../dist/tables/protected-tables.provider.js');

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

function harness({ withManualVisit = true, owner = null } = {}) {
  const writes = [];
  const table = { id: 'table-8', status: withManualVisit ? 'occupied' : 'free' };
  const visit = {
    id: 'booking-8',
    source: 'admin_manual',
    bookingDate: kyivToday(),
    status: 'approved',
    checkedInAt: new Date(),
    table,
  };
  let assignment = owner
    ? {
        action: 'booking_checked_in',
        actorRole: 'waiter',
        actorStaffId: owner,
      }
    : {
        action: 'booking_checked_in',
        actorRole: 'admin',
        actorStaffId: null,
      };

  const bookingRepo = {
    async find(options) {
      if (options?.where?.source === 'admin_manual') {
        return withManualVisit ? [visit] : [];
      }
      return withManualVisit ? [visit] : [];
    },
  };
  const historyRepo = {
    async findOne() { return assignment; },
    create(value) { return value; },
    async save(value) {
      writes.push(['history.save', value.action, value.actorStaffId]);
      assignment = value;
      return value;
    },
  };
  const tableRepo = {
    async findOne(options) {
      if (options?.relations) return table;
      return table;
    },
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
    async transaction(job) {
      writes.push(['transaction']);
      return job(manager);
    },
  };
  const raw = {
    async setWaiterStatus(id, status) {
      writes.push(['raw.status', id, status]);
      table.status = status;
      return table;
    },
    async markCleaning(id) {
      writes.push(['raw.cleaning', id]);
      table.status = 'cleaning';
      return table;
    },
    async markOccupied(id) {
      writes.push(['raw.occupied', id]);
      table.status = 'occupied';
      return table;
    },
    async markFree(id) {
      writes.push(['raw.free', id]);
      table.status = 'free';
      return table;
    },
  };

  return {
    service: createProtectedTablesService(raw, dataSource),
    table,
    writes,
    getAssignment: () => assignment,
  };
}

test('first waiter table action claims administrator-checked-in manual visit', async () => {
  const fixture = harness();

  await fixture.service.markCleaning('table-8', {
    role: 'waiter',
    staffId: 'serhii',
    name: 'Сергій',
  });

  assert.equal(fixture.table.status, 'cleaning');
  assert.equal(fixture.getAssignment().action, 'waiter_manual_visit_claimed');
  assert.equal(fixture.getAssignment().actorStaffId, 'serhii');
});

test('second waiter cannot manipulate claimed manual visit', async () => {
  const fixture = harness({ owner: 'serhii' });

  await assert.rejects(
    fixture.service.markCleaning('table-8', {
      role: 'waiter',
      staffId: 'andrii',
      name: 'Андрій',
    }),
    /інший офіціант/,
  );

  assert.equal(fixture.table.status, 'occupied');
});

test('walk-in status button cannot claim an unassigned booked visit', async () => {
  const fixture = harness();

  await assert.rejects(
    fixture.service.setWaiterStatus(
      'table-8',
      'free',
      { role: 'waiter', staffId: 'serhii', name: 'Сергій' },
    ),
    /активне ручне бронювання/,
  );

  assert.equal(fixture.getAssignment().actorRole, 'admin');
  assert.equal(
    fixture.writes.some((item) => item[0] === 'history.save'),
    false,
  );
});

test('walk-in waiter status keeps existing raw behavior when there is no booking', async () => {
  const fixture = harness({ withManualVisit: false });

  await fixture.service.setWaiterStatus(
    'table-8',
    'occupied',
    { role: 'waiter', staffId: 'serhii', name: 'Сергій' },
  );

  assert.equal(fixture.table.status, 'occupied');
  assert.equal(
    fixture.writes.some((item) => item[0] === 'history.save'),
    false,
  );
});
