const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWaiterAssignmentLookupService,
} = require('../dist/telegram/telegram-waiter-assignment-lookup.service.js');
const {
  TelegramWaiterMenuResolvedService,
} = require('../dist/telegram/telegram-waiter-menu-resolved.service.js');

const actor = {
  sub: 'waiter-1',
  telegramId: '123',
  role: 'waiter',
  staffId: 'waiter-1',
  name: 'Олександр',
};

function booking(index) {
  return {
    id: `booking-${index}`,
    status: 'approved',
    bookingDate: '2099-01-01',
    bookingTime: `${String(index % 24).padStart(2, '0')}:00:00`,
    guestsCount: 2,
    approvedAt: new Date('2099-01-01T12:00:00Z'),
    checkedInAt: new Date('2099-01-01T12:00:00Z'),
    assignedWaiterId: null,
    assignedWaiterName: null,
    table: {
      id: `table-${index}`,
      tableNumber: String(index + 1),
      seats: 4,
      status: 'occupied',
      isVisible: true,
      zone: { name: 'Зал ресторану' },
    },
    client: { fullName: `Гість ${index + 1}` },
  };
}

function callbacks(message) {
  return message.replyMarkup.inline_keyboard
    .flat()
    .map((button) => button.callback_data)
    .filter(Boolean);
}

function createMenuService(bookings, lookup, messages) {
  return new TelegramWaiterMenuResolvedService(
    { async getToday() { return bookings; } },
    {},
    { async findAll() { return []; } },
    {
      async sendMessage(chatId, text, replyMarkup) {
        messages.push({ chatId, text, replyMarkup });
        return { ok: true };
      },
    },
    lookup,
  );
}

test('My tables includes a booking assigned by an accepted waiter call', async () => {
  const messages = [];
  const bookings = [booking(0)];
  let bulkLookups = 0;

  const service = createMenuService(
    bookings,
    {
      async bookingIdsForWaiter(currentBookings, waiterId) {
        bulkLookups += 1;
        assert.equal(waiterId, 'waiter-1');
        assert.deepEqual(currentBookings.map((item) => item.id), ['booking-0']);
        return ['booking-0'];
      },
    },
    messages,
  );

  assert.equal(await service.handle('mine', undefined, 999, actor), true);
  assert.equal(bulkLookups, 1);
  assert.equal(callbacks(messages.at(-1)).includes('waiter:booking:booking-0'), true);
});

test('My tables keeps call-based assignments reachable beyond fifty bookings with one bulk lookup', async () => {
  const messages = [];
  const bookings = Array.from({ length: 65 }, (_, index) => booking(index));
  let bulkLookups = 0;

  const service = createMenuService(
    bookings,
    {
      async bookingIdsForWaiter(currentBookings) {
        bulkLookups += 1;
        assert.equal(currentBookings.length, 65);
        return currentBookings.map((item) => item.id);
      },
    },
    messages,
  );

  await service.handle('mine', '6', 999, actor);
  const pageCallbacks = callbacks(messages.at(-1));

  assert.equal(bulkLookups, 1);
  assert.equal(pageCallbacks.includes('waiter:booking:booking-60'), true);
  assert.equal(pageCallbacks.includes('waiter:booking:booking-64'), true);
  assert.equal(pageCallbacks.includes('waiter:mine:5'), true);
});

test('My tables retains uncapped booking-history assignments without call lookup', async () => {
  const messages = [];
  const bookings = Array.from({ length: 65 }, (_, index) => ({
    ...booking(index),
    assignedWaiterId: 'waiter-1',
    assignedWaiterName: 'Олександр',
  }));
  let bulkLookups = 0;

  const service = createMenuService(
    bookings,
    {
      async bookingIdsForWaiter() {
        bulkLookups += 1;
        return [];
      },
    },
    messages,
  );

  await service.handle('mine', '6', 999, actor);

  assert.equal(bulkLookups, 0);
  assert.equal(callbacks(messages.at(-1)).includes('waiter:booking:booking-64'), true);
});

test('Telegram waiter assignment lookup resolves many call assignments with one database read', async () => {
  const bookings = Array.from({ length: 65 }, (_, index) => booking(index));
  let databaseReads = 0;
  const calls = bookings.map((currentBooking, index) => ({
    id: `call-${index}`,
    booking: currentBooking,
    tableId: currentBooking.table.id,
    tableNumber: currentBooking.table.tableNumber,
    clientName: currentBooking.client.fullName,
    waiterId: 'waiter-1',
    waiterName: 'Олександр',
    assignmentActive: true,
    status: 'accepted',
    acceptedAt: new Date('2099-01-01T12:05:00Z'),
    createdAt: new Date('2099-01-01T12:04:00Z'),
    closedAt: null,
  }));

  const lookup = new TelegramWaiterAssignmentLookupService({
    getRepository() {
      return {
        async find() {
          databaseReads += 1;
          return calls;
        },
      };
    },
  });

  const ids = await lookup.bookingIdsForWaiter(bookings, 'waiter-1');

  assert.equal(databaseReads, 1);
  assert.equal(ids.length, 65);
  assert.equal(ids.includes('booking-64'), true);
});

test('Telegram waiter assignment lookup uses the latest call and ignores stale lifecycle assignments', async () => {
  const currentBooking = booking(0);
  const otherBooking = booking(1);
  otherBooking.approvedAt = new Date('2099-01-01T13:00:00Z');

  const lookup = new TelegramWaiterAssignmentLookupService({
    getRepository() {
      return {
        async find() {
          return [
            {
              booking: currentBooking,
              waiterId: 'waiter-2',
              waiterName: 'Інший',
              assignmentActive: true,
              acceptedAt: new Date('2099-01-01T12:10:00Z'),
              createdAt: new Date('2099-01-01T12:09:00Z'),
            },
            {
              booking: currentBooking,
              waiterId: 'waiter-1',
              waiterName: 'Олександр',
              assignmentActive: true,
              acceptedAt: new Date('2099-01-01T12:05:00Z'),
              createdAt: new Date('2099-01-01T12:04:00Z'),
            },
            {
              booking: otherBooking,
              waiterId: 'waiter-1',
              waiterName: 'Олександр',
              assignmentActive: true,
              acceptedAt: new Date('2099-01-01T12:30:00Z'),
              createdAt: new Date('2099-01-01T12:29:00Z'),
            },
          ];
        },
      };
    },
  });

  const ids = await lookup.bookingIdsForWaiter(
    [currentBooking, otherBooking],
    'waiter-1',
  );

  assert.deepEqual(ids, []);
});
