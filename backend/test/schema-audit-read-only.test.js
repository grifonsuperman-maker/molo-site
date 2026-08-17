const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

function normalize(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

class RecordingClient {
  constructor({ failOn } = {}) {
    this.failOn = failOn;
    this.statements = [];
  }

  async query(sql) {
    const statement = normalize(sql);
    this.statements.push(statement);

    if (this.failOn && statement.includes(this.failOn)) {
      throw new Error('simulated metadata read failure');
    }

    if (statement.includes("to_regclass('public.migrations')")) {
      return { rows: [{ migrations_table: 'migrations' }] };
    }

    if (statement.includes('FROM public.migrations')) {
      return {
        rows: [{ id: 1, timestamp: '2026081500010', name: 'ExampleMigration' }],
      };
    }

    if (statement.includes('current_database()')) {
      return {
        rows: [
          {
            database_name: 'molo_restaurant',
            schema_name: 'public',
            server_version: '16',
          },
        ],
      };
    }

    return { rows: [] };
  }
}

test('schema audit uses one repeatable read-only snapshot and metadata SELECTs only', async () => {
  const { collectSchemaSnapshot } = await import('../scripts/schema-audit.mjs');
  const client = new RecordingClient();

  const snapshot = await collectSchemaSnapshot(client);

  assert.equal(
    client.statements[0],
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  assert.equal(client.statements.at(-1), 'COMMIT');
  assert.equal(snapshot.server.database_name, 'molo_restaurant');
  assert.equal(snapshot.typeOrmMigrations.length, 1);
  assert.ok(Array.isArray(snapshot.functions));

  const metadataStatements = client.statements.slice(1, -1);
  for (const statement of metadataStatements) {
    assert.match(statement, /^SELECT\b/i);
    assert.doesNotMatch(
      statement,
      /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i,
    );
  }

  assert.ok(
    metadataStatements.some((statement) =>
      statement.includes('pg_get_triggerdef(trigger_row.oid, true)'),
    ),
  );
  assert.ok(
    metadataStatements.some((statement) =>
      statement.includes('pg_get_functiondef(function_row.oid)'),
    ),
  );

  const directPublicTableReads = metadataStatements.filter((statement) =>
    /\bFROM\s+public\./i.test(statement),
  );
  assert.deepEqual(directPublicTableReads, [
    'SELECT id, timestamp, name FROM public.migrations ORDER BY id',
  ]);
});

test('schema audit rolls back the read-only transaction when metadata read fails', async () => {
  const { collectSchemaSnapshot } = await import('../scripts/schema-audit.mjs');
  const client = new RecordingClient({ failOn: 'FROM pg_extension' });

  await assert.rejects(
    collectSchemaSnapshot(client),
    /simulated metadata read failure/,
  );

  assert.equal(
    client.statements[0],
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  assert.equal(client.statements.at(-1), 'ROLLBACK');
});

test('production image includes the manual schema audit script without changing startup', async () => {
  const dockerfile = await readFile(
    path.resolve(__dirname, '../Dockerfile'),
    'utf8',
  );

  assert.match(
    dockerfile,
    /COPY --from=build \/app\/scripts \.\/scripts/,
  );
  assert.match(dockerfile, /CMD \["node", "dist\/main\.js"\]/);
});
