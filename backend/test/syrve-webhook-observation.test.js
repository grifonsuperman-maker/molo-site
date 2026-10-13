require('reflect-metadata');
const assert = require('node:assert/strict');
const test = require('node:test');
const { Test } = require('@nestjs/testing');
const { Logger } = require('@nestjs/common');
const { SyrveWebhookService } = require('../dist/syrve/syrve-webhook.service.js');
const { SyrveWebhookController, SyrveWebhookGuard } = require('../dist/syrve/syrve-webhook.controller.js');
const { syrveWebhookToken } = require('../dist/syrve/syrve-webhook.js');
const { createSyrveTableSyncState } = require('../dist/syrve/syrve-state-reducer.js');
const { id, row } = require('./helpers/syrve-state-fixtures.js');
const ORG = id(80), REV = id(81), INTEGRATION = id(82), GROUP = id(1), BILL = id(86);
const PROVIDERS = [id(83), id(84), id(85)], PHYSICAL = [id(90), id(91), id(92)];
const PREFIX = 'Діагностика сповіщень Syrve: ';

function logs(t) {
  const records = [];
  const capture = message => { if (typeof message === 'string' && message.startsWith(PREFIX)) records.push(JSON.parse(message.slice(PREFIX.length))); };
  t.mock.method(Logger.prototype, 'log', capture); t.mock.method(Logger.prototype, 'warn', capture);
  return records;
}
function event(index = 0, status = 'New', timestamp = 100, bill = BILL) {
  const data = row({ organizationId: ORG, syrveTableId: PROVIDERS[index] }, bill, status, timestamp);
  return { eventType: 'TableOrderUpdate', eventTime: 'private-provider-time', organizationId: ORG, correlationId: id(88),
    eventInfo: { ...data, order: { ...data.order, customer: { phone: 'private-phone', name: 'private-name' },
      items: [{ name: 'private-item' }], privatePayload: 'private-body' } } };
}
function harness(t) {
  let saved = PROVIDERS.map((syrveTableId, index) => createSyrveTableSyncState({ integrationId: INTEGRATION,
    configurationRevision: REV, organizationId: ORG, syrveTableId, moloTableId: PHYSICAL[index] }, id(100 + index)));
  const physicalVersions = ['one', 'two', 'three'];
  const snapshot = { prepared: true, entity: { id: INTEGRATION, configurationRevision: REV, organizationId: ORG, status: 'connected' },
    links: PROVIDERS.map((syrveTableId, i) => ({ id: id(110 + i), syrveTableId, moloTableId: PHYSICAL[i], lastKnownNumber: [9,16,11][i] })) };
  const control = { enabled: true, topology: true, topologyCurrent: true, failCommit: false, failPhysical: false,
    changePhysical: false, changeLedger: false, transactionOpen: false, captures: 0, writes: [], throwRead: null };
  const captures = () => saved.map((state, i) => ({ linkId: snapshot.links[i].id, state: structuredClone(state),
    orderIds: [[]], physicalVersion: physicalVersions[i] }));
  const manager = { queryRunner: { isTransactionActive: true }, query: async (sql, params) => {
    assert.match(sql, /^UPDATE .*"tables"/);
    if (control.failPhysical) throw new Error('private-database-write');
    control.writes.push({ id: params[0], status: params[1] }); return [];
  } };
  const settings = { read: async () => { if (control.throwRead) throw control.throwRead; return snapshot; },
    transaction: async (_version, action) => {
      if (control.changePhysical) { physicalVersions[0] = 'changed'; control.changePhysical = false; }
      if (control.changeLedger) { saved[0].localRevision = id(200); control.changeLedger = false; }
      const prior = structuredClone(saved), writesBefore = control.writes.length;
      control.transactionOpen = true;
      try {
        const result = await action(manager, snapshot);
        if (control.failCommit) throw new Error('private-commit-failure');
        return result;
      } catch (error) { saved = prior; control.writes.length = writesBefore; throw error; }
      finally { control.transactionOpen = false; }
    } };
  const topology = { organizationId: ORG, configurationRevision: REV, expiresAt: Date.now() + 120_000,
    tables: PROVIDERS.map(id => ({ id, terminalGroupId: GROUP, isDeleted: false })),
    visibleTableIds: [...PROVIDERS], liveGroupIds: [GROUP], orders: [] };
  const service = new SyrveWebhookService({ options: { type: 'postgres' } }, settings,
    { read: async () => ({ enabled: control.enabled, plan: topology }) },
    { webhookTopology: () => control.topology ? topology : null, isCurrentWebhookTopology: () => control.topologyCurrent });
  t.mock.method(service.states, 'captureBatch', async () => { control.captures++; return captures(); });
  t.mock.method(service.states, 'captureBatchInTransaction', async () => captures());
  t.mock.method(service.states, 'persist', async (_manager, linkId, state) => {
    saved[snapshot.links.findIndex(link => link.id === linkId)] = structuredClone(state);
  });
  return { service, snapshot, control, topology, saved: () => structuredClone(saved), receive: value => service.receive(REV, value) };
}
function pair(records) {
  assert.equal(records.length, 2);
  assert.equal(records[0].stage, 'received');
  assert.equal(records[0].observationId, records[1].observationId);
  assert.equal(records[0].receivedAt, records[1].receivedAt);
  assert.ok(Date.parse(records[1].recordedAt) >= Date.parse(records[0].receivedAt));
  assert.ok(Number.isInteger(records[1].handlingMs) && records[1].handlingMs >= 0);
  return records[1];
}

