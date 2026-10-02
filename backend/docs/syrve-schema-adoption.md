# Syrve schema adoption: reviewed sequence

This stage prepares a read-only preflight and a guarded SQL application plan.
It does not apply migrations in production. A target audit is private evidence,
not a permission token, and must be refreshed before execution.
The existing application registers the six prepared feature migrations only
for guarded disposable CI; merging this PR does not adopt them in production.
The worker, POS read source and public `syncEnabled` remain off.

## Obtain the target audit

1. Build the reviewed backend commit with `npm --prefix backend ci` and
   `npm --prefix backend run build` in a controlled environment.
2. Independently verify the Neon branch, endpoint and database in Neon UI.
   An endpoint string alone does not prove branch identity. Audit a restored
   test branch first. Do not supply a production owner's password to Actions.
3. Provide the private connection through the execution environment, never a
   command-line argument, repository file, PR comment or public log. Use a
   read-only identity with access to the relevant catalog/business tables.
   No GRANT, role change, revoke or backup command is performed by this tool.
4. Set `MOLO_SYRVE_BRANCH` to `test-syrve-migration` or `production`,
   `MOLO_SYRVE_EXPECTED_HOST` to the verified Neon endpoint and
   `MOLO_SYRVE_EXPECTED_DATABASE` to the exact database. Set
   `DB_SYNCHRONIZE=false`; supply private `DB_URL` with `sslmode=require` or
   `verify-full`. Unknown connection options are refused; URL TLS parameters
   are stripped before the explicit certificate-verifying TLS configuration.
5. Run `node backend/scripts/syrve-schema-preflight.mjs --check`.

The isolated data source has no Nest bootstrap, entities, auto migrations or
write path. Both its session and its REPEATABLE READ transaction are read-only.
Catalog/data queries have fixed search path and bounded waits. The report
contains six ordered migration states and an opaque fingerprint; it excludes
connection strings, credentials, SQL definitions and raw business records.

Exit 0 means the prepared schema/history matches the reference, 2 means missing
steps require a reviewed plan, 3 means drift/history/data require an audit, and
1 means an intent guard or read failed. None is permission to apply migrations
or enable synchronization. `--apply` is refused before opening a connection.
The fingerprint identifies a read snapshot; it is not an approval token.

## Review and prepare application separately

Review the actual target report and its private schema/history audit against
the frozen migrations. Existing objects without history must not be adopted
from their names. Partial or altered objects, unknown history, multiple
configurations, duplicate/unsupported table numbers or missing physical
identity must be resolved through a separately reviewed plan. Never delete
settings, bookings, links, overrides or orders to make a preflight pass.

| Order | Prepared migration | Required boundary |
| --- | --- | --- |
| 1 | `CreateSyrveTableLinks2026093000010` | Existing UUID tables and integration; absent link objects/history |
| 2 | `FenceSyrveConfiguration2026093000020` | At most one saved integration; preserve every credential row |
| 3 | `CreateTableMapIdentities2026093000030` | Audit physical UUIDs and unambiguous original map slots; never move/rename a physical table |
| 4 | `ProtectCanonicalTableNumbers2026093000040` | No duplicate canonical numbers; never rewrite numbers to satisfy uniqueness |
| 5 | `CreateSyrveDurableState2026093000050` | Exact link schema; preserve all existing state/override intent |
| 6 | `CreateSyrveWorkerState2026100100060` | Exact integration/link schema; no automatic worker activation |

The application plan targets the audited baseline and must
require a fresh verified backup and separate production-change approval, use
one outer transaction and the `molo/schema-migrations` advisory fence, lock
history/source tables in the established migration order, and recheck the full
target/schema/data snapshot under those locks before applying only the missing
contiguous suffix. Compare schema/data/history afterwards before commit. Do
not add an initial baseline row to an existing database or execute every
pending repository migration. Merging the code never executes this plan.

Prove that operator on the restored test branch, including failures and a full
schema/data comparison. Only then review and approve the concrete production
change. A preflight snapshot may have changed by that time and must be reread.

## Build the private transaction plan

`backend/scripts/syrve-schema-application-plan.mjs` is an offline SQL planner.
It neither opens a connection nor accepts `--apply`. Build the reviewed backend
first. Keep its inputs and output private; they contain catalog definitions,
physical UUIDs and data fingerprints, but never raw customer or credential rows.

1. Independently verify the project, branch ID, direct endpoint ID/host and
   database through Neon. Never rely on the default branch. Obtain an up-to-date
   backup branch from that exact source, leave it untouched, and restore it by
   creating a separate child test branch. Record both parent IDs and creation
   times. An existing snapshot must not be deleted to make room automatically.
