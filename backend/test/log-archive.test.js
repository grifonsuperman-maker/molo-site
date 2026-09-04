require('reflect-metadata');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { LogsController } = require('../dist/logs/logs.controller.js');
const { LogsService } = require('../dist/logs/logs.service.js');
const {
  AddLogArchive2026082400010,
} = require('../dist/migrations/2026082400010-AddLogArchive.js');
const {
  ROLES_KEY,
} = require('../dist/common/decorators/roles.decorator.js');

function logFixture() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    action: 'Офіціант завершив бронювання',
    details: { bookingId: 'booking-1' },
    staff: { id: 'staff-1', fullName: 'Олександр', role: 'waiter' },
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
  };
}

function createHarness({ archived = false, total = 451, log = logFixture() } = {}) {
  const state = { archived };
  const findCalls = [];
  const joins = [];
  const selections = [];
  const orderBys = [];
  const pagination = { skip: null, take: null };
  const paginationMethods = [];
  const locks = [];
  const removed = [];
  const transactionQueries = [];

  const queryBuilder = {
    leftJoinAndSelect(relation, alias) {
      joins.push({ kind: 'leftJoinAndSelect', relation, alias });
      return this;
    },
    leftJoin(table, alias, condition) {
      joins.push({ kind: 'leftJoin', table, alias, condition });
      return this;
    },
    innerJoin(table, alias, condition) {
      joins.push({ kind: 'innerJoin', table, alias, condition });
      return this;
    },
    addSelect(selection, alias) {
      selections.push({ selection, alias });
      return this;
    },
    where() { return this; },
    orderBy(criteria, direction) {
      orderBys.push({ kind: 'orderBy', criteria, direction });
      return this;
    },
    addOrderBy(criteria, direction) {
      orderBys.push({ kind: 'addOrderBy', criteria, direction });
      return this;
    },
    skip(value) {
      paginationMethods.push('skip');
      pagination.skip = value;
      return this;
    },
    take(value) {
      paginationMethods.push('take');
      pagination.take = value;
      return this;
    },
    offset(value) {
      paginationMethods.push('offset');
      pagination.skip = value;
      return this;
    },
    limit(value) {
      paginationMethods.push('limit');
      pagination.take = value;
      return this;
    },
    setLock(mode, version, aliases) {
      locks.push({ mode, aliases });
      return this;
    },
    async getManyAndCount() {
      return [log ? [log] : [], total];
    },
    async getOne() {
      return log;
    },
  };

  const repository = {
    manager: null,
    async find(options) {
      findCalls.push(options);
      return log ? [log] : [];
    },
    createQueryBuilder() {
      return queryBuilder;
    },
    async remove(value) {
      removed.push(value);
      state.archived = false;
      return value;
    },
  };

  const manager = {
    getRepository() {
      return repository;
    },
    async query(sql, params) {
      transactionQueries.push({ sql, params });
      if (sql.includes('INSERT INTO "log_archives"')) {
        state.archived = true;
        return [];
      }
      if (sql.includes('SELECT EXISTS')) {
        return [{ archived: state.archived }];
      }
      throw new Error(`Unexpected SQL in log archive test: ${sql}`);
    },
  };

  repository.manager = {
    async transaction(callback) {
      return callback(manager);
    },
  };

  const service = new LogsService(repository);
  const controller = new LogsController(service);

  return {
    service,
    controller,
    state,
    findCalls,
    joins,
    selections,
    orderBys,
    pagination,
    paginationMethods,
    locks,
    removed,
    transactionQueries,
    log,
  };
}

test('legacy GET /logs contract stays owner/admin and keeps the existing last-300 query', async () => {
  assert.deepEqual(Reflect.getMetadata(ROLES_KEY, LogsController), [
    'owner',
    'admin',
  ]);

  const { service, findCalls } = createHarness();
  await service.findAll();

  assert.deepEqual(findCalls, [
    {
      relations: ['staff'],
      order: { createdAt: 'DESC' },
      take: 300,
    },
  ]);
});

test('new log archive management endpoints are owner-only', () => {
  for (const method of [
    'findActive',
    'findArchive',
    'archive',
    'deletePermanently',
  ]) {
    assert.deepEqual(
      Reflect.getMetadata(ROLES_KEY, LogsController.prototype[method]),
      ['owner'],
    );
  }
});

