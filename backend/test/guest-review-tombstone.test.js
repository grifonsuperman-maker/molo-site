const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GuestBookingsService,
} = require('../dist/bookings/guest-bookings.service.js');

function completedBooking() {
  return {
    id: 'booking-1',
    status: 'completed',
    table: null,
    bookingDate: '2026-08-22',
    bookingTime: '18:00:00',
    durationMinutes: 120,
    guestsCount: 2,
    wishes: null,
    createdAt: new Date('2026-08-22T15:00:00Z'),
    approvedAt: new Date('2026-08-22T15:05:00Z'),
    rejectedAt: null,
    checkedInAt: new Date('2026-08-22T15:55:00Z'),
    cancelledAt: null,
    completedAt: new Date('2026-08-22T18:00:00Z'),
    cancellationReason: null,
    lateNotifiedAt: null,
    latenessHours: null,
    latenessMinutes: null,
    expectedArrivalAt: null,
    guestNotification: null,
  };
}

function createService() {
  const booking = completedBooking();
  let reviewSaveCalls = 0;

  const bookingQuery = {
    leftJoinAndSelect() { return this; },
    andWhere(predicate) {
      if (typeof predicate === 'function') {
        predicate({
          setParameters() {},
          setParameter() {},
        });
      }
      return this;
    },
    async getMany() { return [booking]; },
  };

  const bookings = {
    createQueryBuilder() { return bookingQuery; },
  };
  const reviews = {
    async find() { return []; },
    async exist() { return false; },
  };
  const restaurants = {
    async find() { return []; },
  };
  const historyRepository = {
    async find() {
      return [{ booking, action: 'guest_submitted_review' }];
    },
    async exist() {
      return true;
    },
  };
  const reviewRepository = {
    async findOne() { return null; },
    create(value) { return value; },
    async save() {
      reviewSaveCalls += 1;
    },
  };
  const manager = {
    getRepository(entity) {
      return entity?.name === 'GuestReview' ? reviewRepository : historyRepository;
    },
  };
  const dataSource = {
    getRepository() { return historyRepository; },
    async transaction(callback) { return callback(manager); },
  };

  const service = new GuestBookingsService(
    bookings,
    reviews,
    restaurants,
    dataSource,
  );
  service.findOwnedBooking = async () => booking;

  return {
    service,
    getReviewSaveCalls: () => reviewSaveCalls,
  };
}

test('deleted review remains submitted in guest list and get payloads', async () => {
  const { service } = createService();

  const listed = await service.list({
    guestDeviceId: '',
    tokens: ['guest-access-token'],
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].canLeaveReview, false);

  const booking = await service.get('booking-1', 'guest-access-token');
  assert.equal(booking.canLeaveReview, false);
  assert.equal('bookingHistory' in booking, false);
});

test('deleted review cannot be submitted again for the same completed visit', async () => {
  const { service, getReviewSaveCalls } = createService();

  await assert.rejects(
    () => service.submitReview(
      'booking-1',
      'guest-access-token',
      { text: 'Повторний відгук' },
    ),
    /Відгук для цього візиту вже залишено/,
  );

  assert.equal(getReviewSaveCalls(), 0);
});
