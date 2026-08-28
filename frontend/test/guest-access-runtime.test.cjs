const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadRuntimeModule() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/api/guestAccessRuntime.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', output)(mod, mod.exports);
  return mod.exports;
}

function withWindow(value, work) {
  const previous = Object.getOwnPropertyDescriptor(global, 'window');
  Object.defineProperty(global, 'window', {
    configurable: true,
    writable: true,
    value,
  });
  try {
    return work();
  } finally {
    if (previous) Object.defineProperty(global, 'window', previous);
    else delete global.window;
  }
}

test('guest runtime access survives blocked localStorage in the current tab', () => {
  const runtime = loadRuntimeModule();
  runtime.rememberGuestRuntimeAccess('device-1', [
    { bookingId: 'booking-1', token: 'token-1' },
  ]);

  withWindow({}, () => {
    Object.defineProperty(global.window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage blocked');
      },
    });

    assert.deepEqual(runtime.readGuestBrowserAccess(), {
      guestDeviceId: 'device-1',
      bookings: [{ bookingId: 'booking-1', token: 'token-1' }],
    });
  });
});

test('guest runtime access caches valid storage before storage becomes unavailable', () => {
  const runtime = loadRuntimeModule();
  const values = new Map([
    ['molo:guest:device-id:v1', 'device-stored'],
    [
      'molo:guest:bookings:v1',
      JSON.stringify([{ bookingId: 'booking-stored', token: 'token-stored' }]),
    ],
  ]);
  const storage = {
    getItem(key) {
      return values.get(key) || null;
    },
  };

  withWindow({ localStorage: storage }, () => {
    assert.deepEqual(runtime.readGuestBrowserAccess(), {
      guestDeviceId: 'device-stored',
      bookings: [{ bookingId: 'booking-stored', token: 'token-stored' }],
    });

    Object.defineProperty(global.window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage became blocked');
      },
    });

    assert.deepEqual(runtime.readGuestBrowserAccess(), {
      guestDeviceId: 'device-stored',
      bookings: [{ bookingId: 'booking-stored', token: 'token-stored' }],
    });
  });
});

test('booking creation captures the returned guest token in tab memory', () => {
  const bookingsSource = fs.readFileSync(
    path.resolve(__dirname, '../src/api/bookings.ts'),
    'utf8',
  );

  assert.match(bookingsSource, /rememberGuestRuntimeAccess\(payload\.guestDeviceId/);
  assert.match(bookingsSource, /bookingId: result\.bookingId/);
  assert.match(bookingsSource, /token: result\.guestAccessToken/);
});

test('GuestApp keeps per-booking tokens from shared guest runtime access', () => {
  const guestAppSource = fs.readFileSync(
    path.resolve(__dirname, '../src/guest/GuestApp.tsx'),
    'utf8',
  );

  assert.match(guestAppSource, /readGuestBrowserAccess/);
  assert.match(guestAppSource, /function readGuestBookingAccess\(\)/);
  assert.match(guestAppSource, /readGuestBrowserAccess\(\)\.bookings/);
  assert.match(
    guestAppSource,
    /useState<GuestBookingToken\[\]>\(readGuestBookingAccess\)/,
  );
  assert.match(guestAppSource, /setGuestBookings\(readGuestBookingAccess\(\)\)/);
});

test('booking decision polling uses safe shared guest access without direct storage reads', () => {
  const decisionSource = fs.readFileSync(
    path.resolve(__dirname, '../src/guest/components/GuestBookingDecisionController.tsx'),
    'utf8',
  );

  assert.match(decisionSource, /readGuestBrowserAccess\(\)/);
  assert.doesNotMatch(decisionSource, /window\.localStorage/);
  assert.match(decisionSource, /const POLLING_MS = 15_000;/);
});

test('API token lookup catches blocked storage access', () => {
  const clientSource = fs.readFileSync(
    path.resolve(__dirname, '../src/api/client.ts'),
    'utf8',
  );

  assert.match(
    clientSource,
    /export function getAccessToken\(\) \{\s*try \{\s*if \(typeof localStorage === 'undefined'\) return null;\s*return localStorage\.getItem\(TOKEN_KEY\);\s*\} catch \{\s*return null;/,
  );
});
