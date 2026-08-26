const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(FRONTEND_ROOT, '..');
const PROTECTED_BASELINE_COMMIT = '0b0b0f6fa292a9aa87aaa34867832df8a932f6ab';

function read(relativePath) {
  return fs
    .readFileSync(path.join(FRONTEND_ROOT, relativePath), 'utf8')
    .replace(/\r\n/g, '\n');
}

function readBaseline(relativePath) {
  return execFileSync(
    'git',
    ['show', `${PROTECTED_BASELINE_COMMIT}:frontend/${relativePath}`],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  ).replace(/\r\n/g, '\n');
}

function sourceFiles(directory = path.join(FRONTEND_ROOT, 'src')) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [absolutePath];
  });
}

function findUniqueSource(marker) {
  const matches = sourceFiles().filter((absolutePath) =>
    fs.readFileSync(absolutePath, 'utf8').includes(marker),
  );

  assert.equal(
    matches.length,
    1,
    `Expected exactly one current source for protected marker ${marker}, found ${matches.length}`,
  );

  return fs.readFileSync(matches[0], 'utf8').replace(/\r\n/g, '\n');
}

function extractBalanced(source, marker, opening, closing) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Protected marker is missing: ${marker}`);

  const equalsIndex = source.indexOf('=', markerIndex);
  assert.notEqual(equalsIndex, -1, `Protected assignment is missing: ${marker}`);

  const start = source.indexOf(opening, equalsIndex);
  assert.notEqual(start, -1, `Protected value is missing: ${marker}`);

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }

    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`Protected value is not closed: ${marker}`);
}

function extractArray(source, marker) {
  return extractBalanced(source, marker, '[', ']');
}

function extractObject(source, marker) {
  return extractBalanced(source, marker, '{', '}');
}

function assertIncludesAll(source, values, label) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} changed or disappeared: ${value}`);
  }
}

test('guest map geometry, table numbers, click zones and map image paths stay unchanged', () => {
  const baseline = extractArray(
    readBaseline('src/guest/GuestApp.tsx'),
    'const LOCATIONS: LocationMap[]',
  );
  const current = extractArray(
    findUniqueSource('const LOCATIONS: LocationMap[]'),
    'const LOCATIONS: LocationMap[]',
  );

  assert.equal(current, baseline, 'Protected guest map definition changed');
});

test('protected status colors stay unchanged', () => {
  const baseline = extractObject(
    readBaseline('src/guest/GuestApp.tsx'),
    'const STATUS_COLORS:',
  );
  const current = extractObject(
    findUniqueSource('const STATUS_COLORS:'),
    'const STATUS_COLORS:',
  );

  assert.equal(current, baseline, 'Protected table status colors changed');
});

test('SitePhotoController and protected title/theme image paths stay connected', () => {
  const app = read('src/App.tsx');
  const baselinePhotos = readBaseline('src/theme/SitePhotoController.tsx');
  const currentTitleSource = findUniqueSource('const TITLE_IMAGES =');
  const currentThemeSource = findUniqueSource('const DAY_TO_NIGHT:');

  assert.ok(app.includes('import SitePhotoController from "./theme/SitePhotoController";'));
  assert.ok(app.includes('<SitePhotoController />'));

  assert.equal(
    extractArray(currentTitleSource, 'const TITLE_IMAGES ='),
    extractArray(baselinePhotos, 'const TITLE_IMAGES ='),
    'Protected Title image list changed',
  );
  assert.equal(
    extractObject(currentThemeSource, 'const DAY_TO_NIGHT:'),
    extractObject(baselinePhotos, 'const DAY_TO_NIGHT:'),
    'Protected day/night image path mapping changed',
  );
});

test('exact 15-second polling guards stay in protected working flows', () => {
  const guestServices = read('src/guest/GuestBookingServiceActions.tsx');
  const guestDecision = read('src/guest/GuestBookingDecisionController.tsx');
  const waiterTables = read('src/waiter/WaiterTablesByLocation.tsx');
  const waiterApp = read('src/waiter/WaiterAppV2.tsx');
  const photos = read('src/theme/SitePhotoController.tsx');

  assert.ok(guestServices.includes('const POLLING_INTERVAL_MS = 15_000;'));
  assert.ok(guestDecision.includes('const POLLING_MS = 15_000;'));
  assert.ok(waiterTables.includes('const POLLING_MS = 15_000;'));
  assert.ok(waiterApp.includes('window.setInterval(() => void load(), 15000)'));
  assert.ok(photos.includes('window.setInterval(refreshMode, 15_000)'));
});

test('role test switch and real role workspaces stay connected', () => {
  const app = read('src/App.tsx');

  assertIncludesAll(
    app,
    [
      'const GuestApp = lazy(() => import("./guest/GuestApp"));',
      'const WaiterApp = lazy(() => import("./waiter/WaiterAppV2"));',
      'const HookahApp = lazy(() => import("./hookah/HookahApp"));',
      'const AdminWorkspace = lazy(() => import("./admin/AdminWorkspace"));',
      'const DirectorWorkspace = lazy(() => import("./director/DirectorWorkspace"));',
      '>\n          Гість\n        </button>',
      '>\n          Офіціант\n        </button>',
      '>\n          Кальянник\n        </button>',
      '>\n          Адмін\n        </button>',
      '>\n          Директор\n        </button>',
    ],
    'Protected role switch/workspace',
  );
});

test('waiter walk-in Occupied / Free behavior keeps using guarded waiter-status endpoint', () => {
  const waiterTables = read('src/waiter/WaiterTablesByLocation.tsx');
  const tablesApi = read('src/api/tables.ts');

  assert.ok(waiterTables.includes('tablesApi.waiterStatus(table.id, status)'));
  assert.ok(tablesApi.includes('`/tables/${id}/waiter-status`'));
  assert.ok(waiterTables.includes('>Зайнятий</button>'));
  assert.ok(waiterTables.includes('>Вільний</button>'));
  assert.equal(waiterTables.includes('tablesApi.occupied('), false);
  assert.equal(waiterTables.includes('tablesApi.free('), false);
});
