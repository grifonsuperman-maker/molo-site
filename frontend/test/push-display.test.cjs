const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const worker = fs.readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');

function harness(windows = []) {
  const listeners = new Map();
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: 'https://molo.example' },
    skipWaiting: () => {},
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: {
      claim: async () => {},
      matchAll: async () => windows,
      openWindow: async (url) => { opened.push(url); },
    },
    addEventListener: (event, listener) => listeners.set(event, listener),
  };
  vm.runInNewContext(worker, { self, URL });
  return { listeners, shown, opened };
}

async function dispatchPush(h, payload) {
  let task;
  h.listeners.get('push')({
    data: payload === undefined ? null : { json: () => payload },
    waitUntil: (promise) => { task = promise; },
  });
  if (task) await task;
}

test('displays a branded push for each approved MOLO category', async () => {
  const h = harness();
  const categories = {
    booking: 'Бронювання',
    review_reply: 'Відповідь на відгук',
    restaurant_status: 'Повідомлення ресторану',
    broadcast: 'Новини MOLO',
  };
  for (const [category, label] of Object.entries(categories)) {
    await dispatchPush(h, { category, body: '  Повідомлення для гостя  ' });
    const { title, options } = h.shown.at(-1);
    assert.equal(title, `MOLO · ${label}`);
    assert.equal(options.body, 'Повідомлення для гостя');
    assert.equal(options.icon, '/pwa-icon-192.png');
    assert.equal(options.badge, '/pwa-icon-192.png');
    assert.equal(options.data.url, '/');
  }
  assert.equal(h.shown.length, 4);
});

test('does not display an empty, malformed, oversized or unknown push', async () => {
  const h = harness();
  const invalid = [undefined, null, [], {}, { category: 'other', body: 'x' },
    { category: 'booking', body: '  ' }, { category: 'booking', body: 1 },
    { category: 'booking', body: 'x'.repeat(501) }];
  for (const payload of invalid) await dispatchPush(h, payload);
  h.listeners.get('push')({ data: { json: () => { throw Error('invalid JSON'); } }, waitUntil: () => assert.fail('invalid push waited') });
  assert.equal(h.shown.length, 0);
});

test('notification click focuses guest MOLO, never staff or an external URL', async () => {
  let focused = 0;
  const h = harness([
    { url: 'https://outside.example/', focus: async () => assert.fail('external focused') },
    { url: 'https://molo.example/#admin', focus: async () => assert.fail('staff focused') },
    { url: 'https://molo.example/?tgWebAppStartParam=staff_secret', focus: async () => assert.fail('staff invite focused') },
    { url: 'https://molo.example/#guest', focus: async () => { focused += 1; } },
  ]);
  let closed = 0;
  let task;
  h.listeners.get('notificationclick')({ notification: {
    data: { url: 'https://outside.example/steal' }, close: () => { closed += 1; },
  }, waitUntil: (promise) => { task = promise; } });
  await task;
  assert.equal(focused, 1);
  assert.equal(closed, 1);
  assert.equal(h.opened.length, 0);
});

test('notification click opens only the MOLO homepage when no guest window exists', async () => {
  const h = harness([
    { url: 'https://molo.example/#director', focus: () => assert.fail('staff focused') },
    { url: 'https://molo.example/?tgWebAppStartParam=staff_secret', focus: () => assert.fail('staff invite focused') },
  ]);
  let task;
  h.listeners.get('notificationclick')({ notification: { close: () => {} }, waitUntil: (promise) => { task = promise; } });
  await task;
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0], '/');
});

test('worker does not cache requests or request permission or subscribe without a server', () => {
  assert.doesNotMatch(worker, /caches\.|CacheStorage|respondWith\(/);
  assert.doesNotMatch(worker, /requestPermission\(|pushManager\.subscribe\(/);
  assert.match(worker, /addEventListener\('fetch'/);
});

test('denied push permission shows recovery guidance before the support gate', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/guest/components/GuestPushOptIn.tsx'), 'utf8');
  const guidance = source.indexOf("if (error && 'Notification' in window && Notification.permission === 'denied'");
  const supportGate = source.indexOf('if (!vapidKey || !onGuestHome || !inGuestContext || !installed');
  assert.ok(guidance > 0 && supportGate > guidance);
  const deniedBranch = source.slice(guidance, supportGate);
  assert.match(deniedBranch, /onGuestHome && inGuestContext && installed && hasBookingAccess && !dismissed/);
  assert.match(deniedBranch, /<p role="status"[^>]*>\{error\}<\/p>/);
  assert.match(deniedBranch, /onClick=\{dismiss\}/);
  assert.doesNotMatch(deniedBranch, /hasPushSupport\(\)/);
});
