import { strict as assert } from 'node:assert';

import { directorNoticeDestination } from './directorNoticeNavigation';

assert.equal(directorNoticeDestination('reviews:36'), 'reviews');
assert.equal(directorNoticeDestination('pending:4'), null);
assert.equal(directorNoticeDestination('cleaning:2'), null);

console.log('directorNoticeNavigation tests passed');