2. Run `node backend/scripts/syrve-schema-application-plan.mjs --inventory`.
   Execute its entire `sqlStatements` array as one read-only transaction with
   explicit project, branch and database IDs. The final result is the public
   relation inventory. Do this first on the restored test branch.
3. Supply `{ "inventory": [...], "revision": false }` in a private JSON input.
   Set `revision: true` if the recorded prefix already includes configuration
   fencing. Run `node backend/scripts/syrve-schema-application-plan.mjs --audit
   /private/audit-input.json`. Execute all returned statements in one read-only
   transaction. `parseAudit(queries, results)` produces the audit input; it checks
   the returned result count. Repeat for the source and compare every native
   fingerprint to prove the backup is restorable and matches the current source.
4. Obtain the six `catalog` arrays from a prepared PostgreSQL 17 test database.
   The planner requires that all six match the committed frozen reference. It
   never accepts altered DDL or fills a missing history row from an object name.
5. Assemble private `{ inventory, audit, reference, context }`. `context` contains
   `sourceCommit` (the exact reviewed commit), `target` (`projectId`, `branchId`,
   `endpointId`, `host`, `database`, `purpose`: `production` or `rehearsal`) and
   `backup` (`projectId`, `sourceBranchId`, `branchId`, `parentId`,
   `restoredBranchId`, `restoredParentId`, `createdAt`, `verifiedAt`,
   `restoredFingerprint`: `preflightFingerprint(audit.hashes)`). These supplied
   IDs are not a live Neon identity check: reverify them with Neon immediately
   before execution. Production must be the backup's source; rehearsal must be
   the independently restored child. The planner requires audit/backup evidence
   no older than one hour and embeds that expiry in the SQL itself.
6. Run `node backend/scripts/syrve-schema-application-plan.mjs --plan
   /private/plan-input.json`. Review `pending`, `target`, `sourceCommit`, expiry
   and the entire transaction. Rehearse this exact version on the restored copy,
   including rollback and failure probes. The generated `request` supplies all
   three explicit Neon IDs. Never change those IDs to repurpose a test plan;
   rebuild from the freshly audited production context instead.

Only after the reviewed code, verified restoration, tests and separate explicit
production-change approval may the generated `request.sql_statements` be sent
to Neon's transaction API in one call. Never split it into independent queries,
run every pending repository migration, add a baseline row, or append writes
after the final checks. A rehearsal may append `ROLLBACK` as the last statement.
Expired evidence requires a new backup and audit; a successful PR check is not
production-change approval.

The transaction uses READ COMMITTED, the shared advisory fence, and bounded
ACCESS EXCLUSIVE locks in history/integration/physical-table order, followed by
the remaining original tables in stable order. It rechecks the complete original
catalog and server-side row fingerprints before DDL. It compiles only the missing
contiguous suffix from the unchanged TypeORM classes and retains each conditional
read as a native guard. Before commit it checks the entire prepared catalog,
original metadata and rows, history prefix, configuration revision preservation,
and physical UUID/map backfill. RLS, partitioned/foreign/materialized relations
and unknown conditional reads require a separate reviewed procedure.

The full row-hash comparison also means any intervening booking, call, settings
or table write invalidates the plan. Coordinate a short maintenance window and
re-audit immediately; never bypass a mismatch or automatically remove records.
The one-hour TTL is an upper bound, not permission to reuse stale data.

The isolated PostgreSQL CI validator checks every recorded prefix (0 through 6),
preserves existing links/ledgers/worker state, and proves refused writes roll back.
It is guarded to loopback `molo_fresh_schema_reference`; it cannot run on Neon.
The runtime preflight remains read-only, and synchronization/activation stay off.

## Rollback boundaries

Use the existing migrations' guarded `down` methods in reverse order, within
transactions. Worker rollback refuses saved worker rows; durable rollback
refuses saved fences/ledgers; configuration/link rollback refuses confirmed
mapping rows. Identity rollback refuses non-reconstructable bindings. Never
clear those records automatically to make rollback possible. Number-protection
rollback retains physical numbers. After valuable state exists, prefer an
audited forward correction over dropping storage.

The disposable CI validator exercises actual catalog drift, refused read-only
writes, ledger/configuration checks and the empty migration down/up cycle.
It does not establish production privileges, backup validity, POS order-access
rights or complete POS visibility. Those remain later activation prerequisites.
