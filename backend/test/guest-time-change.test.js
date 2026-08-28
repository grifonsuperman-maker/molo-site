require('reflect-metadata');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  BookingsController,
} = require('../dist/bookings/bookings.controller.js');
const {
  GuestTimeChangeService,
} = require('../dist/bookings/guest-time-change.service.js');
const {
  Booking,
} = require('../dist/bookings/entities/booking.entity.js');
const {
  BookingRescheduleRequest,
} = require('../dist/bookings/entities/booking-reschedule-request.entity.js');

function createServiceHarness({ existingPendingRequest = null, status = 'approved', checkedInAt = null } = {}) {
  const booking = {
    id: 'booking-1',
    status,
    bookingDate: '2026-08-28',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    checkedInAt,
  };
  const bookingWithRelations = {
    ...booking,
    table: { id: 'table-1', tableNumber: '8' },
    client: { id: 'client-1', fullName: 'Гість', phone: '+380000000000' },
  };
  const requests = existingPendingRequest ? [existingPendingRequest] : [];
  let relationLoadObserved = false;

  const bookingRepository = {
    async findOne({ where, relations }) {
      if (where.id !== booking.id) return null;
      if (relations) {
        relationLoadObserved = true;
        return bookingWithRelations;
      }
      return booking;
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
        createdAt: new Date('2026-08-28T18:00:00.000Z'),
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
  const guestBookings = {
    async get(id, token) {
      assert.equal(id, booking.id);
      assert.equal(token, 'guest-token');
      return {
        bookingId: booking.id,
        status: booking.status,
        bookingDate: booking.bookingDate,
        bookingTime: booking.bookingTime,
        durationMinutes: booking.durationMinutes,
        checkedInAt: booking.checkedInAt,
        canGuestChangeTime: false,
        canReportLateness: true,
      };
    },
  };

  const service = new GuestTimeChangeService(dataSource, guestBookings);
  service.kyivDate = () => '2026-08-28';

  return {
    booking,
    bookingWithRelations,
    requests,
    service,
    relationLoadObserved: () => relationLoadObserved,
  };
}

test('guest time change creates only a pending same-date arrival-time request', async () => {
  const {
    booking,
    bookingWithRelations,
    requests,
    service,
    relationLoadObserved,
  } = createServiceHarness();

  const result = await service.request('booking-1', 'guest-token', {
    requestedDate: '2026-08-28',
    requestedTime: '20:15',
  });

  assert.equal(booking.bookingDate, '2026-08-28');
  assert.equal(booking.bookingTime, '19:00:00');
  assert.equal(booking.durationMinutes, 120);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, 'pending');
  assert.equal(requests[0].requestedDate, '2026-08-28');
  assert.equal(requests[0].requestedTime, '20:15:00');
  assert.equal(requests[0].booking, bookingWithRelations);
  assert.equal(requests[0].booking.table.tableNumber, '8');
  assert.equal(requests[0].booking.client.fullName, 'Гість');
  assert.equal(requests[0].booking.client.phone, '+380000000000');
  assert.equal(relationLoadObserved(), true);
  assert.equal(result.rescheduleRequest, requests[0]);
  assert.equal(result.booking.bookingTime, '19:00:00');
  assert.equal(result.booking.durationMinutes, 120);
});

test('guest time change rejects attempts to change the booking date', async () => {
  const { booking, requests, service } = createServiceHarness();

  await assert.rejects(
    () => service.request('booking-1', 'guest-token', {
      requestedDate: '2026-08-29',
      requestedTime: '20:15',
    }),
    (error) => {
      assert.equal(error?.getStatus?.(), 400);
      assert.equal(error?.message, 'Можна змінити лише час прибуття, а не дату бронювання');
      return true;
    },
  );

  assert.equal(booking.bookingTime, '19:00:00');
  assert.equal(booking.durationMinutes, 120);
  assert.equal(requests.length, 0);
});

test('guest time change rejects a second pending reschedule request', async () => {
  const existingPendingRequest = {
    id: 'reschedule-existing',
    booking: { id: 'booking-1' },
    requestedDate: '2026-08-28',
    requestedTime: '20:00:00',
    status: 'pending',
  };
  const { booking, requests, service } = createServiceHarness({ existingPendingRequest });

  await assert.rejects(
    () => service.request('booking-1', 'guest-token', {
      requestedDate: '2026-08-28',
      requestedTime: '20:15',
    }),
    (error) => {
      assert.equal(error?.getStatus?.(), 409);
      assert.equal(error?.message, 'Для цієї броні вже очікує підтвердження запит на перенесення');
      return true;
    },
  );

  assert.equal(booking.bookingTime, '19:00:00');
  assert.equal(booking.durationMinutes, 120);
  assert.equal(requests.length, 1);
  assert.equal(requests[0], existingPendingRequest);
});

test('guest time change is available only for approved not-checked-in bookings', async () => {
  const pendingHarness = createServiceHarness({ status: 'pending' });
  await assert.rejects(
    () => pendingHarness.service.request('booking-1', 'guest-token', {
      requestedDate: '2026-08-28',
      requestedTime: '20:15',
    }),
    (error) => error?.getStatus?.() === 400,
  );

  const checkedInHarness = createServiceHarness({ checkedInAt: new Date('2026-08-28T16:05:00.000Z') });
  await assert.rejects(
    () => checkedInHarness.service.request('booking-1', 'guest-token', {
      requestedDate: '2026-08-28',
      requestedTime: '20:15',
    }),
    (error) => error?.getStatus?.() === 400,
  );
});

test('guest controller exposes the existing change-time button immediately and suppresses lateness button', async () => {
  const approvedBooking = {
    bookingId: 'booking-1',
    status: 'approved',
    checkedInAt: null,
    bookingDate: '2026-08-28',
    bookingTime: '19:00:00',
  };
  const pendingBooking = {
    bookingId: 'booking-2',
    status: 'pending',
    checkedInAt: null,
    bookingDate: '2026-08-28',
    bookingTime: '20:00:00',
  };
  const guestService = {
    async list() {
      return [approvedBooking, pendingBooking];
    },
    async get() {
      return approvedBooking;
    },
  };
  let notifiedRequest = null;
  const guestTimeChange = {
    async request() {
      return {
        booking: approvedBooking,
        rescheduleRequest: { id: 'reschedule-1' },
      };
    },
  };
  const notifications = {
    async notifyRescheduleRequest(request) {
      notifiedRequest = request;
    },
  };

  const controller = new BookingsController(
    {},
    guestService,
    {},
    {},
    {},
    {},
    notifications,
    guestTimeChange,
  );

  const list = await controller.guestList({});
  assert.equal(list[0].canGuestChangeTime, true);
  assert.equal(list[0].canReportLateness, false);
  assert.equal(list[1].canGuestChangeTime, false);
  assert.equal(list[1].canReportLateness, false);

  const single = await controller.guestBooking('booking-1', 'guest-token');
  assert.equal(single.canGuestChangeTime, true);
  assert.equal(single.canReportLateness, false);

  const result = await controller.guestChangeTime('booking-1', 'guest-token', {
    requestedDate: '2026-08-28',
    requestedTime: '20:15',
  });
  assert.equal(result.booking.canGuestChangeTime, true);
  assert.equal(result.booking.canReportLateness, false);
  assert.equal(result.message, 'Запит на зміну часу надіслано адміністратору');
  assert.deepEqual(notifiedRequest, { id: 'reschedule-1' });
});

test('live GuestApp already contains the change-time control used by the capability', () => {
  const guestAppPath = path.join(__dirname, '../../frontend/src/guest/GuestApp.tsx');
  const source = fs.readFileSync(guestAppPath, 'utf8');

  assert.match(source, /booking\.canGuestChangeTime/);
  assert.match(source, /bookingsApi\.guestChangeTime/);
  assert.match(source, />\s*Змінити час\s*</);
});
