const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramAdminMenuService,
} = require('../dist/telegram/telegram-admin-menu.service.js');
const {
  TelegramWebhookService,
} = require('../dist/telegram/telegram-webhook.service.js');

function adminActor() {
  return {
    sub: 'admin-1',
    telegramId: '777',
    role: 'admin',
    staffId: 'admin-1',
    name: 'Олена Адміністратор',
  };
}

function menuHarness(options = {}) {
  const calls = [];
  const today = options.today || [
    {
      id: 'booking-1',
      status: 'pending',
      bookingDate: '2026-08-22',
      bookingTime: '19:00:00',
      guestsCount: 4,
      checkedInAt: null,
      table: {
        id: 'table-1',
        tableNumber: '1',
        zone: { name: 'Зал ресторану' },
      },
      client: { fullName: 'Гість Один', phone: '+380000000001' },
    },
  ];
  const reschedules = options.reschedules || [];
  const dashboard = options.dashboard || {
    tableChanges: [],
    reviews: [],
  };
  const restaurantState = {
    status: 'open',
    adminCanSendBroadcasts: options.canBroadcast !== false,
    adminCanManageOnlineBooking: true,
    adminCanManageRestaurant: true,
    ...(options.restaurant || {}),
  };
  const tables = options.tables || [
    {
      id: 'table-1',
      tableNumber: '1',
      seats: 4,
      status: 'free',
      isVisible: true,
      zone: { name: 'Зал ресторану' },
    },
    {
      id: 'table-15',
      tableNumber: '15',
      seats: 4,
      status: 'occupied',
      isVisible: true,
      zone: { name: 'Навіс' },
    },
  ];

  const bookings = {
    async getToday() {
      return today;
    },
    async getPendingReschedules() {
      return reschedules;
    },
    async approve(id) {
      calls.push(['approve', id]);
    },
    async reject(id) {
      calls.push(['reject', id]);
    },
    async checkIn(id, actor) {
      calls.push(['checkin', id, actor]);
    },
    async complete(id, actor) {
      calls.push(['complete', id, actor]);
    },
    async rejectReschedule(id) {
      calls.push(['reschedule-reject', id]);
    },
  };
  const rescheduleApproval = {
    async approve(id) {
      calls.push(['reschedule-approve', id]);
    },
  };
  const attention = {
    async dashboard() {
      return dashboard;
    },
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
      return {
        recipientCount: 2,
        deliveredCount: 1,
        unreachableCount: 1,
      };
    },
  };
  const permissions = {
    async assert(actor, permission) {
      calls.push(['permission', actor.role, permission]);
      if (options.permissionError) throw options.permissionError;
    },
  };
  const restaurant = {
    async getRestaurant() {
      return restaurantState;
    },
    async adminOpenRestaurant() {
      calls.push(['admin-open-restaurant']);
    },
    async adminCloseRestaurant() {
      calls.push(['admin-close-restaurant']);
    },
    async adminOpenBooking() {
      calls.push(['admin-open-booking']);
    },
    async adminCloseBooking() {
      calls.push(['admin-close-booking']);
    },
    async openRestaurant() {},
    async closeRestaurant() {},
    async openBooking() {},
    async closeBooking() {},
  };
  const tableService = {
    async findAll() {
      return tables;
    },
  };
  const telegram = {
    async sendMessage(chatId, text, markup) {
      calls.push(['message', chatId, text, markup]);
      return { ok: true };
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
    ),
  };
}

function lastMessage(calls) {
  return [...calls].reverse().find((entry) => entry[0] === 'message');
}

function keyboardTexts(messageCall) {
  return (messageCall?.[3]?.inline_keyboard || []).flat().map((button) => button.text);
}

function callbackDataForText(messageCall, text) {
  const button = (messageCall?.[3]?.inline_keyboard || [])
    .flat()
    .find((item) => item.text === text);
  return button?.callback_data || null;
}

function draftIdFromCallback(callbackData) {
  return String(callbackData || '').split(':')[2] || null;
}

