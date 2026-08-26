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

function table(id, tableNumber, status, overrides = {}) {
  return {
    id,
    tableNumber: String(tableNumber),
    status,
    isVisible: true,
    ...overrides,
    zone: {
      isVisible: true,
      isClosed: false,
      ...(overrides.zone || {}),
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

test('today hidden and closed gates override transient status and booking conflict', async () => {
  const hiddenOccupied = table('hidden-occupied', 4, 'occupied', { isVisible: false });
  const hiddenZoneCleaning = table('hidden-zone-cleaning', 5, 'cleaning', { zone: { isVisible: false } });
  const closedTable = table('closed-table', 6, 'closed');
  const closedZoneOccupied = table('closed-zone-occupied', 7, 'occupied', { zone: { isClosed: true } });

  const service = createService(
    [hiddenOccupied, hiddenZoneCleaning, closedTable, closedZoneOccupied],
    [
      booking('hidden-occupied-booking', hiddenOccupied, 'approved'),
      booking('hidden-zone-booking', hiddenZoneCleaning, 'pending'),
      booking('closed-table-booking', closedTable, 'approved'),
      booking('closed-zone-booking', closedZoneOccupied, 'pending'),
    ],
  );

  const result = await service.getTableStatuses({
    bookingDate: kyivDate(),
    bookingTime: '19:00',
    durationMinutes: 120,
  });

  assert.equal(result.statuses['4'].status, 'closed');
  assert.equal(result.statuses['4'].reason, 'hidden');
  assert.equal(result.statuses['5'].status, 'closed');
  assert.equal(result.statuses['5'].reason, 'hidden');
  assert.equal(result.statuses['6'].status, 'closed');
  assert.equal(result.statuses['6'].reason, 'closed');
  assert.equal(result.statuses['7'].status, 'closed');
  assert.equal(result.statuses['7'].reason, 'closed');
});

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

test('future dates ignore transient occupied and cleaning statuses and show booking state', async () => {
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

test('future dates keep closed and hidden availability gates even with or without bookings', async () => {
  const closedBooked = table('closed-booked', 20, 'closed');
  const closedFree = table('closed-free', 21, 'closed');
  const hiddenBooked = table('hidden-booked', 22, 'free', { isVisible: false });
  const hiddenFree = table('hidden-free', 23, 'free', { isVisible: false });
  const zoneClosedBooked = table('zone-closed-booked', 24, 'free', { zone: { isClosed: true } });
  const zoneClosedFree = table('zone-closed-free', 25, 'free', { zone: { isClosed: true } });
  const zoneHiddenBooked = table('zone-hidden-booked', 26, 'free', { zone: { isVisible: false } });
  const zoneHiddenFree = table('zone-hidden-free', 27, 'free', { zone: { isVisible: false } });

  const service = createService(
    [
      closedBooked,
      closedFree,
      hiddenBooked,
      hiddenFree,
      zoneClosedBooked,
      zoneClosedFree,
      zoneHiddenBooked,
      zoneHiddenFree,
    ],
    [
      booking('closed-booking', closedBooked, 'approved'),
      booking('hidden-booking', hiddenBooked, 'approved'),
      booking('zone-closed-booking', zoneClosedBooked, 'pending'),
      booking('zone-hidden-booking', zoneHiddenBooked, 'approved'),
    ],
  );

  const result = await service.getTableStatuses({
    bookingDate: kyivDate(7),
    bookingTime: '19:00',
    durationMinutes: 120,
  });

  for (const number of ['20', '21', '24', '25']) {
    assert.equal(result.statuses[number].status, 'closed');
    assert.equal(result.statuses[number].reason, 'closed');
  }
  for (const number of ['22', '23', '26', '27']) {
    assert.equal(result.statuses[number].status, 'closed');
    assert.equal(result.statuses[number].reason, 'hidden');
  }
});