test('committed openings, duplicates, bill-only updates and stale versions have distinct table diagnostics', async t => {
  const records = logs(t), h = harness(t);
  assert.deepEqual(await h.receive(event()), { accepted: true, events: 1, statusesApplied: 1 });
  let final = pair(records);
  assert.equal(final.stage, 'accepted'); assert.equal(final.reason, 'STATUS_APPLIED'); assert.equal(final.commitConfirmed, true);
  assert.deepEqual(final.tables.map(row => row.tableNumber), [9]);
  assert.deepEqual(final.tables[0].actions, ['occupied']); assert.equal(final.tables[0].statusChanges, 1);
  assert.equal(final.tables[0].activeBillsBefore, 0); assert.equal(final.tables[0].activeBillsAfter, 1);
  records.length = 0;
  assert.equal((await h.receive(event())).statusesApplied, 0);
  final = pair(records); assert.equal(final.reason, 'NO_STATUS_CHANGE');
  assert.equal(final.tables[0].unchanged, 1); assert.equal(final.tables[0].ledgerChanges, 0);
  records.length = 0;
  await h.receive(event(0, 'Bill', 200)); final = pair(records);
  assert.equal(final.tables[0].ledgerChanges, 1); assert.equal(final.tables[0].statusChanges, 0);
  records.length = 0;
  await h.receive(event(0, 'Bill', 150)); final = pair(records);
  assert.deepEqual(final.tables[0].diagnostics, ['stale_order']); assert.equal(final.tables[0].unchanged, 1);
});

test('a transfer reports both source and destination; closing one of multiple bills preserves occupancy', async t => {
  const records = logs(t), h = harness(t);
  await h.receive(event()); records.length = 0;
  assert.equal((await h.receive(event(1, 'Bill', 200))).statusesApplied, 2);
  let final = pair(records);
  assert.deepEqual(final.tables.map(row => [row.tableNumber, row.actions]), [[9,['free']],[16,['occupied']]]);
  await h.receive(event(1, 'New', 201, id(87))); records.length = 0;
  assert.equal((await h.receive(event(1, 'Closed', 202))).statusesApplied, 0);
  final = pair(records); assert.equal(final.tables[0].tableNumber, 9, 'prior association remains diagnosable');
  const destination = final.tables.find(row => row.tableNumber === 16);
  assert.equal(destination.activeBillsBefore, 2); assert.equal(destination.activeBillsAfter, 1);
  assert.equal(destination.statusChanges, 0); assert.deepEqual(destination.actions, []);
});

