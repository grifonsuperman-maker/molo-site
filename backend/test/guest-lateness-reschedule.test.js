require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GuestBookingsService,
} = require('../dist/bookings/guest-bookings.service.js');
const {
  Booking,
} = require('../dist/bookings/entities/booking.entity.js');
const {
  BookingRescheduleRequest,
} = require('../dist/bookings/entities/booking-reschedule-request.entity.js');

function createHarness({
  bookingDate,
  bookingTime,
  bookingAtIso,
  existingPendingRequest = null,
}) {
  const booking = {
    id: 'booking-1',
    status: 'approved',
    bookingDate,
    bookingTime,
    durationMinutes: 120,
    guestsCount: 2,
    wishes: '',
    checkedInAt: null,
    lateNotifiedAt: null,
    latenessHours: null,
    latenessMinutes: null,
    expectedArrivalAt: null,
    table: {
      id: 'table-1',
      tableNumber: '8',
      zone: { id: 'zone-1', name: 'Зал' },
    },
    client: {
      id: 'client-1',
      fullName: 'Гість',
      phone: '+380000000000',
    },
  };
  const requests = existingPendingRequest ? [existingPendingRequest] : [];
  const bookingRepository = {
    async save(value) {
      return value;
    },
  };
  const rescheduleRepository = {
    async findOne({ where }) {
      return requests.find((request) =>
        request.booking?.id === where.booking?.id && request.status === where.status,
      ) || null;
    },
    create(value) {
      return { ...value };
    },
    async save(value) {
      const saved = {
        id: `reschedule-${requests.length + 1}`,
        createdAt: new Date('2026-08-16T00:00:00.000Z'),
        ...value,
      };
      requests.push(saved);
      return saved;
    },
  };
  const manager = {
    getRepository(entity) {
      if (entity === Booking) return bookingRepository;
      if (entity === BookingRescheduleRequest) return rescheduleRepository;
      throw new Error(`Unexpected repository: ${entity?.name || entity}`);
    },
  };
  const dataSource = {
    async transaction(callback) {
      return callback(manager);
    },
  };
  const service = new GuestBookingsService({}, {}, {}, dataSource);
  service.findOwnedBooking = async () => booking;
  service.isToday = () => true;
  service.kyivLocalDateTimeToUtc = () => new Date(bookingAtIso);
  service.saveHistory = async () => {};
  service.get = async () => ({
    bookingId: booking.id,
    bookingDate: booking.bookingDate,
    bookingTime: booking.bookingTime,
    lateNotifiedAt: booking.lateNotifiedAt,
    latenessHours: booking.latenessHours,
    latenessMinutes: booking.latenessMinutes,
    expectedArrivalAt: booking.expectedArrivalAt,
  });

  return { booking, requests, service };
}

async function withNow(iso, callback) {
  const originalNow = Date.now;
  Date.now = () => new Date(iso).getTime();
  try {
    return await callback();
  } finally {
    Date.now = originalNow;
  }
}

test('guest lateness creates a pending reschedule request without changing booking time before admin approval', async () => {
  const { booking, requests, service } = createHarness({
    bookingDate: '2026-08-16',
    bookingTime: '16:37:00',
    bookingAtIso: '2026-08-16T13:37:00.000Z',
  });

  const result = await withNow('2026-08-16T13:39:00.000Z', () =>
    service.reportLateness('booking-1', 'guest-token', { hours: 0, minutes: 15 }),
  );

  assert.equal(booking.bookingTime, '16:37:00');
  assert.equal(booking.latenessHours, 0);
  assert.equal(booking.latenessMinutes, 15);
  assert.equal(booking.expectedArrivalAt.toISOString(), '2026-08-16T13:52:00.000Z');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, 'pending');
  assert.equal(requests[0].requestedDate, '2026-08-16');
  assert.equal(requests[0].requestedTime, '16:52:00');
  assert.equal(requests[0].booking, booking);
  assert.equal(result.rescheduleRequest, requests[0]);
  assert.equal(result.booking.bookingTime, '16:37:00');
});

test('guest lateness reschedule request rolls over to the next Kyiv date after midnight', async () => {
  const { booking, requests, service } = createHarness({
    bookingDate: '2026-08-27',
    bookingTime: '23:30:00',
    bookingAtIso: '2026-08-27T20:30:00.000Z',
  });

  await withNow('2026-08-27T20:32:00.000Z', () =>
    service.reportLateness('booking-1', 'guest-token', { hours: 1, minutes: 30 }),
  );

  assert.equal(booking.bookingTime, '23:30:00');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestedDate, '2026-08-28');
  assert.equal(requests[0].requestedTime, '01:00:00');
});

test('guest lateness rejects a second pending reschedule request without changing booking fields', async () => {
  const existingPendingRequest = {
    id: 'reschedule-existing',
    booking: { id: 'booking-1' },
    requestedDate: '2026-08-16',
    requestedTime: '17:00:00',
    status: 'pending',
  };
  const { booking, requests, service } = createHarness({
    bookingDate: '2026-08-16',
    bookingTime: '16:37:00',
    bookingAtIso: '2026-08-16T13:37:00.000Z',
    existingPendingRequest,
  });

  await assert.rejects(
    () => withNow('2026-08-16T13:39:00.000Z', () =>
      service.reportLateness('booking-1', 'guest-token', { hours: 0, minutes: 15 }),
    ),
    (error) => {
      assert.equal(error?.getStatus?.(), 409);
      assert.equal(error?.message, 'Для цієї броні вже очікує підтвердження запит на перенесення');
      return true;
    },
  );

  assert.equal(booking.bookingTime, '16:37:00');
  assert.equal(booking.lateNotifiedAt, null);
  assert.equal(booking.latenessHours, null);
  assert.equal(booking.latenessMinutes, null);
  assert.equal(booking.expectedArrivalAt, null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0], existingPendingRequest);
});
