const { randomUUID } = require('node:crypto');
const { ConflictException } = require('@nestjs/common');
function settingsHarness(tables = []) {
  let entity = null, links = [], queue = Promise.resolve();
  const writes = [];
  const snapshot = () => ({ prepared: true, entity: entity && { ...entity }, links: links.map((link) => ({ ...link })) });
  const manager = { query: async () => [], getRepository: (type) => {
    if (type.name === 'TableEntity') return { find: async () => tables };
    if (type.name === 'SyrveTableLink') return { find: async () => links, insert: async (values) => { links.push(...values); } };
    throw new Error(`unexpected repository ${type.name}`);
  } };
  const store = {
    read: async () => snapshot(),
    save: async (_manager, value) => {
      entity = { id: entity?.id || randomUUID(), ...value, configurationRevision: randomUUID() };
      writes.push({ ...entity }); return { ...entity };
    },
    transaction: async (expected, action) => {
      const prior = queue;
      let release;
      queue = new Promise((resolve) => release = resolve);
      await prior;
      const before = snapshot();
      try {
        if ((entity?.id || null) !== expected.id || (entity?.configurationRevision || null) !== expected.revision) {
          throw new ConflictException('Налаштування або столи змінилися. Повторіть перевірку перед підтвердженням.');
        }
        return await action(manager, snapshot());
      } catch (error) { entity = before.entity; links = before.links; throw error; }
      finally { release(); }
    },
  };
  return { store, writes, snapshot, entity: () => entity, links: () => links, tables };
}
module.exports = { settingsHarness };
