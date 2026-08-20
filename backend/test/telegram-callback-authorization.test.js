const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

function createHarness(actor) {
  const calls = [];
  const bookings = {
    async approve(id) {
      calls.push(['approve', id]);
    },
    async reject(id) {
      calls.push(['reject', id]);
    },
    async cancel(id) {
      calls.push(['cancel', id]);
    },
    async checkIn(id, authUser) {
      calls.push(['checkin', id, authUser]);
    },
    async complete(id, authUser) {
      calls.push(['complete', id, authUser]);
    },
    async rejectReschedule(id) {
      calls.push(['reschedule-reject', id]);
    },
  };
  const reschedule = {
    async approve(id) {
      calls.push(['reschedule-approve', id]);
    },
  };
  const restaurant = {
    async openRestaurant() {
      calls.push(['restaurant-open']);
    },
    async closeBooking() {
      calls.push(['restaurant-close-booking']);
    },
    async closeRestaurant() {
      calls.push(['restaurant-close-full']);
    },
    async adminOpenRestaurant() {
      calls.push(['admin-restaurant-open']);
    },
    async adminCloseBooking() {
      calls.push(['admin-restaurant-close-booking']);
    },
    async adminCloseRestaurant() {
      calls.push(['admin-restaurant-close-full']);
    },
  };
  const telegram = {
    async answerCallbackQuery(id) {
      calls.push(['answer', id]);
      return { ok: true };
    },
    async sendMessage(chatId, text) {
      calls.push(['message', chatId, text]);
      return { ok: true };
    },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId(telegramId) {
      calls.push(['staff-find', telegramId]);
      return actor;
    },
  };

  return {
    calls,
    service: new TelegramWebhookService(
      bookings,
      reschedule,
      restaurant,
      telegram,
      telegramStaff,
    ),
  };
}

function callback(data, fromId = 123) {
  return {
    id: 'callback-1',
    from: { id: fromId },
    message: { chat: { id: 999 } },
    data,
  };
}

test('unlinked Telegram user cannot execute a protected booking callback', async () => {
  const { service, calls } = createHarness(null);

  const result = await service.handleCallback(
    callback('booking:approve:booking-1'),
  );

  assert.deepEqual(result, { ok: false });
  assert.equal(calls.some(([name]) => name === 'approve'), false);
  assert.equal(
    calls.some(
      (entry) => entry[0] === 'staff-find' && entry[1] === '123',
    ),
    true,
  );
  assert.equal(
    calls.some(
      (entry) =>
        entry[0] === 'message' && /Недостатньо прав/.test(entry[2]),
    ),
    true,
  );
});

test('authorization uses callback sender id, not chat id', async () => {
  const { service, calls } = createHarness({
    role: 'admin',
    active: true,
    isArchived: false,
    isOnShift: false,
  });

  await service.handleCallback(callback('booking:approve:booking-1', 321));

  assert.equal(
    calls.some(
      (entry) => entry[0] === 'staff-find' && entry[1] === '321',
    ),
    true,
  );
  assert.equal(
    calls.some(
      (entry) => entry[0] === 'staff-find' && entry[1] === '999',
    ),
    false,
  );
});

test('Admin can execute admin booking and reschedule callbacks', async () => {
  const actor = {
    role: 'admin',
    active: true,
    isArchived: false,
    isOnShift: false,
  };
  const cases = [
    ['booking:approve:booking-1', 'approve'],
    ['booking:reject:booking-1', 'reject'],
    ['booking:cancel:booking-1', 'cancel'],
    ['reschedule:approve:request-1', 'reschedule-approve'],
    ['reschedule:reject:request-1', 'reschedule-reject'],
  ];

  for (const [data, expectedCall] of cases) {
    const { service, calls } = createHarness(actor);
    assert.deepEqual(await service.handleCallback(callback(data)), { ok: true });
    assert.equal(calls.some((entry) => entry[0] === expectedCall), true);
  }
});

