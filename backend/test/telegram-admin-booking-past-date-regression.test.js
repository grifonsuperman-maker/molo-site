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
