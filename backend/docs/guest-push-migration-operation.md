# Guest Push migration — manual operation only

This runbook prepares the `CreateGuestPushSubscriptions2026092000010` migration. **Merging its code does not authorize or execute a change in production Neon.** The live Nest bootstrap still registers only the original eight migrations. There is no Push subscription API or delivery yet.

## Safety prerequisites

1. Confirm the current `main`/deployment version and `AGENTS.md`. Confirm in Neon that the source branch is `production` and inspect a **fresh, restorable backup** before the production change window. A historical snapshot alone does not guarantee recovery of bookings created after it.
2. Verify the production migration history contains exactly the original eight names, IDs 1–8 and timestamps, `bookings.id` is UUID, and `guest_push_subscriptions` does not exist. Never paste guest rows, `DB_URL`, credentials or Push secrets into GitHub or chat.
3. Test using a separate Neon branch forked from `production` with data and schema; confirm the branch selector in **Neon → SQL Editor**. Do not change Render's production environment or point the running backend at the test branch.
4. Use a private operator terminal with Node 24 and the exact reviewed repository commit. Install and build with `npm --prefix backend ci && npm --prefix backend run build`. Keep Neon credentials in the terminal's private environment; do not pass them as command arguments, put them in committed `.env` files, paste them in chat, or enable shell tracing. Use the **branch-specific connection string** from Neon. The expected host must be copied independently from the intended branch's connection panel, not derived automatically from `DB_URL`.

## Preflight (no writes)

Set the following private environment values locally:

- `DB_URL`: branch-specific Neon connection string with `sslmode=require` or `sslmode=verify-full`.
- `MOLO_PUSH_BRANCH`: `test-push-migration` for testing, or `production` only when separately approved.
- `MOLO_PUSH_EXPECTED_HOST`: hostname of the **same selected branch's** Neon connection endpoint, verified in Neon UI.
- `DB_SYNCHRONIZE=false` (the operator always sets TypeORM `synchronize: false` regardless).

Run from the repository root: `node backend/scripts/guest-push-migration-operator.mjs --check`.

The command checks exact migration history, `bookings.id`, and that the Push table is absent. It does not launch Nest, register startup migrations or change any database objects. **Hostname equality cannot independently prove branch identity**: a human must verify the branch name and connection panel in Neon before running anything.

## Test branch only — separately approved execution

After successful preflight, set `MOLO_PUSH_APPROVAL=apply-guest-push-subscriptions-to-test-push-migration` in the same private terminal and run `node backend/scripts/guest-push-migration-operator.mjs --apply`. The runner repeats the audit inside a transaction, shares the application's advisory migration lock, locks the history table, executes **only this compiled TypeORM migration**, checks the new ninth history record and booking foreign key, then commits. A validation or SQL error rolls back the transaction.

Check again using a **read-only Neon SQL Editor query on the test branch**: count must be nine, Push table present and empty, `bookings` still present. Do not use an old test branch after its auto-delete date. The previously completed manual `CREATE TABLE`/rollback exercise did not execute TypeORM in Neon; this operation is a separate test.

## Production — requires another explicit approval

Do **not** proceed merely because this PR passes CI or is merged. Obtain a fresh backup and recovery plan, re-audit the live database immediately before the operation, confirm the exact `production` endpoint host in Neon UI, and agree on a change window with the owner. The operator requires all of these explicit local flags in addition to `--apply`:

- `MOLO_PUSH_BRANCH=production`
- `MOLO_PUSH_APPROVAL=apply-guest-push-subscriptions-to-production`
- `MOLO_PUSH_BACKUP_CONFIRMED=yes`
- `MOLO_PUSH_PRODUCTION_CHANGE_APPROVED=yes`

These flags are operator attestations, **not automated backup or Neon branch verification**. Never run the command on Render's running service. Do not use the existing `runtime-migration-roundtrip.mjs` against Neon: it is guarded for an isolated local CI database and rewinds multiple migrations. No automatic or forced rollback is provided; the migration's `down` intentionally refuses to delete a nonempty table.

## Verification and failure

After any production change, read-only verify the ninth migration record, the Push table and FK, and existing booking operations. If the preflight fails or the branch/host cannot be independently verified, stop; do not manually insert migration-history records or retry `CREATE TABLE`. Preserve error details privately without publishing connection information. Guest Push will still be disabled until a separately reviewed subscription API and delivery mechanism are deployed.
