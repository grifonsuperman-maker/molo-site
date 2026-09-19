require('reflect-metadata');

const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const { TelegramStaffLinkService } = require('../dist/staff/telegram-staff-link.service.js');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function setup({ replaceInvite = false } = {}) {
  const oldHash = hashToken('expired');
  const freshHash = hashToken('new-invite');
  const previousVersion = new Date('2026-09-18T10:00:00.000Z');
  const currentVersion = new Date('2026-09-18T10:00:00.001Z');
  const director = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    role: 'owner',
    fullName: 'Директор',
    active: true,
    isArchived: false,
    telegramId: null,
    telegramInviteTokenHash: oldHash,
    telegramInviteExpiresAt: new Date(Date.now() - 60_000),
    directorPasswordHash: 'old-hash',
    directorCredentialsConfiguredAt: previousVersion,
  };
  const updates = [];
  let fullEntitySaves = 0;
  const repository = {
    async findOne({ where }) {
      if (where.telegramInviteTokenHash !== oldHash) return null;
      // Simulate a row read before concurrent password rotation and optional
      // issuance of a newer invite, without inventing a new DB schema.
      const staleSnapshot = { ...director };
      director.directorPasswordHash = 'new-hash';
      director.directorCredentialsConfiguredAt = currentVersion;
      if (replaceInvite) {
        director.telegramInviteTokenHash = freshHash;
        director.telegramInviteExpiresAt = new Date(Date.now() + 60_000);
      }
      return staleSnapshot;
    },
    async update(where, values) {
      updates.push({ where, values });
      if (where.id !== director.id ||
          where.telegramInviteTokenHash !== director.telegramInviteTokenHash) {
        return { affected: 0 };
      }
      Object.assign(director, values);
      return { affected: 1 };
    },
    async save(stale) {
      fullEntitySaves += 1;
      Object.assign(director, stale);
      return director;
    },
  };
  return {
    director,
    updates,
    getFullEntitySaves: () => fullEntitySaves,
    service: new TelegramStaffLinkService(repository, {}, {}),
    currentVersion,
    oldHash,
    freshHash,
  };
}

test('expired Director invite cleanup does not restore old password or JWT version', async () => {
  const { service, director, updates, getFullEntitySaves, currentVersion, oldHash } = setup();
  await assert.rejects(() => service.getInviteInfo('expired'), /прострочене/);
  assert.equal(getFullEntitySaves(), 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.telegramInviteTokenHash, oldHash);
  assert.deepEqual(updates[0].values, {
    telegramInviteTokenHash: null,
    telegramInviteExpiresAt: null,
  });
  assert.equal(director.directorPasswordHash, 'new-hash');
  assert.equal(director.directorCredentialsConfiguredAt.getTime(), currentVersion.getTime());
  assert.equal(director.telegramInviteTokenHash, null);
});

test('expired invite cleanup cannot consume a newer Telegram invitation', async () => {
  const { service, director, getFullEntitySaves, currentVersion, freshHash } =
    setup({ replaceInvite: true });
  await assert.rejects(() => service.getInviteInfo('expired'), /прострочене/);
  assert.equal(getFullEntitySaves(), 0);
  assert.equal(director.directorPasswordHash, 'new-hash');
  assert.equal(director.directorCredentialsConfiguredAt.getTime(), currentVersion.getTime());
  assert.equal(director.telegramInviteTokenHash, freshHash);
  assert.ok(director.telegramInviteExpiresAt > new Date());
});
