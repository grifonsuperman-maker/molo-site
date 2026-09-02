const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramAdminBookingCreateService,
} = require('../dist/telegram/telegram-admin-booking-create.service.js');

const ACTOR = {
  sub: 'admin-1',
  telegramId: '777',
  role: 'admin',
  staffId: 'admin-1',
  name: 'Олена Адміністратор',
};

function kyivDate(offsetDays) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value || 1970);
  const month = Number(parts.find((part) => part.type === 'month')?.value || 1);
  const day = Number(parts.find((part) => part.type === 'day')?.value || 1);
  return new Date(Date.UTC(year, month - 1, day + offsetDays)).toISOString().slice(0, 10);
}

function lastMessage(calls) {
  return [...calls].reverse().find((entry) => entry[0] === 'message');
}

function callbackFor(messageCall, text) {
  const keyboard = messageCall?.[3]?.inline_keyboard || [];
  return keyboard.flat().find((button) => button.text === text)?.callback_data || null;
}

function actionId(callbackData) {
  const parts = String(callbackData || '').split(':');
  assert.equal(parts[0], 'admin');
  assert.equal(parts[1], 'booking');
  return parts[2];
}

test('Admin Telegram rejects a past booking date and keeps the draft on date step', async () => {
  const calls = [];
  const service = new TelegramAdminBookingCreateService(
    {
      async createManual() {
        throw new Error('createManual must not run for a rejected past date');
      },
    },
    {
      async withCreateLock(_dto, work) {
        return work();
      },
    },
    {
      async assertBookable() {},
    },
    {
      async findAll() {
        calls.push(['tables']);
        return [];
      },
    },
    {
      async sendMessage(chatId, text, markup) {
        calls.push(['message', chatId, text, markup]);
        return { ok: true };
      },
    },
  );

  await service.begin(42, ACTOR);
  await service.handleText(kyivDate(-1), 42, ACTOR);

  assert.equal(service.hasPendingInput('777'), true);
  assert.equal(calls.filter((entry) => entry[0] === 'tables').length, 0);
  assert.match(lastMessage(calls)[2], /Минула дата недоступна/);

  await service.handleText(kyivDate(0), 42, ACTOR);
  assert.match(lastMessage(calls)[2], /Крок 2\/6/);
});

test('Admin Telegram rechecks the booking date on confirm after Kyiv date rollover', async () => {
  const calls = [];
  let createManualCalls = 0;
  let currentKyivDate = '2026-09-10';
  const service = new TelegramAdminBookingCreateService(
    {
      async createManual() {
        createManualCalls += 1;
        return { bookingId: 'must-not-be-created' };
      },
    },
    {
      async withCreateLock(_dto, work) {
        calls.push(['lock']);
        return work();
      },
    },
    {
      async assertBookable() {
        calls.push(['availability']);
      },
    },
    {
      async findAll() {
        return [
          {
            id: 'table-15',
            tableNumber: '15',
            isVisible: true,
            status: 'free',
          },
        ];
      },
    },
    {
      async sendMessage(chatId, text, markup) {
        calls.push(['message', chatId, text, markup]);
        return { ok: true };
      },
    },
  );

  service.kyivDate = () => currentKyivDate;

  await service.begin(42, ACTOR);
  await service.handleText('2026-09-10', 42, ACTOR);
  await service.handleText('15', 42, ACTOR);
  await service.handleText('18:30', 42, ACTOR);
  await service.handleText('Марина', 42, ACTOR);
  await service.handleText('2', 42, ACTOR);

  const skipCallback = callbackFor(lastMessage(calls), '⏭ Пропустити телефон');
  await service.handleAction(actionId(skipCallback), 42, ACTOR);
  const confirmCallback = callbackFor(lastMessage(calls), '✅ Створити бронювання');

  currentKyivDate = '2026-09-11';
  await service.handleAction(actionId(confirmCallback), 42, ACTOR);

  assert.equal(createManualCalls, 0);
  assert.equal(calls.filter((entry) => entry[0] === 'lock').length, 0);
  assert.equal(calls.filter((entry) => entry[0] === 'availability').length, 0);
  assert.equal(service.hasPendingInput('777'), false);
  assert.match(lastMessage(calls)[2], /Дата бронювання вже минула/);
  assert.equal(
    callbackFor(lastMessage(calls), '➕ Створити заново'),
    'admin:booking:create',
  );
});
