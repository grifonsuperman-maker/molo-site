const assert = require('node:assert/strict');
const test = require('node:test');

const { AnalyticsService } = require('../dist/analytics/analytics.service.js');

test('today uses the Europe/Kyiv restaurant date around UTC midnight', () => {
  const service = new AnalyticsService({}, {}, {}, {});

  assert.equal(
    service.todayStr(new Date('2026-08-06T21:30:00.000Z')),
    '2026-08-07',
  );
});