test('active staff actions support pages beyond the first 300 records', async () => {
  const { controller, pagination, paginationMethods, joins } = createHarness({ total: 451 });

  const result = await controller.findActive('4', '100');

  assert.equal(result.total, 451);
  assert.equal(result.page, 4);
  assert.equal(result.limit, 100);
  assert.equal(result.hasMore, true);
  assert.deepEqual(pagination, { skip: 300, take: 100 });
  assert.deepEqual(paginationMethods, ['skip', 'take']);
  assert.ok(
    joins.some(
      (join) =>
        join.kind === 'leftJoin' &&
        join.table === 'log_archives' &&
        join.alias === 'log_archive',
    ),
  );
});

test('archive pages use direct offset/limit pagination and order by the selected archive alias', async () => {
  const {
    controller,
    pagination,
    paginationMethods,
    joins,
    selections,
    orderBys,
  } = createHarness({ archived: true, total: 451 });

  const result = await controller.findArchive('4', '100');

  assert.equal(result.total, 451);
  assert.equal(result.page, 4);
  assert.equal(result.limit, 100);
  assert.equal(result.hasMore, true);
  assert.deepEqual(pagination, { skip: 300, take: 100 });
  assert.deepEqual(paginationMethods, ['offset', 'limit']);
  assert.ok(
    joins.some(
      (join) =>
        join.kind === 'innerJoin' &&
        join.table === 'log_archives' &&
        join.alias === 'log_archive',
    ),
  );
  assert.deepEqual(selections, [
    {
      selection: 'log_archive.archived_at',
      alias: 'logArchiveArchivedAt',
    },
  ]);
  assert.deepEqual(orderBys.slice(-2), [
    {
      kind: 'orderBy',
      criteria: 'logArchiveArchivedAt',
      direction: 'DESC',
    },
    {
      kind: 'addOrderBy',
      criteria: 'log.createdAt',
      direction: 'DESC',
    },
  ]);
});

test('archiving a staff action is idempotent and does not delete the original log', async () => {
  const {
    service,
    state,
    locks,
    removed,
    transactionQueries,
    log,
  } = createHarness();

  assert.deepEqual(await service.archive(log.id), { ok: true, id: log.id });
  assert.deepEqual(await service.archive(log.id), { ok: true, id: log.id });

  assert.equal(state.archived, true);
  assert.equal(removed.length, 0);
  assert.deepEqual(locks, [
    { mode: 'pessimistic_write', aliases: ['log'] },
    { mode: 'pessimistic_write', aliases: ['log'] },
  ]);
  const inserts = transactionQueries.filter(({ sql }) =>
    sql.includes('INSERT INTO "log_archives"'),
  );
  assert.equal(inserts.length, 2);
  assert.ok(inserts.every(({ sql }) => sql.includes('ON CONFLICT')));
});

test('permanent deletion is blocked until the staff action is archived', async () => {
  const { service, removed, locks, log } = createHarness();

  await assert.rejects(
    () => service.deletePermanently(log.id),
    /Спочатку перемістіть дію персоналу до архіву/,
  );

  assert.equal(removed.length, 0);
  assert.deepEqual(locks, [
    { mode: 'pessimistic_write', aliases: ['log'] },
  ]);
});

test('Director can permanently delete an archived staff action', async () => {
  const { service, removed, log } = createHarness({ archived: true });

  assert.deepEqual(await service.deletePermanently(log.id), {
    ok: true,
    id: log.id,
  });
  assert.equal(removed.length, 1);
  assert.equal(removed[0], log);
});

test('log archive migration has safe up/down and is registered as a runtime migration', async () => {
  const queries = [];
  const queryRunner = {
    async query(sql) {
      queries.push(String(sql));
    },
  };
  const migration = new AddLogArchive2026082400010();

  await migration.up(queryRunner);
  assert.match(queries[0], /CREATE TABLE IF NOT EXISTS "log_archives"/);
  assert.match(queries[0], /REFERENCES "logs"\("id"\) ON DELETE CASCADE/);
  assert.match(queries[1], /CREATE INDEX IF NOT EXISTS "IDX_log_archives_archived_at"/);

  await migration.down(queryRunner);
  assert.match(queries.at(-1), /DROP TABLE IF EXISTS "log_archives"/);

  const appModuleSource = fs.readFileSync(
    path.join(__dirname, '../src/app.module.ts'),
    'utf8',
  );
  assert.match(
    appModuleSource,
    /AddLogArchive2026082400010.*2026082400010-AddLogArchive/,
  );
  assert.match(
    appModuleSource,
    /AddGuestReviewArchive2026082200010,[\s\S]*AddLogArchive2026082400010,/,
  );
});
