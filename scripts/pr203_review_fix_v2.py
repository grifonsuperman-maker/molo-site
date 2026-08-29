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
