const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeSyrvePosVersion, assessSyrvePosVersion, diagnoseSyrvePosVersions, inspectSyrvePosVersion } = require('../dist/syrve/syrve-pos-version.js');
const { parseTerminalGroups } = require('../dist/syrve/syrve-catalog.js');

const ORG = 'a0000000-0000-4000-8000-000000000001';
const GROUP = 'a0000000-0000-4000-8000-000000000002';
const OTHER = 'a0000000-0000-4000-8000-000000000003';
const TABLE = 'a0000000-0000-4000-8000-000000000010';
const TABLE2 = 'a0000000-0000-4000-8000-000000000011';
const scope = (version = '7.7.1') => ({
  checks: Object.fromEntries(['connection', 'terminalGroups', 'restaurantSections'].map(key => [key, { status: 'ok', code: null }])),
  terminalGroups: { active: [{ id: GROUP, posVersion: version }], sleeping: [] },
  catalogTables: [{ id: TABLE, terminalGroupId: GROUP, isDeleted: false }],
});
const links = [{ syrveTableId: TABLE }];

for (const [version, read, initialization] of [
  ['7.4.5', 'unsupported', 'unsupported'], ['7.4.6', 'supported', 'unsupported'],
  ['7.4.6.123', 'supported', 'unsupported'], ['7.7.0.99', 'supported', 'unsupported'],
  ['7.7.1', 'supported', 'supported'], ['7.7.1.0', 'supported', 'supported'],
  ['7.10.0', 'supported', 'supported'], ['8.0.0', 'supported', 'supported'],
  ['8.8.8001.0', 'supported', 'supported'],
  ['6.99.99', 'unsupported', 'unsupported'],
]) test(`documented POS version boundaries are compared numerically: ${version}`, () => {
  assert.deepEqual(assessSyrvePosVersion(version), { read, initialization });
  assert.equal(normalizeSyrvePosVersion(version), version);
});

test('missing or arbitrary version text never establishes support or retains provider data', () => {
  for (const value of [undefined, null, {}, [], 7.7, '', '7.7', '7.7.1-beta', '7.7.1 secret',
    '7.7.1\n', ' 7.7.1', '07.7.1', '7.7.1.1.1', '7.999999999.1', 'secret-customer-token']) {
    assert.equal(normalizeSyrvePosVersion(value), null);
    assert.deepEqual(assessSyrvePosVersion(value), { read: 'unknown', initialization: 'unknown' });
  }
});

test('only explicitly requested version projection changes the catalog contract', () => {
  const payload = { terminalGroups: [{ organizationId: ORG, items: [{ id: GROUP, organizationId: ORG, name: 'Каса', posVersion: '7.7.1' }] }], terminalGroupsInSleep: [] };
  assert.deepEqual(parseTerminalGroups(payload, ORG).active, [{ id: GROUP, name: 'Каса' }]);
  assert.deepEqual(parseTerminalGroups(payload, ORG, true).active, [{ id: GROUP, name: 'Каса', posVersion: '7.7.1', posVersionStatus: 'valid' }]);
  payload.terminalGroups[0].items[0].posVersion = { credential: 'secret-customer-token' };
  const parsed = parseTerminalGroups(payload, ORG, true);
  assert.equal(parsed.active[0].posVersion, null);
  assert.equal(parsed.active[0].posVersionStatus, 'invalid_type');
  assert.ok(!JSON.stringify(parsed).includes('secret-customer-token'));
});

test('version diagnostics distinguish missing values and rejected formats without retaining arbitrary provider text', () => {
  for (const [value, status] of [[undefined, 'missing'], [null, 'null'], ['', 'empty'], ['  ', 'empty'],
    [8.8, 'invalid_type'], [{ credential: 'secret-customer-token' }, 'invalid_type'],
    [' 8.8.8001.0', 'invalid_format'], ['8.8', 'invalid_format'], ['secret-customer-token', 'invalid_format']]) {
    assert.deepEqual(inspectSyrvePosVersion(value), { posVersion: null, posVersionStatus: status });
    assert.deepEqual(assessSyrvePosVersion(value), { read: 'unknown', initialization: 'unknown' });
  }
  assert.deepEqual(inspectSyrvePosVersion('8.8.8001.0'), { posVersion: '8.8.8001.0', posVersionStatus: 'valid' });
});

test('version evidence covers every mapped table while ignoring unrelated supported registers', () => {
  const probe = scope('7.4.5'); probe.terminalGroups.active.push({ id: OTHER, posVersion: '7.7.1' });
  const result = diagnoseSyrvePosVersions(probe, [...links, { syrveTableId: TABLE2 }]);
  assert.deepEqual(result, { read: { supported: 0, unsupported: 1, unknown: 1 },
    initialization: { supported: 0, unsupported: 1, unknown: 1 } });
  probe.catalogTables.push({ id: TABLE2, terminalGroupId: OTHER, isDeleted: false });
  assert.deepEqual(diagnoseSyrvePosVersions(probe, [...links, { syrveTableId: TABLE2 }]), {
    read: { supported: 1, unsupported: 1, unknown: 0 }, initialization: { supported: 1, unsupported: 1, unknown: 0 } });
});

test('missing, deleted, sleeping, duplicate or different-group catalog scope cannot supply positive version evidence', () => {
  const mutations = [p => p.catalogTables = null, p => p.catalogTables = [], p => p.catalogTables[0].isDeleted = true,
    p => p.catalogTables[0].terminalGroupId = OTHER, p => p.catalogTables.push({ ...p.catalogTables[0] }),
    p => p.terminalGroups = null, p => p.terminalGroups.active = [],
    p => p.terminalGroups.active.push({ ...p.terminalGroups.active[0] }),
    p => p.terminalGroups.sleeping.push({ ...p.terminalGroups.active[0] })];
  for (const mutate of mutations) {
    const probe = scope(); mutate(probe);
    assert.deepEqual(diagnoseSyrvePosVersions(probe, links), { read: { supported: 0, unsupported: 0, unknown: 1 },
      initialization: { supported: 0, unsupported: 0, unknown: 1 } });
  }
});

test('failed or incomplete prerequisite reads invalidate all version evidence', () => {
  for (const key of ['connection', 'terminalGroups', 'restaurantSections']) for (const status of ['error', 'not_checked']) {
    const probe = scope(); probe.checks[key].status = status;
    assert.equal(diagnoseSyrvePosVersions(probe, links).read.unknown, 1);
    assert.equal(diagnoseSyrvePosVersions(probe, links).initialization.unknown, 1);
  }
});

test('multiple tables on one register retain table counts and do not imply data completeness', () => {
  const probe = scope(); probe.catalogTables.push({ id: TABLE2, terminalGroupId: GROUP, isDeleted: false });
  const result = diagnoseSyrvePosVersions(probe, [...links, { syrveTableId: TABLE2 }]);
  assert.deepEqual(result, { read: { supported: 2, unsupported: 0, unknown: 0 },
    initialization: { supported: 2, unsupported: 0, unknown: 0 } });
  assert.equal(result.complete, undefined); assert.equal(result.activationAvailable, undefined);
});
