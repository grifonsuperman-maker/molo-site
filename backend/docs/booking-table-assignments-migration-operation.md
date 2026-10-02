# Booking table assignments migration — manual operation only

This runbook applies only `CreateBookingTableAssignments2026100200010`. Merging the operator code does **not** authorize or execute a production database change. The live Nest bootstrap does not register this migration.

## What this migration changes

The migration creates `booking_table_assignments`, keeps the existing `bookings.table_id` untouched, and backfills every non-null current booking table as one `is_primary=true` assignment. It does not create banquet UI, secondary assignments or Telegram behavior.

The operator accepts only the reviewed post-Syrve migration history, with Guest Push either already present in its historical slot or absent. It refuses unknown history. After application, the banquet migration must be the only new history row.

## Safety prerequisites

1. GitHub → repository → main: confirm the exact merged commit that contains this operator and confirm both main push workflows are green.
2. Neon → Project → Branches → production: independently confirm the production branch, direct endpoint hostname and database.
3. Neon → Project → Branches → production: create a fresh backup branch. Restore/rehearse on a separate child test branch first; do not point Render production at it.
4. Use a private operator terminal with Node 24 and a clean checkout of the exact reviewed commit. Run `npm --prefix backend ci && npm --prefix backend run build`.
5. Never paste `DB_URL`, passwords, booking rows, table UUIDs or private audit output into GitHub, chat or shell history.

## Private environment

Set these values in the private terminal:

- `DB_URL`: branch-specific Neon connection string with `sslmode=require` or `verify-full`.
- `DB_SYNCHRONIZE=false`.
- `MOLO_BANQUET_BRANCH`: `test-banquet-migration` for rehearsal or `production` for the separately approved live operation.
- `MOLO_BANQUET_EXPECTED_HOST`: direct endpoint host copied independently from the selected Neon branch.
- `MOLO_BANQUET_EXPECTED_DATABASE`: exact selected database.
- `MOLO_BANQUET_REVIEWED_COMMIT`: exact SHA of the clean checkout being executed.

The operator strips URL TLS options after validating them and uses explicit certificate verification. A hostname is still not proof of branch identity; verify the branch in Neon UI.

## Read-only preflight

Run:

`node backend/scripts/booking-table-assignments-migration-operator.mjs --check`

This uses a REPEATABLE READ, read-only transaction with bounded lock/statement timeouts. It checks:

- exact reviewed migration-history shape and timestamps;
- UUID booking/table keys and `uuid_generate_v4()`;
- absence of `booking_table_assignments`;
- exact reviewed checkout SHA and a clean working tree.

No Nest bootstrap, synchronize, other migration or write path is loaded.

## Rehearsal on a restored test branch

Neon → Project → Branches → restored child branch: verify the branch and direct endpoint again.

Set:

- `MOLO_BANQUET_BRANCH=test-banquet-migration`
- `MOLO_BANQUET_APPROVAL=apply-booking-table-assignments-to-test-banquet-migration`

Run `--check`, then:

`node backend/scripts/booking-table-assignments-migration-operator.mjs --apply`

The apply path uses one outer transaction, bridges both reviewed MOLO advisory migration fences, locks the migration history, repeats preflight, executes only the banquet migration, verifies unchanged old history and exact backfill, then commits. Any mismatch rolls back.

Immediately verify read-only:

`node backend/scripts/booking-table-assignments-migration-operator.mjs --verify`

Also verify in Neon → SQL Editor on the test branch that the new table exists and the migration history has exactly one new banquet row. Do not expose row contents.

## Production requires separate explicit approval

A successful rehearsal or merged PR is not permission to write production.

Immediately before the production window:

1. Neon → Project → Branches → production: create/confirm a fresh restorable backup.
2. Verify its restore on a separate child branch.
3. Recheck the exact production endpoint/database and run `--check`.
4. Set:
   - `MOLO_BANQUET_BRANCH=production`
   - `MOLO_BANQUET_APPROVAL=apply-booking-table-assignments-to-production`
   - `MOLO_BANQUET_BACKUP_CONFIRMED=yes`
   - `MOLO_BANQUET_REHEARSAL_CONFIRMED=yes`
   - `MOLO_BANQUET_PRODUCTION_CHANGE_APPROVED=yes`
   - `MOLO_BANQUET_BACKUP_VERIFIED_AT=<ISO timestamp within the last hour>`
5. Run `--apply` once from the exact reviewed clean checkout.
6. Run `--verify` immediately afterwards.

Do not run the disposable `runtime-migration-roundtrip.mjs` against Neon. Do not manually insert migration rows. Do not enable `synchronize`.

## Syrve boundary

The banquet migration is a known post-Syrve history row, but it is not part of the six frozen Syrve migrations. Syrve readiness may accept this one reviewed follow-up only after all six Syrve steps are present. Unknown or early follow-up migration rows still force `requires_audit`.

The operator does not enable Syrve synchronization, modify mappings, rename tables, change physical table UUIDs or alter Director activation behavior.

## Rollback boundary

The migration `down` is intentionally guarded. Once secondary/non-legacy assignment rows exist, rollback is refused because dropping the table would lose banquet data. Before banquet business writes exist, rollback must still be separately reviewed and executed in a transaction. Prefer an audited forward correction after valuable assignment data exists.
