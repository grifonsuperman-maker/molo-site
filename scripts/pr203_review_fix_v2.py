from pathlib import Path
import runpy

patcher = Path('scripts/pr203_review_fix.py')
source = patcher.read_text()
for variable in (
    'old_lookup',
    'new_lookup',
    'old_completion',
    'new_completion',
    'old_mock',
    'new_mock',
):
    old = f'{variable} = dedent('
    new = f'{variable} = ('
    if source.count(old) != 1:
        raise SystemExit(f'{variable} wrapper mismatch: {source.count(old)}')
    source = source.replace(old, new, 1)
old_note = "notes.join('\\n')"
new_note = "notes.join('\\\\n')"
if source.count(old_note) != 1:
    raise SystemExit(f'note escaping mismatch: {source.count(old_note)}')
source = source.replace(old_note, new_note, 1)
patcher.write_text(source)
runpy.run_path(str(patcher), run_name='__main__')

for test_path in (
    Path('backend/test/booking-expiration-visit-stats.test.js'),
    Path('backend/test/client-phone-reconciliation.test.js'),
):
    content = test_path.read_text()
    if content.startswith('\\\n'):
        test_path.write_text(content[2:])
    else:
        raise SystemExit(f'unexpected generated test prefix: {test_path}')

manual_test = Path('backend/test/admin-manual-booking.test.js')
manual = manual_test.read_text()
old_clients = """  const clients = {
    async findOne() {
      return null;
    },
    create(value) {
      return value;
    },
"""
new_clients = """  const clients = {
    async find() {
      return [];
    },
    create(value) {
      return value;
    },
"""
if manual.count(old_clients) != 1:
    raise SystemExit(f'admin manual clients mock mismatch: {manual.count(old_clients)}')
manual_test.write_text(manual.replace(old_clients, new_clients, 1))
