from pathlib import Path
import runpy

patcher = Path('scripts/pr203_phone_identity_fix.py')
source = patcher.read_text()
old = "test_path.write_text(test_text.rstrip() + addition + '\\n')"
new = "test_path.write_text(test_text.rstrip() + addition.rstrip() + '\\n')"
if source.count(old) != 1:
    raise SystemExit(f'EOF generator anchor mismatch: {source.count(old)}')
patcher.write_text(source.replace(old, new, 1))
runpy.run_path(str(patcher), run_name='__main__')
