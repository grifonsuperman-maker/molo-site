const assert = require('node:assert/strict');
const test = require('node:test');
const { UnauthorizedException } = require('@nestjs/common');

const {
  StaffPinThrottleService,
} = require('../dist/staff/staff-pin-throttle.service.js');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createDataSource() {
  const state = { rows: [], nextId: 1 };

  async function query(sql, params = []) {
    if (sql.includes('pg_advisory_xact_lock')) return [];

    if (
      sql.includes('DELETE FROM "staff_pin_attempts"') &&
      sql.includes('"locked_until" IS NULL')
    ) {
      return [];
    }

    if (sql.includes('SELECT "locked_until"') && sql.includes('> NOW()')) {
      return [];
    }

    if (sql.includes('SELECT COUNT(*)::int AS "count"')) {
      const [scope, subjectHash] = params;
      const matching = state.rows.filter(
        (row) => row.scope === scope && row.subjectHash === subjectHash,
      );
      if (sql.includes('"status" = \'failed\'')) {
        return [{ count: matching.filter((row) => row.status === 'failed').length }];
      }
      return [{ count: matching.length }];
    }

    if (sql.includes('INSERT INTO "staff_pin_attempts"')) {
      const [scope, subjectHash] = params;
      const row = {
        id: state.nextId++,
        scope,
        subjectHash,
        status: 'pending',
      };
      state.rows.push(row);
      return [{ id: row.id }];
    }

    if (sql.includes('SET "status" = \'failed\'')) {
      const [scope, subjectHash, id] = params;
      const row = state.rows.find(
        (item) =>
          item.id === Number(id) &&
          item.scope === scope &&
          item.subjectHash === subjectHash &&
          item.status === 'pending',
      );
      if (!row) return [];
      row.status = 'failed';
      return [{ id: row.id }];
    }

    if (
      sql.includes('DELETE FROM "staff_pin_attempts"') &&
      sql.includes('"id" <= $3') &&
      sql.includes('"status" = \'failed\' OR "id" = $3')
    ) {
      const [scope, subjectHash, id] = params;
      state.rows = state.rows.filter((row) => {
        const sameSubject = row.scope === scope && row.subjectHash === subjectHash;
        const eligible =
          row.id <= Number(id) && (row.status === 'failed' || row.id === Number(id));
        return !(sameSubject && eligible);
      });
      return [];
    }

    throw new Error(`Unexpected SQL in test: ${sql}`);
  }

  const manager = { query };
  return {
    state,
    dataSource: {
      query,
      transaction: async (callback) => callback(manager),
    },
  };
}

test('newer successful login preserves an older in-flight wrong PIN reservation', async () => {
  const { state, dataSource } = createDataSource();
  const service = new StaffPinThrottleService(dataSource);
  const olderStarted = deferred();
  const finishOlder = deferred();

  const olderWrong = service.execute({
    scope: 'pin-login',
    subject: 'same-staff',
    credentialFailureMessage: 'Невірний працівник або PIN',
    action: async () => {
      olderStarted.resolve();
      await finishOlder.promise;
      throw new UnauthorizedException('Невірний працівник або PIN');
    },
  });

  await olderStarted.promise;

  const newerSuccess = await service.execute({
    scope: 'pin-login',
    subject: 'same-staff',
    credentialFailureMessage: 'Невірний працівник або PIN',
    action: async () => 'access-token',
  });

  assert.equal(newerSuccess, 'access-token');
  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].id, 1);
  assert.equal(state.rows[0].status, 'pending');

  finishOlder.resolve();
  await assert.rejects(() => olderWrong, /Невірний працівник або PIN/);

  assert.equal(state.rows.length, 1);
  assert.equal(state.rows[0].id, 1);
  assert.equal(state.rows[0].status, 'failed');
});
