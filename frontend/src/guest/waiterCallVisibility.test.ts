import { isWaiterCallBookingForToday } from './waiterCallVisibility.js';

const today = '2026-08-09';

const cases = [
  {
    name: 'shows an approved booking for today',
    booking: { status: 'approved', bookingDate: today },
    expected: true,
  },
  {
    name: 'hides an approved booking for a future date',
    booking: { status: 'approved', bookingDate: '2026-09-01' },
    expected: false,
  },
  {
    name: 'hides an approved booking for a past date',
    booking: { status: 'approved', bookingDate: '2026-08-08' },
    expected: false,
  },
  {
    name: 'hides a pending booking for today',
    booking: { status: 'pending', bookingDate: today },
    expected: false,
  },
];

for (const testCase of cases) {
  const actual = isWaiterCallBookingForToday(testCase.booking, today);

  if (actual !== testCase.expected) {
    throw new Error(
      `${testCase.name}: expected ${testCase.expected}, received ${actual}`,
    );
  }
}

console.log(`Passed ${cases.length} waiter-call visibility checks.`);