test('topology failures report 503 and affected tables without extra capture/transport or applied writes', async t => {
  const records = logs(t), h = harness(t);
  h.control.topology = false;
  await assert.rejects(h.receive(event()), error => error.getStatus() === 503);
  let final = pair(records);
  assert.equal(final.reason, 'TOPOLOGY_UNAVAILABLE'); assert.equal(final.httpStatus, 503);
  assert.equal(final.commitConfirmed, false); assert.deepEqual(final.tables.map(row => row.tableNumber), [9]);
  assert.equal(h.control.captures, 1); assert.equal(h.control.writes.length, 0);
  records.length = 0; h.control.topology = true; h.topology.liveGroupIds = [];
  await assert.rejects(h.receive(event()), error => error.getStatus() === 503);
  final = pair(records); assert.equal(final.reason, 'TOPOLOGY_UNCONFIRMED'); assert.equal(final.statusesApplied, 0);
});

test('equal informational table numbers retain separate source/destination counters and stable private references', async t => {
  const records = logs(t), h = harness(t);
  h.snapshot.links[1].lastKnownNumber = 9;
  await h.receive(event()); const sourceRef = pair(records).tables[0].tableRef;
  records.length = 0;
  await h.receive(event(1, 'Bill', 200)); const final = pair(records);
  assert.deepEqual(final.tables.map(row => row.tableNumber), [9,9]);
  assert.equal(new Set(final.tables.map(row => row.tableRef)).size, 2);
  assert.ok(final.tables.every(row => /^[0-9a-f]{16}$/.test(row.tableRef) && row.statusChanges === 1));
  assert.deepEqual(final.tables.find(row => row.tableRef === sourceRef).actions, ['free']);
  assert.ok(!JSON.stringify(records).includes(PHYSICAL[0]) && !JSON.stringify(records).includes(PHYSICAL[1]));
});

test('unknown/conflicting evidence explains zero physical actions without printing provider versions', async t => {
  const records = logs(t), h = harness(t);
  await h.receive(event()); records.length = 0;
  assert.equal((await h.receive([event(1, 'New', 100), event(2, 'New', 100)])).statusesApplied, 0);
  const final = pair(records);
  assert.equal(final.reason, 'NO_STATUS_CHANGE'); assert.equal(final.unassociatedOrders, 0, 'conflict retains its explicit destination UUIDs');
  assert.ok(final.tables.some(row => row.diagnostics.includes('conflicting_order_versions')));
  assert.ok(final.tables.every(row => !row.actions.length && row.statusChanges === 0));
  assert.doesNotMatch(JSON.stringify(records), /timestamp|eventTime|fingerprint/);
  records.length = 0;
  const pending = event(0, 'New', 1000, id(87));
  pending.eventInfo.creationStatus = 'InProgress'; pending.eventInfo.order = null;
  assert.equal((await h.receive(pending)).statusesApplied, 0);
  const unassociated = pair(records);
  assert.equal(unassociated.unassociatedOrders, 1); assert.equal(unassociated.tables.length, 3);
  assert.ok(unassociated.tables.every(row => row.statusChanges === 0));
});

test('changed physical/ledger fences retain the existing 409 and identify the conflict', async t => {
  for (const [physical, ledger, fence] of [[true,false,'physical'],[false,true,'ledger'],[true,true,'both']]) {
    const records = logs(t), h = harness(t);
    h.control.changePhysical = physical; h.control.changeLedger = ledger;
    await assert.rejects(h.receive(event()), error => error.getStatus() === 409);
    const final = pair(records);
    assert.equal(final.reason, 'LOCAL_STATE_CHANGED'); assert.equal(final.tables[0].fence, fence);
    assert.equal(final.statusesApplied, 0); assert.equal(h.control.writes.length, 0);
    t.mock.restoreAll();
  }
});

test('SQL/commit failures and revoked topology never log staged changes as committed', async t => {
  for (const condition of ['failPhysical','failCommit','topologyCurrent']) {
    const records = logs(t), h = harness(t), before = h.saved();
    h.control[condition] = condition === 'topologyCurrent' ? false : true;
    await assert.rejects(h.receive(event()));
    const final = pair(records);
    assert.equal(final.stage, 'rejected'); assert.equal(final.commitConfirmed, false); assert.equal(final.statusesApplied, 0);
    assert.equal(final.reason, condition === 'topologyCurrent' ? 'TOPOLOGY_CHANGED'
      : condition === 'failCommit' ? 'COMMIT_NOT_CONFIRMED' : 'PROCESSING_FAILED');
    assert.ok(final.tables.every(row => row.statusChanges === 0 && row.ledgerChanges === 0 && row.activeBillsAfter === null && !row.actions.length));
    assert.deepEqual(h.saved(), before); assert.equal(h.control.writes.length, 0);
    assert.doesNotMatch(JSON.stringify(records), /private-/);
    t.mock.restoreAll();
  }
});

