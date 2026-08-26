const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const FRONTEND_SRC = path.join(FRONTEND_ROOT, 'src');

function read(relativePath) {
  return fs
    .readFileSync(path.join(FRONTEND_ROOT, relativePath), 'utf8')
    .replace(/\r\n/g, '\n');
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [absolutePath];
  });
}

function findUniqueSource(marker, directory = FRONTEND_SRC) {
  const matches = sourceFiles(directory).filter((absolutePath) =>
    fs.readFileSync(absolutePath, 'utf8').includes(marker),
  );

  assert.equal(
    matches.length,
    1,
    `Expected exactly one current source for protected marker ${marker}, found ${matches.length}`,
  );

  return fs.readFileSync(matches[0], 'utf8').replace(/\r\n/g, '\n');
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

function assertModeRendersWorkspace(source, mode, workspace, label) {
  const workspaceIndex = source.indexOf(workspace);
  assert.notEqual(workspaceIndex, -1, `${label} workspace render is missing: ${workspace}`);

  const modeMarker = `{mode === "${mode}"`;
  const modeIndex = source.lastIndexOf(modeMarker, workspaceIndex);
  assert.notEqual(modeIndex, -1, `${label} workspace must stay guarded by ${mode}`);

  const otherModeIndex = source.lastIndexOf('{mode === "', workspaceIndex);
  assert.equal(
    otherModeIndex,
    modeIndex,
    `${label} workspace must stay inside its matching ${mode} render branch`,
  );
}

test('each protected role button selects and renders its matching workspace', () => {
  const roles = [
    ['guest', 'Гість', '<GuestApp />', 'const GuestApp = lazy(() => import("./guest/GuestApp"));'],
    ['waiter', 'Офіціант', '<WaiterApp />', 'const WaiterApp = lazy(() => import("./waiter/WaiterAppV2"));'],
    ['hookah', 'Кальянник', '<HookahApp />', 'const HookahApp = lazy(() => import("./hookah/HookahApp"));'],
    ['admin', 'Адмін', '<AdminWorkspace />', 'const AdminWorkspace = lazy(() => import("./admin/AdminWorkspace"));'],
    ['director', 'Директор', '<DirectorWorkspace />', 'const DirectorWorkspace = lazy(() => import("./director/DirectorWorkspace"));'],
  ];

  for (const [mode, label, workspace, importMarker] of roles) {
    const importSource = findUniqueSource(importMarker);
    assert.ok(importSource.includes(importMarker), `${label} protected workspace import changed`);

    const handler = `onClick={() => changeMode("${mode}")}`;
    const buttonSource = findUniqueSource(handler);
    const button = buttonBlock(buttonSource, handler);
    assert.ok(button.includes(handler), `${label} button must select ${mode}`);
    assert.match(button, new RegExp(`>\\s*${label}\\s*</button>`), `${label} label must stay bound to ${mode}`);

    const renderSource = findUniqueSource(workspace);
    assertModeRendersWorkspace(renderSource, mode, workspace, label);
  }
});

test('waiter Occupied and Free labels stay bound to their matching status arguments', () => {
  const waiterDirectory = path.join(FRONTEND_SRC, 'waiter');
  const occupiedHandler = "onClick={() => void setStatus(selectedTable, 'occupied')}";
  const freeHandler = "onClick={() => void setStatus(selectedTable, 'free')}";
  const waiterTables = findUniqueSource('tablesApi.waiterStatus(table.id, status)', waiterDirectory);
  const occupiedSource = findUniqueSource(occupiedHandler, waiterDirectory);
  const freeSource = findUniqueSource(freeHandler, waiterDirectory);
  const tablesApi = read('src/api/tables.ts');

  assert.ok(waiterTables.includes('tablesApi.waiterStatus(table.id, status)'));
  assert.ok(tablesApi.includes('`/tables/${id}/waiter-status`'));

  const occupiedButton = buttonBlock(occupiedSource, occupiedHandler);
  assert.ok(occupiedButton.includes(occupiedHandler), 'Зайнятий must send occupied');
  assert.match(occupiedButton, />\s*Зайнятий\s*<\/button>/, 'occupied action must stay on Зайнятий');

  const freeButton = buttonBlock(freeSource, freeHandler);
  assert.ok(freeButton.includes(freeHandler), 'Вільний must send free');
  assert.match(freeButton, />\s*Вільний\s*<\/button>/, 'free action must stay on Вільний');

  assert.equal(waiterTables.includes('tablesApi.occupied('), false);
  assert.equal(waiterTables.includes('tablesApi.free('), false);
});

test('home hero stays connected to protected Title rotation recognition and scheduling', () => {
  const guestDirectory = path.join(FRONTEND_SRC, 'guest');
  const themeDirectory = path.join(FRONTEND_SRC, 'theme');
  const homeMarker = "{step === 'home' && (";
  const heroSource = findUniqueSource(homeMarker, guestDirectory);
  const controllerSource = findUniqueSource(
    "image.dataset.moloTitle === 'true' || TITLE_IMAGES.includes(currentPath)",
    themeDirectory,
  );

  assert.match(
    heroSource,
    /\{step === 'home' && \(\s*<section\b[^>]*>\s*<img\s+src="\/hero-bg\.jpg"/s,
    'Protected /hero-bg.jpg must stay rendered directly inside the guest home screen branch',
  );

  assert.ok(
    controllerSource.includes("image.dataset.moloTitle === 'true' || TITLE_IMAGES.includes(currentPath)"),
    'SitePhotoController must keep recognizing protected Title paths',
  );
  assert.ok(
    controllerSource.includes("image.dataset.moloTitle = 'true';"),
    'Recognized Title images must keep receiving the moloTitle marker',
  );
  assert.ok(
    controllerSource.includes("image.dataset.moloFallback = '/hero-bg.jpg';"),
    'Title fallback must remain /hero-bg.jpg',
  );
  assert.ok(
    controllerSource.includes('syncTitle();'),
    'Title rotation must still perform its initial sync',
  );
  assert.ok(
    controllerSource.includes('const timer = window.setInterval(syncTitle, TITLE_SYNC_MS);'),
    'Title rotation must stay scheduled with TITLE_SYNC_MS',
  );
  for (const event of ['focus', 'pageshow', 'storage']) {
    assert.ok(
      controllerSource.includes(`window.addEventListener('${event}', syncTitle);`),
      `Title rotation must still resync on ${event}`,
    );
  }
  assert.ok(
    controllerSource.includes("document.addEventListener('visibilitychange', syncWhenVisible);"),
    'Title rotation must still resync after visibility changes',
  );
  assert.ok(
    controllerSource.includes('window.clearInterval(timer);'),
    'Title rotation timer cleanup must remain connected',
  );
});