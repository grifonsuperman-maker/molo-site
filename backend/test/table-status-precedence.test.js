require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const { BookingsService } = require('../dist/bookings/bookings.service.js');

function kyivDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function queryBuilder(activeBookings) {
  const query = {
    leftJoinAndSelect() { return query; },
    where() { return query; },
    andWhere() { return query; },
    orderBy() { return query; },
    async getMany() { return activeBookings; },
  };
  return query;
}

function createService(tables, activeBookings) {
  const bookings = {
    createQueryBuilder() {
      return queryBuilder(activeBookings);
    },
  };
  const tableRepository = {
    async find() {
      return tables;
    },
  };

  return new BookingsService(
    bookings,
    {},
    {},
    {},
    tableRepository,
    {},
    {},
    {},
    {},
  );
}

function table(id, tableNumber, status) {
  return {
    id,
    tableNumber: String(tableNumber),
    status,
    isVisible: true,
    zone: {
      isVisible: true,
      isClosed: false,
    },
  };
}

function booking(id, tableValue, status) {
  return {
    id,
    status,
    bookingTime: '19:00:00',
    durationMinutes: 120,
    wishes: '',
    table: tableValue,
  };
}

test('today physical occupied and cleaning statuses override booking state', async () => {
  const occupied = table('table-occupied', 8, 'occupied');
  const cleaning = table('table-cleaning', 9, 'cleaning');
  const service = createService(
    [occupied, cleaning],
    [
      booking('booking-approved', occupied, 'approved'),
      booking('booking-pending', cleaning, 'pending'),
    ],
  );

  const result = await service.getTableStatuses({
    bookingDate: kyivDate(),
    bookingTime: '19:00',
    durationMinutes: 120,
  });

  assert.equal(result.statuses['8'].status, 'occupied');
  assert.equal(result.statuses['8'].reason, 'physical_status_today');
  assert.equal(result.statuses['9'].status, 'cleaning');
  assert.equal(result.statuses['9'].reason, 'physical_status_today');
});

test('future dates ignore physical today status and show booking state only', async () => {
  const futureReserved = table('table-reserved', 8, 'occupied');
  const futureFree = table('table-free', 9, 'cleaning');
  const futurePending = table('table-pending', 10, 'occupied');
  const service = createService(
    [futureReserved, futureFree, futurePending],
    [
      booking('booking-approved', futureReserved, 'approved'),
      booking('booking-pending', futurePending, 'pending'),
    ],
  );

  const result = await service.getTableStatuses({
    bookingDate: kyivDate(7),
    bookingTime: '19:00',
    durationMinutes: 120,
  });

  assert.equal(result.statuses['8'].status, 'reserved');
  assert.equal(result.statuses['8'].reason, 'booking_conflict');
  assert.equal(result.statuses['9'].status, 'free');
  assert.equal(result.statuses['9'].reason, null);
  assert.equal(result.statuses['10'].status, 'pending');
  assert.equal(result.statuses['10'].reason, 'booking_conflict');
});
