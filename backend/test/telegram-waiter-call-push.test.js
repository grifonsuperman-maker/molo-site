const assert = require('node:assert/strict');
const test = require('node:test');

const {
  WaiterCallTelegramNotifierService,
} = require('../dist/waiter-calls/waiter-call-telegram-notifier.service.js');
const {
  WaiterCallsController,
} = require('../dist/waiter-calls/waiter-calls.controller.js');

function call(overrides = {}) {
  return {
    id: 'call-1',
    bookingId: 'booking-1',
    tableId: 'table-8',
    tableNumber: '8',
    clientName: 'Ататoa',
    waiterId: null,
    waiterName: null,
    status: 'new',
    createdAt: '2099-01-01T12:00:00.000Z',
    acceptedAt: null,
    closedAt: null,
    ...overrides,
  };
}

test('new unassigned waiter call pushes only to linked waiters on shift and includes active count', async () => {
  const sent = [];
  const notifier = new WaiterCallTelegramNotifierService(
    {
      async find(options) {
        assert.deepEqual(options.where, {
          role: 'waiter',
          active: true,
          isArchived: false,
          isOnShift: true,
        });
        return [
          { id: 'waiter-1', telegramId: '101' },
          { id: 'waiter-2', telegramId: '202' },
          { id: 'waiter-no-telegram', telegramId: null },
        ];
      },
    },
    {
      async sendMessage(chatId, text, replyMarkup) {
        sent.push({ chatId, text, replyMarkup });
        return { ok: true };
      },
    },
  );

  const newCall = call();
  const activeCalls = [
    newCall,
    call({ id: 'call-w1', waiterId: 'waiter-1' }),
    call({ id: 'call-w2', waiterId: 'waiter-2' }),
    call({ id: 'call-other', waiterId: 'waiter-3' }),
  ];

  const summary = await notifier.notifyCreated(newCall, activeCalls);

  assert.deepEqual(summary, { attempted: 2, delivered: 2, failed: 0 });
  assert.deepEqual(sent.map((item) => item.chatId), ['101', '202']);
  for (const item of sent) {
    assert.match(item.text, /Новий виклик Офіціанта/);
    assert.match(item.text, /Стіл №<b>8<\/b>/);
    assert.match(item.text, /Активних викликів: <b>2<\/b>/);
    assert.equal(
      item.replyMarkup.inline_keyboard[0][0].callback_data,
      'waiter:call_accept:call-1',
    );
    assert.equal(item.replyMarkup.inline_keyboard[1][0].text, '🔔 Виклики · 2');
  }
});

test('assigned waiter call pushes only to that linked waiter', async () => {
  const sent = [];
  const notifier = new WaiterCallTelegramNotifierService(
    {
      async find() {
        return [
          { id: 'waiter-1', telegramId: '101' },
          { id: 'waiter-2', telegramId: '202' },
        ];
      },
    },
    {
      async sendMessage(chatId, text, replyMarkup) {
        sent.push({ chatId, text, replyMarkup });
        return { ok: true };
      },
    },
  );

  const assignedCall = call({ waiterId: 'waiter-1', waiterName: 'Олександр' });
  await notifier.notifyCreated(assignedCall, [assignedCall]);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '101');
  assert.match(sent[0].text, /Активних викликів: <b>1<\/b>/);
});

test('guest call response does not wait for Telegram push and starts notification after save', async () => {
  const newCall = call();
  let listed = 0;
  let notified = 0;
  const originalConsoleInfo = console.info;
  console.info = () => undefined;

  try {
    const controller = new WaiterCallsController(
      {
        async createFromGuest() {
          return { message: 'Виклик відправлено у загальний список офіціантів', call: newCall };
        },
        async list() {
          listed += 1;
          return [newCall];
        },
      },
      {
        async notifyCreated(currentCall, activeCalls) {
          notified += 1;
          assert.equal(currentCall.id, 'call-1');
          assert.equal(activeCalls.length, 1);
        },
      },
    );

    const result = await controller.createFromGuest({ bookingId: 'booking-1' }, 'guest-token');
    assert.equal(result.call.id, 'call-1');

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(listed, 1);
    assert.equal(notified, 1);
  } finally {
    console.info = originalConsoleInfo;
  }
});

test('duplicate guest call does not send a second Telegram push', async () => {
  const existingCall = call();
  let listed = 0;
  let notified = 0;

  const controller = new WaiterCallsController(
    {
      async createFromGuest() {
        return { message: 'Виклик вже відправлено', call: existingCall };
      },
      async list() {
        listed += 1;
        return [existingCall];
      },
    },
    {
      async notifyCreated() {
        notified += 1;
      },
    },
  );

  await controller.createFromGuest({ bookingId: 'booking-1' }, 'guest-token');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(listed, 0);
  assert.equal(notified, 0);
});

test('Telegram push failure cannot undo an already saved guest call', async () => {
  const newCall = call();
  const originalConsoleError = console.error;
  const originalConsoleInfo = console.info;
  console.error = () => undefined;
  console.info = () => undefined;

  try {
    const controller = new WaiterCallsController(
      {
        async createFromGuest() {
          return { message: 'Виклик відправлено у загальний список офіціантів', call: newCall };
        },
        async list() {
          throw new Error('telegram-side lookup failed');
        },
      },
      {
        async notifyCreated() {
          throw new Error('should not be reached');
        },
      },
    );

    const result = await controller.createFromGuest({ bookingId: 'booking-1' }, 'guest-token');
    assert.equal(result.call.id, 'call-1');

    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = originalConsoleError;
    console.info = originalConsoleInfo;
  }
});

test('Telegram timing diagnostics mark recipient lookup and Telegram confirmation without personal data', async () => {
  const lines = [];
  const originalConsoleInfo = console.info;
  console.info = (...args) => lines.push(args.join(' '));

  try {
    const notifier = new WaiterCallTelegramNotifierService(
      {
        async find() {
          return [{ id: 'waiter-1', telegramId: '101' }];
        },
      },
      {
        async sendMessage() {
          return { ok: true };
        },
      },
    );

    const startedAtMs = Date.now();
    const newCall = call();
    await notifier.notifyCreated(newCall, [newCall], startedAtMs);

    const payloads = lines
      .filter((line) => line.startsWith('[waiter-call-timing] '))
      .map((line) => JSON.parse(line.slice('[waiter-call-timing] '.length)));

    assert.deepEqual(
      payloads.map((payload) => payload.stage),
      ['recipients_resolved', 'telegram_send_started', 'telegram_confirmed'],
    );
    assert.ok(payloads.every((payload) => payload.callId === 'call-1'));
    assert.ok(payloads.every((payload) => Number.isInteger(payload.elapsedMs)));
    assert.ok(lines.every((line) => !line.includes('Ататoa')));
    assert.ok(lines.every((line) => !line.includes('101')));
  } finally {
    console.info = originalConsoleInfo;
  }
});
