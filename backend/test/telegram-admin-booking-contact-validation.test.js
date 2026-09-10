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
  name: 'Адміністратор',
};

function kyivTomorrow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value || 1970);
  const month = Number(parts.find((part) => part.type === 'month')?.value || 1);
  const day = Number(parts.find((part) => part.type === 'day')?.value || 1);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function createHarness() {
  const messages = [];
  const service = new TelegramAdminBookingCreateService(
    { createManual: async () => ({}) },
    { withCreateLock: async (_dto, work) => work() },
    { assertBookable: async () => {} },
    {
      findAll: async () => [
        { id: 'table-15', tableNumber: '15', isVisible: true, status: 'free' },
      ],
    },
    {
      sendMessage: async (_chatId, text, markup) => {
        messages.push({ text, markup });
        return { ok: true };
      },
    },
  );
  return { service, messages };
}

async function reachNameStep(service) {
  await service.begin(42, ACTOR);
  await service.handleText(kyivTomorrow(), 42, ACTOR);
  await service.handleText('15', 42, ACTOR);
  await service.handleText('18:30', 42, ACTOR);
}

test('Telegram Admin rejects digits in guest name', async () => {
  const { service, messages } = createHarness();
  await reachNameStep(service);

  await service.handleText('Анна123', 42, ACTOR);

  assert.match(messages.at(-1).text, /лише літери/);
  assert.equal(service.hasPendingInput('777'), true);
});

test('Telegram Admin validates a provided Ukrainian phone but still offers skip', async () => {
  const { service, messages } = createHarness();
  await reachNameStep(service);
  await service.handleText('Анна Марія', 42, ACTOR);
  await service.handleText('2', 42, ACTOR);

  const phoneStep = messages.at(-1);
  assert.match(phoneStep.text, /\+380 \(XX\) XXX-XX-XX/);
  assert.ok(
    phoneStep.markup.inline_keyboard.flat().some((button) => button.text === 'Пропустити телефон'),
  );

  await service.handleText('+380 (67) 123-45', 42, ACTOR);
  assert.match(messages.at(-1).text, /\+380 \(XX\) XXX-XX-XX/);

  await service.handleText('+380 (67) 123-45-67', 42, ACTOR);
  assert.match(messages.at(-1).text, /\+380671234567/);
});
