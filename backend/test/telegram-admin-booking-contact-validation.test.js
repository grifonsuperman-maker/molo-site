const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TelegramAdminBookingCreateService,
} = require('../dist/telegram/telegram-admin-booking-create.service.js');

const ACTOR = {
  sub: 'admin-contact-test',
  telegramId: '778',
  role: 'admin',
  staffId: 'admin-contact-test',
  name: 'Адміністратор',
};

function tomorrowKyiv() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value || 1970);
  const month = Number(parts.find((part) => part.type === 'month')?.value || 1);
  const day = Number(parts.find((part) => part.type === 'day')?.value || 1);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function harness() {
  const calls = [];
  const bookings = {
    async createManual(dto) {
      calls.push(['createManual', dto]);
      return { bookingId: 'booking-1', status: 'approved', bookingDate: dto.bookingDate, bookingTime: `${dto.bookingTime}:00` };
    },
  };
  const tableLock = { async withCreateLock(_dto, work) { return work(); } };
  const availability = { async assertBookable() {} };
  const tables = {
    async findAll() {
      return [{ id: 'table-15', tableNumber: '15', isVisible: true, status: 'free' }];
    },
  };
  const telegram = {
    async sendMessage(_chatId, text, markup) {
      calls.push(['message', text, markup]);
      return { ok: true };
    },
  };
  return {
    calls,
    service: new TelegramAdminBookingCreateService(bookings, tableLock, availability, tables, telegram),
  };
}

function lastMessage(calls) {
  return [...calls].reverse().find((entry) => entry[0] === 'message');
}

function confirmAction(calls) {
  const keyboard = lastMessage(calls)?.[2]?.inline_keyboard || [];
  const callback = keyboard.flat().find((button) => button.text === '✅ Створити бронювання')?.callback_data;
  assert.match(callback, /^admin:booking:create_confirm_[a-f0-9]+$/);
  return callback.split(':')[2];
}

async function reachNameStep(service) {
  await service.begin(42, ACTOR);
  await service.handleText(tomorrowKyiv(), 42, ACTOR);
  await service.handleText('15', 42, ACTOR);
  await service.handleText('18:30', 42, ACTOR);
}

test('Telegram manual booking rejects non-letter guest names before persistence', async () => {
  const { service, calls } = harness();
  await reachNameStep(service);

  await service.handleText('Олена123', 42, ACTOR);

  assert.match(lastMessage(calls)[1], /лише літери/);
  assert.equal(calls.filter((entry) => entry[0] === 'createManual').length, 0);
  assert.equal(service.hasPendingInput('778'), true);

  await service.handleText('  Олена   Коваль  ', 42, ACTOR);
  assert.match(lastMessage(calls)[1], /Скільки гостей/);
});

test('Telegram manual booking rejects an invalid phone and normalizes a valid legacy subscriber number', async () => {
  const { service, calls } = harness();
  await reachNameStep(service);
  await service.handleText('Олена Коваль', 42, ACTOR);
  await service.handleText('2', 42, ACTOR);

  await service.handleText('123', 42, ACTOR);
  assert.match(lastMessage(calls)[1], /\+380 \(XX\) XXX-XX-XX/);
  assert.equal(calls.filter((entry) => entry[0] === 'createManual').length, 0);

  await service.handleText('501234567', 42, ACTOR);
  assert.match(lastMessage(calls)[1], /\+380501234567/);

  await service.handleAction(confirmAction(calls), 42, ACTOR);

  const createCall = calls.find((entry) => entry[0] === 'createManual');
  assert.equal(createCall[1].fullName, 'Олена Коваль');
  assert.equal(createCall[1].phone, '+380501234567');
});