test('Admin restaurant callbacks dispatch through permission-checking admin methods', async () => {
  const actor = {
    role: 'admin',
    active: true,
    isArchived: false,
    isOnShift: false,
  };
  const cases = [
    ['restaurant:open', 'admin-restaurant-open', 'restaurant-open'],
    [
      'restaurant:close_booking',
      'admin-restaurant-close-booking',
      'restaurant-close-booking',
    ],
    ['restaurant:close_full', 'admin-restaurant-close-full', 'restaurant-close-full'],
  ];

  for (const [data, guardedCall, directorCall] of cases) {
    const { service, calls } = createHarness(actor);
    assert.deepEqual(await service.handleCallback(callback(data)), { ok: true });
    assert.equal(calls.some((entry) => entry[0] === guardedCall), true);
    assert.equal(calls.some((entry) => entry[0] === directorCall), false);
  }
});

test('Director can execute protected admin callbacks without shift requirement', async () => {
  const { service, calls } = createHarness({
    role: 'owner',
    active: true,
    isArchived: false,
    isOnShift: false,
  });

  const result = await service.handleCallback(
    callback('restaurant:close_full'),
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.some((entry) => entry[0] === 'restaurant-close-full'), true);
  assert.equal(
    calls.some((entry) => entry[0] === 'admin-restaurant-close-full'),
    false,
  );
});

test('Waiter on shift can check in and complete but cannot approve', async () => {
  const actor = {
    id: 'staff-waiter-1',
    fullName: 'Олександр',
    role: 'waiter',
    active: true,
    isArchived: false,
    isOnShift: true,
  };

  const checkIn = createHarness(actor);
  assert.deepEqual(
    await checkIn.service.handleCallback(
      callback('booking:checkin:booking-1'),
    ),
    { ok: true },
  );
  const checkInCall = checkIn.calls.find((entry) => entry[0] === 'checkin');
  assert.ok(checkInCall);
  assert.equal(checkInCall[2].role, 'waiter');
  assert.equal(checkInCall[2].staffId, 'staff-waiter-1');
  assert.equal(checkInCall[2].name, 'Олександр');
  assert.equal(checkInCall[2].telegramId, '123');

  const complete = createHarness(actor);
  assert.deepEqual(
    await complete.service.handleCallback(
      callback('booking:complete:booking-1'),
    ),
    { ok: true },
  );
  const completeCall = complete.calls.find((entry) => entry[0] === 'complete');
  assert.ok(completeCall);
  assert.equal(completeCall[2].role, 'waiter');
  assert.equal(completeCall[2].staffId, 'staff-waiter-1');
  assert.equal(completeCall[2].name, 'Олександр');
  assert.equal(completeCall[2].telegramId, '123');

  const approve = createHarness(actor);
  assert.deepEqual(
    await approve.service.handleCallback(
      callback('booking:approve:booking-1'),
    ),
    { ok: false },
  );
  assert.equal(approve.calls.some((entry) => entry[0] === 'approve'), false);
});

test('Waiter off shift cannot execute waiter callbacks', async () => {
  const actor = {
    role: 'waiter',
    active: true,
    isArchived: false,
    isOnShift: false,
  };

  for (const data of [
    'menu:waiter',
    'booking:checkin:booking-1',
    'booking:complete:booking-1',
  ]) {
    const { service } = createHarness(actor);
    assert.deepEqual(await service.handleCallback(callback(data)), { ok: false });
  }
});

test('Hookah role cannot execute waiter or admin callbacks', async () => {
  const actor = {
    role: 'hookah',
    active: true,
    isArchived: false,
    isOnShift: true,
  };

  for (const data of [
    'booking:checkin:booking-1',
    'booking:approve:booking-1',
    'restaurant:open',
  ]) {
    const { service } = createHarness(actor);
    assert.deepEqual(await service.handleCallback(callback(data)), { ok: false });
  }
});

test('unknown callback remains non-privileged and keeps existing response', async () => {
  const { service, calls } = createHarness(null);

  const result = await service.handleCallback(callback('unknown:action'));

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.some((entry) => entry[0] === 'staff-find'), false);
  assert.equal(
    calls.some(
      (entry) => entry[0] === 'message' && /не розпізнано/.test(entry[2]),
    ),
    true,
  );
});
