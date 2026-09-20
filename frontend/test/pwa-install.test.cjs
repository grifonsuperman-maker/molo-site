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
  assert.match(source, /isGuestHomeVisible\(\)/);
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
