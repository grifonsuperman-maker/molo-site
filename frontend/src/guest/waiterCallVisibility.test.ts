import {
  isGuestServiceBookingForToday,
  isGuestServiceStatusSnapshotCurrent,
  isWaiterCallBookingForToday,
  shouldRefreshGuestServiceStatusOnVisibility,
} from './waiterCallVisibility.js';

const today = '2026-08-09';

const cases = [
  {
    name: 'allows service calls for an approved booking today',
    booking: { status: 'approved', bookingDate: today },
    expected: true,
  },
  {
    name: 'blocks service calls for an approved future booking',
    booking: { status: 'approved', bookingDate: '2026-09-01' },
    expected: false,
  },
  {
    name: 'blocks service calls for an approved past booking',
    booking: { status: 'approved', bookingDate: '2026-08-08' },
    expected: false,
  },
  {
    name: 'blocks service calls for a pending booking today',
    booking: { status: 'pending', bookingDate: today },
    expected: false,
  },
];

for (const testCase of cases) {
  const serviceActual = isGuestServiceBookingForToday(testCase.booking, today);
  const waiterActual = isWaiterCallBookingForToday(testCase.booking, today);

  if (serviceActual !== testCase.expected || waiterActual !== testCase.expected) {
    throw new Error(
      `${testCase.name}: expected ${testCase.expected}, received service=${serviceActual}, waiter=${waiterActual}`,
    );
  }
}

const visibilityCases = [
  { state: 'visible', expected: true },
  { state: 'hidden', expected: false },
  { state: 'prerender', expected: false },
];

for (const testCase of visibilityCases) {
  const actual = shouldRefreshGuestServiceStatusOnVisibility(testCase.state);
  if (actual !== testCase.expected) {
    throw new Error(
      `visibility ${testCase.state}: expected ${testCase.expected}, received ${actual}`,
    );
  }
}

const snapshotCases = [
  {
    name: 'accepts the latest snapshot when no guest action happened',
    args: [3, 3, 4, 4] as const,
    expected: true,
  },
  {
    name: 'rejects an older request that resolves after a newer request',
    args: [2, 3, 4, 4] as const,
    expected: false,
  },
  {
    name: 'rejects a snapshot started before a new guest call',
    args: [3, 3, 4, 5] as const,
    expected: false,
  },
];

for (const testCase of snapshotCases) {
  const actual = isGuestServiceStatusSnapshotCurrent(...testCase.args);
  if (actual !== testCase.expected) {
    throw new Error(
      `${testCase.name}: expected ${testCase.expected}, received ${actual}`,
    );
  }
}

console.log(
  `Passed ${cases.length} guest-service visibility checks, ${visibilityCases.length} resume checks and ${snapshotCases.length} stale-snapshot checks.`,
);