test('configuration/consent refusals and ignored events are observable without introducing writes', async t => {
  const records = logs(t), h = harness(t);
  h.snapshot.entity.status = 'not_connected';
  await assert.rejects(h.receive(event()), error => error.getStatus() === 409);
  assert.equal(pair(records).reason, 'CONFIGURATION_CHANGED'); assert.equal(h.control.captures, 0);
  records.length = 0; h.snapshot.entity.status = 'connected'; h.control.enabled = false;
  await assert.rejects(h.receive(event()), error => error.getStatus() === 409);
  assert.equal(pair(records).reason, 'AUTO_STATUS_DISABLED'); assert.equal(h.control.captures, 0);
  records.length = 0; h.control.enabled = true;
  assert.deepEqual(await h.receive({ eventType: 'TableOrderError', organizationId: ORG, eventInfo: { error: 'private-error' } }),
    { accepted: true, events: 0, statusesApplied: 0 });
  assert.equal(pair(records).reason, 'IGNORED_EVENTS'); assert.equal(records[1].ignoredEvents, 1);
  assert.equal(h.control.captures, 0);
});

test('accepted diagnostics are emitted after commit; a broken logger never changes acknowledgement', async t => {
  const h = harness(t), records = [];
  const capture = message => {
    if (message.startsWith(PREFIX)) {
      const record = JSON.parse(message.slice(PREFIX.length));
      if (record.stage === 'accepted') assert.equal(h.control.transactionOpen, false);
      records.push(record);
    }
  };
  t.mock.method(Logger.prototype, 'log', capture);
  await h.receive(event()); assert.equal(pair(records).commitConfirmed, true);
  t.mock.method(Logger.prototype, 'log', () => { throw new Error('private-log-failure'); });
  assert.equal((await h.receive(event(1, 'New', 200, id(87)))).statusesApplied, 1);
  assert.equal(h.saved()[1].activeSyrveOrderIds.length, 1);
});

test('HTTP authorization/malformed requests share one server observation and never leak supplied identifiers or secrets', async t => {
  const records = logs(t), h = harness(t), prior = process.env.SYRVE_CREDENTIALS_SECRET;
  process.env.SYRVE_CREDENTIALS_SECRET = 'private-synthetic-webhook-key';
  t.after(() => prior === undefined ? delete process.env.SYRVE_CREDENTIALS_SECRET : process.env.SYRVE_CREDENTIALS_SECRET = prior);
  const token = syrveWebhookToken(REV);
  const module = await Test.createTestingModule({ controllers: [SyrveWebhookController],
    providers: [SyrveWebhookGuard, { provide: SyrveWebhookService, useValue: h.service }] }).compile();
  const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const base = await app.getUrl();
  for (const [authorization, body, status, reason] of [['Bearer private-jwt', event(), 401, 'UNAUTHORIZED'],
    [token, { privateBody: 'private-malformed' }, 400, 'INVALID_PAYLOAD'], [token, event(), 200, 'STATUS_APPLIED']]) {
    records.length = 0;
    const response = await fetch(base + '/api/syrve-webhook/' + REV, { method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json', 'X-Request-ID': 'private-client-request-id' }, body: JSON.stringify(body) });
    assert.equal(response.status, status); const final = pair(records); assert.equal(final.reason, reason);
    assert.equal(final.httpStatus, status); assert.notEqual(final.observationId, 'private-client-request-id');
    const reply = await response.json(); assert.equal(Object.hasOwn(reply, 'observationId'), false);
    for (const secret of [token, REV, ORG, INTEGRATION, BILL, id(88), ...PROVIDERS, ...PHYSICAL, 'private-']) {
      assert.ok(!JSON.stringify(records).includes(secret));
    }
  }
  records.length = 0; delete process.env.SYRVE_CREDENTIALS_SECRET;
  const response = await fetch(base + '/api/syrve-webhook/' + REV, { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify(event()) });
  assert.equal(response.status, 503); assert.equal(pair(records).reason, 'AUTHORIZATION_UNAVAILABLE');
});
