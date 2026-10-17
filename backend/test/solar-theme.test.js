const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const solarSource = fs.readFileSync(
  path.join(__dirname, '../src/restaurant/solar-theme.ts'),
  'utf8',
);
const compiled = ts.transpileModule(solarSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const solar = { exports: {} };
new Function('module', 'exports', compiled)(solar, solar.exports);
const { solarSiteMode, resolveSiteMode } = solar.exports;

test('sunrise, noon and sunset use restaurant time in Kyiv, not visitor time', () => {
  assert.equal(solarSiteMode(new Date('2026-06-21T00:00:00Z')), 'night');
  assert.equal(solarSiteMode(new Date('2026-06-21T10:00:00Z')), 'day');
  assert.equal(solarSiteMode(new Date('2026-06-21T20:00:00Z')), 'night');
  assert.equal(solarSiteMode(new Date('2026-12-21T10:00:00Z')), 'day');
  assert.equal(solarSiteMode(new Date('2026-12-21T18:00:00Z')), 'night');
});

test('the sunset moves seasonally, rather than following a fixed hour', () => {
  assert.equal(solarSiteMode(new Date('2026-06-21T16:00:00Z')), 'day');
  assert.equal(solarSiteMode(new Date('2026-12-21T16:00:00Z')), 'night');
});

test('manual day, night and holiday always override solar mode', () => {
  const midday = new Date('2026-06-21T10:00:00Z');
  const midnight = new Date('2026-06-21T22:00:00Z');
  assert.equal(resolveSiteMode('night', false, midday), 'night');
  assert.equal(resolveSiteMode('day', false, midnight), 'day');
  assert.equal(resolveSiteMode('holiday', false, midnight), 'holiday');
  assert.equal(resolveSiteMode('night', true, midday), 'day');
  assert.equal(resolveSiteMode('day', true, midnight), 'night');
});
