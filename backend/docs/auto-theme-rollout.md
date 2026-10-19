# MOLO: staged auto day/night rollout

This document is a rollout safety gate, not permission to mutate production.

## Stage 1 — schema-only PR

The PR only **adds** `AddRestaurantAutoTheme2026101200010` and tests. It does not
register the migration in `app.module.ts`, add an entity property, or turn on
any feature. Merging the PR **does not apply the migration** to a running DB.

The migration adds `restaurant.auto_theme_enabled boolean NOT NULL DEFAULT false`.
Existing `site_mode`, `holiday_key`, bookings, Syrve and table status are
unaffected. It uses `SET LOCAL lock_timeout = '2s'` inside the migration transaction before each `ACCESS EXCLUSIVE` lock, aborting rather than waiting indefinitely in the production traffic queue. It refuses to adopt a preexisting column and refuses rollback while any restaurant has automation enabled, holding the same lock through the check and drop.

Before applying anything to production, a human must:

1. Confirm the current production branch and actual PostgreSQL instance.
2. Inspect the live schema *read-only* and existing TypeORM migration history.
   Verify that `restaurant` exists and determine whether
   `auto_theme_enabled` is already present.
3. Take and verify a recoverable backup/snapshot of that same database. Record
   the backup identifier and recovery procedure. Never use a disposable CI
   database as a substitute for the live audit.
4. Approve an explicit one-off TypeORM migration execution, restricted to
   `AddRestaurantAutoTheme2026101200010`, with a transaction and a verified
   connection target. Do **not** enable `synchronize`, run all pending
   migrations, or modify the protected Syrve migration registry.
5. Confirm the new column's type/default/nullability and verify all existing
   rows have `auto_theme_enabled = false`. Confirm the normal bookings and
   staff workflows still work.

**Stop** on any unexpected column, nonempty auto flag, failed backup, failed
schema audit, lock timeout (retry at a quiet time), unknown database target or migration-history discrepancy. Do not
deploy the auto-theme feature PR yet.

## Stage 2 — feature PR

Only after the stage-1 PR is merged, a backup is verified, and the production
column is confirmed installed, rebase or recreate the stage-2 PR from the new
`main`, inspect the diff and require fresh CI plus current-HEAD Codex review.
Stage 2 adds the server-side calculation and Director's `Авто за сонцем`
button. The existing day/night/holiday buttons override the automatic choice.

The stage-2 default is manual. Existing images, image paths, table maps, role
switch and the exact 15-second photo polling remain unchanged.

## Rollback

If only stage 1 is present, the new unused column can remain safely in place.
If stage 2 was deployed, first roll back the feature code to the previous
version; only consider reversing the schema migration after verifying
`auto_theme_enabled = false` on all rows and after backup. The migration's
`down` method refuses to remove an active setting.
