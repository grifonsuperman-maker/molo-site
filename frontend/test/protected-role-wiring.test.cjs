const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FRONTEND_ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs
    .readFileSync(path.join(FRONTEND_ROOT, relativePath), 'utf8')
    .replace(/\r\n/g, '\n');
}

function buttonBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Protected button marker is missing: ${marker}`);

  const start = source.lastIndexOf('<button', markerIndex);
  const endMarker = '</button>';
  const end = source.indexOf(endMarker, markerIndex);
  assert.notEqual(start, -1, `Protected button start is missing: ${marker}`);
  assert.notEqual(end, -1, `Protected button end is missing: ${marker}`);

  return source.slice(start, end + endMarker.length);
}

function modeRenderBlock(source, mode) {
  const marker = `{mode === "${mode}"`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Protected render branch is missing for ${mode}`);

  const nextMode = source.indexOf('\n          {mode === "', start + marker.length);
  const suspenseEnd = source.indexOf('</Suspense>', start);
  const end = nextMode === -1 ? suspenseEnd : nextMode;
  assert.notEqual(end, -1, `Protected render branch end is missing for ${mode}`);

  return source.slice(start, end);
}

test('each protected role button selects and renders its matching workspace', () => {
  const app = read('src/App.tsx');
  const roles = [
    ['guest', 'Гість', '<GuestApp />', 'const GuestApp = lazy(() => import("./guest/GuestApp"));'],
    ['waiter', 'Офіціант', '<WaiterApp />', 'const WaiterApp = lazy(() => import("./waiter/WaiterAppV2"));'],
    ['hookah', 'Кальянник', '<HookahApp />', 'const HookahApp = lazy(() => import("./hookah/HookahApp"));'],
    ['admin', 'Адмін', '<AdminWorkspace />', 'const AdminWorkspace = lazy(() => import("./admin/AdminWorkspace"));'],
    ['director', 'Директор', '<DirectorWorkspace />', 'const DirectorWorkspace = lazy(() => import("./director/DirectorWorkspace"));'],
  ];

  for (const [mode, label, workspace, importMarker] of roles) {
    assert.ok(app.includes(importMarker), `${label} protected workspace import changed`);

    const button = buttonBlock(app, `onClick={() => changeMode("${mode}")}`);
    assert.ok(button.includes(`onClick={() => changeMode("${mode}")}`), `${label} button must select ${mode}`);
    assert.match(button, new RegExp(`>\\s*${label}\\s*</button>`), `${label} label must stay bound to ${mode}`);

    const render = modeRenderBlock(app, mode);
    assert.ok(render.includes(workspace), `${label} mode must render ${workspace}`);
  }
});

test('waiter Occupied and Free labels stay bound to their matching status arguments', () => {
  const waiterTables = read('src/waiter/WaiterTablesByLocation.tsx');
  const tablesApi = read('src/api/tables.ts');

  assert.ok(waiterTables.includes('tablesApi.waiterStatus(table.id, status)'));
  assert.ok(tablesApi.includes('`/tables/${id}/waiter-status`'));

  const occupiedButton = buttonBlock(
    waiterTables,
    "onClick={() => void setStatus(selectedTable, 'occupied')}",
  );
  assert.ok(
    occupiedButton.includes("onClick={() => void setStatus(selectedTable, 'occupied')}"),
    'Зайнятий must send occupied',
  );
  assert.match(occupiedButton, />\s*Зайнятий\s*<\/button>/, 'occupied action must stay on Зайнятий');

  const freeButton = buttonBlock(
    waiterTables,
    "onClick={() => void setStatus(selectedTable, 'free')}",
  );
  assert.ok(
    freeButton.includes("onClick={() => void setStatus(selectedTable, 'free')}"),
    'Вільний must send free',
  );
  assert.match(freeButton, />\s*Вільний\s*<\/button>/, 'free action must stay on Вільний');

  assert.equal(waiterTables.includes('tablesApi.occupied('), false);
  assert.equal(waiterTables.includes('tablesApi.free('), false);
});
