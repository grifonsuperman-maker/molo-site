const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'guest', 'GuestApp.tsx'),
  'utf8',
);

test('guest back button is lower, clickable, and keeps the existing goBack action', () => {
  assert.match(source, /fixed left-4 top-20 z-\[100\]/);
  assert.match(source, /type="button"\s+onClick=\{goBack\}/);
  assert.doesNotMatch(source, /fixed left-4 top-4 z-\[80\]/);
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
