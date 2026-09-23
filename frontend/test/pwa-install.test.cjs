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

test('permission is requested only from the click action and registration proves every active booking ownership', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  const handler = source.indexOf('async function enableNotifications()');
  assert.ok(handler > 0);
  assert.doesNotMatch(source.slice(0, handler), /Notification\.requestPermission\(\)/);
  assert.match(source.slice(handler), /Notification\.requestPermission\(\)/);
  assert.match(source, /onClick=\{\(\) => \{ void enableNotifications\(\); \}\}/);
  assert.match(source, /userVisibleOnly: true/);
  assert.match(source, /applicationServerKey: key/);
  assert.match(source, /bookingsApi\.guestList\(/);
  assert.match(source, /booking\.status === 'pending' \|\| booking\.status === 'approved'/);
  assert.match(source, /booking\.bookingDate >= today/);
  assert.match(source, /timeZone: 'Europe\/Kyiv'/);
  assert.match(source, /for \(const booking of activeAccess\)/);
  assert.match(source, /guestDeviceId: access\.guestDeviceId/);
  assert.match(source, /bookingId: booking\.bookingId/);
  assert.match(source, /guestAccessToken: booking\.token/);
  assert.match(source, /subscription: subscription\.toJSON\(\)/);
  assert.match(source, /activeAccess\.map\(\(booking\) =>\s*subscriptionFingerprint\(booking\.bookingId/);
  assert.match(source, /result\?\.enabled !== true/);
  assert.doesNotMatch(source, /access\.bookings\[0\]/);
  assert.doesNotMatch(read('public/sw.js'), /guestAccessToken|guestDeviceId/);
});

test('revoked or failed server readiness clears the previously offered push key', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  assert.match(source, /setVapidKey\(''\);\s*setCompleted\(false\);\s*if \(!onGuestHome/);
  assert.match(source, /const key = config\?\.enabled === true/);
  assert.match(source, /if \(!key \|\| !\(await isValidVapidPublicKey\(key\)\) \|\| cancelled\) return;/);
  assert.match(source, /setVapidKey\(key\);/);
  assert.match(source, /\.catch\(\(\) => \{\s*if \(!cancelled\) \{\s*setVapidKey\(''\);/);
});

test('an old VAPID subscription is replaced rather than silently reused', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  assert.match(source, /subscription\?\.options\.applicationServerKey/);
  assert.match(source, /previousKey\.every\(\(byte, index\) => byte === key\[index\]\)/);
  assert.match(source, /if \(existing && !keyMatches\) await existing\.unsubscribe\(\)/);
  assert.match(source, /existing && keyMatches \? existing : await worker\.pushManager\.subscribe/);
});

test('resuming the same PWA screen rechecks the backend even when route does not change', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  assert.match(source, /const \[configRefresh, setConfigRefresh\] = useState\(0\)/);
  assert.match(source, /setConfigRefresh\(\(current\) => current \+ 1\)/);
  assert.match(source, /window\.addEventListener\('pageshow', refreshOnResume\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
  assert.match(source, /bookingAccessKey,/);
  assert.match(source, /refreshedActiveBookingKey,/);
  assert.match(source, /dismissed,\s*configRefresh,/);
  assert.match(source, /window\.addEventListener\('molo:guest-bookings-refreshed', refreshBookingState\)/);
  assert.match(source, /setRefreshedActiveBookingIds\(\[\.\.\.new Set\(activeBookingIds\)\]\.sort\(\)\)/);
  assert.doesNotMatch(source, /setInterval\(/);
});

test('guest booking refresh passes active ids to push without exposing tokens or adding polling', () => {
  const guestSource = read('src/guest/GuestApp.tsx');
  assert.match(guestSource, /new CustomEvent\('molo:guest-bookings-refreshed'/);
  assert.match(guestSource, /activeBookingIds: activeBookings\.map\(\(item\) => item\.bookingId\)/);
  assert.match(guestSource, /item\.bookingDate >= getKyivDateValue\(\)/);
  const eventBlock = guestSource.match(/new CustomEvent\('molo:guest-bookings-refreshed',[\s\S]*?\}\)\);/);
  assert.ok(eventBlock);
  assert.doesNotMatch(eventBlock[0], /token|guestDeviceId/);
});

test('dismissal expires after 30 days without losing tab-only dismissal when storage is blocked', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  assert.match(source, /const dismissedInTabAt = useRef\(0\)/);
  assert.match(source, /Date\.now\(\) - dismissedInTabAt\.current < DISMISS_FOR_MS/);
  assert.match(source, /setDismissed\(dismissedInTab \|\| wasRecentlyDismissed\(\)\)/);
  assert.match(source, /dismissedInTabAt\.current = Date\.now\(\)/);
});

test('confirmed subscriptions survive launch, booking-set changes and blocked storage', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  assert.match(source, /CONFIRMED_SUBSCRIPTION_KEY = 'molo:push:confirmed-subscription:v1'/);
  assert.match(source, /crypto\.subtle\.digest\('SHA-256', data\)/);
  assert.match(source, /let runtimeConfirmedFingerprints = new Set<string>\(\)/);
  assert.match(source, /if \(CONFIRMED_FINGERPRINT\.test\(stored\)\) return \[stored\]/);
  assert.match(source, /runtimeConfirmedFingerprints\.add\(fingerprint\)/);
  assert.match(source, /return \[\.\.\.runtimeConfirmedFingerprints\]/);
  assert.match(source, /JSON\.stringify\(\[\.\.\.runtimeConfirmedFingerprints\]\)/);
  assert.match(source, /activeFingerprints\.every\(\(fingerprint\) =>\s*confirmedFingerprints\.has\(fingerprint\)/);
  assert.match(source, /rememberConfirmedFingerprints\(fingerprints\)/);
  assert.match(source, /setCompleted\(alreadyConfirmed\)/);
  assert.match(source, /if \(!vapidKey \|\| !onGuestHome[\s\S]*\|\| dismissed \|\| completed\) return null;/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^,]+,\s*booking\.token/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^,]+,\s*subscription\.endpoint/);
});

test('VAPID key decoder rejects malformed keys before permission is offered', () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  const match = source.match(/function decodeVapidPublicKey\(key: string\): Uint8Array \| null \{[\s\S]*?\n\}/);
  assert.ok(match);
  const decoder = match[0].replace('(key: string): Uint8Array | null', '(key)');
  const decode = require('node:vm').runInNewContext(`${decoder}\ndecodeVapidPublicKey`, { atob, Uint8Array });
  const validShape = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
  assert.equal(validShape.length, 87);
  assert.equal(Array.from(decode(validShape)).length, 65);
  assert.equal(decode(validShape.slice(1)), null);
  assert.equal(decode('not-a-key'), null);
  assert.equal(decode(Buffer.alloc(65, 3).toString('base64url')), null);
});

test('only a valid P-256 point passes the VAPID readiness gate', async () => {
  const source = read('src/guest/components/GuestPushOptIn.tsx');
  const decodeMatch = source.match(/function decodeVapidPublicKey\(key: string\): Uint8Array \| null \{[\s\S]*?\n\}/);
  const validateMatch = source.match(/async function isValidVapidPublicKey\(key: string\) \{[\s\S]*?\n\}/);
  assert.ok(decodeMatch);
  assert.ok(validateMatch);
  assert.match(source, /if \(!key \|\| !\(await isValidVapidPublicKey\(key\)\) \|\| cancelled\) return;/);
  const decoder = decodeMatch[0].replace('(key: string): Uint8Array | null', '(key)');
  const validator = validateMatch[0].replace('(key: string)', '(key)')
    .replace('bytes as Uint8Array<ArrayBuffer>', 'bytes');
  const { webcrypto } = require('node:crypto');
  const validate = require('node:vm').runInNewContext(
    `${decoder}\n${validator}\nisValidVapidPublicKey`,
    { atob, Uint8Array, crypto: webcrypto },
  );
  const invalidPoint = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
  assert.equal(await validate(invalidPoint), false);
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const validPoint = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
  assert.equal(await validate(validPoint), true);
});

// Keep the push-display regression in the already wired frontend test command.
require('./push-display.test.cjs');
