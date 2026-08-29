from pathlib import Path

repo = Path(__file__).resolve().parents[2]
guest = repo / 'frontend/src/guest/GuestApp.tsx'
package = repo / 'frontend/package.json'
test = repo / 'frontend/test/guest-back-navigation.test.cjs'

text = guest.read_text()

def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return source.replace(old, new, 1)

text = replace_once(
    text,
    "import { useEffect, useMemo, useState } from 'react';\nimport type { ReactNode, KeyboardEvent } from 'react';",
    "import { useEffect, useMemo, useRef, useState } from 'react';\nimport type { ReactNode, KeyboardEvent, TouchEvent } from 'react';",
    'react imports',
)

text = replace_once(
    text,
    "export default function GuestApp() {\n  const [step, setStep] = usePersistentState<Step>('molo:guest:step', 'home');",
    "export default function GuestApp() {\n  const [step, setStep] = usePersistentState<Step>('molo:guest:step', 'home');\n  const backSwipeStart = useRef<{ x: number; y: number } | null>(null);",
    'swipe ref',
)

text = replace_once(
    text,
    "    setStep('home');\n  }\n\n  function openCustomDuration() {",
    "    setStep('home');\n  }\n\n  function handleBackSwipeStart(event: TouchEvent<HTMLDivElement>) {\n    backSwipeStart.current = null;\n    if (step === 'home' || event.touches.length !== 1) return;\n\n    const touch = event.touches[0];\n    if (touch.clientX > 64) return;\n\n    const target = event.target instanceof Element ? event.target : null;\n    if (target?.closest('input, textarea, select, button, a, [role=\"button\"]')) return;\n\n    backSwipeStart.current = { x: touch.clientX, y: touch.clientY };\n  }\n\n  function handleBackSwipeEnd(event: TouchEvent<HTMLDivElement>) {\n    const start = backSwipeStart.current;\n    backSwipeStart.current = null;\n    if (!start || step === 'home' || event.changedTouches.length !== 1) return;\n\n    const touch = event.changedTouches[0];\n    const deltaX = touch.clientX - start.x;\n    const deltaY = Math.abs(touch.clientY - start.y);\n\n    if (deltaX >= 72 && deltaX > deltaY * 1.25) goBack();\n  }\n\n  function cancelBackSwipe() {\n    backSwipeStart.current = null;\n  }\n\n  function openCustomDuration() {",
    'swipe handlers',
)

text = replace_once(
    text,
    "    <div className={`molo-mode-${siteMode} min-h-[100dvh] bg-black text-white`}>",
    "    <div\n      className={`molo-mode-${siteMode} min-h-[100dvh] bg-black text-white`}\n      onTouchStart={handleBackSwipeStart}\n      onTouchEnd={handleBackSwipeEnd}\n      onTouchCancel={cancelBackSwipe}\n    >",
    'root touch handlers',
)

text = replace_once(
    text,
    "        <div className=\"fixed left-4 top-4 z-[80]\">\n          <button\n            onClick={goBack}",
    "        <div className=\"fixed left-4 top-20 z-[100]\">\n          <button\n            type=\"button\"\n            onClick={goBack}",
    'back button position',
)

guest.write_text(text)

package_text = package.read_text()
package_text = replace_once(
    package_text,
    "&& node test/admin-manual-booking.test.cjs\", \"preview\"",
    "&& node test/admin-manual-booking.test.cjs && node test/guest-back-navigation.test.cjs\", \"preview\"",
    'frontend test script',
)
package.write_text(package_text)

test.write_text(r'''const assert = require('node:assert/strict');
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
  assert.match(source, /deltaX >= 72/);
  assert.match(source, /deltaX > deltaY \* 1\.25/);
  assert.match(source, /goBack\(\);/);
});
''')
