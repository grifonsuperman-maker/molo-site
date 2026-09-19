require('reflect-metadata');

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { BookingsController } = require('../dist/bookings/bookings.controller.js');
const { GuestNoShowNoticesService } = require('../dist/bookings/guest-no-show-notices.service.js');

const DEVICE = 'browser-device-1';
const HASH = createHash('sha256').update(DEVICE).digest('hex');

function booking(overrides = {}) {
  return {
    id: '7ae79432-09e3-47f2-ac16-a79384932128',
    guestDeviceIdHash: HASH,
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
  const repository = {
    createQueryBuilder() {
      let deviceHash = null;
      let unreadOnly = false;
      return {
        where(sql, params) {
          calls.push(['where', sql, params]);
          deviceHash = params.deviceHash || null;
          if (params.bookingId) lookup = { bookingId: params.bookingId };
          return this;
        },
        andWhere(sql, params = {}) {
          calls.push(['andWhere', sql, params]);
          if (params.deviceHash) deviceHash = params.deviceHash;
          if (sql.includes('acknowledgedAt')) unreadOnly = true;
          return this;
        },
        orderBy() { return this; },
        setLock(mode) { calls.push(['lock', mode]); return this; },
        async getMany() {
          return records.filter((row) =>
            row.guestDeviceIdHash === deviceHash &&
            row.status === 'cancelled' &&
            row.cancellationReason === 'no_show' &&
            row.guestNotification?.type === 'no_show' &&
            row.guestNotification?.reason === 'automatic_no_show_30m' &&
            (!unreadOnly || !row.guestNotification?.acknowledgedAt),
          );
        },
        async getOne() {
          if (!lookup) return null;
          return records.find((row) => row.id === lookup.bookingId && row.guestDeviceIdHash === deviceHash) || null;
        },
      };
    },
    async save(row) { calls.push(['booking.save', row.id]); return row; },
  };
  const history = {
    create: (entry) => entry,
    async save(entry) { calls.push(['history.save', entry.action]); return entry; },
  };
  const dataSource = {
    async transaction(callback) {
      calls.push(['transaction']);
      return callback({ getRepository: (entity) => entity.name === 'Booking' ? repository : history });
    },
  };
  return { service: new GuestNoShowNoticesService(repository, dataSource), calls, rows: records };
}

test('device notice returns an opaque one-purpose handle without any booking identity or historical details', async () => {
  const { service, calls, rows } = harness([
    booking(),
    booking({ id: 'manual-cancellation', cancellationReason: 'guest_cancelled' }),
    booking({ id: 'manual-no-show', guestNotification: { type: 'no_show', reason: 'manual' } }),
    booking({ id: 'already-read', guestNotification: { type: 'no_show', reason: 'automatic_no_show_30m', acknowledgedAt: '2026-09-19T01:00:00Z' } }),
    booking({ id: 'another-device', guestDeviceIdHash: 'different-hash' }),
  ]);
  const notices = await service.listUnreadForDevice(DEVICE);
  assert.equal(notices.length, 1);
  assert.deepEqual(Object.keys(notices[0]).sort(), ['guestNotification', 'noticeHandle']);
  assert.match(notices[0].noticeHandle, /^[a-f0-9]{64}$/);
  assert.notEqual(notices[0].noticeHandle, rows[0].id);
  assert.deepEqual(Object.keys(notices[0].guestNotification).sort(), ['createdAt', 'message', 'title', 'type']);
  assert.equal(notices[0].guestNotification.type, 'no_show');
  for (const key of ['bookingId', 'bookingDate', 'bookingTime', 'tableNumber', 'status', 'guestDeviceIdHash', 'guestAccessTokenHash']) {
    assert.equal(Object.hasOwn(notices[0], key), false, `must not disclose ${key}`);
  }
  assert.ok(calls.some((call) => call[0] === 'where' && call[2].deviceHash === HASH));
  assert.ok(calls.some((call) => call[0] === 'andWhere' && call[1].includes('acknowledgedAt')));
  assert.ok(calls.some((call) => call[0] === 'andWhere' && call[1].includes('guest_notification') && call[1].includes('reason')));
});

test('controller keeps historical no-shows out of guest/list and exposes notice-only handle', async () => {
  const { service } = harness();
  const active = { bookingId: 'active-booking', status: 'approved', checkedInAt: null };
  const controller = new BookingsController(
    {}, { async list() { return [active]; } }, {}, {}, {}, {}, {}, {}, {}, {}, service,
  );
  const list = await controller.guestList({ guestDeviceId: DEVICE });
  assert.equal(list.length, 1);
  assert.equal(list[0].bookingId, active.bookingId);
  assert.equal(list[0].canGuestChangeTime, true);
  const notices = await controller.guestNoShowNotices({ guestDeviceId: DEVICE });
  assert.equal(notices.length, 1);
  assert.deepEqual(Object.keys(notices[0]).sort(), ['guestNotification', 'noticeHandle']);
});

test('old unread automatic no-show never adds historical booking to an empty guest list', async () => {
  const { service } = harness([booking({ bookingDate: '2026-09-17' })]);
  const controller = new BookingsController(
    {}, { async list() { return []; } }, {}, {}, {}, {}, {}, {}, {}, {}, service,
  );
  assert.deepEqual(await controller.guestList({ guestDeviceId: DEVICE }), []);
  const notices = await controller.guestNoShowNotices({ guestDeviceId: DEVICE });
  assert.equal(notices.length, 1);
  assert.match(notices[0].noticeHandle, /^[a-f0-9]{64}$/);
  assert.equal('bookingDate' in notices[0], false);
  assert.equal('bookingId' in notices[0], false);
});

test('blank or excessively long device IDs never list notices', async () => {
  const { service, calls } = harness();
  assert.deepEqual(await service.listUnreadForDevice(''), []);
  assert.deepEqual(await service.listUnreadForDevice('x'.repeat(257)), []);
  assert.equal(calls.length, 0);
});

test('device acknowledgement locks the booking privately using only its own opaque handle', async () => {
  const { service, calls, rows } = harness();
  const [{ noticeHandle }] = await service.listUnreadForDevice(DEVICE);
  await assert.rejects(service.acknowledgeByDevice(noticeHandle, 'wrong-device'), /Недійсний доступ/);
  await assert.rejects(service.acknowledgeByDevice(rows[0].id, DEVICE), /Недійсний доступ/);
  await assert.rejects(service.acknowledgeByDevice('a'.repeat(64), DEVICE), /Недійсний доступ/);
  assert.ok(!calls.some((call) => call[0] === 'booking.save'));
  const response = await service.acknowledgeByDevice(noticeHandle, DEVICE);
  assert.equal(response.message, 'Повідомлення прочитано');
  assert.ok(calls.some((call) => call[0] === 'lock' && call[1] === 'pessimistic_write'));
  assert.equal(calls.filter((call) => call[0] === 'history.save').length, 1);
  assert.deepEqual(await service.listUnreadForDevice(DEVICE), []);
  await service.acknowledgeByDevice(noticeHandle, DEVICE);
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
    await assert.rejects(service.acknowledgeByDevice('a'.repeat(64), DEVICE), /Недійсний доступ/);
    assert.ok(!calls.some((call) => call[0] === 'booking.save'));
  }
});
