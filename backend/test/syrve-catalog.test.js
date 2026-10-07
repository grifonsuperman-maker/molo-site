const assert = require('node:assert/strict');
const test = require('node:test');
const { SyrveClient } = require('../dist/syrve/syrve-client.js');
const { SyrveIntegrationService } = require('../dist/syrve/syrve-integration.service.js');
const { buildSyrveCatalogPreview } = require('../dist/syrve/syrve-catalog.js');

const id = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = id(1), GROUP = id(2), SECTION = id(3);
const LOGIN = 'catalog-test-api-secret', TOKEN = 'catalog-test-backend-token';
const INPUT = { displayName: 'MOLO', apiBaseUrl: 'https://api-eu.syrve.live', apiLogin: LOGIN, organizationId: ORG };
const molo = (n, number) => ({ id: id(n), tableNumber: String(number) });
const table = (n, number, isDeleted = false) => ({ id: id(n), number, name: `Table ${number}`, isDeleted,
  sectionId: SECTION, sectionName: 'Зал', terminalGroupId: GROUP });
const groups = () => ({ correlationId: id(91), terminalGroups: [{ organizationId: ORG, items: [{ id: GROUP, organizationId: ORG, name: 'Каса', address: null, timeZone: '03:00:00' }] }],
  terminalGroupsInSleep: [] });
const sections = (tables) => ({ correlationId: id(92), revision: 1,
  restaurantSections: [{ id: SECTION, terminalGroupId: GROUP, name: 'Зал',
    tables: tables.map(({ id: tableId, number, name, isDeleted }) => ({ id: tableId, number, name, isDeleted,
      seatingCapacity: 4, revision: 1, posId: id(93) })) }] });
const catalog = (tables) => ({ organization: { id: ORG, name: 'MOLO' },
  terminalGroups: { active: [{ id: GROUP, name: 'Каса' }], sleeping: [] }, sectionsCount: 1, tables });

function setup(t, payloads = [groups(), sections([table(10, 12)])]) {
  const keys = ['SYRVE_APP_ID', 'SYRVE_APP_CLIENT_SECRET', 'SYRVE_CREDENTIALS_SECRET', 'NODE_ENV', 'RENDER_EXTERNAL_URL'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => { for (const key of keys) {
    if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key];
  } });
  process.env.SYRVE_APP_ID = '';
  process.env.SYRVE_APP_CLIENT_SECRET = '';
  process.env.SYRVE_CREDENTIALS_SECRET = 'catalog-test-long-storage-secret';
  const responses = [Response.json({ token: TOKEN }), Response.json({ organizations: [{ id: ORG, name: 'MOLO' }] }),
    ...payloads.map((value) => value instanceof Response || typeof value === 'function' ? value : Response.json(value))];
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    const response = responses.shift();
    assert.ok(response, 'unexpected Syrve request');
    return typeof response === 'function' ? response(options) : response;
  });
  return { client: new SyrveClient(require('./helpers/syrve-test-request-limiter.js')), calls };
}
const safeError = (code) => (error) => {
  assert.equal(error.getStatus(), 502);
  assert.equal(error.getResponse().code, code);
  assert.ok(!JSON.stringify(error.getResponse()).includes(LOGIN));
  assert.ok(!JSON.stringify(error.getResponse()).includes(TOKEN));
  return true;
};