test('Admin Telegram menu shows operational counts, locations, broadcast and full Mini App', async () => {
  const { service, calls } = menuHarness({
    reschedules: [{ id: 'reschedule-1' }],
    dashboard: {
      tableChanges: [{ id: 'change-1' }],
      reviews: [{ id: 'review-1' }],
    },
  });

  await service.sendMenu(42, adminActor(), 'https://molo.example/app#admin');

  const message = lastMessage(calls);
  assert.match(message[2], /Бронювань сьогодні: <b>1<\/b>/);
  assert.match(message[2], /Запитів на перенесення: <b>1<\/b>/);
  assert.match(message[2], /Запитів на інший стіл: <b>1<\/b>/);
  const texts = keyboardTexts(message);
  assert.equal(texts.some((value) => /Локації та столи/.test(value)), true);
  assert.equal(texts.some((value) => /Розсилка всім гостям/.test(value)), true);
  assert.equal(texts.some((value) => /Відкрити повний пульт/.test(value)), true);
});

test('broadcast button is hidden when Director did not grant Admin broadcast permission', async () => {
  const { service, calls } = menuHarness({ canBroadcast: false });

  await service.sendMenu(42, adminActor(), 'https://molo.example/app#admin');

  const texts = keyboardTexts(lastMessage(calls));
  assert.equal(texts.some((value) => /Розсилка/.test(value)), false);
});

test('locations and tables show current status without status-changing Telegram callbacks', async () => {
  const { service, calls } = menuHarness();

  await service.handle('locations', undefined, 42, adminActor());
  let message = lastMessage(calls);
  let callbacks = message[3].inline_keyboard.flat().map((button) => button.callback_data).filter(Boolean);
  assert.equal(callbacks.includes('admin:location:hall'), true);
  assert.equal(callbacks.includes('admin:location:canopy'), true);

  await service.handle('location', 'canopy', 42, adminActor());
  message = lastMessage(calls);
  assert.match(message[2], /Навіс/);
  assert.equal(keyboardTexts(message).some((value) => /№15 · Зайнятий/.test(value)), true);
  callbacks = message[3].inline_keyboard.flat().map((button) => button.callback_data).filter(Boolean);
  assert.equal(callbacks.some((value) => /occupied|free|cleaning|close|open/.test(value)), false);
  assert.equal(callbacks.includes('admin:table:table-15'), true);
});

test('Admin broadcast to all requires permission, preview and explicit draft-bound confirmation', async () => {
  const { service, calls } = menuHarness();
  const actor = adminActor();

  await service.handle('broadcast', undefined, 42, actor);
  assert.equal(service.hasPendingInput('777'), true);
  assert.equal(calls.some((entry) => entry[0] === 'broadcast-target' && entry[1] === 'all_clients'), true);

  await service.handleText('Сьогодні жива музика 🎵', 42, actor);
  let message = lastMessage(calls);
  assert.match(message[2], /Перевірте розсилку/);
  assert.match(message[2], /Сьогодні жива музика/);
  assert.equal(keyboardTexts(message).includes('✅ Надіслати всім'), true);
  assert.equal(calls.some((entry) => entry[0] === 'broadcast-send'), false);

  const confirmData = callbackDataForText(message, '✅ Надіслати всім');
  assert.match(confirmData, /^admin:broadcast_confirm:[a-f0-9]{16}$/);
  const draftId = draftIdFromCallback(confirmData);
  await service.handle(
    'broadcast_confirm',
    draftId,
    42,
    actor,
    'https://molo.example/app#admin',
  );

  const send = calls.find((entry) => entry[0] === 'broadcast-send');
  assert.ok(send);
  assert.equal(send[1].target, 'all_clients');
  assert.equal(send[1].message, 'Сьогодні жива музика 🎵');
  assert.equal(service.hasPendingInput('777'), false);
  assert.ok(calls.filter((entry) => entry[0] === 'permission').length >= 3);
});

test('double broadcast confirmation can deliver at most once', async () => {
  let releaseBroadcast;
  const broadcastGate = new Promise((resolve) => {
    releaseBroadcast = resolve;
  });
  const { service, calls } = menuHarness({ broadcastGate });
  const actor = adminActor();

  await service.handle('broadcast', undefined, 42, actor);
  await service.handleText('Одне повідомлення', 42, actor);
  const preview = lastMessage(calls);
  const draftId = draftIdFromCallback(
    callbackDataForText(preview, '✅ Надіслати всім'),
  );

  const first = service.handle('broadcast_confirm', draftId, 42, actor);
  const second = service.handle('broadcast_confirm', draftId, 42, actor);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    calls.filter((entry) => entry[0] === 'broadcast-send').length,
    1,
  );
  releaseBroadcast();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
});

