const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const controller = read('src/guest/components/GuestBookingDecisionController.tsx');
const api = read('src/guest/services/noShowNoticeApi.ts');
const notice = read('src/guest/no-show-rule.css');
const main = read('src/main.tsx');
const guestApp = read('src/guest/GuestApp.tsx');

assert.match(controller, /const POLLING_MS = 15_000;/, 'booking-decision polling stays 15 seconds');
assert.match(controller, /item\.status === 'cancelled' &&\s*item\.guestNotification\?\.type === 'no_show'/, 'only unread no-show is eligible for device fallback');
assert.match(controller, /!tokenFor\(item\.bookingId\)/, 'device fallback is reserved for lost booking tokens');
assert.match(controller, /if \(token\) \{\s*await bookingsApi\.guestAcknowledgeNotification/, 'token-based acknowledgement is preserved');
assert.match(controller, /noShowNoticeApi\.acknowledgeByDevice\(booking\.bookingId, guestDeviceId\)/, 'tokenless notice has a working acknowledgement action');
assert.match(api, /\/guest\/no-show\/ack-by-device/, 'device-only API uses a dedicated limited endpoint');
assert.match(api, /\{ guestDeviceId \}/, 'device ID is sent only to the dedicated endpoint');
assert.match(guestApp, /const unreadNotificationBookings = myBookings\.filter/, 'main guest cards preserve unread notifications');
assert.match(guestApp, /booking\.guestNotification &&\s*!booking\.guestNotification\.acknowledgedAt/, 'main guest cards hide acknowledged notices');

assert.ok(main.indexOf("import './guest/no-show-rule.css';") > main.indexOf("import './styles.css';"), 'clarification overrides old guest warning');
assert.match(notice, /Поки Адміністратор розглядає ваш запит на зміну часу, відлік призупинено/, 'pending request pauses the deadline');
assert.match(notice, /Після підтвердження нового часу 30 хвилин відраховуються від нового часу прибуття/, 'approved arrival time starts a new 30-minute deadline');
assert.match(notice, /протягом 30 хвилин після підтвердженого часу прибуття/, 'notice explains no-show deadline');

console.log('guest device no-show notice and rule tests passed');
