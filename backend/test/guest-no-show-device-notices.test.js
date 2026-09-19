require('reflect-metadata');

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { GuestNoShowNoticesService } = require('../dist/bookings/guest-no-show-notices.service.js');

const DEVICE = 'browser-device-1';
const HASH = createHash('sha256').update(DEVICE).digest('hex');

function booking(overrides = {}) {
  return {
    id: 'owned-booking',
    status: 'cancelled',
    cancellationReason: 'no_show',
    bookingDate: '2026-09-18',
    bookingTime: '23:45:00',
    durationMinutes: 120,
    guestsCount: 2,
    wishes: null,
    guestNotification: {
      type: 'no_show',
      title: 'Ваше бронювання анульовано',
      reason: 'automatic_no_show_30m',
      createdAt: '2026-09-18T21:15:00.000Z',
    },
    table: { id: 'table-8', tableNumber: '8', zone: { id: 'zone-1', name: 'Зал' } },
    ...overrides,
  };
}

function harness(rows = [booking()]) {
  const calls = [];
  const records = rows;
  let lookup = null;
  const listQuery = {
    leftJoinAndSelect() { return this; },
    where(sql, params) { calls.push(['where', sql, params]); return this; },
    andWhere(sql, params) { calls.push(['andWhere', sql, params]); return this; },
    orderBy() { return this; },
    async getMany() { return records.filter((row) =>
      row.status === 'cancelled' &&
      row.cancellationReason === 'no_show' &&
      row.guestNotification?.type === 'no_show' &&
      row.guestNotification?.reason === 'automatic_no_show_30m' &&
      !row.guestNotification?.acknowledgedAt,
    ); },
  };
  const acknowledgementQuery = {
    where(sql, params) { lookup = { ...(lookup || {}), bookingId: params.bookingId }; return this; },
    andWhere(sql, params) { lookup = { ...lookup, deviceHash: params.deviceHash }; return this; },
    setLock(mode) { calls.push(['lock', mode]); return this; },
    async getOne() {
      if (lookup.deviceHash !== HASH) return null;
      return records.find((row) => row.id === lookup.bookingId) || null;
    },
  };
  const transactionBookings = {
    createQueryBuilder: () => acknowledgementQuery,
    async save(row) { calls.push(['booking.save', row.id]); return row; },
  };
  const history = {
    create: (entry) => entry,
    async save(entry) { calls.push(['history.save', entry.action]); return entry; },
  };
  const dataSource = {
    async transaction(callback) {
      calls.push(['transaction']);
      return callback({ getRepository: (entity) => entity.name === 'Booking' ? transactionBookings : history });
    },
  };
  const repository = { createQueryBuilder: () => listQuery };
  return { service: new GuestNoShowNoticesService(repository, dataSource), calls, rows: records };
}

test('only unread automatic no-show notices can be listed by device, including after Kyiv midnight', async () => {
  const { service, calls } = harness([
    booking(),
    booking({ id: 'manual-cancellation', cancellationReason: 'guest_cancelled' }),
    booking({ id: 'manual-no-show', guestNotification: { type: 'no_show', reason: 'manual' } }),
    booking({ id: 'already-read', guestNotification: { type: 'no_show', reason: 'automatic_no_show_30m', acknowledgedAt: '2026-09-19T01:00:00Z' } }),
  ]);
  const notices = await service.listUnreadForDevice(DEVICE);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].bookingId, 'owned-booking');
  assert.equal(notices[0].bookingDate, '2026-09-18');
  assert.equal(notices[0].status, 'cancelled');
  assert.equal(notices[0].canGuestCancel, false);
  assert.equal(notices[0].canLeaveReview, false);
  assert.equal(Object.hasOwn(notices[0], 'guestDeviceIdHash'), false);
  assert.equal(Object.hasOwn(notices[0], 'guestAccessTokenHash'), false);
  assert.ok(calls.some((call) => call[0] === 'where' && call[2].deviceHash === HASH));
  assert.ok(calls.some((call) => call[0] === 'andWhere' && call[1].includes('acknowledgedAt')));
  assert.ok(calls.some((call) => call[0] === 'andWhere' && call[1].includes('guest_notification') && call[1].includes('reason')));
  assert.equal(calls.some((call) => String(call[1]).includes('bookingDate')), false);
});

test('blank or excessively long device IDs never list notices', async () => {
  const { service, calls } = harness();
  assert.deepEqual(await service.listUnreadForDevice(''), []);
  assert.deepEqual(await service.listUnreadForDevice('x'.repeat(257)), []);
  assert.equal(calls.length, 0);
});

test('device acknowledgement locks only its own automatic no-show and removes unread notice', async () => {
  const { service, calls } = harness();
  await assert.rejects(service.acknowledgeByDevice('owned-booking', 'wrong-device'), /Недійсний доступ/);
  assert.ok(!calls.some((call) => call[0] === 'booking.save'));
  const response = await service.acknowledgeByDevice('owned-booking', DEVICE);
  assert.equal(response.message, 'Повідомлення прочитано');
  assert.ok(calls.some((call) => call[0] === 'lock' && call[1] === 'pessimistic_write'));
  assert.equal(calls.filter((call) => call[0] === 'history.save').length, 1);
  assert.deepEqual(await service.listUnreadForDevice(DEVICE), []);
  await service.acknowledgeByDevice('owned-booking', DEVICE);
  assert.equal(calls.filter((call) => call[0] === 'history.save').length, 1);
});

test('device acknowledgement cannot operate on active bookings or unrelated notifications', async () => {
  for (const row of [
    booking({ status: 'approved' }),
    booking({ cancellationReason: 'guest_cancelled' }),
    booking({ guestNotification: { type: 'manual_change', reason: 'automatic_no_show_30m' } }),
    booking({ guestNotification: { type: 'no_show', reason: 'manual_no_show' } }),
  ]) {
    const { service, calls } = harness([row]);
    await assert.rejects(service.acknowledgeByDevice(row.id, DEVICE), /Недійсний доступ/);
    assert.ok(!calls.some((call) => call[0] === 'booking.save'));
  }
});