test('old broadcast preview cannot confirm a newer corrected message', async () => {
  const { service, calls } = menuHarness();
  const actor = adminActor();

  await service.handle('broadcast', undefined, 42, actor);
  await service.handleText('Варіант А', 42, actor);
  const firstPreview = lastMessage(calls);
  const firstId = draftIdFromCallback(
    callbackDataForText(firstPreview, '✅ Надіслати всім'),
  );

  await service.handleText('Варіант Б', 42, actor);
  const secondPreview = lastMessage(calls);
  const secondId = draftIdFromCallback(
    callbackDataForText(secondPreview, '✅ Надіслати всім'),
  );
  assert.notEqual(firstId, secondId);

  await assert.rejects(
    () => service.handle('broadcast_confirm', firstId, 42, actor),
    /неактуальна/,
  );
  assert.equal(calls.some((entry) => entry[0] === 'broadcast-send'), false);

  await service.handle('broadcast_confirm', secondId, 42, actor);
  const send = calls.find((entry) => entry[0] === 'broadcast-send');
  assert.equal(send[1].message, 'Варіант Б');
});

test('reviews page stays safely below Telegram message size limit', async () => {
  const reviews = Array.from({ length: 8 }, (_, index) => ({
    id: `review-${index + 1}`,
    text: 'Д'.repeat(500),
    booking: {
      client: { fullName: `Гість ${index + 1}` },
      table: { tableNumber: String(index + 1) },
    },
  }));
  const { service, calls } = menuHarness({
    dashboard: { tableChanges: [], reviews },
  });

  await service.handle('reviews', '0', 42, adminActor());

  const message = lastMessage(calls);
  assert.ok(message[2].length < 4096);
  const callbacks = message[3].inline_keyboard.flat().map((button) => button.callback_data).filter(Boolean);
  assert.equal(callbacks.includes('admin:reviews:1'), true);
});

test('Admin booking approval uses the same BookingsService used by the site', async () => {
  const { service, calls } = menuHarness();

  await service.handle('booking_approve', 'booking-1', 42, adminActor());

  assert.equal(calls.some((entry) => entry[0] === 'approve' && entry[1] === 'booking-1'), true);
});

test('/start gives a linked Admin both Telegram commands and the full Admin Mini App', async () => {
  const previousUrl = process.env.TELEGRAM_WEB_APP_URL;
  process.env.TELEGRAM_WEB_APP_URL = 'https://molo.example/app';
  const sent = [];
  const telegram = {
    async sendMessage(...args) {
      sent.push(args);
      return { ok: true };
    },
    async answerCallbackQuery() {
      return { ok: true };
    },
  };
  const telegramStaff = {
    async findActiveStaffByTelegramId(id) {
      assert.equal(id, '777');
      return {
        id: 'admin-1',
        fullName: 'Олена',
        role: 'admin',
        isOnShift: false,
      };
    },
  };
  const adminMenu = {
    clearPendingInput(id) {
      assert.equal(id, '777');
    },
  };
  const webhook = new TelegramWebhookService(
    {},
    {},
    {},
    telegram,
    telegramStaff,
    undefined,
    undefined,
    adminMenu,
  );

  try {
    await webhook.handleMessage({
      chat: { id: 42 },
      from: { id: 777 },
      text: '/start',
    });
  } finally {
    if (previousUrl === undefined) delete process.env.TELEGRAM_WEB_APP_URL;
    else process.env.TELEGRAM_WEB_APP_URL = previousUrl;
  }

  const keyboard = sent[0][2].inline_keyboard;
  assert.deepEqual(keyboard[0], [
    {
      text: '👔 Команди Адміністратора',
      callback_data: 'menu:admin',
    },
  ]);
  assert.deepEqual(keyboard[1], [
    {
      text: '👔 Відкрити панель адміністратора',
      web_app: { url: 'https://molo.example/app#admin' },
    },
  ]);
});
