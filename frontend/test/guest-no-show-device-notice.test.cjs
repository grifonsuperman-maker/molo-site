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
assert.match(controller, /noShowNoticeApi\.listUnreadForDevice\(guestDeviceId\)/, 'no-show notice is fetched separately from guest booking list');
assert.match(controller, /Promise\.allSettled/, 'failed guest booking lookup does not suppress a successful notice lookup');
assert.match(controller, /if \(bookingsResult\.status === 'rejected' \|\| noticesResult\.status === 'rejected'\) return;/, 'partial polling failures cannot dismiss an already displayed unread notice');
assert.match(controller, /const notice = notices\[0\]/, 'separate unread no-show notice is presented in decision overlay');
assert.match(controller, /bookingId: null,\s*noticeHandle: notice\.noticeHandle/, 'device no-show overlay never carries a historical booking ID');
assert.match(controller, /isNoShow: true/, 'device no-show is tagged as a notice, not a booking card');
assert.match(controller, /!decision\.isNoShow && decision\.bookingDate/, 'no historical booking date or table is rendered for no-show notice');
assert.match(controller, /await bookingsApi\.guestAcknowledgeNotification\(bookingId, token\)/, 'existing token-based acknowledgement is preserved');
assert.match(controller, /noShowNoticeApi\.acknowledgeByDevice\(noticeHandle, guestDeviceId\)/, 'device ACK uses only an opaque one-purpose handle');
assert.match(api, /\/bookings\/guest\/no-show\/notices/, 'device-only notice list uses a dedicated endpoint');
assert.match(api, /\/guest\/no-show\/ack-by-device/, 'device-only acknowledgement uses a dedicated limited endpoint');
assert.match(api, /noticeHandle: string/, 'no-show public payload has an opaque handle, not a booking ID');
assert.doesNotMatch(api, /bookingId: string/, 'no-show public payload never contains bookingId');
assert.match(api, /\{ guestDeviceId \}/, 'device ID is sent only to the narrow notice API');
assert.match(guestApp, /const activeMyBookings = myBookings\.filter/, 'main guest cards preserve the active booking filter');
assert.match(guestApp, /const myBookingCards = \[\.\.\.activeMyBookings, \.\.\.unreadNotificationBookings\]/, 'existing token-scoped notification behavior stays unchanged');

assert.ok(main.indexOf("import './guest/no-show-rule.css';") > main.indexOf("import './styles.css';"), 'clarification overrides old guest warning');
assert.match(notice, /Поки Адміністратор розглядає ваш запит на зміну часу, відлік призупинено/, 'pending request pauses the deadline');
assert.match(notice, /Після підтвердження нового часу 30 хвилин відраховуються від нового часу прибуття/, 'approved arrival time starts a new 30-minute deadline');
assert.match(notice, /протягом 30 хвилин після підтвердженого часу прибуття/, 'notice explains no-show deadline');

console.log('guest opaque no-show notice UI and rule checks passed');
