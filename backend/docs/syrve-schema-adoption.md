# Syrve schema adoption: reviewed sequence

This stage prepares a read-only preflight and an ordered adoption plan. It does
not apply migrations. The production schema/history has not been inspected.
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

The subsequent reviewed application operator must target the audited baseline,
require a fresh verified backup and separate production-change approval, use
one outer transaction and the `molo/schema-migrations` advisory fence, lock
history/source tables in the established migration order, and recheck the full
target/schema/data snapshot under those locks before applying only the missing
contiguous suffix. Compare schema/data/history afterwards before commit. Do
not add an initial baseline row to an existing database or execute every
pending repository migration. No such application is executed in this PR.

Prove that operator on the restored test branch, including failures and a full
schema/data comparison. Only then review and approve the concrete production
change. A preflight snapshot may have changed by that time and must be reread.

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
