import {
  isGuestServiceBookingForToday,
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

console.log(
  `Passed ${cases.length} guest-service visibility checks and ${visibilityCases.length} resume checks.`,
);
