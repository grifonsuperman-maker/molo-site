from pathlib import Path

app_path = Path('frontend/src/guest/GuestApp.tsx')
source = app_path.read_text()
old = "<div className={`fixed left-4 z-[100] ${hasGuestTopBanner ? 'top-52' : 'top-20'}`}>"
new = '<div className="fixed left-4 top-4 z-[100]">'
if source.count(old) != 1:
    raise SystemExit(f'Expected exactly one guest back button position block, found {source.count(old)}')
app_path.write_text(source.replace(old, new, 1))

test_path = Path('frontend/test/guest-back-navigation.test.cjs')
test = test_path.read_text()
old_test = """test('guest back button is lower, clickable, and keeps the existing goBack action', () => {
  assert.match(source, /const hasGuestTopBanner = Boolean/);
  assert.ok(source.includes(`hasGuestTopBanner ? 'top-52' : 'top-20'`));
  assert.match(source, /\\{hasGuestTopBanner && \\(/);
  assert.doesNotMatch(source, /fixed left-4 top-20 z-\\[100\\]/);
  assert.match(source, /type=\"button\"\\s+onClick=\\{goBack\\}/);
  assert.doesNotMatch(source, /fixed left-4 top-4 z-\\[80\\]/);
});
"""
new_test = """test('guest back button is restored to the original high position and keeps the existing goBack action', () => {
  assert.ok(source.includes(`className=\"fixed left-4 top-4 z-[100]\"`));
  assert.equal(source.includes(`hasGuestTopBanner ? 'top-52' : 'top-20'`), false);
  assert.match(source, /type=\"button\"\\s+onClick=\\{goBack\\}/);
});
"""
if test.count(old_test) != 1:
    raise SystemExit(f'Expected exactly one guest back button test block, found {test.count(old_test)}')
test_path.write_text(test.replace(old_test, new_test, 1))
