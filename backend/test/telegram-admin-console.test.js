const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramAdminMenuService,
} = require('../dist/telegram/telegram-admin-menu.service.js');
const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

const ACTOR = {
  sub: 'admin-1',
  telegramId: '777',
  role: 'admin',
  staffId: 'admin-1',
  name: 'Олена Адміністратор',
};

function harness(options = {}) {
  const calls = [];
  const today = options.today || [
    {
      id: 'booking-1',
      status: 'pending',
      bookingDate: '2026-08-22',
      bookingTime: '19:00:00',
      guestsCount: 4,
      checkedInAt: null,
      table: { id: 'table-1', tableNumber: '1', zone: { name: 'Зал ресторану' } },
      client: { fullName: 'Гість Один', phone: '+380000000001' },
    },
  ];
  const dashboard = options.dashboard || { tableChanges: [], reviews: [] };
  const restaurantState = {
    status: 'open',
    adminCanSendBroadcasts: options.canBroadcast !== false,
    adminCanManageOnlineBooking: true,
    adminCanManageRestaurant: true,
    ...(options.restaurant || {}),
  };
  const tables = options.tables || [
    { id: 'table-1', tableNumber: '1', seats: 4, status: 'free', isVisible: true, zone: { name: 'Зал ресторану' } },
    { id: 'table-15', tableNumber: '15', seats: 4, status: 'occupied', isVisible: true, zone: { name: 'Навіс' } },
  ];

  const bookings = {
    async getToday() { return today; },
    async getPendingReschedules() { return options.reschedules || []; },
    async approve(id) { calls.push(['approve', id]); },
    async reject(id) { calls.push(['reject', id]); },
    async checkIn(id, actor) { calls.push(['checkin', id, actor]); },
    async complete(id, actor) { calls.push(['complete', id, actor]); },
    async rejectReschedule(id) { calls.push(['reschedule-reject', id]); },
  };
  const rescheduleApproval = {
    async approve(id) { calls.push(['reschedule-approve', id]); },
  };
  const attention = {
    async dashboard() { return dashboard; },
  };
  const broadcasts = {
    async getTargetClients(target) {
      calls.push(['broadcast-target', target]);
      return [
        { id: 'client-1', telegramId: '1001' },
        { id: 'client-2', telegramId: null },
      ];
    },
    async sendNow(payload) {
      calls.push(['broadcast-send', payload]);
      if (options.broadcastGate) await options.broadcastGate;
      return { recipientCount: 2, deliveredCount: 1, unreachableCount: 1 };
    },
  };
  const permissions = {
    async assert(actor, permission) {
      calls.push(['permission', actor.role, permission]);
      if (options.permissionError) throw options.permissionError;
    },
  };
  const restaurant = {
    async getRestaurant() { return restaurantState; },
    async adminOpenRestaurant() { calls.push(['admin-open-restaurant']); },
    async adminCloseRestaurant() { calls.push(['admin-close-restaurant']); },
    async adminOpenBooking() { calls.push(['admin-open-booking']); },
    async adminCloseBooking() { calls.push(['admin-close-booking']); },
    async openRestaurant() {},
    async closeRestaurant() {},
    async openBooking() {},
    async closeBooking() {},
  };
  const tableService = { async findAll() { return tables; } };
  const telegram = {
    async sendMessage(chatId, text, markup) {
      calls.push(['message', chatId, text, markup]);
      return { ok: true };
    },
  };
  const bookingCreate = options.bookingCreate || {
    hasPendingInput() { return false; },
    clearPendingInput(id) { calls.push(['booking-create-clear', id]); },
    async handleAction(id, chatId, actor) {
      calls.push(['booking-create-action', id, chatId, actor]);
      return true;
    },
    async handleText(text, chatId, actor) {
      calls.push(['booking-create-text', text, chatId, actor]);
      return true;
    },
  };

  return {
    calls,
    service: new TelegramAdminMenuService(
      bookings,
      rescheduleApproval,
      attention,
      broadcasts,
      permissions,
      restaurant,
      tableService,
      telegram,
      bookingCreate,
    ),
  };
}

