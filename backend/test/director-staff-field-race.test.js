require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const { StaffService } = require('../dist/staff/staff.service.js');

const oldVersion = new Date('2026-09-18T10:00:00.000Z');
const newVersion = new Date('2026-09-18T10:00:00.001Z');

function scenario({ role = 'owner', isArchived = false, isOnShift = false, promoteAfterRead = false } = {}) {
  const row = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: 'Директор',
    phone: null,
    telegramId: null,
    role,
    note: null,
    pinHash: null,
    directorLoginName: 'director',
    directorPasswordHash: 'old-password-hash',
    directorCredentialsConfiguredAt: oldVersion,
    directorFailedLoginAttempts: 0,
    directorLockedUntil: null,
    active: !isArchived,
    isArchived,
    archivedAt: isArchived ? new Date('2026-09-18T08:00:00.000Z') : null,
    archivedBy: isArchived ? 'system' : null,
    isOnShift,
    shiftStartedAt: isOnShift ? new Date('2026-09-18T09:00:00.000Z') : null,
    shiftStartedBy: null,
    shiftEndedAt: null,
    shiftEndedBy: null,
    lastAutoShiftEndDate: null,
  };
  let rotated = false;
  let fullSaves = 0;
  const narrowWrites = [];
  const repo = {
    async findOne({ where }) {
      if (where.id !== row.id) return null;
      // A concurrent rotation or promotion may happen after the staff read.
      const stale = { ...row };
      if (!rotated && (role === 'owner' || promoteAfterRead)) {
        rotated = true;
        if (promoteAfterRead) row.role = 'owner';
        row.directorPasswordHash = 'new-password-hash';
        row.directorCredentialsConfiguredAt = newVersion;
      }
      return stale;
    },
    async update(where, values) {
      assert.equal(where.id, row.id);
      if (row.role !== where.role) return { affected: 0 };
      assert.equal(Object.hasOwn(values, 'directorPasswordHash'), false);
      assert.equal(Object.hasOwn(values, 'directorCredentialsConfiguredAt'), false);
      narrowWrites.push({ ...values });
      Object.assign(row, values);
      return { affected: 1 };
    },
    async save(stale) {
      fullSaves += 1;
      Object.assign(row, stale);
      return { ...row };
    },
  };
  const shiftRepo = {
    create: (value) => value,
    save: async (value) => value,
  };
  return {
    service: new StaffService(repo, shiftRepo, { signAsync: async () => 'jwt' }),
    row,
    narrowWrites,
    getFullSaves: () => fullSaves,
  };
}

function assertRotationSurvived({ row, narrowWrites, getFullSaves }) {
  assert.equal(row.directorPasswordHash, 'new-password-hash');
  assert.equal(row.directorCredentialsConfiguredAt.getTime(), newVersion.getTime());
  assert.equal(getFullSaves(), 0);
  assert.ok(narrowWrites.length > 0);
}

test('generic Director edit cannot restore stale password and JWT version', async () => {
  const state = scenario();
  const edited = await state.service.update(state.row.id, {
    fullName: 'Новий Директор', phone: '+380000000000', note: 'оновлено',
  });
  assertRotationSurvived(state);
  assert.equal(edited.fullName, 'Новий Директор');
  assert.equal(state.row.fullName, 'Новий Директор');
  assert.equal(state.row.phone, '+380000000000');
});

test('Director PIN edit cannot overwrite newer director credentials', async () => {
  const state = scenario();
  await state.service.changePin(state.row.id, '1234');
  assertRotationSurvived(state);
  assert.ok(state.row.pinHash);
});

test('Director block cannot restore older credentials', async () => {
  const state = scenario();
  await state.service.setActive(state.row.id, false);
  assertRotationSurvived(state);
  assert.equal(state.row.active, false);
});

test('Director archive cannot restore older credentials', async () => {
  const state = scenario();
  await state.service.archive(state.row.id, { performedBy: 'system' });
  assertRotationSurvived(state);
  assert.equal(state.row.isArchived, true);
  assert.equal(state.row.active, false);
});

test('Director restore cannot restore older credentials', async () => {
  const state = scenario({ isArchived: true });
  await state.service.restore(state.row.id, { performedBy: 'system' });
  assertRotationSurvived(state);
  assert.equal(state.row.isArchived, false);
  assert.equal(state.row.active, true);
});

test('ending a stale Director shift cannot restore older credentials', async () => {
  const state = scenario({ isOnShift: true });
  await state.service.endShift(state.row.id, { performedBy: 'system' });
  assertRotationSurvived(state);
  assert.equal(state.row.isOnShift, false);
  assert.ok(state.row.shiftEndedAt instanceof Date);
});

test('waiter staff update preserves the requested fields without a stale full-row save', async () => {
  const state = scenario({ role: 'waiter' });
  const updated = await state.service.update(state.row.id, { fullName: 'Офіціант' });
  assert.equal(state.getFullSaves(), 0);
  assert.deepEqual(state.narrowWrites, [{ fullName: 'Офіціант' }]);
  assert.equal(updated.fullName, 'Офіціант');
  assert.equal(state.row.fullName, 'Офіціант');
  assert.equal(state.row.role, 'waiter');
});

test('stale waiter edit cannot overwrite credentials after promotion to Director', async () => {
  const state = scenario({ role: 'waiter', promoteAfterRead: true });
  await assert.rejects(
    () => state.service.update(state.row.id, { fullName: 'Старе ім’я' }),
    /Дані працівника змінилися/,
  );
  assert.equal(state.row.role, 'owner');
  assert.equal(state.row.fullName, 'Директор');
  assert.equal(state.row.directorPasswordHash, 'new-password-hash');
  assert.equal(state.row.directorCredentialsConfiguredAt.getTime(), newVersion.getTime());
  assert.equal(state.getFullSaves(), 0);
  assert.deepEqual(state.narrowWrites, []);
});
