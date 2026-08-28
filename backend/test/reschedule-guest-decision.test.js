require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BookingRescheduleApprovalService,
} = require('../dist/bookings/booking-reschedule-approval.service.js');
const { AvailabilityBlock } = require('../dist/bookings/entities/availability-block.entity.js');
const { Booking } = require('../dist/bookings/entities/booking.entity.js');
const {
  BookingRescheduleRequest,
} = require('../dist/bookings/entities/booking-reschedule-request.entity.js');
const { TableEntity } = require('../dist/tables/entities/table.entity.js');
const { NotificationsService } = require('../dist/notifications/notifications.service.js');

function approvalHarness() {
  const table = {
    id: 'table-1',
    tableNumber: '8',
    isVisible: true,
    status: 'free',
    zone: { id: 'zone-1', isClosed: false, isVisible: true },
  };
  const booking = {
    id: 'booking-1',
    status: 'approved',
    bookingDate: '2026-08-29',
    bookingTime: '19:00:00',
    durationMinutes: 120,
    wishes: null,
    checkedInAt: null,
    table,
    client: { telegramId: 'guest-telegram-1' },
    guestNotification: null,
  };
  const request = {
    id: 'reschedule-1',
    status: 'pending',
    booking,
    requestedDate: '2026-08-29',
    requestedTime: '20:00:00',
    resolvedAt: null,
  };
  const observed = {
    transactionCompleted: false,
    bookingSaves: 0,
    requestSaves: 0,
    guestNotifications: [],
  };

  const requestRepository = {
    async findOne(options) {
      return options?.where?.id === request.id ? request : null;
    },
    async save(value) {
      observed.requestSaves += 1;
      return value;
    },
  };
  const queryBuilder = {
    where() { return this; },
    andWhere() { return this; },
    orderBy() { return this; },
    async getMany() { return []; },
  };
  const bookingRepository = {
    async findOne(options) {
      return options?.where?.id === booking.id ? booking : null;
    },
    async save(value) {
      observed.bookingSaves += 1;
      return value;
    },
    createQueryBuilder() {
      return queryBuilder;
    },
  };
  const tableRepository = {
    async findOne(options) {
      return options?.where?.id === table.id ? table : null;
    },
  };
  const availabilityRepository = {
    async find() {
      return [];
    },
  };
  const manager = {
    async query() {},
    getRepository(entity) {
      if (entity === BookingRescheduleRequest) return requestRepository;
      if (entity === Booking) return bookingRepository;
      if (entity === TableEntity) return tableRepository;
      if (entity === AvailabilityBlock) return availabilityRepository;
      throw new Error('Unexpected repository');
    },
  };
  const dataSource = {
    async transaction(callback) {
      try {
        return await callback(manager);
      } finally {
        observed.transactionCompleted = true;
      }
    },
  };
  const notifications = {
    async notifyGuestRescheduleDecision(payload) {
      assert.equal(observed.transactionCompleted, true);
      observed.guestNotifications.push(payload);
    },
  };
  const service = new BookingRescheduleApprovalService(dataSource, notifications);
  service.kyivDate = () => '2026-08-29';

  return { booking, request, observed, service };
}

test('approved reschedule updates booking and publishes guest decision after commit', async () => {
  const { booking, request, observed, service } = approvalHarness();

  const result = await service.approve('reschedule-1');

  assert.deepEqual(result, { message: 'Перенесення підтверджено' });
  assert.equal(booking.bookingDate, '2026-08-29');
  assert.equal(booking.bookingTime, '20:00:00');
  assert.equal(booking.guestNotification.type, 'reschedule_decision');
  assert.equal(booking.guestNotification.decision, 'approved');
  assert.match(booking.guestNotification.message, /20:00/);
  assert.equal(request.status, 'approved');
  assert.ok(request.resolvedAt instanceof Date);
  assert.equal(observed.bookingSaves, 1);
  assert.equal(observed.requestSaves, 1);
  assert.deepEqual(observed.guestNotifications, [
    {
      telegramId: 'guest-telegram-1',
      decision: 'approved',
      bookingDate: '2026-08-29',
      bookingTime: '20:00:00',
    },
  ]);
});

test('direct guest reschedule Telegram notification escapes reason and has no staff callback buttons', async () => {
  const sent = [];
  const telegram = {
    async sendMessage(chatId, text, replyMarkup) {
      sent.push({ chatId, text, replyMarkup });
    },
  };
  const service = new NotificationsService({}, telegram);

  const summary = await service.notifyGuestRescheduleDecision({
    telegramId: 'guest-telegram-1',
    decision: 'rejected',
    bookingDate: '2026-08-29',
    bookingTime: '19:00:00',
    adminComment: 'Час < 20:00 & <foo>',
  });

  assert.deepEqual(summary, { attempted: 1, delivered: 1, failed: 0 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, 'guest-telegram-1');
  assert.match(sent[0].text, /не підтверджено/);
  assert.match(sent[0].text, /19:00/);
  assert.match(sent[0].text, /Час &lt; 20:00 &amp; &lt;foo&gt;/);
  assert.doesNotMatch(sent[0].text, /Час < 20:00/);
  assert.equal(sent[0].replyMarkup, undefined);
});
