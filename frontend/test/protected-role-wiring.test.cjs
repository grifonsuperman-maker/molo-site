const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

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

function isInsideRenderedJsx(node) {
  let current = node.parent;
  let sawJsxExpression = false;

  while (current) {
    if (ts.isJsxExpression(current)) sawJsxExpression = true;
    if (ts.isReturnStatement(current)) return sawJsxExpression;
    if (
      ts.isVariableDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isArrowFunction(current)
    ) {
      return false;
    }
    current = current.parent;
  }

  return false;
}

function assertModeRendersWorkspace(source, mode, workspace, label) {
  const sourceFile = ts.createSourceFile(
    `${mode}.tsx`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let matchedBranch = false;

  function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      ts.isBinaryExpression(node.left) &&
      node.left.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      node.left.left.getText(sourceFile) === 'mode' &&
      node.left.right.getText(sourceFile).replace(/["']/g, '') === mode &&
      node.right.getText(sourceFile).includes(workspace) &&
      isInsideRenderedJsx(node)
    ) {
      matchedBranch = true;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(
    matchedBranch,
    `${label} workspace must stay inside a rendered ${mode} JSX branch`,
  );
}

function loadTitleRotationRuntime(source) {
  const sourceFile = ts.createSourceFile(
    'SitePhotoController.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const wantedVariables = new Set([
    'TITLE_ROTATION_MS',
    'TITLE_SYNC_MS',
    'TITLE_STORAGE_KEY',
    'TITLE_IMAGES',
  ]);
  const wantedFunctions = new Set([
    'titleBucket',
    'readTitleState',
    'writeTitleState',
    'seededRandom',
    'fallbackTitleIndex',
    'chooseTitleImage',
  ]);
  const declarations = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const names = statement.declarationList.declarations
        .map((declaration) => declaration.name)
        .filter(ts.isIdentifier)
        .map((identifier) => identifier.text);
      if (names.some((name) => wantedVariables.has(name))) {
        declarations.push(statement.getText(sourceFile));
      }
      continue;
    }

    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      wantedFunctions.has(statement.name.text)
    ) {
      declarations.push(statement.getText(sourceFile));
    }
  }

  for (const name of [...wantedVariables, ...wantedFunctions]) {
    assert.ok(
      declarations.some((declaration) => declaration.includes(name)),
      `Protected Title rotation declaration is missing: ${name}`,
    );
  }

  const executableSource = `${declarations.join('\n\n')}\n\nmodule.exports = { TITLE_ROTATION_MS, TITLE_SYNC_MS, TITLE_IMAGES, chooseTitleImage };`;
  const compiled = ts.transpileModule(executableSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  let now = 0;
  const storage = new Map();
  const deterministicMath = Object.create(Math);
  deterministicMath.random = () => 0;
  const sandbox = {
    module: { exports: {} },
    exports: {},
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
    },
    Date: { now: () => now },
    Math: deterministicMath,
  };

  vm.runInNewContext(compiled, sandbox, { filename: 'title-rotation-runtime.cjs' });

  return {
    api: sandbox.module.exports,
    setNow(value) {
      now = value;
    },
  };
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
  assert.match(
    controllerSource,
    /const \[titleImage, setTitleImage\] = useState\(\(\) => chooseTitleImage\(\)\);/,
    'Mounted SitePhotoController must initialize Title state through chooseTitleImage()',
  );
  assert.match(
    controllerSource,
    /const syncTitle = \(\) => \{\s*const nextTitleImage = chooseTitleImage\(\);\s*setTitleImage\(/,
    'Mounted SitePhotoController sync path must keep calling chooseTitleImage()',
  );

  assert.match(
    controllerSource,
    /\n\s*syncTitle\(\);\s*\n\s*const timer = window\.setInterval\(syncTitle, TITLE_SYNC_MS\);\s*\n\s*window\.addEventListener\('focus', syncTitle\);\s*\n\s*window\.addEventListener\('pageshow', syncTitle\);\s*\n\s*window\.addEventListener\('storage', syncTitle\);\s*\n\s*document\.addEventListener\('visibilitychange', syncWhenVisible\);/,
    'Title rotation must perform its initial sync and then install its protected schedule/listeners',
  );

  assert.match(
    controllerSource,
    /return \(\) => \{\s*\n\s*window\.clearInterval\(timer\);\s*\n\s*window\.removeEventListener\('focus', syncTitle\);\s*\n\s*window\.removeEventListener\('pageshow', syncTitle\);\s*\n\s*window\.removeEventListener\('storage', syncTitle\);\s*\n\s*document\.removeEventListener\('visibilitychange', syncWhenVisible\);\s*\n\s*\};/,
    'Title rotation must keep its timer and all event-listener cleanup bound together',
  );
});

test('protected Title rotation advances only at the expected 20-minute cadence', () => {
  const themeDirectory = path.join(FRONTEND_SRC, 'theme');
  const controllerSource = findUniqueSource('function chooseTitleImage()', themeDirectory);
  const runtime = loadTitleRotationRuntime(controllerSource);
  const {
    TITLE_ROTATION_MS,
    TITLE_SYNC_MS,
    TITLE_IMAGES,
    chooseTitleImage,
  } = runtime.api;

  assert.equal(TITLE_ROTATION_MS, 20 * 60 * 1000, 'Title rotation cadence must remain 20 minutes');
  assert.equal(TITLE_SYNC_MS, 30 * 1000, 'Title sync cadence must remain 30 seconds');
  assert.ok(Array.isArray(TITLE_IMAGES) && TITLE_IMAGES.length > 1, 'Protected Title image rotation needs multiple images');

  const bucketStart = 1_000 * TITLE_ROTATION_MS;
  runtime.setNow(bucketStart);
  const first = chooseTitleImage();

  runtime.setNow(bucketStart + TITLE_ROTATION_MS - 1);
  const sameBucket = chooseTitleImage();
  assert.equal(sameBucket, first, 'Title must remain stable inside one rotation bucket');

  runtime.setNow(bucketStart + TITLE_ROTATION_MS);
  const second = chooseTitleImage();
  assert.notEqual(second, first, 'Title must advance when the next 20-minute bucket starts');

  runtime.setNow(bucketStart + 2 * TITLE_ROTATION_MS);
  const third = chooseTitleImage();
  assert.notEqual(third, second, 'Consecutive Title buckets must not repeat the previous image');
});