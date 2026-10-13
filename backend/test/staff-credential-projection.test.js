require('reflect-metadata');

const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { before, test } = require('node:test');
const { DataSource } = require('typeorm');
const { Staff } = require('../dist/staff/entities/staff.entity.js');
const { Log } = require('../dist/logs/entities/log.entity.js');
const { Broadcast } = require('../dist/broadcasts/entities/broadcast.entity.js');
const { STAFF_WITH_CREDENTIALS_SELECT } = require('../dist/staff/staff-credential-selection.js');

const source = new DataSource({ type: 'postgres', entities: [resolve(__dirname, '../dist/**/*.entity.js')] });
before(() => source.buildMetadatas());

const privateColumns = [
  'pin_hash', 'director_password_hash', 'director_login_name', 'director_credentials_configured_at',
  'director_failed_login_attempts', 'director_locked_until', 'telegram_invite_token_hash',
];
function assertSafeProjection(query) {
  const sql = query.getSql().split(' FROM ')[0];
  for (const column of privateColumns) assert.ok(!sql.includes(`"${column}"`), `${column} leaked into ${sql}`);
  assert.match(sql, /"full_name"/);
}
test('ordinary staff lookup excludes credentials in real TypeORM SQL', () => {
  assertSafeProjection(source.getRepository(Staff).createQueryBuilder('staff'));
});
for (const [entity, relation] of [[Log, 'staff'], [Broadcast, 'createdByStaff']]) {
  test(`${entity.name} find with staff relation excludes credentials`, () => {
    assertSafeProjection(source.getRepository(entity).createQueryBuilder('row').setFindOptions({ relations: [relation] }));
  });
  test(`${entity.name} joined staff query excludes credentials`, () => {
    assertSafeProjection(source.getRepository(entity).createQueryBuilder('row').leftJoinAndSelect(`row.${relation}`, 'staff'));
  });
}
test('explicit authentication selection retains credentials and all public columns without invite hash', () => {
  const query = source.getRepository(Staff).createQueryBuilder('staff').setFindOptions({ select: STAFF_WITH_CREDENTIALS_SELECT });
  const sql = query.getSql();
  for (const column of privateColumns.filter((name) => name !== 'telegram_invite_token_hash')) assert.ok(sql.includes(`"${column}"`));
  assert.ok(!sql.includes('"telegram_invite_token_hash"'));
  for (const column of source.getMetadata(Staff).columns.filter((item) => item.isSelect)) {
    assert.ok(sql.includes(`"${column.databaseName}"`), `explicit selection lost ${column.propertyName}`);
  }
});
