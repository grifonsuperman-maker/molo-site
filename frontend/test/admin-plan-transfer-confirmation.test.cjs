const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const planner = fs.readFileSync(path.join(root, 'src/admin/AdminVisualTablePlanner.tsx'), 'utf8');
const bookingApi = fs.readFileSync(path.join(root, 'src/api/bookings.ts'), 'utf8');
const match = planner.match(/(  async function transferBooking\(booking: Booking\) \{[\s\S]*?\n  \})\n  function openManualBooking/);
assert.ok(match, 'the live Admin Plan transfer handler must be present');
const handler = match[1]
  .replace('booking: Booking', 'booking')
  .replace('catch (actionError: any)', 'catch (actionError)');

assert.match(bookingApi, /getByDate: \(date: string, options\?: RequestInit\)/);
assert.match(planner, /booking\.bookingDate === today && \(table\.status === 'occupied' \|\| table\.status === 'cleaning'\)/);

async function transferScenario({ actualTableId = 'table-42', readFails = false, patchFails = false } = {}) {
  const events = {
    errors: [], notices: [], refreshed: [], reloaded: [], selected: [], requests: [],
  };
  const context = {
    transferTableId: 'table-42',
    reason: { trim: () => '' },
    setBusy() {},
    setError(value) { events.errors.push(value); },
    setNotice(value) { events.notices.push(value); },
    setBookings(value) { events.refreshed.push(value); },
    setTransferBookingId(value) { events.selected.push(value); },
    setTransferTableId(value) { events.selected.push(value); },
    async load(silent) { events.reloaded.push(silent); },
    availabilityBlocksApi: {
      async transferBooking(id, tableId) {
        events.requests.push({ method: 'PATCH', id, tableId });
        if (patchFails) throw new Error('Сервер відхилив перенесення');
      },
    },
    bookingsApi: {
      async getByDate(date, options) {
        events.requests.push({ method: 'GET', date, cache: options?.cache });
        if (readFails) throw new Error('Network unavailable');
        return [{ id: 'booking-41', table: { id: actualTableId, tableNumber: actualTableId === 'table-42' ? '42' : '41' } }];
      },
    },
  };
  const action = vm.runInNewContext(`(() => { ${handler}; return transferBooking; })()`, context);
  await action({ id: 'booking-41', bookingDate: '2026-10-08' });
  return events;
}

(async () => {
  const success = await transferScenario();
  assert.deepEqual(success.requests.map((request) => request.method), ['PATCH', 'GET']);
  assert.equal(success.requests[1].cache, 'no-store');
  assert.deepEqual(success.reloaded, [true]);
  assert.ok(success.notices.some((notice) => notice.includes('№42')));
  assert.deepEqual(success.selected, [null, '']);
  assert.equal(success.refreshed[0][0].table.tableNumber, '42');

  const stale = await transferScenario({ actualTableId: 'table-41' });
  assert.deepEqual(stale.reloaded, [], 'do not treat stale booking data as success');
  assert.deepEqual(stale.selected, [], 'keep the destination selection until verified');
  assert.ok(stale.errors.some((message) => message.includes('не підтверджено')));
  assert.equal(stale.notices.filter(Boolean).length, 0);

  const uncertain = await transferScenario({ readFails: true });
  assert.deepEqual(uncertain.selected, []);
  assert.equal(uncertain.notices.filter(Boolean).length, 0);
  assert.ok(uncertain.errors.some((message) => message.includes('Перевірте поточний стіл')));

  const rejected = await transferScenario({ patchFails: true });
  assert.deepEqual(rejected.requests.map((request) => request.method), ['PATCH']);
  assert.ok(rejected.errors.some((message) => message.includes('Сервер відхилив перенесення')));

  console.log('admin plan table transfer read-back regression passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
