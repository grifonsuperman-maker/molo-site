import { formatDuration } from './durationFormat';

const cases: Array<[number, string]> = [
  [30, '30 хв'],
  [59, '59 хв'],
  [60, '1 година'],
  [90, '1,5 години'],
  [120, '2 години'],
  [180, '3 години'],
  [240, '4 години'],
  [300, '5 годин'],
];

for (const [minutes, expected] of cases) {
  if (formatDuration(minutes) !== expected) {
    throw new Error(`Unexpected duration label for ${minutes} minutes: ${formatDuration(minutes)}`);
  }
}

console.log('guest duration formatter tests passed');
