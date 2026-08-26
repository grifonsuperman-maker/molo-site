const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const EXPECTED_GUEST_MAP_SHA256 =
  '0fa112eabf80af7b4857e5b0a5ffcdf9f6b24ab27f3bfea45286338594a5ceae';

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

function findUniqueSource(marker, directory) {
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

function extractArray(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Protected marker is missing: ${marker}`);

  const equalsIndex = source.indexOf('=', markerIndex);
  assert.notEqual(equalsIndex, -1, `Protected assignment is missing: ${marker}`);

  const start = source.indexOf('[', equalsIndex);
  assert.notEqual(start, -1, `Protected array is missing: ${marker}`);

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

    if (character === '[') depth += 1;
    if (character === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`Protected array is not closed: ${marker}`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertIncludesAll(source, values, label) {
  for (const value of values) {
    assert.ok(source.includes(value), `${label} changed or disappeared: ${value}`);
  }
}

test('guest map geometry, table numbers, click zones and map image paths stay unchanged', () => {
  const guestDirectory = path.join(FRONTEND_ROOT, 'src', 'guest');
  const currentSource = findUniqueSource(
    'const LOCATIONS: LocationMap[]',
    guestDirectory,
  );
  const currentMap = extractArray(
    currentSource,
    'const LOCATIONS: LocationMap[]',
  );

  assert.equal(
    sha256(currentMap),
    EXPECTED_GUEST_MAP_SHA256,
    'Protected guest map definition changed',
  );
});

test('guest contour rendering and click behavior stay unchanged', () => {
  const guestDirectory = path.join(FRONTEND_ROOT, 'src', 'guest');
  const shapeSource = findUniqueSource('function shapeRenderData(', guestDirectory);
  const contourSource = findUniqueSource('function VisibleContour(', guestDirectory);
  const clickSource = findUniqueSource('function ClickZone(', guestDirectory);

  assertIncludesAll(
    shapeSource,
    [
      "tag: 'polygon'",
      'pointList(expandPolygon(shape.points, shape.expand ?? 0))',
      "tag: 'ellipse'",
      'rx: shape.rx + (shape.expand ?? 0)',
      'ry: shape.ry + (shape.expand ?? 0)',
      "tag: 'path'",
      'd: ellipsePath(shape)',
    ],
    'Protected table shape rendering',
  );

  assertIncludesAll(
    contourSource,
    [
      'strokeWidth={22} strokeOpacity={0.28}',
      'strokeWidth={13} strokeOpacity={0.78}',
      'strokeWidth={6} strokeOpacity={1}',
      'stroke="white" strokeWidth={2} strokeOpacity={0.65}',
      "pointerEvents: 'none' as const",
    ],
    'Protected visible table contour',
  );

  assertIncludesAll(
    clickSource,
    [
      "className: 'molo-svg-hit'",
      'fillOpacity: 0',
      "stroke: 'none'",
      "pointerEvents: 'all' as const",
      "role: 'button'",
      'tabIndex: 0',
      'onClick: () => onPick(table)',
      "if (event.key === 'Enter' || event.key === ' ')",
      'onPick(table)',
      "if (data.tag === 'polygon') return <polygon points={data.points} {...commonProps} />;",
      "if (data.tag === 'ellipse') return <ellipse cx={data.cx} cy={data.cy} rx={data.rx} ry={data.ry} {...commonProps} />;",
      'return <path d={data.d} {...commonProps} />;',
    ],
    'Protected table click zone',
  );
});

test('protected status colors and hidden free-table outlines stay unchanged', () => {
  const guestDirectory = path.join(FRONTEND_ROOT, 'src', 'guest');
  const source = findUniqueSource('const STATUS_COLORS:', guestDirectory);
  const visibilitySource = findUniqueSource(
    "const shouldShowVisibleNeon = isActive || status !== 'free';",
    guestDirectory,
  );

  assertIncludesAll(
    source,
    [
      "active: '#facc15'",
      "pending: '#38bdf8'",
      "reserved: '#fb923c'",
      "occupied: '#ff3b4f'",
      "cleaning: '#67e8f9'",
      "closed: '#bdbdbd'",
      "free: '#ffffff'",
    ],
    'Protected table status color',
  );

  assert.ok(
    visibilitySource.includes("const shouldShowVisibleNeon = isActive || status !== 'free';"),
    'Free table outlines must stay hidden unless the table is actively selected',
  );
  assert.ok(
    visibilitySource.includes('{shouldShowVisibleNeon && ('),
    'VisibleContour must stay gated by the protected visibility predicate',
  );
});

test('SitePhotoController and protected title/theme image paths stay connected', () => {
  const app = read('src/App.tsx');
  const themeDirectory = path.join(FRONTEND_ROOT, 'src', 'theme');
  const titleSource = findUniqueSource('const TITLE_IMAGES =', themeDirectory);
  const dayNightSource = findUniqueSource('const DAY_TO_NIGHT:', themeDirectory);

  assert.ok(app.includes('import SitePhotoController from "./theme/SitePhotoController";'));
  assert.ok(app.includes('<SitePhotoController />'));

  assertIncludesAll(
    titleSource,
    [
      "'/hero-bg.jpg'",
      "'/maps/title/title-02.png'",
      "'/maps/title/title-03.png'",
      "'/maps/title/title-04.png'",
      "'/maps/title/title-05.png'",
      "'/maps/title/title-06.png'",
      "'/maps/title/title-07.png'",
      "'/maps/title/title-08.png'",
      "'/maps/title/title-11.png'",
      "'/maps/title/title-12.png'",
      "'/maps/title/title-13.png'",
      "'/maps/title/title-14.png'",
      "'/maps/title/title-15.png'",
    ],
    'Protected Title image path',
  );

  assertIncludesAll(
    dayNightSource,
    [
      "'/maps/territory-bg.png': '/maps/themes/night/territory.png'",
      "'/maps/waterfront-bg.png': '/maps/themes/night/waterfront.png'",
      "'/maps/hall-bg-numbered.png': '/maps/themes/night/hall.png'",
      "'/maps/canopy-day-numbered.png': '/maps/themes/night/canopy.png'",
      "'/maps/gazebo-day-numbered.png': '/maps/themes/night/gazebo.png'",
      "'/maps/rotang-day-numbered.png': '/maps/themes/night/rotang.png'",
      "'/maps/embankment-day-numbered.png': '/maps/themes/night/embankment.png'",
      "'/maps/glass-gazebo-day-numbered.png': '/maps/themes/night/glass-gazebo.png'",
      "'/maps/water-gazebo-day-numbered.png': '/maps/themes/night/water-gazebo.png'",
    ],
    'Protected day/night image path',
  );
});

test('every protected production poll stays exactly 15 seconds', () => {
  const guestApp = read('src/guest/GuestApp.tsx');
  const guestServices = read('src/guest/GuestBookingServiceActions.tsx');
  const guestHookah = read('src/guest/GuestHookahCallPanel.tsx');
  const guestDecision = read('src/guest/GuestBookingDecisionController.tsx');
  const waiterTables = read('src/waiter/WaiterTablesByLocation.tsx');
  const waiterApp = read('src/waiter/WaiterAppV2.tsx');
  const waiterAlert = read('src/waiter/WaiterCallAlertController.tsx');
  const hookahApp = read('src/hookah/HookahApp.tsx');
  const adminAttention = read('src/admin/AdminAttentionPanel.tsx');
  const adminTables = read('src/admin/AdminTablesByLocation.tsx');
  const compactAdmin = read('src/admin/CompactAdminPanel.tsx');
  const directorPanel = read('src/director/PremiumDirectorPanel.tsx');
  const photos = read('src/theme/SitePhotoController.tsx');

  assertIncludesAll(
    guestApp,
    [
      'window.setInterval(refreshPublicSettings, 15000)',
      'window.setInterval(refreshBookingStatus, 15000)',
    ],
    'GuestApp 15-second poll',
  );

  assert.ok(guestServices.includes('const POLLING_INTERVAL_MS = 15_000;'));
  assert.ok(
    guestServices.includes('void loadWaiterStatus(true);\n    }, POLLING_INTERVAL_MS);'),
    'Guest waiter status poll must use the protected 15-second interval',
  );
  assert.ok(
    guestServices.includes('void loadHookahStatus(true);\n    }, POLLING_INTERVAL_MS);'),
    'Guest hookah status poll must use the protected 15-second interval',
  );

  assert.ok(
    guestHookah.includes('void loadStatus(true);\n    }, 15_000);'),
    'Guest hookah panel poll must stay exactly 15 seconds',
  );

  assert.ok(guestDecision.includes('const POLLING_MS = 15_000;'));
  assert.ok(
    guestDecision.includes('window.setInterval(() => void load(), POLLING_MS)'),
    'Guest booking decision poll must use the protected 15-second interval',
  );

  assert.ok(waiterTables.includes('const POLLING_MS = 15_000;'));
  assert.ok(
    waiterTables.includes('window.setInterval(() => void load(true), POLLING_MS)'),
    'Waiter table poll must use the protected 15-second interval',
  );

  assert.ok(
    waiterApp.includes('window.setInterval(() => void load(), 15000)'),
    'Waiter app poll must stay exactly 15 seconds',
  );

  assert.ok(waiterAlert.includes('const POLLING_MS = 15_000;'));
  assert.ok(
    waiterAlert.includes('window.setInterval(() => void checkCalls(), POLLING_MS)'),
    'Waiter call alert poll must use the protected 15-second interval',
  );

  assert.ok(
    hookahApp.includes('void loadCalls(true);\n    }, 15_000);'),
    'Hookah app poll must stay exactly 15 seconds',
  );

  for (const [label, source, call] of [
    [
      'Admin attention',
      adminAttention,
      'window.setInterval(() => void load(true), POLLING_MS)',
    ],
    [
      'Admin tables',
      adminTables,
      'window.setInterval(() => void load(true), POLLING_MS)',
    ],
    [
      'Compact admin',
      compactAdmin,
      'window.setInterval(() => void loadAll(true), POLLING_MS)',
    ],
  ]) {
    assert.ok(source.includes('const POLLING_MS = 15_000;'), `${label} poll constant must stay 15 seconds`);
    assert.ok(source.includes(call), `${label} poll must use the protected 15-second interval`);
  }

  assert.ok(
    directorPanel.includes('window.setInterval(() => void load(true), 15_000)'),
    'Director panel poll must stay exactly 15 seconds',
  );

  assert.ok(
    photos.includes('window.setInterval(refreshMode, 15_000)'),
    'Site photo mode poll must stay exactly 15 seconds',
  );
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
