import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { assertFreshSchemaReferenceTarget } from './fresh-schema-reference.mjs';

const ROLLBACK = new Error('BOOKING_TABLE_ASSIGNMENTS_CI_ROLLBACK');

function isUniqueViolation(error) {
  return error?.code === '23505';
}

export async function runBookingTableAssignmentsValidation(env = process.env) {
  assertFreshSchemaReferenceTarget(env);
  if (env !== process.env) {
    throw new Error('Banquet migration validation must use the validated process environment.');
  }

  const require = createRequire(import.meta.url);
  const { DataSource } = require('typeorm');
  const {
    CreateBookingTableAssignments2026100200010,
  } = require('../dist/migrations/2026100200010-CreateBookingTableAssignments.js');

  const source = new DataSource({
    type: 'postgres',
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 5432),
    username: env.DB_USER || 'postgres',
    password: env.DB_PASSWORD || 'postgres',
    database: env.DB_NAME,
    synchronize: false,
    migrations: [],
    logging: false,
    extra: {
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    },
  });

  await source.initialize();

  try {
    const initialTable = await source.query(
      `SELECT to_regclass('public.booking_table_assignments')::text AS table_name`,
    );
    assert.equal(initialTable[0]?.table_name, null);

    await assert.rejects(
      source.transaction('READ COMMITTED', async (manager) => {
        const physicalTables = await manager.query(
          'SELECT id FROM public.tables ORDER BY id LIMIT 2',
        );
        assert.equal(
          physicalTables.length,
          2,
          'Disposable fresh schema must contain at least two physical tables',
        );

        const bookingId = randomUUID();
        await manager.query(
          `INSERT INTO public.bookings
            (id, table_id, booking_date, booking_time, guests_count)
           VALUES ($1, $2, '2099-01-01', '18:00', 4)`,
          [bookingId, physicalTables[0].id],
        );

        const migration = new CreateBookingTableAssignments2026100200010();
        const runner = {
          isTransactionActive: true,
          connection: source,
          query: manager.query.bind(manager),
        };

        await migration.up(runner);

        const assignments = await manager.query(
          `SELECT booking_id, table_id, is_primary
           FROM public.booking_table_assignments
           WHERE booking_id = $1
           ORDER BY table_id`,
          [bookingId],
        );
        assert.deepEqual(assignments, [
          {
            booking_id: bookingId,
            table_id: physicalTables[0].id,
            is_primary: true,
          },
        ]);

        await manager.query('SAVEPOINT duplicate_pair');
        await assert.rejects(
          manager.query(
            `INSERT INTO public.booking_table_assignments
              (booking_id, table_id, is_primary)
             VALUES ($1, $2, false)`,
            [bookingId, physicalTables[0].id],
          ),
          isUniqueViolation,
        );
        await manager.query('ROLLBACK TO SAVEPOINT duplicate_pair');

        await manager.query('SAVEPOINT duplicate_primary');
        await assert.rejects(
          manager.query(
            `INSERT INTO public.booking_table_assignments
              (booking_id, table_id, is_primary)
             VALUES ($1, $2, true)`,
            [bookingId, physicalTables[1].id],
          ),
          isUniqueViolation,
        );
        await manager.query('ROLLBACK TO SAVEPOINT duplicate_primary');

        await manager.query(
          `INSERT INTO public.booking_table_assignments
            (booking_id, table_id, is_primary)
           VALUES ($1, $2, false)`,
          [bookingId, physicalTables[1].id],
        );

        await assert.rejects(
          migration.down(runner),
          /Cannot roll back booking table assignments while secondary or non-legacy table assignments exist/,
        );

        throw ROLLBACK;
      }),
      (error) => error === ROLLBACK,
    );

    const afterRollback = await source.query(
      `SELECT to_regclass('public.booking_table_assignments')::text AS table_name`,
    );
    assert.equal(afterRollback[0]?.table_name, null);

    await source.transaction('READ COMMITTED', async (manager) => {
      const migration = new CreateBookingTableAssignments2026100200010();
      const runner = {
        isTransactionActive: true,
        connection: source,
        query: manager.query.bind(manager),
      };

      await migration.up(runner);
      await migration.down(runner);

      const afterSafeDown = await manager.query(
        `SELECT to_regclass('public.booking_table_assignments')::text AS table_name`,
      );
      assert.equal(afterSafeDown[0]?.table_name, null);
    });
  } finally {
    await source.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBookingTableAssignmentsValidation()
    .then(() => {
      process.stdout.write(
        'Booking table assignment PostgreSQL migration validation passed.\n',
      );
    })
    .catch((error) => {
      console.error(
        `Booking table assignment validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
