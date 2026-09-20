const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function pngSize(filename) {
  const data = fs.readFileSync(path.join(root, 'public', filename));
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test('MOLO install manifest uses approved icon assets and guest start page', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.name, 'Ресторан MOLO');
  assert.equal(manifest.short_name, 'MOLO');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'uk');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((entry) => entry.sizes === `${size}x${size}`);
    assert.ok(icon, `missing ${size}px icon`);
    assert.equal(icon.type, 'image/png');
    assert.deepEqual(pngSize(icon.src.slice(1)), [size, size]);
  }
});

test('installation metadata is wired to the actual frontend entrypoint', () => {
  const html = read('index.html');
  const main = read('src/main.tsx');
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\/pwa-icon-192\.png"/);
  assert.match(main, /import GuestInstallPrompt from ['"]\.\/guest\/components\/GuestInstallPrompt['"]/);
  assert.match(main, /<GuestInstallPrompt\s*\/>/);
});

test('install invitation is guest-home-only and excludes Telegram and staff invite', () => {
  const source = read('src/guest/components/GuestInstallPrompt.tsx');
  const home = read('src/guest/GuestApp.tsx');
  assert.match(source, /isGuestHomeVisible\(\)/);
  assert.match(home, /className="molo-site-mode-badge /);
  assert.match(source, /document\.querySelector\('section\.molo-screen \.molo-site-mode-badge'\)/);
  assert.doesNotMatch(source, /img\[src=/);
  assert.match(source, /isTelegramMiniApp\(\)/);
  assert.match(source, /readTelegramStaffInviteToken\(\)/);
  assert.match(source, /isDeveloperRoleSwitcherPath\(window\.location\.pathname\)/);
  assert.match(source, /window\.addEventListener\('beforeinstallprompt'/);
  assert.match(source, /window\.addEventListener\('appinstalled'/);
  assert.match(source, /window\.localStorage\.setItem\(DISMISSED_AT_KEY/);
  assert.match(source, /'Зачекайте…' : canPrompt \? 'Встановити MOLO' : 'Як встановити MOLO'/);
});

test('service worker does not cache booking requests or 15-second polling', () => {
  const worker = read('public/sw.js');
  assert.match(worker, /addEventListener\('fetch'/);
  assert.doesNotMatch(worker, /caches\.|CacheStorage|respondWith\(/);
  assert.match(read('src/guest/components/GuestInstallPrompt.tsx'), /serviceWorker\.register\('\/sw\.js'\)/);
});

test('push opt-in is wired only to installed guest home and a ready backend', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  const main = read('src/main.tsx');
  assert.match(main, /import GuestPushOptIn from ['"]\.\/guest\/components\/GuestPushOptIn['"]/);
  assert.match(main, /<GuestPushOptIn\s*\/>/);
  assert.match(source, /matchMedia\('\(display-mode: standalone\)'\)/);
  assert.match(source, /navigator as Navigator & \{ standalone\?: boolean \}/);
  assert.match(source, /section\.molo-screen \.molo-site-mode-badge/);
  assert.match(source, /isTelegramMiniApp\(\)/);
  assert.match(source, /readTelegramStaffInviteToken\(\)/);
  assert.match(source, /isDeveloperRoleSwitcherPath\(window\.location\.pathname\)/);
  assert.match(source, /readGuestBrowserAccess\(\)\.bookings\.length > 0/);
  assert.match(source, /config\?\.enabled === true/);
  assert.match(source, /api\.get<PushConfig>\('\/push\/guest\/config'\)/);
  assert.match(source, /if \(!vapidKey \|\| !onGuestHome \|\| !inGuestContext \|\| !installed/);
  assert.match(source, /Notification\.permission !== 'denied'/);
  assert.match(source, /src="\/pwa-icon-192\.png"/);
});

test('permission is requested only from the click action and registration proves booking ownership', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  const handler = source.indexOf('async function enableNotifications()');
  assert.ok(handler > 0);
  assert.doesNotMatch(source.slice(0, handler), /Notification\.requestPermission\(\)/);
  assert.match(source.slice(handler), /Notification\.requestPermission\(\)/);
  assert.match(source, /onClick=\{\(\) => \{ void enableNotifications\(\); \}\}/);
  assert.match(source, /userVisibleOnly: true/);
  assert.match(source, /applicationServerKey: key/);
  assert.match(source, /guestDeviceId: access\.guestDeviceId/);
  assert.match(source, /bookingId: booking\.bookingId/);
  assert.match(source, /guestAccessToken: booking\.token/);
  assert.match(source, /subscription: subscription\.toJSON\(\)/);
  assert.match(source, /result\?\.enabled !== true/);
  assert.doesNotMatch(read('public/sw.js'), /guestAccessToken|guestDeviceId/);
});

test('revoked or failed server readiness clears the previously offered push key', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  assert.match(source, /setVapidKey\(''\);\s*if \(!onGuestHome/);
  assert.match(source, /const key = config\?\.enabled === true/);
  assert.match(source, /setVapidKey\(key\);/);
  assert.match(source, /\.catch\(\(\) => \{ if \(!cancelled\) setVapidKey\(''\); \}\)/);
});

test('an old VAPID subscription is replaced rather than silently reused', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  assert.match(source, /existing\?\.options\.applicationServerKey/);
  assert.match(source, /previousKey\.every\(\(byte, index\) => byte === key\[index\]\)/);
  assert.match(source, /if \(existing && !keyMatches\) await existing\.unsubscribe\(\)/);
  assert.match(source, /existing && keyMatches \? existing : await worker\.pushManager\.subscribe/);
});

test('VAPID key decoder rejects malformed keys before permission is offered', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  const match = source.match(/function decodeVapidPublicKey\(key: string\): Uint8Array \| null \{[\s\S]*?\n\}/);
  assert.ok(match);
  const decoder = match[0].replace('(key: string): Uint8Array | null', '(key)');
  const decode = require('node:vm').runInNewContext(`${decoder}\ndecodeVapidPublicKey`, { atob, Uint8Array });
  const valid = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
  assert.equal(valid.length, 87);
  assert.equal(Array.from(decode(valid)).length, 65);
  assert.equal(decode(valid.slice(1)), null);
  assert.equal(decode('not-a-key'), null);
  assert.equal(decode(Buffer.alloc(65, 3).toString('base64url')), null);
});

// Keep the push-display regression in the already wired frontend test command.
require('./push-display.test.cjs');
