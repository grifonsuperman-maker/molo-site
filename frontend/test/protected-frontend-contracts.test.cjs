const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FRONTEND_ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(FRONTEND_ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function extractArray(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Protected marker is missing: ${marker}`);

  const equalsIndex = source.indexOf('=', markerIndex);
  assert.notEqual(equalsIndex, -1, `Protected assignment is missing: ${marker}`);

  const start = source.indexOf('[', equalsIndex);
  assert.notEqual(start, -1, `Protected array is missing: ${marker}`);

  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '[') depth += 1;
    if (source[index] === ']') {
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

const EXPECTED_GUEST_MAP_SHA256 = '__CAPTURE_FROM_CURRENT_MAIN__';

test('guest map geometry, table numbers, click zones and map image paths stay unchanged', () => {
  const guestApp = read('src/guest/GuestApp.tsx');
  const locations = extractArray(guestApp, 'const LOCATIONS: LocationMap[]');
  const actual = sha256(locations);

  assert.equal(
    actual,
    EXPECTED_GUEST_MAP_SHA256,
    `Protected guest map changed. actual=${actual}`,
  );
});

test('protected status colors stay unchanged', () => {
  const guestApp = read('src/guest/GuestApp.tsx');

  assertIncludesAll(
    guestApp,
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
});

test('SitePhotoController and protected title/theme image paths stay connected', () => {
  const app = read('src/App.tsx');
  const photos = read('src/theme/SitePhotoController.tsx');

  assert.ok(app.includes('import SitePhotoController from "./theme/SitePhotoController";'));
  assert.ok(app.includes('<SitePhotoController />'));

  assertIncludesAll(
    photos,
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
    'Protected photo path',
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

  assert.ok(waiterTables.includes("tablesApi.waiterStatus(table.id, status)"));
  assert.ok(tablesApi.includes("`/tables/${id}/waiter-status`"));
  assert.ok(waiterTables.includes('>Зайнятий</button>'));
  assert.ok(waiterTables.includes('>Вільний</button>'));
  assert.equal(waiterTables.includes('tablesApi.occupied('), false);
  assert.equal(waiterTables.includes('tablesApi.free('), false);
});