test('catalog uses only official read methods, scoped organization/group IDs and no layout request', async (t) => {
  const h = setup(t);
  const result = await h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG.toUpperCase());
  assert.deepEqual(h.calls.map(({ url }) => url.split('.live')[1]), [
    '/api/1/access_token', '/api/1/organizations', '/api/1/terminal_groups', '/api/1/reserve/available_restaurant_sections',
  ]);
  assert.deepEqual(h.calls[2].body, { organizationIds: [ORG], includeDisabled: false });
  assert.deepEqual(h.calls[3].body, { terminalGroupIds: [GROUP], returnSchema: false });
  assert.deepEqual(result.tables, [table(10, 12)]);
  assert.equal(h.calls.length, 4, 'one backend token session for the entire catalog');
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test('connection steps reuse the tested session but fetch a fresh catalog each time', async (t) => {
  const h = setup(t, [groups(), sections([table(10, 12)]), groups(), sections([table(11, 37)])]);
  await h.client.checkOrganizations(INPUT.apiBaseUrl, LOGIN);
  const first = await h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG);
  const next = await h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG);
  assert.deepEqual(first.tables, [table(10, 12)]);
  assert.deepEqual(next.tables, [table(11, 37)]);
  assert.deepEqual(h.calls.map(({ url }) => new URL(url).pathname), [
    '/api/1/access_token', '/api/1/organizations',
    '/api/1/terminal_groups', '/api/1/reserve/available_restaurant_sections',
    '/api/1/terminal_groups', '/api/1/reserve/available_restaurant_sections',
  ]);
  assert.ok(!JSON.stringify(next).includes(TOKEN));
});

test('denied cached access fails once and requires fresh authentication on the next explicit action', async (t) => {
  const h = setup(t, [Response.json({}, { status: 401 }),
    Response.json({ token: TOKEN }), Response.json({ organizations: [{ id: ORG, name: 'MOLO' }] }),
    groups(), sections([table(10, 12)])]);
  await h.client.checkOrganizations(INPUT.apiBaseUrl, LOGIN);
  await assert.rejects(h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG), safeError('SYRVE_AUTH_FAILED'));
  assert.equal(h.calls.length, 3, 'no automatic retry or fallback after denial');
  assert.equal((await h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG)).tables.length, 1);
  assert.equal(h.calls.filter(({ url }) => url.endsWith('/access_token')).length, 2);
});

test('the explicit credential test still authenticates afresh after a cached success', async (t) => {
  const h = setup(t, [Response.json({ token: TOKEN }),
    Response.json({ organizations: [{ id: ORG, name: 'MOLO' }] })]);
  await h.client.checkOrganizations(INPUT.apiBaseUrl, LOGIN);
  await h.client.checkOrganizations(INPUT.apiBaseUrl, LOGIN);
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls.filter(({ url }) => url.endsWith('/access_token')).length, 2);
});

test('v2 catalog retains server-only app authentication with no token in projections', async (t) => {
  const h = setup(t);
  process.env.SYRVE_APP_ID = id(98);
  process.env.SYRVE_APP_CLIENT_SECRET = 'catalog-app-secret';
  const result = await h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG);
  assert.ok(h.calls[0].url.endsWith('/api/v2/access_token'));
  for (const secret of [LOGIN, TOKEN, 'catalog-app-secret']) assert.ok(!JSON.stringify(result).includes(secret));
});

test('catalog projection drops upstream layout, POS identity and undeclared credential fields', async (t) => {
  const payload = sections([table(10, 12)]);
  payload.restaurantSections[0].schema = { tables: [{ x: 999, angle: 45, token: TOKEN }] };
  payload.restaurantSections[0].tables[0].apiLogin = LOGIN;
  const h = setup(t, [groups(), payload]);
  const result = await h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG);
  assert.deepEqual(result.tables, [table(10, 12)]);
  for (const excluded of [LOGIN, TOKEN, 'schema', 'posId', 'angle']) assert.ok(!JSON.stringify(result).includes(excluded));
});

test('organization must be valid and accessible before any catalog request', async (t) => {
  const h = setup(t);
  await assert.rejects(h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, 'invalid'), (error) => error.getStatus() === 400);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, id(99)), /більше не доступна/);
  assert.equal(h.calls.length, 2);
});

test('sleeping groups are diagnosed without awakening them or querying their sections', async (t) => {
  const payload = groups();
  payload.terminalGroupsInSleep = [{ organizationId: ORG, items: [{ id: id(90), organizationId: ORG, name: 'Спляча каса' }] }];
  const h = setup(t, [payload, sections([table(10, 12)])]);
  const preview = buildSyrveCatalogPreview(await h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG), [molo(20, 12)]);
  assert.equal(preview.diagnostics.terminalGroups.sleeping.length, 1);
  assert.deepEqual(h.calls[3].body.terminalGroupIds, [GROUP]);
  assert.ok(preview.diagnostics.warnings.some((warning) => warning.includes('неактивна')));
  assert.equal(preview.syncEnabled, false);
});