function lastMessage(calls) {
  return [...calls].reverse().find((entry) => entry[0] === 'message');
}

function buttons(messageCall) {
  return (messageCall?.[3]?.inline_keyboard || []).flat();
}

function callbackFor(messageCall, text) {
  return buttons(messageCall).find((button) => button.text === text)?.callback_data || null;
}

function draftId(callbackData) {
  return String(callbackData || '').split(':')[2] || null;
}

test('Admin menu shows counts, manual booking, locations, broadcast and full Mini App', async () => {
  const { service, calls } = harness({
    reschedules: [{ id: 'reschedule-1' }],
    dashboard: { tableChanges: [{ id: 'change-1' }], reviews: [{ id: 'review-1' }] },
  });

  await service.sendMenu(42, ACTOR, 'https://molo.example/app#admin');

  const message = lastMessage(calls);
  assert.match(message[2], /Бронювань сьогодні: <b>1<\/b>/);
  assert.match(message[2], /Запитів на перенесення: <b>1<\/b>/);
  assert.match(message[2], /Запитів на інший стіл: <b>1<\/b>/);
  const texts = buttons(message).map((button) => button.text);
  assert.equal(texts.includes('➕ Створити бронювання'), true);
  assert.equal(texts.some((value) => /Локації та столи/.test(value)), true);
  assert.equal(texts.some((value) => /Розсилка всім гостям/.test(value)), true);
  assert.equal(texts.some((value) => /Відкрити повний пульт/.test(value)), true);
});

test('manual booking stays inside existing authorized admin:booking callback family', async () => {
  const { service, calls } = harness();
  await service.handle('booking', 'create', 42, ACTOR);
  assert.equal(
    calls.some((entry) => entry[0] === 'booking-create-action' && entry[1] === 'create'),
    true,
  );
});

test('broadcast button is hidden without Director permission', async () => {
  const { service, calls } = harness({ canBroadcast: false });
  await service.sendMenu(42, ACTOR, 'https://molo.example/app#admin');
  assert.equal(buttons(lastMessage(calls)).some((button) => /Розсилка/.test(button.text)), false);
});

test('locations show statuses without status-changing callbacks', async () => {
  const { service, calls } = harness();

  await service.handle('locations', undefined, 42, ACTOR);
  assert.equal(buttons(lastMessage(calls)).some((button) => button.callback_data === 'admin:location:canopy'), true);

  await service.handle('location', 'canopy', 42, ACTOR);
  const message = lastMessage(calls);
  assert.match(message[2], /Навіс/);
  assert.equal(buttons(message).some((button) => /№15 · Зайнятий/.test(button.text)), true);
  const callbacks = buttons(message).map((button) => button.callback_data).filter(Boolean);
  assert.equal(callbacks.includes('admin:table:table-15'), true);
  assert.equal(callbacks.some((value) => /occupied|free|cleaning|table_close|table_open/.test(value)), false);
});

test('broadcast to all requires preview and draft-bound confirmation', async () => {
  const { service, calls } = harness();

  await service.handle('broadcast', undefined, 42, ACTOR);
  await service.handleText('Сьогодні жива музика 🎵', 42, ACTOR);
  const preview = lastMessage(calls);
  const confirmData = callbackFor(preview, '✅ Надіслати всім');
  assert.match(confirmData, /^admin:broadcast_confirm:[a-f0-9]{16}$/);
  assert.equal(calls.some((entry) => entry[0] === 'broadcast-send'), false);

  await service.handle('broadcast_confirm', draftId(confirmData), 42, ACTOR);

  const send = calls.find((entry) => entry[0] === 'broadcast-send');
  assert.equal(send[1].target, 'all_clients');
  assert.equal(send[1].message, 'Сьогодні жива музика 🎵');
  assert.equal(service.hasPendingInput('777'), false);
  assert.ok(calls.filter((entry) => entry[0] === 'permission').length >= 3);
});

