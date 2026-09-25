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

test('completion never reports table free while another checked-in visit exists', async () => {
  const writes = [];
  const table = { id: 'table-8', status: 'occupied' };
  const booking = {
    id: 'booking-8',
    source: 'admin_manual',
    bookingDate: kyivToday(),
    status: 'approved',
    checkedInAt: new Date(),
    table,
    client: null,
  };

  const repos = {
    Booking: {
      async findOne() { return booking; },
      async exist() { return true; },
      async save() { writes.push('booking.save'); },
    },
    TableEntity: {
      async findOne() { return table; },
      async save() { writes.push('table.save'); },
    },
    BookingHistory: {
      async findOne() {
        return {
          action: 'booking_checked_in',
          actorRole: 'waiter',
          actorStaffId: 'serhii',
        };
      },
      create(value) { return value; },
      async save() { writes.push('history.save'); },
    },
  };
  const manager = {
    getRepository(entity) {
      return repos[entity.name];
    },
  };
  const dataSource = {
    getRepository: manager.getRepository,
    async transaction(job) { return job(manager); },
  };
  const raw = {
    async complete() { throw new Error('unprotected complete was called'); },
    bookingSnapshot() { return {}; },
    async safeLog() { writes.push('log'); },
  };

  const service = createWaiterBookingProtectionService(raw, dataSource);
  await assert.rejects(
    service.complete(booking.id, {
      role: 'waiter',
      staffId: 'serhii',
      name: 'Сергій',
    }),
    /триває інше відвідування/,
  );

  assert.deepEqual(writes, []);
  assert.equal(booking.status, 'approved');
  assert.equal(table.status, 'occupied');
});
