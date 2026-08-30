const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'guest', 'GuestApp.tsx'),
  'utf8',
);

test('guest back button is restored to the original high position and keeps the existing goBack action', () => {
  assert.ok(source.includes(`className="fixed left-4 top-4 z-[100]"`));
  assert.equal(source.includes(`hasGuestTopBanner ? 'top-52' : 'top-20'`), false);
  assert.match(source, /type="button"\s+onClick=\{goBack\}/);
});

test('guest pages support a deliberate right swipe from the left edge', () => {
  assert.match(source, /onTouchStart=\{handleBackSwipeStart\}/);
  assert.match(source, /onTouchEnd=\{handleBackSwipeEnd\}/);
  assert.match(source, /onTouchCancel=\{cancelBackSwipe\}/);
  assert.match(source, /step === 'home'/);
  assert.match(source, /touch\.clientX > 64/);
  assert.ok(source.includes(`target?.closest('input, textarea, select, button, a, label, [role=\"button\"]')`));
  assert.equal(source.includes(`target?.closest('input, textarea, select, button, a, [role=\"button\"]')`), false);
  assert.match(source, /deltaX >= 72/);
  assert.match(source, /deltaX > deltaY \* 1\.25/);
  assert.match(source, /goBack\(\);/);
});

test('guest back swipe does not move the page under an open guest modal', () => {
  assert.ok(source.includes(`if (showMyBookings || externalReviewOffer) return;`));
  assert.ok(source.includes(`if (!start || showMyBookings || externalReviewOffer || step === 'home' || event.changedTouches.length !== 1) return;`));
});
