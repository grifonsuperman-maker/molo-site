import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function normalizeMigrationHistory(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => ({
    name: row?.name,
    timestamp: row?.timestamp,
  }));
}

function normalizeColumns(rows) {
  if (!Array.isArray(rows)) return rows;

  return rows
    .map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
      const { ordinal_position: _ordinalPosition, ...semanticColumn } = row;
      return semanticColumn;
    })
    .sort((left, right) => {
      const leftKey = `${left?.table_name || ''}\u0000${left?.column_name || ''}`;
      const rightKey = `${right?.table_name || ''}\u0000${right?.column_name || ''}`;
      return leftKey.localeCompare(rightKey);
    });
}

export function comparableSchemaBaseline(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Schema baseline must be a JSON object');
  }

  return {
    ...snapshot,
    columns: normalizeColumns(snapshot.columns),
    typeOrmMigrations: normalizeMigrationHistory(snapshot.typeOrmMigrations),
  };
}

export function compareSchemaBaselines(expected, actual) {
  const left = comparableSchemaBaseline(expected);
  const right = comparableSchemaBaseline(actual);
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const changedSections = keys.filter(
    (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]),
  );

  if (changedSections.length > 0) {
    throw new Error(
      `Schema roundtrip mismatch in sections: ${changedSections.join(', ')}`,
    );
  }
}

async function main() {
  const expectedPath = process.argv[2];
  const actualPath = process.argv[3];
  if (!expectedPath || !actualPath) {
    throw new Error(
      'Usage: node schema-roundtrip-compare.mjs <expected-baseline.json> <actual-baseline.json>',
    );
  }

  const [expected, actual] = await Promise.all([
    readFile(expectedPath, 'utf8').then(JSON.parse),
    readFile(actualPath, 'utf8').then(JSON.parse),
  ]);

  compareSchemaBaselines(expected, actual);
  process.stdout.write('Schema roundtrip matches the fresh reference.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(
      `Schema roundtrip comparison failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
