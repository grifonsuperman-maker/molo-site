const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CreateBookingTableAssignments2026100200010,
} = require('../dist/migrations/2026100200010-CreateBookingTableAssignments.js');

test('booking table assignment migration creates a normalized multi-table relation and backfills legacy primary tables', async () => {
  const queries = [];
  const migration = new CreateBookingTableAssignments2026100200010();

  await migration.up({
    query: async (sql) => {
      queries.push(sql);
      return [];
    },
  });

  const sql = queries.join('\n');
  const lockIndex = queries.findIndex((query) =>
    query.includes('LOCK TABLE "bookings" IN SHARE ROW EXCLUSIVE MODE'),
  );
  const createIndex = queries.findIndex((query) =>
    query.includes('CREATE TABLE "booking_table_assignments"'),
  );
  const backfillIndex = queries.findIndex((query) =>
    query.includes('INSERT INTO "booking_table_assignments"'),
  );

  assert.ok(lockIndex >= 0 && createIndex > lockIndex && backfillIndex > createIndex);
  assert.match(sql, /PRIMARY KEY \("id"\)/);
  assert.match(sql, /FOREIGN KEY \("booking_id"\) REFERENCES "bookings" \("id"\) ON DELETE CASCADE/);
  assert.match(sql, /FOREIGN KEY \("table_id"\) REFERENCES "tables" \("id"\) ON DELETE CASCADE/);
  assert.match(sql, /UQ_booking_table_assignments_booking_table/);
  assert.match(sql, /UQ_booking_table_assignments_primary_booking/);
  assert.match(sql, /WHERE "is_primary" = true/);
  assert.match(sql, /SELECT "id", "table_id", true/);
  assert.match(sql, /WHERE "table_id" IS NOT NULL/);
});

test('booking table assignment rollback refuses to discard banquet-only table links', async () => {
  const migration = new CreateBookingTableAssignments2026100200010();

  await assert.rejects(
    () =>
      migration.down({
        isTransactionActive: true,
        query: async (sql) => {
          if (sql.includes('SELECT EXISTS')) return [{ unsafe: true }];
          return [];
        },
      }),
    /secondary or non-legacy table assignments exist/,
  );
});

test('booking table assignment rollback is transactional and safe before banquet data exists', async () => {
  const migration = new CreateBookingTableAssignments2026100200010();

  await assert.rejects(
    () => migration.down({ isTransactionActive: false, query: async () => [] }),
    /requires an active transaction/,
  );

  const queries = [];
  await migration.down({
    isTransactionActive: true,
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('SELECT EXISTS')) return [{ unsafe: false }];
      return [];
    },
  });

  assert.equal(queries.at(-1), 'DROP TABLE "booking_table_assignments"');
});

test('booking table assignment entity is registered without changing existing booking table ownership', () => {
  const bookingSource = fs.readFileSync(
    path.join(__dirname, '../src/bookings/entities/booking.entity.ts'),
    'utf8',
  );
  const assignmentSource = fs.readFileSync(
    path.join(__dirname, '../src/bookings/entities/booking-table-assignment.entity.ts'),
    'utf8',
  );
  const moduleSource = fs.readFileSync(
    path.join(__dirname, '../src/bookings/bookings.module.ts'),
    'utf8',
  );

  assert.match(bookingSource, /table: TableEntity \| null;/);
  assert.match(bookingSource, /tableAssignments: BookingTableAssignment\[\];/);
  assert.match(
    assignmentSource,
    /@Entity\(\{ name: 'booking_table_assignments', synchronize: false \}\)/,
  );
  assert.match(moduleSource, /BookingTableAssignment,/);

  const appModuleSource = fs.readFileSync(
    path.join(__dirname, '../src/app.module.ts'),
    'utf8',
  );
  assert.doesNotMatch(
    appModuleSource,
    /CreateBookingTableAssignments2026100200010/,
    'the prepared banquet migration must not join the guarded Syrve/runtime track before explicit schema adoption',
  );
});