test('no active terminal groups is a diagnostic, never a section/wake command or table reset', async (t) => {
  const h = setup(t, [{ terminalGroups: [], terminalGroupsInSleep: groups().terminalGroups }]);
  const preview = buildSyrveCatalogPreview(await h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG), [molo(20, 12)]);
  assert.equal(h.calls.length, 3);
  assert.equal(preview.summary.proposals, 0);
  assert.equal(preview.mappingConfirmationAvailable, false);
  assert.ok(preview.diagnostics.warnings.some((warning) => warning.includes('немає активних')));
});

for (const [label, mutate] of [
  ['absent sleep list', (g) => delete g.terminalGroupsInSleep],
  ['foreign wrapper', (g) => g.terminalGroups[0].organizationId = id(99)],
  ['foreign group', (g) => g.terminalGroups[0].items[0].organizationId = id(99)],
  ['duplicate group', (g) => g.terminalGroups[0].items.push(g.terminalGroups[0].items[0])],
  ['absent section tables', (_g, s) => delete s.restaurantSections[0].tables],
  ['foreign section group', (_g, s) => s.restaurantSections[0].terminalGroupId = id(99)],
  ['duplicate section ID', (_g, s) => s.restaurantSections.push(s.restaurantSections[0])],
  ['absent deleted flag', (_g, s) => delete s.restaurantSections[0].tables[0].isDeleted],
  ['string number', (_g, s) => s.restaurantSections[0].tables[0].number = '12'],
  ['non-integer number', (_g, s) => s.restaurantSections[0].tables[0].number = 12.5],
  ['invalid table ID', (_g, s) => s.restaurantSections[0].tables[0].id = 'unknown'],
]) {
  test(`${label} rejects the entire catalog instead of returning partial proposals`, async (t) => {
    const g = groups(), s = sections([table(10, 12)]);
    mutate(g, s);
    const h = setup(t, [g, s]);
    await assert.rejects(h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG), safeError('SYRVE_INVALID_RESPONSE'));
  });
}

for (const [status, code] of [[401, 'SYRVE_AUTH_FAILED'], [403, 'SYRVE_ACCESS_DENIED'],
  [429, 'SYRVE_RATE_LIMITED'], [504, 'SYRVE_TIMEOUT'], [500, 'SYRVE_UNAVAILABLE']]) {
  test(`section HTTP ${status} preserves controlled failures and leaks no body`, async (t) => {
    const h = setup(t, [groups(), Response.json({ message: `${LOGIN} ${TOKEN}` }, { status })]);
    await assert.rejects(h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG), safeError(code));
  });
}

test('offline section access yields no validated catalog or MOLO writes', async (t) => {
  const h = setup(t, [groups(), () => { throw new Error(`${LOGIN} ${TOKEN}`); }]);
  await assert.rejects(h.client.getCatalog(INPUT.apiBaseUrl, LOGIN, ORG), safeError('SYRVE_UNAVAILABLE'));
});

test('unique matching numbers propose existing UUIDs; unknown provider tables only enter diagnostics', () => {
  const tables = [molo(20, 12), molo(21, 13)];
  const input = catalog([table(10, 12), table(11, 77)]);
  const before = structuredClone({ input, tables });
  const result = buildSyrveCatalogPreview(input, tables);
  assert.deepEqual(result.summary, { syrveTables: 2, proposals: 1, missingInMolo: 1, missingInSyrve: 1, conflicts: 0, deletedTables: 0 });
  assert.equal(result.proposals[0].moloTableId, id(20));
  assert.equal(result.proposals[0].syrveTableId, id(10));
  assert.equal(result.missingInMolo[0].number, 77);
  assert.deepEqual(result.missingInSyrve, [molo(21, 13)]);
  assert.deepEqual(result.diagnostics.receivedSections, [{
    sectionName: 'Зал', terminalGroupName: 'Каса', tableNumbers: [12, 77], tableCount: 2,
  }]);
  assert.deepEqual({ input, tables }, before);
});

