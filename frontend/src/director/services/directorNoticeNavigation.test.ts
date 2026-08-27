import { directorNoticeDestination } from './directorNoticeNavigation.js';

function expectEqual<T>(actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  }
}

expectEqual(directorNoticeDestination('reviews:36'), 'reviews');
expectEqual(directorNoticeDestination('pending:4'), null);
expectEqual(directorNoticeDestination('cleaning:2'), null);

console.log('directorNoticeNavigation tests passed');
