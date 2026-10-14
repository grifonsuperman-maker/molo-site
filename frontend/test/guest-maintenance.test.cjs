const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const notice = fs.readFileSync(
  path.join(root, 'src/guest/components/GuestMaintenance.tsx'), 'utf8',
);

test('maintenance is limited to guests and excludes staff invite and developer access', () => {
  assert.match(
    app,
    /const showGuestMaintenance\s*=\s*mode === "guest" && !telegramInviteToken && !showDeveloperRoleSwitcher;/,
  );
  assert.match(app, /awaitingTelegramStaffRole\s*=\s*showGuestMaintenance &&\s*isTelegramMiniApp\(\)/);
  assert.match(app, /telegramRoleToMode\(telegramAuth\.user\.role\) !== "guest"/);
  assert.match(app, /!showGuestMaintenance && <SitePhotoController \/>/);
  assert.match(app, /showGuestMaintenance \? \(\s*awaitingTelegramStaffRole \? null : <GuestMaintenance \/>/);
});

test('staff consoles, role links, and Telegram linking remain mounted through the original entrypoint', () => {
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<script type="module" src="\/src\/main\.tsx"><\/script>/);
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\/pwa-icon-192\.png"/);
  assert.match(app, /<TelegramStaffLinkGate/);
  for (const mode of ['waiter', 'hookah', 'admin', 'director']) {
    assert.ok(app.includes('value === "' + mode + '"'), mode + ' deep link lost');
    assert.ok(app.includes('mode === "' + mode + '" &&'), mode + ' console lost');
  }
  assert.match(app, /<WaiterApp \/>/);
  assert.match(app, /<HookahApp \/>/);
  assert.match(app, /<AdminWorkspace \/>/);
  assert.match(app, /<DirectorWorkspace \/>/);
});

test('maintenance notice needs no API, booking data, or staff credentials', () => {
  assert.match(notice, /Технічне обслуговування та оновлення версії/);
  assert.match(notice, /dateTime="2026-10-18"/);
  assert.match(notice, /18\.10\.2026/);
  assert.match(notice, /Сайт відновить роботу/);
  assert.doesNotMatch(notice, /\b(fetch|axios|restaurantApi|bookingsApi|staffApi|useEffect)\b/);
});
