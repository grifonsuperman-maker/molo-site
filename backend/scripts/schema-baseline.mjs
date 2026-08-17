import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REQUIRED_ARRAY_SECTIONS = [
  'extensions',
  'tables',
  'columns',
  'enums',
  'constraints',
  'indexes',
  'triggers',
  'functions',
  'sequences',
  'views',
  'typeOrmMigrations',
];

function assertSnapshotShape(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Schema snapshot must be a JSON object');
  }

  if (!snapshot.server || typeof snapshot.server !== 'object' || Array.isArray(snapshot.server)) {
    throw new Error('Schema snapshot is missing the server section');
  }

  for (const section of REQUIRED_ARRAY_SECTIONS) {
    if (!Array.isArray(snapshot[section])) {
      throw new Error(`Schema snapshot is missing the ${section} array`);
    }
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
}

export function normalizeSchemaSnapshot(snapshot) {
  assertSnapshotShape(snapshot);

  const stableSnapshot = {
    ...snapshot,
    server: { ...snapshot.server },
  };

  delete stableSnapshot.capturedAt;
  delete stableSnapshot.server.server_version;

  return canonicalize(stableSnapshot);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      'Usage: node scripts/schema-baseline.mjs <schema-audit-snapshot.json>',
    );
  }

  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const baseline = normalizeSchemaSnapshot(input);
  process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `Schema baseline failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