test('section diagnostics keep duplicate table numbers compact without undercounting real tables', () => {
  const result = buildSyrveCatalogPreview(catalog([table(10, 12), table(11, 12)]), [molo(20, 12)]);
  assert.deepEqual(result.diagnostics.receivedSections, [{
    sectionName: 'Зал', terminalGroupName: 'Каса', tableNumbers: [12], tableCount: 2,
  }]);
  assert.equal(result.summary.syrveTables, 2);
  assert.ok(result.conflicts.some((conflict) => conflict.code === 'duplicate_syrve_number'));
});

test('duplicate provider numbers, duplicate IDs and duplicate MOLO numbers never produce an ambiguous pair', () => {
  for (const [input, moloRows, code] of [
    [catalog([table(10, 12), table(11, 12)]), [molo(20, 12)], 'duplicate_syrve_number'],
    [catalog([table(10, 12), table(10, 14)]), [molo(20, 12), molo(21, 14)], 'duplicate_syrve_id'],
    [catalog([table(10, 12)]), [molo(20, 12), molo(21, '0012')], 'duplicate_molo_number'],
  ]) {
    const result = buildSyrveCatalogPreview(input, moloRows);
    assert.equal(result.proposals.length, 0);
    assert.ok(result.conflicts.some((conflict) => conflict.code === code));
  }
});

test('deleted entries and an ID shared with a deleted entry cannot be proposed', () => {
  for (const input of [catalog([table(10, 12, true)]), catalog([table(10, 12), table(10, 14, true)])]) {
    const result = buildSyrveCatalogPreview(input, [molo(20, 12)]);
    assert.equal(result.proposals.length, 0);
    assert.equal(result.summary.deletedTables, 1);
  }
});

test('unrepresentable numbers are conflicts; leading zero matches remain explicit suggestions only', () => {
  const result = buildSyrveCatalogPreview(catalog([table(10, -1), table(11, 12)]), [molo(20, 'A1'), molo(21, '0012')]);
  assert.equal(result.conflicts.length, 2);
  assert.equal(result.proposals[0].moloTableNumber, '0012');
  assert.equal(result.mappingConfirmationAvailable, false);
  assert.equal(result.syncEnabled, false);
});

test('Director preview reads only table ID/number and never creates tables, logs or integration/link rows', async (t) => {
  const h = setup(t, [groups(), sections([table(10, 12), table(11, 77)])]);
  let reads = 0;
  const forbidden = new Proxy({}, { get: (_target, method) => () => assert.fail(`forbidden ${String(method)} write/access`) });
  const service = new SyrveIntegrationService({ read: async () => ({ prepared: false, entity: null, links: [] }) }, forbidden, h.client, {
    find: async (options) => {
      reads++;
      assert.deepEqual(options.select, { id: true, tableNumber: true });
      return [molo(20, 12), { ...molo(21, 13), status: 'occupied', x: 22, photoUrl: '/keep.jpg' }];
    },
  });
  const result = await service.previewTables(INPUT);
  assert.equal(reads, 1);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.missingInMolo[0].number, 77);
  assert.deepEqual(result.missingInSyrve, [molo(21, 13)]);
  for (const secret of [LOGIN, TOKEN, 'apiLoginEncrypted', 'photoUrl', 'occupied']) assert.ok(!JSON.stringify(result).includes(secret));
});

test('failed preview leaves all existing MOLO and integration state untouched', async (t) => {
  const h = setup(t, [groups(), Response.json({}, { status: 500 })]);
  const forbidden = new Proxy({}, { get: (_target, method) => () => assert.fail(`unexpected local access ${String(method)}`) });
  const service = new SyrveIntegrationService({ read: async () => ({ prepared: false, entity: null, links: [] }) }, forbidden, h.client, forbidden);
  await assert.rejects(service.previewTables(INPUT), safeError('SYRVE_UNAVAILABLE'));
});