test('double broadcast confirmation can deliver at most once', async () => {
  let releaseBroadcast;
  const broadcastGate = new Promise((resolve) => { releaseBroadcast = resolve; });
  const { service, calls } = harness({ broadcastGate });

  await service.handle('broadcast', undefined, 42, ACTOR);
  await service.handleText('Одне повідомлення', 42, ACTOR);
  const id = draftId(callbackFor(lastMessage(calls), '✅ Надіслати всім'));

  const first = service.handle('broadcast_confirm', id, 42, ACTOR);
  const second = service.handle('broadcast_confirm', id, 42, ACTOR);
  const settled = Promise.allSettled([first, second]);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.filter((entry) => entry[0] === 'broadcast-send').length, 1);
  releaseBroadcast();
  const results = await settled;
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
});

test('old preview cannot confirm a newer corrected broadcast', async () => {
  const { service, calls } = harness();

  await service.handle('broadcast', undefined, 42, ACTOR);
  await service.handleText('Варіант А', 42, ACTOR);
  const firstId = draftId(callbackFor(lastMessage(calls), '✅ Надіслати всім'));
  await service.handleText('Варіант Б', 42, ACTOR);
  const secondId = draftId(callbackFor(lastMessage(calls), '✅ Надіслати всім'));
  assert.notEqual(firstId, secondId);

  await assert.rejects(
    () => service.handle('broadcast_confirm', firstId, 42, ACTOR),
    /неактуальна/,
  );
  assert.equal(calls.some((entry) => entry[0] === 'broadcast-send'), false);

  await service.handle('broadcast_confirm', secondId, 42, ACTOR);
  assert.equal(calls.find((entry) => entry[0] === 'broadcast-send')[1].message, 'Варіант Б');
});

test('reviews page stays below Telegram message limit', async () => {
  const reviews = Array.from({ length: 8 }, (_, index) => ({
    id: `review-${index + 1}`,
    text: 'Д'.repeat(500),
    booking: {
      client: { fullName: `Гість ${index + 1}` },
      table: { tableNumber: String(index + 1) },
    },
  }));
  const { service, calls } = harness({ dashboard: { tableChanges: [], reviews } });

  await service.handle('reviews', '0', 42, ACTOR);

  const message = lastMessage(calls);
  assert.ok(message[2].length < 4096);
  assert.equal(buttons(message).some((button) => button.callback_data === 'admin:reviews:1'), true);
});

test('Admin booking approval uses the same BookingsService as the site', async () => {
  const { service, calls } = harness();
  await service.handle('booking_approve', 'booking-1', 42, ACTOR);
  assert.equal(calls.some((entry) => entry[0] === 'approve' && entry[1] === 'booking-1'), true);
});

test('/start gives Admin Telegram commands and full Admin Mini App', async () => {
  const previousUrl = process.env.TELEGRAM_WEB_APP_URL;
  process.env.TELEGRAM_WEB_APP_URL = 'https://molo.example/app';
  const sent = [];
  const telegram = {
    async sendMessage(...args) { sent.push(args); return { ok: true }; },
    async answerCallbackQuery() { return { ok: true }; },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId(id) {
      assert.equal(id, '777');
      return { id: 'admin-1', fullName: 'Олена', role: 'admin', isOnShift: false };
    },
  };
  const adminMenu = { clearPendingInput(id) { assert.equal(id, '777'); } };
  const webhook = new TelegramWebhookService(
    {}, {}, {}, telegram, telegramStaff, undefined, undefined, adminMenu,
  );

  try {
    await webhook.handleMessage({ chat: { id: 42 }, from: { id: 777 }, text: '/start' });
  } finally {
    if (previousUrl === undefined) delete process.env.TELEGRAM_WEB_APP_URL;
    else process.env.TELEGRAM_WEB_APP_URL = previousUrl;
  }

  const keyboard = sent[0][2].inline_keyboard;
  assert.deepEqual(keyboard[0], [
    { text: '👔 Команди Адміністратора', callback_data: 'menu:admin' },
  ]);
  assert.deepEqual(keyboard[1], [
    {
      text: '👔 Відкрити панель адміністратора',
      web_app: { url: 'https://molo.example/app#admin' },
    },
  ]);
});
