# Syrve: audit, safety boundaries and staged implementation

Initial audit: `e5a9a8cc417cc18f8335546a8d65b9ef5cf85d11` (2026-09-25).
PR 10a starts from fresh main `814d3bf3e1a19bd0a5736e3efeab41d8f7d6905d` (2026-10-01),
after manual merges of PRs #261, #264, #265, #266, #267, #268, #269, #270, #271, #272, #273, #274 and #275. Client diagnostics, link schema preparation,
read-only catalog preview, explicit UUID confirmation, internal rename preparation and read-only order observation are implemented.
The transition adapter is used by transactional staff hooks and, after explicit Director consent, the background worker.
Automatic observation and effective POS status projection default off. Migration-only activation storage,
a purpose-separated one-use confirmation and fresh command-confirmed table loading are required to enable them.
Real Syrve is not connected or queried during development; tests use synthetic credentials and mocked fetch.
Every later PR starts from freshly fetched main after the Director's manual merge.

## Confirmed wiring and current behavior

- `frontend/src/App.tsx` loads `DirectorWorkspace`, which mounts
  `SyrveIntegrationDock` inside `DirectorAuthGate`.
- `frontend/src/api/syrve.ts` calls MOLO's `/syrve-integration` routes. The staff
  frontend does not contact Syrve directly. The form already tests credentials,
  lists organizations and saves/disconnects the selected connection.
- `AppModule` imports `SyrveIntegrationModule`. Its controller has `@Roles('owner')`;
  the global `JwtAuthGuard` and `RolesGuard` enforce authentication and Director
  access. `owner` is the internal role; the interface name stays `Директор`.
- `SyrveIntegrationService` stores the API login with AES-256-GCM, a random
  12-byte IV and authentication tag. Responses are explicit projections, including
  a masked login, never ciphertext or the upstream access token.
- `syncEnabled` is hard-coded to false. The link/sync schema is prepared by PR 2;
  explicit mapping writes are available only after the prepared schema is applied.
  Internal UUID rename preparation exists; no HTTP mutation or automatic caller invokes it.
  Read-only order observation is an explicit Director API action; no frontend/automatic caller invokes it.
  The staff coordinator records local revisions/overrides when prepared links exist.
  The shared status engine is used by table/map/booking-window reads; its Syrve source is hard-disabled.
  No scheduler, automatic observation persistence or effective POS status application is enabled.
- The existing `1785362400000-CreateSyrveIntegration.ts` has up/down, and the fresh
  schema baseline contains `syrve_integrations`. This legacy migration is NOT in
  `AppModule`'s runtime migration list. A file's existence does not establish its
  application to any deployed database. Production configuration was not queried.
- `TablesService.setStatusByNumber()` calls `findOrCreateByNumber()`. The Syrve
  integration must never use either method. Even catalog import must not write
  `tables` or use a repository upsert that could insert a physical table.
- The waiter uses `/tables/:id/waiter-status`. `free` restores `occupied` for a
  checked-in approved booking, otherwise `reserved`, `pending`, or `free`.
  These existing outcomes must be preserved; a POS override does not cancel a booking.
- Other staff status paths include `setStatus`, `markFree`, `markOccupied` and
  the admin visual planner. Manual free overrides must cover these entry points
  without treating automatic booking lifecycle updates as manual actions.
- `MapService` reads table repositories directly. `BookingsService.getTableStatuses`
  combines physical and booking state. The waiter reads `/tables`; the admin uses
  maps plus booking statuses; the guest uses the public map plus booking statuses.
  Adding a source to just one response would produce inconsistent role views.
- `GuestApp` and `AdminVisualTablePlanner` now match prepared static slots by permanent
  physical identity, with number lookup retained only for an unprepared legacy response.
- `ZonesService.onModuleInit` actually seeds 60 standard physical tables and also
  reconciles existing zone assignments by number in a legacy database. PR 4b skips
  the whole default bootstrap once the independent physical-identity schema exists;
  repeated restarts neither recreate an old-number table nor reassign its location.
  `WaiterTablesByLocation` and `AdminTablesByLocation` use permanent key prefixes for
  prepared grouping. Number-range grouping is retained only before schema adoption.
- Booking statuses are `pending`, `approved`, `rejected`, `cancelled`, `completed`.
  No-show uses the existing cancelled/reason/notification flow, not a new enum.
  Active duplicate prevention uses pending/approved. Syrve must not modify it.
- Preserve today's status priority: hidden/closed, occupied, cleaning,
  pending/reserved, free. Future booking views must not inherit POS occupancy.
  Preserve every existing color, asset, shape, click zone and 15-second poll.

## Verified official API

Sources retrieved directly on 2026-09-25:

- https://api-eu.syrve.live/docs (ReDoc loads `/api-docs/docs`).
- https://api-eu.syrve.live/api-docs/docs (official OpenAPI; downloaded SHA-256:
  `35bef7ee322929566fcd481b8892553f6d57903c0df586c77b1631083dfdb87f`).
- The specification directs application registration to https://developers.syrve.com/portal.

Catalog contract rechecked from the same official OpenAPI on 2026-09-30; SHA-256:
`344c44240dee9724129b9d0821295da411c4ab4fde2dcbc5ff9b8d17ab2bd2d9`.
Order and POS-availability contracts rechecked on 2026-10-01; the downloaded
official OpenAPI has the same SHA-256. Table-order by-ID reads also require POS >=7.4.6.
Terminal responses contain organization-scoped `items` wrappers in both
`terminalGroups` and `terminalGroupsInSleep`; each group's organization must match.
Sections are scoped by `terminalGroupId`, with tables containing cloud `id`, integer
`number` and mandatory `isDeleted`. `posId` is not the cloud table identity. This
endpoint covers sections available for banquet/reserve booking, not a guaranteed
complete inventory of every physical restaurant table. PR 3 labels that limitation
and sleeping groups explicitly; no missing entry establishes closure or deletion.

| Purpose | Documented POST endpoint | Relevant fields / restriction |
| --- | --- | --- |
| Existing authentication | `/api/1/access_token` | `apiLogin`; returns object with `token`; marked deprecated |
| Current authentication | `/api/v2/access_token` | `apiKey`, `appId`, `clientSecret`; token lifetime one hour |
| Organizations | `/api/1/organizations` | `organizations[].id`, nullable `name`; Data: dictionaries |
| Terminal groups | `/api/1/terminal_groups` | organization-scoped groups and sleeping groups; Data: dictionaries |
| Sections and tables | `/api/1/reserve/available_restaurant_sections` | `terminalGroupIds`, `returnSchema: false`; Orders: preparing, POS >=7.1.5 |
| Orders by tables | `/api/1/order/by_table` | `organizationIds`, `tableIds`, optional statuses; Orders: receiving, POS >=7.4.6 |
| Track an existing order | `/api/1/order/by_id` | `organizationIds`, `orderIds` OR `posOrderIds`; Orders: receiving |
| POS-created order initialization | `/api/1/order/init_by_table` | `organizationId`, `terminalGroupId`, `tableIds`; Orders: loading data, POS >=7.7.1 |
| POS availability | `/api/1/terminal_groups/is_alive` | POS: availability |
| Webhook settings | `/api/1/webhooks/settings`, `/api/1/webhooks/update_settings` | Organizations: settings; configuration is a separate write |

Sections contain `id`, `terminalGroupId`, `name`, `tables`. Table records contain
`id`, `number`, `name`, `seatingCapacity`, `revision`, `isDeleted`, `posId`.
Cloud `id` is the persistent link key; neither number nor `posId` is interchangeable
with it. Do not request/apply `schema` to MOLO's map.

Order wrappers contain `id`, `organizationId`, `timestamp`, `creationStatus` and
nullable `order`. Only successful, structurally valid order payloads are usable.
`order.tableIds` is an ARRAY; `order.status` is New/Bill/Closed/Deleted. One table
may have multiple orders. `Bill` is not closure. Payment totals or bill printing
must not be substituted for explicit terminal status.

An empty list, missing order, sleeping POS or failed request does not prove closure.
The initial connection must diagnose permissions, POS/version availability and
visibility of POS-created orders. Read access to organizations alone proves none
of these. The initialization endpoint is a command, so PR 1 and read-only catalog
or order probes must never invoke it. If it is required for complete observation,
add an explicitly scoped initialization step to activation and verify its result;
otherwise keep activation blocked with an actionable diagnostic. Do not declare
completeness based on an empty response. No webhook is configured in this plan's
first implementation; its settings endpoints alone do not establish delivery guarantees.

## PR 1: implemented boundary

- Extract a backend client used by the existing test/connect/recheck actions.
- Only authentication and organizations are queried. `/test` writes neither the
  integration repository nor audit logs. Existing connect/recheck/disconnect retain
  their configuration/audit writes; they do not touch tables or bookings.
- Return authentication mode and precise checks: organizations checked, tables and
  orders NOT checked, synchronization false. Existing frontend response fields remain.
- Accept only the verified `https://api-eu.syrve.live` origin, with no credentials,
  path, query, custom port or redirect. Other regions need explicit verification
  and a future allowlist addition; no arbitrary provider hostname is accepted.
- Keep the existing 12-second request/body deadline, cap responses at 1 MiB and
  validate the whole organization list. Reject malformed/partial data atomically.
- Never return or persist upstream error bodies or fetch error details. Use fixed
  Ukrainian diagnostics for auth, permissions, rate limiting, timeout and failure.
- With both backend `SYRVE_APP_ID` and `SYRVE_APP_CLIENT_SECRET`, use v2. Partial
  configuration fails locally; failed v2 does not retry v1. Without both settings,
  retain existing v1 compatibility and explicitly mark it deprecated in diagnostics.
- Keep the encryption format. In production (including Render), require a separate
  `SYRVE_CREDENTIALS_SECRET` when testing/saving/decrypting credentials; do not add a
  startup dependency. Development keeps the previous JWT-secret fallback.
- No schema change, dependencies, scheduler, activation switch, order calls, catalog
  import, frontend polling change or physical map edit is included.

Operator preparation: configure the storage secret before first use. For v2,
register the MOLO application and configure its app credentials on the backend;
the Director still supplies only the restaurant API key. These are deployment
prerequisites, not a request to connect a real restaurant during development.
Do not rotate the storage secret casually. Ciphertext created with the old JWT
fallback cannot be read with a new separate secret; an already connected installation
needs an explicit credential re-entry or separately reviewed re-encryption procedure.
This PR neither changes production environment variables nor re-encrypts existing rows.

## Minimal target data model and concurrency

Prefer one new `syrve_table_links` table; embed per-table sync state in the link:

- `id`, `integrationId`, `organizationId`, `moloTableId`, `syrveTableId`.
- `lastKnownNumber`, `lastSeenAt`, `lastSyncedAt`, `lastSyrveState` (unknown/open/closed).
- `activeSyrveOrderIds`, `manuallyFreedSyrveOrderIds` as validated UUID arrays (`uuid[]`);
  order metadata/timestamps sufficient to reject stale updates and prove closure.
- FK to an EXISTING MOLO table; unique MOLO binding and unique provider binding
  scoped to organization. No cascade from Syrve to physical tables.
- Existing integration row gains activation state (default false), configuration
  revision and last successful sync/error metadata. Enforce the single configuration
  invariant before relying on it; never silently discard duplicate configurations.

Separately persist an immutable physical `mapKey` for each existing table before renaming:
PR 4a uses a two-column `table_map_identities` relation, owned by MOLO and independent
of Syrve. A new mapped column on the synchronized legacy TableEntity would either
be implicitly created by synchronize or break legacy inserts/reads before the final
schema-adoption step. The separate migration-owned relation avoids that problem
without changing the existing physical schema. Backfill from the current verified map slot,
use UUID for actions and current
`tableNumber` for labels. A map slot/location must stay bound when a number changes,
the integration is disabled or links are removed. This is why putting the physical
map identity only into a removable Syrve link is insufficient. Verify number labels
on existing photos without editing the photos; report conflicts rather than rewriting assets.

Keep `tables.status` as MOLO's manual/booking source. A shared status projection
adds Syrve occupancy for today's reads, so closure removes only the Syrve source
and cannot clear manual occupied/cleaning/closed or a checked-in booking. There
must be no different effective status implementations for map, waiter and booking views.
Unknown provider tables produce Director diagnostics, not inserts or map slots.

Manual free atomically records the observed active order IDs and performs the
existing MOLO free logic. The same IDs remain suppressed; explicit closure clears
their overrides; a new ID becomes occupied. Multiple active orders must be handled
as a set, not by selecting the first order. Polling and staff writes lock the same
table/link in a fixed order. A response fetched before a staff action must not erase
that override. Configuration revision fencing rejects in-flight replies after
disconnect, remapping or organization changes. Never hold a DB transaction over HTTP.

Use database constraints and transactions for mapping/rename races; audit duplicate
existing numbers before introducing a uniqueness constraint. A conflicting rename
updates no physical field. If a new number is not safely representable, show a
conflict. Do not swap two physical tables or rewrite bookings to resolve it.

Worker failure records safe diagnostics and retains the last validated state.
Use one bounded, non-overlapping backend run, a multi-instance database lock,
rate-limit backoff and last-success timestamps. Staff requests never await Syrve.
Activation remains unavailable until all prerequisites and mapping confirmation pass.

## Ordered PRs and expected files

| PR | Scope and acceptance gate | Expected files |
| --- | --- | --- |
| 1 | Safe auth/organization client and diagnostics (merged #261) | `src/syrve/syrve-client.ts`, service/module, `test/syrve-*.test.js`, `.env*example`, this document |
| 2 | Link/sync storage and uniqueness; reversible migration with explicit registration/application path; no mapping writes or status changes | new Syrve link entity/migration, module, migration registry and PostgreSQL schema tests |
| 3 | Read-only terminal/section catalog, deleted/duplicate/unmapped diagnostics and proposals by unambiguous numbers (merged #265); no mapping writes or migrations | Syrve client/catalog/service/controller/DTO/module and tests, `frontend/src/api/syrve.ts`, Director dock/preview panel/tests |
| 3b | Explicit UUID mapping confirmation (merged #266); singleton/configuration revision and stale-preview fencing introduced with the first write transaction | integration entity + migration/registry, mapping DTO/service/controller, Director confirmation UI and PostgreSQL concurrency tests |
| 4a | Independent immutable physical UUID ↔ map slot storage and read-only diagnostics (merged #267); legacy-compatible API projection, no map consumer switch | new table-map entity/service/module/catalog + migration, tables/map API, migration registry/scripts and PostgreSQL tests; frontend API types only |
| 4b | Connected map/location consumers use permanent identity before any rename (merged #268); missing/hidden slots remain unavailable in prepared guest maps, legacy behavior and frozen geometry/assets preserved | `frontend/src/guest/GuestApp.tsx`, `frontend/src/admin/AdminVisualTablePlanner.tsx`, both `*TablesByLocation.tsx`, shared physical-slot resolver, `backend/src/zones/zones.service.ts` bootstrap identity guard and protected-map/booking/restart tests |
| 5 | Rename by persisted UUID link, only `tableNumber`, atomic conflict protection (merged #269); internal methods remain unreachable from HTTP/automatic callers | Syrve rename service/plan, canonical table-number uniqueness migration, read-only Director diagnostics, partial status saves and concurrency tests |
| 6 | Read-only order observation and POS/permissions diagnostics; classify explicit closure vs unknown (merged #270) | Syrve order client/observer, explicit Director API and synthetic fixtures/tests; no persistence or status application |
| 7 | Pure state transition rules covering order sets, explicit closure, stale observations, manual overrides and priority (merged #271) | isolated Syrve state reducer and regression tests; no enabled worker |
| 8a | Durable version ledger and local staff fence, transactional internal adapter (merged #272) | separate migration-owned state/version tables, internal store, disposable PostgreSQL restart/concurrency tests and CI migration registry |
| 8b | Transactional manual-action hooks, existing waiter/booking behavior retained (merged #273) | `TablesService`, minimal staff coordinator/module, durable adapter and PostgreSQL regression tests; sync remains off |
| 8c | Unified effective status reads with the existing role/date priorities (merged #274) | map/status read services, shared projection, dependency wiring and regression tests; sync remains off |
| 9 | Disabled-by-default backend worker, configuration fencing, one runner, backoff and durable last good state (merged #275) | Syrve worker/module/state service and failure/concurrency tests; no automatic activation |
| 10a | Read-only readiness and target-guarded schema adoption preflight (this PR) | schema contracts/catalog reader, Director GET/panel, read-only operator and disposable PostgreSQL checks; no application or activation |
| 10b1 | Explicit Director diagnostics after the reviewed schema-adoption path (merged #278); stale-response handling, no activation | aggregate diagnostics projection/route, Director API/panel, authorization and read-only/stale-response regression tests |
| 10b2 | Table-only Director diagnostics and mapped POS version compatibility; no initialization or activation | bounded version parser/counts, saved-scope probe/projection, Director diagnostics/readiness text and regression tests |
| 10b3 | Explicit Director loading of confirmed table scope with command completion and a fresh read; no activation | purpose-separated one-use confirmation, shared PostgreSQL lease, bounded init/status transport, Director confirmation panel and regression tests |
| 10b | Final Director activation, complete diagnostics, regression hardening and reviewed schema-adoption path after a fresh production audit | Director dock/API, activation DTO/controller, migration operator/registry, diagnostics, operational documentation and full regression suite |

All paths above are under `backend/` unless prefixed `frontend/`. Boundaries may
be narrowed after each fresh-main review, never expanded to include unrelated fixes.
Both PR 4a and PR 4b are prerequisites imposed by the existing implementation, not a redesign of
coordinates, photographs, click zones or colors. Do not combine occupied application
with a live worker before closure and manual override rules exist.

### PR 2 storage boundary

`CreateSyrveTableLinks2026093000010` adds only `syrve_table_links`. Existing
integration rows, credentials, tables and bookings remain unchanged. The entity is
registered through `SyrveIntegrationModule` with `synchronize: false`. The migration is
explicitly registered for the guarded disposable CI database, where the existing
transaction/advisory-lock bootstrap applies it. The live bootstrap retains its eight
existing migrations. Production adoption is deferred until a fresh schema/history audit
and a separately reviewed deployment step; PR 2 must not assume the unregistered legacy
Syrve migration was applied. The eventual Director flow requires the backend schema to
be deployed first, without requiring any real Syrve credentials during development.
Historical baseline/legacy migrations and the production guest-push gate are unchanged.

One physical MOLO UUID has at most one link. The provider UUID is unique per
organization, including across duplicate existing integration rows. Both parent UUIDs
must exist; deleting a parent removes its link only. No Syrve operation creates a
physical table. Initial state is `unknown`, with empty order/override arrays and null
observation timestamps. Native PostgreSQL `uuid[]` stores multiple order IDs without
an extra sync-state table; checks reject invalid IDs, impossible state/order pairs and
overrides for IDs outside the active set. This does not yet implement transitions.

Rollback holds an exclusive lock and refuses to drop a non-empty link table, preserving
confirmed links and overrides. Operators must explicitly remove mappings before a
schema rollback; the migration never silently deletes them. Empty-table up/down is
covered by existing schema roundtrip/fresh-baseline CI. The additional disposable-only
PostgreSQL probe checks real FK/unique/check constraints, concurrent mapping inserts,
last-valid-state preservation and unchanged physical fields.

Singleton connection enforcement and configuration revision move to PR 3b so they are
introduced together with the first actual mapping write transaction. PR 2 adds no
HTTP routes, mapping service, polling, worker or activation; `syncEnabled` stays false.

### PR 3 read-only preview boundary

`POST /syrve-integration/tables-preview` is Director-only under the existing JWT/role
guards, validates the selected organization UUID and returns `Cache-Control: no-store`.
One request-local token session checks organization access, reads terminal groups and
reads sections for active groups with `returnSchema: false`. Sleeping groups are only
reported: no awake/init/order/webhook command is sent. The existing 12-second per-request
deadline, 1 MiB body limit, fixed HTTPS origin and safe errors also apply to the catalog.
Foreign-scope responses or malformed/missing fields needed for catalog identity,
number and deletion checks reject the entire preview; undeclared fields are not exposed.

MOLO reads only existing table UUIDs/numbers. Preview never calls `TablesService`,
creates a table, reads/writes prepared links, saves integration state or writes logs.
Cloud table IDs and number comparisons generate suggestions only. Duplicate IDs,
duplicate canonical numbers, deleted tables and unsupported numbers never generate an
ambiguous pair. Missing provider/MOLO entries and conflicts are separate diagnostics.
Errors leave all MOLO/manual/booking state unchanged. Every preview reports mapping
confirmation unavailable, orders not checked and sync disabled; it is not an activation
or proof that the catalog covers all restaurant tables.

The Ukrainian Director panel adds an explicit table check before its existing credential
save. It shows counts, suggested table-number pairs backed by UUIDs, missing entries, conflicts, deleted entries
and coverage warnings. Changing organization/rechecking/closing clears the preview;
request versions reject late success/error responses. Closing also clears the typed key.
No key or upstream token is returned to the browser or stored in browser persistence.
At PR 3, connection saving only saved encrypted settings. PR 3b adds the separate
confirmation boundary below; no worker or activation is enabled.

### PR 3b explicit confirmation boundary

The Director must explicitly acknowledge the proposed pairs before saving credentials
and links together through `POST /syrve-integration/connect`. A server-signed, five-minute
`confirmationProof` binds the restaurant, normalized API origin, an HMAC credential
fingerprint, configuration ID/revision, the validated provider catalog, every existing
MOLO UUID/number and persisted UUID links. It contains no API login, encrypted secret
or upstream access token and cannot authenticate to Syrve. No new receipt table or
browser persistence is introduced.

Confirmation re-reads the same documented catalog outside the database transaction.
Inside a short transaction, a settings advisory lock serializes all configuration writes,
the persisted UUID revision must still match, and a `SHARE` lock on `tables` prevents a
concurrent insert/rename from invalidating number uniqueness. Lock waits are limited to
750 ms, each statement to five seconds; no Syrve call or audit-log call holds these locks.
The fingerprint and selected UUID pairs are revalidated before any write. Only unique
currently proposed pairs may be inserted, including an explicitly chosen subset. Unknown,
deleted, duplicate or already-linked tables cannot be imported or rebound. An empty
selection saves only settings. The UI confirms all displayed eligible proposals in one
explicit action. Other conflicts remain visible and never imply complete coverage.

The transaction saves settings and new links atomically. Existing links, observation
state, active order sets and manual overrides are never overwritten. Existing UUID links
remain visible if Syrve changes a number; this stage does not rename MOLO tables.
A different restaurant is rejected while any confirmed link belongs to the old one.
Disconnect clears credentials but retains the connection row, links and sync state.
Recheck, disconnect and metadata writes require the current revision; late successful or
failed checks cannot restore credentials or overwrite a newer configuration. Every settings
write replaces the revision UUID. Failed post-commit audit logging reports a fixed server
warning rather than falsely reporting that a committed confirmation failed.

`FenceSyrveConfiguration2026093000020` adds only a UUID revision column and a unique
constant-expression singleton index to `syrve_integrations`. Duplicate existing settings
cause `up` to stop for an audited reconciliation; no row is discarded. Both directions
require an active transaction. `down` locks settings and links, refuses confirmed links,
and removes only the owned column/index. Credentials and all other settings survive;
a later `up` generates new UUID revisions, invalidating pre-rollback receipts.
`SyrveIntegration` is now `synchronize: false`, matching the link entity. The guarded
CI reference provisions its legacy table/PK using the frozen initial migration baseline
before runtime migrations; it never adopts production history or uses the legacy
unregistered Syrve migration to infer live schema state.

The new migration is registered only in the guarded disposable CI registry. The eight
production bootstrap migrations and Guest Push operator gate stay unchanged. Status
reads select legacy columns explicitly when the prepared schema is unavailable and never
create a settings row. Catalog diagnostics still work, while confirmation/mutation is
blocked with a controlled Director message. Prepared schema deployment remains a separately
reviewed final adoption step after a fresh production schema/history audit; no production
migration, SQL, environment change or real Syrve connection is performed in PR 3b.

Tests cover tampering/expiry, credential/catalog/MOLO changes, arbitrary or duplicate pairs,
concurrent first confirmations, replay, provider failure, stable UUIDs, retained overrides,
restaurant-change protection and late recheck responses after disconnect. The disposable
PostgreSQL probe executes the actual compiled service/store, verifies singleton/link
constraints and transaction rollback, compares every physical table field, and checks
legacy reads and migration down/up credential preservation. Full role/DTO guards and
frontend handler/SSR suites also run, including polling remaining exactly 15 seconds.


### PR 4a physical identity preparation boundary

This stage prepares the stable physical relationship without switching any map or
staff UI away from its current number-based lookup. PR 4b must follow a fresh-main
audit after the Director's manual merge; renaming stays blocked until both stages
and their regression gates are complete.

The independent `table_map_identities` table contains only `table_id` (existing MOLO
UUID, primary key/FK with cascade on MOLO deletion) and `map_key` (unique immutable
physical slot). A slot such as `hall:12` is a frozen physical identifier, not the
current table number. Its prefix provides the permanent location without a second
redundant column. It does not reference Syrve configuration or removable Syrve links.

`CreateTableMapIdentities2026093000030` freezes the verified 60 slots in both active
guest/admin visual maps. Under a short transaction and source-table lock it inserts
only unique canonical existing numbers. Leading zeros/outer spaces are normalized;
duplicates, unsupported or malformed numbers remain unbound. It never writes physical
table fields or creates a physical table. PostgreSQL protects one UUID per slot and
one slot per UUID, checks known slots, and rejects identity reassignment through an
UPDATE trigger. Later map additions require a new migration; changing the live slot
catalog cannot rewrite historical migration backfill.

Both migration directions require a transaction. Down locks the source tables and
bindings in the same order as up, then compares the complete binding set with the
frozen, unambiguous backfill in both directions. Only exactly reconstructable
associations may be rolled back. A rename, duplicate or any extra/missing association
blocks rollback instead of discarding physical identity. MOLO's existing explicit table deletion remains possible
and cascades only that table's identity; Syrve has no write path to this table.

The new entity is synchronize:false. The existing TableEntity and its database
columns stay unchanged. AppModule registers the new migration only for the already
guarded disposable CI database; production's eight bootstrap migrations and all
historical baseline definitions stay unchanged. Production deployment/adoption is
still deferred to the separately reviewed final schema/history audit.

A shared read-only service adds `mapKey` and `mapLocation` to `/tables` and the main
`tables` collection of `/map`, with `mapIdentityPrepared` on map responses.
The absent legacy binding table returns original table objects without querying
unknown columns. Prepared but unbound tables expose null identity; reads never
derive/save a new association from a changed number. Other physical properties,
status computation and public visibility filtering remain unchanged. The frontend
only gains optional API types; all map, location grouping, manual button and booking
handlers are untouched at this stage.

`GET /tables/map-identities` is Director-only under the existing real JWT/role
guards and returns Cache-Control:no-store. It reports bound/unbound UUIDs, physical
locations, current vs original numbers and duplicate-number conflicts without
credentials or any external Syrve request. It explicitly reports map consumers,
renaming and synchronization not ready/enabled.

Full backend/frontend builds/tests and exact-HEAD git checks run in GitHub CI.
Local execution is unavailable because the workspace exec service reports
`409 Conflict, environment_offline: Environment is not connected`; no local check
is claimed. The disposable PostgreSQL probe runs the actual compiled service/API read paths in
its own temporary schema, cloned only from the guarded disposable database. All 60
ZonesService-seeded public tables/bindings are compared before/after and stay untouched.
It verifies legacy reads, backfill ambiguity, constraints, concurrent slot inserts,
immutability, unchanged physical fields/schema and lossless/prohibited up/down cases.

### PR 4b physical identity consumer boundary

The shared frontend resolver recognizes the same frozen 60 slots as the existing
backend catalog and both connected visual maps. Prepared responses resolve geometry
only through `mapKey`, never through the current number or `mapLocation` alone. A
missing, unbound, invalid or duplicate slot cannot borrow another UUID by number.
The map preparation flag also protects an empty/partial prepared map response.
Legacy responses preserve their old number lookup and guest fallback selection.

Guest status reads use the resolved table's current number, while the active contour
continues to use its frozen slot. Prepared missing/hidden tables do not render a
guest click target and cannot create a synthetic booking target. Admin map selection
uses the resolved physical UUID for existing manual bookings, status actions and
availability blocks; current numbers are used for status lookup and accessible labels.
All coordinates, photographs, SVG shapes and click-zone geometry stay frozen.

Guest pre-submit revalidation follows the chosen UUID in a prepared map, rejecting
deleted, hidden or unbound results instead of choosing a different table with the
old number. If the same UUID acquired a new number while the form was open, the
displayed selection is refreshed and a second explicit submit is required. This
prevents a stale form closure from sending the old number. Existing API payloads,
contact validation, duration and token/device booking flows stay unchanged.

Both location panels group prepared tables by their permanent physical prefix,
including the existing hyphenated staff location keys. Unbound/invalid tables stay
in the existing unassigned list, and hidden filtering, number search, sorting,
selected UUIDs and 15-second polling are preserved. The waiter response merge retains
optional identity fields when the existing manual-status endpoint returns the legacy
physical entity; the sent UUID/status and occupied/free business rules stay unchanged.

`ZonesModule` injects the existing read-only identity service. When the independent
schema is prepared, `ensureDefaultLocations` returns existing zones without creating
a restaurant, zones or tables or changing zone assignments. This guard applies even
when all bindings/slots were intentionally removed; absence cannot trigger reseeding.
An identity read failure rejects startup before any default-bootstrap write. Before
schema adoption the original default bootstrap remains intact and idempotent; its
module-init hook still precedes the guarded migration bootstrap's application hook.
Director diagnostics report consumer readiness only when the identity schema exists.
Renaming and synchronization remain disabled.

New regression tests exercise actual connected handlers, map render callbacks,
current-number status lookups, UUID selection, legacy fallbacks, unbound/hidden/deleted
slots, a reused old number, prepared partial responses, repeated startup and retained
waiter identity. Both full map catalogs have frozen source checksums covering their
geometry, slot labels and image paths. The existing disposable-only PostgreSQL probe
also invokes the actual compiled ZonesService twice after a synthetic rename and
again after deleting all physical fixtures; it compares complete tables, zones and
bindings and leaves all 60 seeded public slots untouched.

No migration, production schema adoption, external Syrve request, status integration,
worker, environment change or deployment is part of PR 4b. Photographs and section
range captions still describe the original physical layout; the later rename stage
must report original/current-number conflicts without rewriting those assets.

### PR 5 UUID rename preparation boundary

`SyrveTableRenamingService` is registered and exported for later observer/activation
work. This stage has no HTTP rename route, worker, scheduler or automatic caller.
Its `capture()` method records the configuration revision and a fingerprint of
existing UUID links, physical bindings and current numbers before the future
observer's external request. `applyCatalog()` accepts the already validated catalog
and that observation, performs no HTTP request, and rejects expired, stale or
disconnected observations inside the existing settings transaction fence.

The transaction locks settings, then physical tables and bindings in a fixed order,
with the existing 750 ms lock and five-second statement deadlines. It plans the
whole batch before writing. Only persisted MOLO UUID ↔ Syrve UUID links belonging
to the selected configuration/organization and a valid independent physical slot
are eligible. Unknown provider tables never create MOLO records. Missing/deleted
provider UUIDs only produce skipped diagnostics; they never delete or rebind a table.
Duplicate provider IDs/numbers, invalid/nonpositive/out-of-int32 targets, unbound
slots, duplicate MOLO canonical numbers and occupied targets block the whole batch.
Occupied targets also block swaps/chains; no temporary number is introduced.

Each update is scoped to the existing physical UUID and its observed number, and
changes only `tables.table_number`, including leaving `updated_at` untouched.
Bookings, table geometry/location/visibility/manual status, immutable map identity,
confirmed links, order sets, manual overrides and settings remain unchanged.
The observation fingerprint rejects a late result after a prior rename, insert,
delete or remapping, even if the configuration revision itself did not change.
Fresh repeated catalogs are idempotent. Any PostgreSQL failure rolls the entire
batch back; canonical-number conflicts become fixed Ukrainian HTTP 409 messages.

`ProtectCanonicalTableNumbers2026093000040` owns a strict immutable SQL normalizer
and expression unique index on positive canonical numbers. It mirrors the frozen
12-digit number normalization and JavaScript trim whitespace, so `12`, `0012` and
outer-whitespace variants cannot describe two tables. Existing unsupported values
remain untouched. Up holds a source-table lock and stops on duplicates for an
audited reconciliation without renaming/deleting any row. Down drops only its
index/function under the same lock and retains all data. The expression index is
declared `synchronize: false` on the existing entity; TypeORM neither creates nor
drops it implicitly. Prepared readiness checks require the actual valid unique
index, its normalizer expression and the exact frozen SQL function body, language,
strict/immutable/parallel-safe attributes, invoker security and absence of custom
function settings. A same-name function returning raw input or NULL is not ready.

The migration is registered only for the guarded disposable CI reference and its
fresh/history/roundtrip probes. Production's eight bootstrap migrations, historical
baseline/legacy definitions and Guest Push operator gate are unchanged. Production
schema adoption remains the separately reviewed final step, after a fresh audit;
no real Syrve connection, SQL, migration, environment change or deployment is
performed against production during this development stage.

Unlocked table-status saves now persist only UUID/status; explicit table updates
persist only requested fields. This prevents an entity loaded before a rename from
writing its stale number back. Existing waiter occupied/free decisions, checked-in
booking priority, expiration and booking lifecycle conditions remain unchanged.
Status responses reload the current table. Existing transactions already holding
a table write lock retain their behavior. Generic physical-table create/update
paths convert violations of the new number index into Ukrainian conflicts.

The connected advanced `AdminPanel` also consumes prepared physical identity:
it never synthesizes old-number virtual targets once the map is prepared, keeps
physical/booking grouping by the persisted table UUID and map prefix, and sends
actions through existing UUID endpoints. Empty prepared maps remain empty; legacy
virtual-number behavior stays available only before schema preparation. The backend
also refuses all number-based status/find-or-create actions after identity adoption,
so an old client cannot recreate a renamed slot or mutate a different UUID that
reused the old number. The waiter already uses UUID routes and retains its rules.

`GET /syrve-integration/table-renaming` is Director-only with the existing real
JWT/role guards and `Cache-Control: no-store`. It reports schema readiness,
confirmed UUIDs, permanent map slot/location, original/current numbers and photo
label conflicts. It returns no credentials, access tokens, order sets or overrides.
`renamingEnabled` and `syncEnabled` remain false. Existing photographs and section
range captions retain original layout numbers; conflicts are reported, never
rewritten into assets.

Local verification includes both npm installs/builds/full test suites, source and
whitespace checks. The guarded CI PostgreSQL probe runs the actual compiled service
and store in a separate namespace. It verifies duplicate-up refusal, SQL/JS number
normalization, direct/concurrent unique violations, a late second-update fault and
full rollback, concurrent rename observations, stale/disconnected replies, booking
and map/link preservation, actual waiter read/rename/save interleaving and lossless
number-protection down/up. The probe additionally verifies refusal of raw-input/NULL
function drift and missing/reused number actions without physical writes. Every
public bootstrap table/binding/zone is compared before/after and remains untouched.
Earlier identity fixtures deliberately omit
the later index, and mapping probes now expect duplicate inserts to be rejected.

### PR 6 read-only order observation boundary

`POST /syrve-integration/orders-observation` is Director-only under the existing
real JWT/role guards and returns `Cache-Control: no-store`. Its only accepted input
is the saved `configurationRevision`; arbitrary table/order IDs or credentials
cannot expand its scope. It requires a prepared, connected saved configuration and
confirmed UUID links. Legacy/unprepared, stale, disconnected and foreign-link
configurations fail locally before any upstream request. The existing connection
test/recheck and frontend actions retain their original auth/catalog scope. No
frontend action, worker or automatic caller invokes the new observation endpoint.

One backend token session reads the organization, active/sleeping groups, sections,
POS availability and orders. It uses only the documented read endpoints; it never
initializes POS orders, wakes terminals, configures webhooks or requests map layout.
POS availability uses `organizationIds` and `terminalGroupIds`; its complete
organization-scoped response must cover every requested active group exactly once.
Only confirmed cloud table UUIDs present, nondeleted and on an alive catalog group
are queried by table. Sleeping/offline/missing/deleted tables remain unknown.
Previously active order UUIDs are additionally queried by ID with `posOrderIds:null`.
There is no status/date filter that could turn an excluded order into closure.

The saved UUID scope is not rejected at the size of one transport batch. Both order
methods use sequential chunks: at most 100 table UUIDs or 200 known order UUIDs per
request, with one shared backend token session. This supports 101–1000 confirmed
links allowed by a connection confirmation, including larger cumulative mappings.
An order spanning tables in different chunks may legitimately occur in multiple
responses; its UUID is deduplicated and versions are reconciled by the same timestamp
rules. Duplicate UUIDs within a single response still invalidate that response.

MOLO bounds the entire probe to 25 upstream requests (including authentication and
organizations), 2000 unique collected orders per channel and 45 seconds overall.
The request budget or deadline never resets between chunks. Budget exhaustion,
failure of any chunk or an invalid aggregate discards all partial evidence and
returns incomplete/unknown diagnostics while retaining all saved data. Every request/body retains the existing
12-second deadline, 1 MiB streaming cap, origin allowlist and redirect rejection.
Response validation rejects duplicate/foreign/unrequested IDs, malformed/partial
critical fields and timestamps that cannot be represented as safe nonnegative
JavaScript integers. It validates the observation fields rather than requiring or
forwarding unrelated customer, item, payment and external-data payloads. Provider
timestamps are opaque ordered versions, never interpreted as a local wall clock.

Only `Success` with valid table IDs, terminal-group UUID, timestamp and status is
usable. `New`/`Bill` are open; `Closed`/`Deleted` explicitly close that order UUID.
Payments or a closing-time field cannot override the explicit status. Pending/error
creation and unknown statuses are unknown, with no error body forwarded. An empty
list, missing known UUID, changed table association or conflicting equal-version
responses never establish closure. Where both methods return an order, the greater
provider timestamp wins. A failed/invalid required read invalidates all closure/open
evidence in that probe; an offline/unknown order group or a catalog/order group
mismatch also produces unknown.
These are observation classifications only: stale-versus-persisted transition rules
and manual override reduction remain PR 7.

The pure observer handles multiple orders and an order's table-ID array. It returns
sets of active, explicitly closed and unknown order evidence for existing UUID links
without selecting the first order or creating an unlinked table. Positive open
evidence can be reported, but table state is never "closed/free" in this stage.
Even when every known order is explicitly closed, unobserved POS-created orders
have not been ruled out. The response always reports incomplete visibility, unknown
POS version, initialization not performed and activation/synchronization false.
Successful reads prove only access to that endpoint, not a complete permission
inventory or supported installed POS version. Diagnostics give the documented
permission/version prerequisite per check and fixed safe failure codes.

The service fingerprints the configuration, confirmed links, order/override sets
and linked physical UUID/current numbers/manual status/update timestamp before HTTP,
then re-reads them afterwards. The timestamp also fences a staff change followed
by restoration of the original number/status during the same probe.
Disconnect, remapping, manual free, order-set changes, rename/deletion and schema
rollback fence both late successful and failed diagnostics. No database transaction
or lock spans HTTP. Settings/revisions, links, observations, overrides, audit logs,
physical fields, bookings and map bindings are never written by a probe. Rename
preparation is not invoked. There is no migration, registry/production change,
environment change, dependency, deployment or real restaurant query in PR 6.

Synthetic fixtures exercise the actual client and integration service, including
multiple/spanning orders, first empty reads, tracked-ID closure, moved/missing IDs,
unknown/pending/error states, partial/malformed responses, equal/newer timestamps,
POS sleeping/offline, permissions, rate limits, network/body/overall deadlines,
secret projection, configuration/staff races and change/restore table versions.
The actual integration service is also exercised with 100/101/1000/1001 saved
links; client fixtures cover 201 known order IDs, multi-table orders across chunks,
newer/equal-conflicting versions, later-chunk HTTP/body failures, the shared 45-second
deadline, the 25-request budget and aggregate limits without partial closure.
Real JWT/role/DTO HTTP tests cover
every role and reject caller-supplied IDs. Protected frontend/maps/assets/geometry,
existing waiter/booking rules and the exact 15-second polling remain unchanged.

### PR 7 pure state-policy boundary

`syrve-state-reducer.ts` exports isolated deterministic functions for an internal
snapshot, order evidence, staff-action fencing and effective status projection.
No controller/service/module/worker imports them. They issue no HTTP, query/save no
entities, change no physical fields or bookings, and enable no synchronization.
The existing Director observation endpoint and its explicit read-only response
retain their PR 6 behavior. There is no frontend or schema/migration change.

The input is an internal validated snapshot scoped to integration/configuration,
organization, physical MOLO UUID and cloud table UUID. A captured request must
match both that snapshot's local revision and the freshly locked current scope.
Disconnected, remapped, reconfigured or staff-modified state rejects the whole
reply. The future transactional adapter must provide the fresh scope under the
same lock as staff writes and advance the local revision whenever state changes;
there is no transaction over HTTP. Even a staff change/restore or an action before
the first observed order rotates the fence. Replayed/concurrent whole requests
are rejected without overwriting a newer state.

The policy consumes the existing observer's sanitized evidence. Required read
failure, missing/deleted catalog table or offline/sleeping POS preserves the
entire last validated snapshot. An empty result, missing/moved order, pending/error
creation or an unknown status never removes a tracked order. Positive open UUIDs
are added as a set. Unknown versions retain active UUIDs and manual overrides.
Provider timestamps are safe nonnegative integer versions, not wall-clock dates.
Per-order high-water marks reject older evidence, including closure, while closed
tombstones reject delayed old open replies. Conflicting equal versions preserve
last good state and remain fenced until a strictly newer version resolves them.
The entire prospective ledger is derived before any closure: stored, newly unknown
or equal-conflicting outcomes in one UUID retain every active UUID/override, even when a
different order has a newer explicit closure and sorts earlier in the response.
The ledger stores the latest usable/unknown outcome as well as timestamp/fingerprint;
only active UUID membership contributes occupancy. A moved previously active UUID
remains unknown for its old link. Initially unassociated unknown discovery is also
retained, so an older subsequent association/closure cannot erase that watermark.
A strictly newer usable association elsewhere can resolve a never-active discovery
without adding occupancy to this physical table or creating an unlinked table.
Previously unknown/conflicting evidence keeps blocking every closure when the
next row is stale, absent or itself newer-but-unknown; resolution requires a
strictly newer usable observation for that same UUID. This includes ambiguous
closed tombstones, not just currently active orders. The pure
`getSyrveOrderIdsToObserve` helper returns a deterministic array of scopes, each
containing at most 2000 active (including suppressed) or unresolved UUIDs. Empty
state returns one empty scope for table discovery. Each scope requires its own
`SyrveClient.probeOrders` call for this one linked physical table, rather than
merging all scopes into one call. This respects both the existing 2000-order
channel cap and 25-request budget; the client's 200-ID HTTP chunks alone cannot
read an arbitrarily large cumulative set in one probe.

The future adapter must capture the complete plan with the snapshot/fence, collect
every `{ orderIds, probe }` result and pass the whole batch array to the reducer
once. The reducer checks exact canonical scope coverage, per-batch organization,
catalog/POS/read success and a consistent current-table POS group across probes;
missing, duplicated, foreign or failed batches retain
the entire old snapshot before any UUID, override or watermark update. By-ID
evidence outside a declared scope is invalid. Required by-ID reads also apply to
inactive unresolved tombstones. Sanitized evidence across all successful probes
is reconciled by version, including equal conflicts, before the whole-ledger
closure fence. Missing/moved/unknown orders in any scope still block every closure.
The original single-probe input remains usable only for snapshots whose complete
known scope fits one probe. No partial page may be persisted, and fresh staff or
configuration changes fence the whole reply. The future adapter must bound job
work/resume collection without reapplying early pages; no worker or HTTP loop is
introduced here. Discovery responses themselves retain PR 6's safe limits.
Identical evidence is idempotent.

Closure additionally requires server-established POS-order visibility for the
current scope and no relevant missing/moved/ambiguous order evidence. An unknown
order without table association conservatively blocks closure. This proof is
not a caller/Director DTO flag and is not inferred from a successful or empty API
reply. PR 6 cannot establish it, so its unverified observations cannot remove
the last known active UUID or clear a manual override. Once all prerequisites are
actually proven, explicit `Closed`/`Deleted` can remove exactly that UUID and its
override. Closing one of multiple orders leaves the rest occupied. Only closure
of previously known active orders can change the saved state to closed; an
initial empty response or an untracked historical closed order cannot do so.

Manual free records all currently active UUIDs without deleting their tracking.
Those same UUIDs stay suppressed across repeated/newer open replies, missing
responses and errors. A new UUID can occupy the table; explicit trusted closure
clears only its own override. Other staff status actions rotate the fence and
retain existing overrides. Actual waiter/free/booking actions are not wired to
these functions yet and retain their existing behavior.

The pure projection keeps today's priority: hidden/closed, occupied, cleaning,
reserved/pending, free. Syrve contributes occupied only when synchronization is
enabled for the current matching scope and an active UUID is not suppressed.
Closure removes only that contribution: manual occupied/cleaning/closed and
checked-in/approved/pending booking sources remain intact. Future dates use only
booking state, with hidden/closed availability preserved. There is no new automatic
cleaning transition or booking cancellation. Disconnected/foreign/disabled POS
state cannot contribute to the projection.

`orderVersions` and `localRevision` describe the required internal concurrency
contract; they are not new entity columns or a declaration that the existing
prepared schema can already persist this state. A future migration-owned adapter
must durably store/reload the version ledger and local fence before any worker or
status application is allowed. An active UUID without its watermark is rejected,
not silently assigned a fabricated version. Closed tombstones must not be pruned
while old evidence can still arrive. Prepared migrations remain subject to the
final reviewed production audit/adoption path; this PR changes no database.
The policy does not truncate cumulative saved UUID/version sets to one response.
Tests run 2100 and 4201 tracked UUIDs through separate probes using the actual
client with mocked upstream replies, then close the complete set in one reduction.
Unknown tombstones remain reachable, and a missing/failed/ambiguous later probe
cannot publish early closures or clear overrides. No real provider request runs.

Synthetic sequences test multiple/spanning orders, partial closure, initial and
later empty responses, offline/deleted/missing tables, every required read failure,
stale/unknown/conflicting versions, closure/reopening tombstones, manual free/new
orders, change/restore and local/configuration/identity fences. Frozen snapshots
verify no mutation or mutable aliasing. Projection tests cover all booking/manual
priorities and future dates. Neither a real Syrve restaurant nor production
Neon/Render/configuration is accessed; all protected areas remain unchanged.

### PR 8a durable state preparation boundary

`CreateSyrveDurableState2026093000050` owns two separate tables:
`syrve_table_sync_states` captures the UUID binding, configuration revision and
local revision; `syrve_order_versions` retains each order's safe integer version,
usable/unknown outcome and sanitized fingerprint, including inactive tombstones.
Primary/foreign keys prevent duplicate or orphaned ledger rows; PostgreSQL checks
bound versions to JavaScript's safe range and reject invalid outcomes/fingerprints.
The existing entities need no new mapped columns. No legacy state is backfilled
with invented versions, and no physical table, booking or credential is changed.

`SyrveStateStore` is an internal, unregistered adapter. Capture, complete observation
application and staff-state recording use the existing short settings transaction,
then lock the existing physical UUID, link and state in that order. HTTP never runs
inside these transactions. Ledger, active/suppressed sets and local revision commit
atomically. The adapter reloads all saved rows and validates them before writes;
an active legacy UUID without a durable watermark blocks preparation rather than
silently dropping it. Captured membership, watermarks, caller proof flags and next
revisions are not authoritative. The freshly locked database state and server
generated revisions are used for every transition. No table insert/upsert or
physical status change occurs.

Configuration changes reject old requests. A new capture for the same immutable
UUID binding adopts the new configuration revision and rotates the local fence
while preserving all tracked versions and suppression. A changed UUID binding or
disconnected setting is rejected. Storage does not truncate cumulative state to
the HTTP response limit; it captures the complete bounded observation plan and
applies all results in one transaction. Incomplete/failed batches publish no early
UUID, watermark or override changes. Trusted POS visibility is not established in
this stage: the adapter hard-codes it to false, so no observation can remove known
occupancy or suppression. There is no proof setter or activation switch.

The reversible migration is registered only for the guarded disposable CI schema,
not production startup. Down requires an active transaction, locks both tables,
and refuses to destroy even a saved fence before the first order. An operator
must separately retire bindings before dropping durable history. Automatic
disconnect retains the existing links and state. Production schema adoption
remains a separately reviewed final step.

Regression tests cover restored state, staff changes before the first order,
simultaneous/replayed observations, full rollback after a late write failure,
reconfiguration, incomplete batches and 4201 tracked UUIDs. Database-reference CI
runs the compiled adapter on actual PostgreSQL, closes and rebuilds its connection
pool, validates tombstone replay and constraints, and tests guarded down/up. Its
synthetic visibility fixture is confined to test setup. No real Syrve/Render/Neon
request is made. Controller/service/module callers, staff button behavior, map
reads, polling and all protected product areas stay unchanged. The next PR must
join staff-state recording and existing MOLO actions in the same transaction
before any worker or effective-status application is permitted.

### PR 8b transactional staff action boundary

`TablesModule` imports the small `SyrveStaffActionsModule`, which exports only
`SyrveStaffActionsService`. It depends on the existing DataSource/settings store,
not the integration module, client, credentials or table module. There is no
module cycle and no upstream HTTP call. The state adapter remains internal and
unregistered. Its transaction-only recorder rejects managers outside a transaction.

All explicit staff status commands use the same callback: `setStatus`, the legacy
number route, waiter status and the occupied/cleaning/free/open/close aliases.
The coordinator acquires the existing bounded settings fence; the callback locks
the physical UUID without a nullable join, reloads its zone, reads today's active
bookings and saves only `{id,status}`. The adapter then locks the link/snapshot,
reloads the ledger and records the action in that same transaction. Both writes
commit together, or both roll back. No stale table number/geometry is saved.
The prepared number route still rejects number-based changes as before; the
unprepared legacy route retains its existing create/status behavior.

The action type comes from the requested command, not the resulting status.
Waiter free therefore suppresses known POS IDs even when checked-in guests keep
the physical table occupied or an approved/pending booking restores its status.
Bookings, history and notifications are never written here. All successful staff
commands rotate the fence, including same-status and change-and-restore actions;
invalid/disallowed/missing-table actions change neither physical nor POS state.
Automatic booking lifecycle writes do not call this hook.

Error/offline and disconnected configurations retain their bindings and allow
local actions; disconnected settings may have no selected organization, so the
stored link's immutable organization is used. Revision rebasing retains the
ledger and suppression. An absent legacy link/configuration schema or an unlinked
table keeps ordinary MOLO behavior. If configuration/links are prepared but durable
storage is temporarily absent, the same transaction rotates the configuration
revision and copies only existing active IDs into manual suppression for a free
command. After schema recovery, an old capture is rejected and the unchanged
watermark ledger is adopted; no history is invented or truncated. Corrupt or
foreign durable state blocks the whole action rather than half-saving it.

Tests exercise the actual TablesService/coordinator, every status entry point,
booking outcomes, local/configuration fences, restart, failed physical/late
durable writes, offline/disconnect, uppercase UUIDs, unknown bindings and
concurrent observation/manual commands. The guarded disposable PostgreSQL CI
validator runs real repository/locking/booking queries and a late failure trigger,
checks restart and temporary schema recovery, then removes its synthetic fixtures.
No migration/schema/production registry changes, worker, activation or effective
status reads are included. Unified role/date projection remains the next stage.

### PR 8c shared role/date status reads

`TablesModule`, `MapModule` and `BookingsModule` import the small
`TableStatusProjectionModule`. Its only export is the common status engine;
there is no integration-module cycle, controller, worker or HTTP client dependency.
`/tables`, full/public flat maps, nested map-zone tables and
`/bookings/table-statuses` use this engine. Each map response shares one captured
POS contribution for its flat and nested copies. Existing public filtering,
physical map identities, API fields and booking conflict details are preserved.

Raw current-table reads keep the existing manual-status/visibility representation.
For today's booking window, the unchanged priority is hidden/closed, occupied,
cleaning, selected-window pending/approved conflict, free. Physical pending or
reserved does not invent a conflict in another time window. Date/time calculation,
the 15-minute cleanup boundary and availability-block overlay remain unchanged.
Future windows skip the POS source entirely and use only their selected bookings
while respecting hidden/closed tables and zones.

The production `SyrveStatusReadService` has a private gate returning false: no
environment variable, saved credential or request can activate it in this stage.
Disabled reads execute zero Syrve feature queries and preserve the existing
MOLO results. The internal read adapter is neither a provider nor an export.
Only synthetic injected sources in tests exercise its prepared behavior.

That adapter reads settings, immutable UUID links, durable state, the complete
order-version ledger and physical status/version inside a PostgreSQL REPEATABLE
READ, READ ONLY transaction with a five-second statement timeout. It never calls
the write-capable capture adapter, creates state, rebases a revision, repairs rows,
prunes tombstones, locks for writing or contacts Syrve. A changed/foreign scope
contributes nothing. Missing/corrupt saved occupancy raises a fixed Ukrainian
503; an untouched unknown binding needs no state creation. Error status can retain
last-good state only within the same configuration revision; disconnected or
unselected settings contribute nothing.

Prepared POS can only add occupied from an unsuppressed active order. It cannot
clear manual/check-in/booking state, override hidden/closed state, cancel a booking
or affect future windows. Staff free suppresses existing UUIDs; a different new
order UUID may add occupied later. Scope and physical status/update-time checks
reject mixed versions; duplicated flat/nested UUIDs with differing physical
frames decline POS on every copy. The frame also includes table visibility and
the zone UUID/visibility/closure actually used by each representation: a zone-only
update does not advance the table timestamp. Nested capture/projection both use
the loaded parent zone. These are coherent snapshot checks, not a
promise that concurrent network responses arrive in commit order.

Regression tests cover the legacy priority matrix, actual role read services,
booking details and cleanup boundary, availability blocks, manual suppression,
new orders, scope changes, mixed versions, no response leaks and real Nest DI.
The guarded disposable PostgreSQL validator exercises the compiled reader and
actual table/map/booking/staff services, a rejected write in READ ONLY mode,
restart, 4201 additional tombstones, missing ledger and configuration changes.
No migration/schema/runtime registry changes, frontend/assets/polling changes,
Render/Neon/production operation or real Syrve request is part of this stage.
Activation and automatic observation persistence require a separate next PR.

## Required regression gates

PR 1 covers controlled failures, read-only diagnostics, actual role guards,
encryption, secret exclusion and synchronization staying false. Existing full
backend/frontend suites cover current staff/booking behavior and protected polling.
The final integration must additionally exercise these end-to-end scenarios:

1. New order on a linked existing table contributes occupied.
2. Explicit closure removes that contribution; eligible MOLO table becomes free.
3. Staff free while the order stays open follows existing MOLO booking rules.
4. Repeated observation of that ID does not reoccupy the table.
5. Explicit old-order closure clears only its override.
6. A different new order ID can occupy the table again.
7. Unknown Syrve table never inserts a MOLO table or changes another table.
8. Linked rename changes only the number; physical identity/location remain fixed.
9. Duplicate target number blocks the entire rename, including concurrent requests.
10. Offline Syrve does not block MOLO operations.
11. Timeout, 401/403/429, malformed/partial response and stale reply preserve last good state.
12. Waiter manual occupied/free behavior remains, including checked-in bookings.
13. Booking statuses and future-date booking views retain their existing behavior.
14. Existing frontend polling remains exactly 15 seconds.
15. Protected map assets, geometry, colors, click zones and image paths are unchanged.

Also test multiple orders, POS sleeping/recovery, deleted/missing tables, unknown
order status, permission loss, concurrent manual-free/poll, disconnect during a
request, and multiple backend instances. Missing orders are never treated as closure.

For every PR: backend/frontend `npm ci`, builds and tests, `git diff --check`,
`git show --check HEAD`, protected-path diff review, fresh CI and Codex review on
the current GitHub HEAD. Pending CI/review means the PR is not ready. Never merge.

### PR 9 disabled worker preparation

The existing Syrve integration module registers a 15-second scheduler service,
but its private gate returns `false`. A tick returns before settings reads, lease
creation, HTTP, observation persistence or logging. Credentials, environment
flags and Director requests cannot enable it. `syncEnabled` and the POS status
read source stay hard-disabled. There is no activation DTO or controller route.

The internal runner reuses the existing credential decryptor and bounded Syrve
client. It captures the entire durable ledger and probes every planned scope of
at most 2000 saved active/unknown order UUIDs. One table commits only after all
its scopes are collected and validated; incomplete scopes publish no early
membership, watermarks or manual suppression changes. Observed closure remains
non-authoritative because POS visibility is still unverified.

`CreateSyrveWorkerState2026100100060` owns separate per-integration bookkeeping:
a random lease token, configuration revision, expiry, failure count, next attempt,
last attempt, last successful observation, allowlisted error code and link cursor.
It is registered only in guarded disposable-schema CI, never in the deployed
application migration list or entity synchronization. Down requires a transaction
and an empty worker table; deleting a disposable integration cascades its state.
No production database, migration history, configuration or connection is queried.

Lease acquisition and all writes use short settings-fenced transactions and the
database clock. A live 90-second lease prevents another instance from starting,
even after reconfiguration. Expired leases can be reclaimed with a new random
token. Every state/bookkeeping write checks token, configuration and expiry; an
old caller cannot publish or clear its replacement's lease. No transaction or
connection lock is held across HTTP. Local staff revisions are checked again
under the same transaction that commits the complete table state and bookkeeping.

Each cycle shares one 45-second HTTP deadline and cancellation signal and covers
at most 32 tables in durable round-robin order. Earlier completed tables can
commit before the deadline, while an incomplete table retains its previous state.
The complete ledger is never trimmed to a transport page. Failure retries grow
from 15 seconds to at most 5 minutes; rate limits start at 60 seconds. Counters,
last good observations and cursor survive process/pool restarts. Nest module teardown aborts
active HTTP and waits for the runner to release its lease. Process loss leaves
a bounded lease that the next instance can reclaim. Final activation must also
wire termination signals to Nest teardown; server bootstrap is unchanged here.

`last_success_at` means a complete checked observation was processed, not proof
of full POS visibility or authorization to clear a table. Unknown, malformed,
offline, timed-out, revoked or stale observations preserve known occupancy and
staff suppression. Only fixed diagnostic codes are persisted; API logins,
upstream tokens, response bodies and exception messages are never saved there.

Tests exercise the actual store/reducer/client and mocked upstream transport.
The guarded PostgreSQL CI validator additionally checks independent pools,
no idle HTTP transaction, real waiter free during a probe, expired-lease fencing,
restart backoff, atomic rollback after a late bookkeeping failure, 4201 saved
UUIDs, reconfiguration and refused/empty migration rollback. Frontend, booking
lifecycle, staff buttons, protected assets and exact 15-second polling are unchanged.
Final activation still requires a separately approved stage, proven visibility
and a reviewed production schema-adoption path.

### PR 10a read-only readiness and schema preflight

The Director's existing Syrve dock reads `GET /syrve-integration/readiness` only
while its settings panel is open, with an explicit refresh button. JWT/Director
role protection and `Cache-Control: no-store` cover the route. Reads use one
REPEATABLE READ / READ ONLY transaction, bounded lock/statement timeouts and
a fixed catalog search path. They take no write fence, repair no ledger, decrypt
no credential and make no upstream request. Stale/failed/invalid responses clear
the displayed result; a changed configuration cannot reuse an old readiness view.

A frozen PostgreSQL 17 catalog reference covers every prepared migration's
owned columns, defaults, validated constraints, index definitions/validity,
function bodies and trigger definitions/enabled state. Object names alone do
not establish readiness. History must match an existing/fresh baseline and an
exact recorded prefix of the six prepared migrations. Unrecorded existing objects,
recorded missing objects, partial structures, drift and unknown history require
an audit. No baseline or migration history row is adopted automatically.

Readiness additionally inspects saved connection flags, exact physical/identity
links, ambiguous table numbers and the complete ledger/local scope. It reports
fixed codes and no credentials, order IDs, SQL definitions or database target.
Order-access rights and complete POS visibility remain explicitly unverified;
activation and synchronization remain false even with a verified local schema.

The standalone `scripts/syrve-schema-preflight.mjs --check` validates the private
Neon target and forces verified TLS, session/transaction read-only and no entity
synchronization or migration executor. It produces an ordered diagnostic plan
and opaque snapshot fingerprint. Applying migrations is deliberately unavailable
until a separately reviewed audit of the real target provides the missing
production baseline. See `syrve-schema-adoption.md` for the concrete sequence,
exit codes and guarded rollback boundaries. This PR adds no schema migration
and changes no production registry, deployment or database.

### PR 10b1 explicit Director order and POS diagnostics

This stage starts from fresh main `ee0029a088181fa0ece6dd8381c477192574522e`,
after the manual merge of #277. The separate approved database operation has
applied the six frozen migrations and independently verified their catalog,
original rows/history and all 60 physical UUID/map bindings. This code change
performs no migration, database operation, deployment or real Syrve request.

The Director can explicitly request `POST /syrve-integration/orders-diagnostics`
with only the saved configuration revision. The route retains JWT/Director and
no-store protection, the existing prepared/saved mapping guards, and the full
configuration/link/manual/table fingerprint around the bounded HTTP probe.
It reuses the read-only order observer; no transaction spans HTTP and no settings,
logs, ledgers, overrides, physical table or booking is written by the check.

The response projects only six fixed checks, safe diagnostic codes and counts
of linked/unknown tables, observed order states, unresolved tracked orders and
alive/sleeping/offline/unknown terminal groups. It excludes order/table/terminal
UUIDs, tokens, credentials, customer records and arbitrary provider/driver text.
An explicit closure count is evidence about orders; it never establishes that
a physical table is free. Empty, missing, failed or partial reads retain unknown
state. POS version, complete visibility and initialization remain unverified.

The panel performs no order request when opening, changing settings or refreshing
readiness. Its button is available only for a prepared saved connection with
confirmed links and no parent operation. One in-flight request is permitted;
closing, scope changes, recheck or disconnect discard its late result. Retry
clears old success, malformed/inconsistent/other-scope responses are refused,
and displayed messages are fixed Ukrainian text. The existing 15-second polling
and all protected maps, photographs, staff and booking behavior are unchanged.

Saved-connection summary and connection drafts are separate views. Starting a
new/edit flow unmounts both saved readiness and order panels, invalidating late
diagnostics even when the saved revision has not changed yet. Draft credentials
or a different selected organization can never be presented beside old reading
evidence. Cancel/reopen shows the saved summary with fresh panels; a successful
confirmed save exits edit mode using the newly saved revision.

These diagnostics are transient reading evidence, not an activation receipt.
`syncEnabled`, worker and POS-read gates remain false. Final activation still
requires a separate implementation with verified POS-created order visibility
and explicitly scoped initialization when required; no completeness proof,
activation button or caller-controlled proof setter is introduced here.

### PR 10b2 table diagnostics and POS version compatibility

This stage starts from fresh main `7c20c0f4e330640e00c3eca10dfcbb6be6b40796`,
after the manual merge of #278. The product scope is table statuses only. Syrve's
open/closed account records are an internal source of occupancy evidence; MOLO
does not add order management, items, payments, sums or customer details. The
Director diagnostics response and UI now contain table/register counts only;
the previous aggregate order counters are removed. Readiness and catalog text
also describe table status checks rather than a separate order feature.

Official OpenAPI was downloaded again on 2026-10-02 from
https://api-eu.syrve.live/api-docs/docs, SHA-256
`e7f6671de2f95ce4c6de543e3fcdf096ab22f08466c56544b789f9ef00470b6d`.
Its terminal-group schema includes nullable `posVersion`. The documented minimum
for table/by-ID reads is 7.4.6; `init_by_table` requires 7.7.1 and the separate
loading-data permission. Command status uses `organizationId`/`correlationId`
and distinguishes InProgress, Success and Error. This stage invokes neither
initialization nor command-status, wake or webhook endpoints.

The existing bounded read probe now retains only a strictly numeric three/four
component POS version from the selected organization's terminal groups. Absent,
null, malformed, suffixed or arbitrary version text becomes unknown and is never
projected. Numeric comparison handles 7.10 correctly and preserves distinct read
and initialization version prerequisites. Organization RMS/cloud API versions,
successful state reads and order timestamps do not establish the installed POS version.

Version compatibility is counted per confirmed physical table, using that
table's unique, non-deleted catalog entry and active terminal group. A missing,
deleted, sleeping, ambiguous or foreign-group table stays unknown; a supported
unrelated register cannot supply evidence for it. Failed connection/group/section
reads invalidate every version count. A fresh version finding is independent of
successful access to table-state data and never establishes permissions or completeness.

The saved-revision/link/manual/table fingerprint encloses both table and version
diagnostics, without a database transaction over HTTP or a write to any table,
settings, audit, durable ledger or overrides. Frontend decoding verifies both
per-table count totals, version-state consistency and the ordered prerequisite
relationship; failed-scope and legacy/inconsistent responses are refused. It
retains only the table contract and rejects activation-like flags. Existing
explicit-click, draft/unmount, parent-busy and stale-response guards stay in place.

Even when every mapped POS version supports the required operation, complete
table-state visibility remains unverified, initialization has not been performed,
and synchronization/activation/worker/POS-read gates remain off. The next activation
stage still needs explicitly scoped loading, confirmed command results and fresh
state verification; version support alone is never an activation receipt. No
migration, database operation, deployment, environment change or real Syrve
request is performed during development. Protected assets, table geometry/numbers,
waiter behavior, booking flow/status priority and exact 15-second polling are unchanged.

### PR 10b3 explicit loading of confirmed table state

Starts from merged #280, main `4ab8c143ad3867129f0fb900e29228582683634a`.
The product still exposes table statuses only. The documented POS account-loading
command is an internal prerequisite, not an order-management feature. The public
OpenAPI was fetched again on 2026-10-02: `init_by_table` requires organization,
terminal group and table UUIDs, POS >=7.7.1 and `Orders: loading data`; its UUID
acknowledgement is not completion. `commands/status` requires `Commands` permission
and exactly the acknowledged organization/correlation. Only `Success` confirms a
command; `InProgress`, `Error`, malformed replies and HTTP 410 do not. A 410
correlation is never polled again. Raw exceptions and error reasons are discarded.

Two owner-only, no-store routes accept only a saved revision for preview, then
revision, opaque proof and literal boolean confirmation for loading. Scope IDs,
credentials, caller visibility flags and arbitrary transport destinations are
forbidden. Both stages fetch the current catalog, POS versions, availability and
bounded table/tracked-record reads. Every saved table must belong uniquely to a
nondeleted, active, alive, compatible group. A sleeping, missing, moved, duplicate
or unrelated group cannot validate a table. The signed five-minute proof binds
exact table/group/version membership, full saved link/manual/table fingerprint,
configuration revision and authenticated Director identity/session version, with
a separate HMAC purpose from mapping proofs. It contains no credentials.

After fresh confirmation checks, a short PostgreSQL transaction locks settings
then physical rows, checks the fingerprint, advances the saved configuration
revision and claims the existing worker lease for 90 seconds. This consumes all
old-revision previews across processes/restarts before the first loading command.
The same lease excludes another loading operation or future worker runner. Old
worker success/backoff/cursor metadata is cleared for the new revision; loading
never records a worker success. No new
schema/migration is needed. A failed final lease write rolls the revision back.
No transaction spans HTTP. A replaced, expired or changed-scope lease is refused
before each command/status query and after the fresh post-load read. Old-token
release cannot clear a replacement lease. An uncertain outcome retains its bounded
lease until expiry and requires a fresh manual preview; it is never auto-retried.

The confirmed operation has a shared 45-second/25-request budget including both
auth sessions, catalog/availability reads, initialization, status polls and fresh
reads. Each request retains the existing 12-second, 1 MiB, JSON, TLS and no-redirect
limits. At most 100 saved tables/four groups are prepared. Each group is initialized
once and its command polled at most six times with 250 ms spacing. The shortest
remaining successful path must fit the budget before the proof is consumed;
additional in-progress polls or a large tracked ledger can still exhaust it and
yield an unknown result. Partial group completion never becomes table-state proof.
There are no terminal wake, webhook, menu, payment or map-layout calls.

The Ukrainian Director panel starts only on a click, displays the physical table
numbers, requires a separate acknowledgement and consumes its proof immediately
on submission. Double clicks, drafts, close/unmount, changed scope, parent actions
and late replies are fenced. Sibling actions and old diagnostic evidence are
blocked while loading. Saved settings are refreshed after submission failures and
on reopening the dialog because an accepted operation can outlive its closed panel.
Strict decoders retain only bounded counts, timestamps and fixed result codes.

The result is transient command/read evidence only. It does not establish complete
future POS visibility, create a trusted activation receipt, update table status,
rename a table, change bookings/overrides, write an order ledger or mark worker
success. Settings revision and lease are the only writes in the explicitly
confirmed runtime action. All completeness, synchronization, activation, worker,
effective POS-read and reducer visibility gates remain false. Final activation
still requires a reviewed durable visibility contract and end-to-end regression
checks; this prerequisite alone cannot enable synchronization.

Validation includes mocked actual transport, role/DTO guards, stale/session/proof
cases, frontend acknowledgement/lifecycle/refresh and disposable PostgreSQL
cross-instance claims, restarts, lease replacement, atomic rollback and data
preservation. Development performs no production/Neon writes, live restaurant
requests, environment edits or deployment. Protected maps, photos, geometry,
numbers, booking/waiter behavior, status colors and exact 15-second polling stay
unchanged.


### Director activation and current runtime (after PR #282)

This task starts from fresh main `b4f5e70ef8b422070cee50abbfd819696aafacad`.
The Director can preview only the saved table bindings, acknowledge recurring table-state
loading and explicitly enable automatic occupancy. The activation HMAC purpose differs
from manual loading and catalog confirmation. Actor/session, configuration, complete
local/manual fingerprint, exact upstream groups/tables/POS versions and five-minute
expiry are checked before a revision/lease claim. Accepted attempts consume that revision
across instances and restarts, including failures. Only confirmed commands plus a fresh
complete read can commit durable consent; no initial table status/booking/ledger is overwritten.

`CreateSyrveActivation2026100200070` creates `syrve_sync_activation` with default-off
consent, a configuration revision, binding fingerprint, server-derived loading plan,
actor hash and consent time. Rollback refuses every saved receipt, including disabled
ones. It runs automatically only in the guarded disposable schema reference. Production
adoption needs a newly reviewed backup/audit/rehearsal/application plan for this seventh
migration. The earlier approved six-migration application does not cover it. Existing
six catalog fingerprints are unchanged; the seventh is frozen against PostgreSQL 17.5
and must match the real PostgreSQL 17 CI reference. No production migration, activation,
credential change, deployment or real restaurant request is performed in this task.

A saved receipt binds credentials, organization, UUID bindings and physical numbers,
while manual status/revision and the cumulative ledger remain independent. Settings
revision changes invalidate consent. Changing/rechecking a live connection or manually
loading tables requires disabling auto-status first; disconnecting invalidates it directly.
An ordinary table rename/delete or an invalid saved plan makes consent ineffective
without breaking public map/manual status reads or the Director's revision/status
read. New preview, repair and explicit disable remain available; an old binding can
never authorize worker commands or occupancy while it differs from the saved scope.
Disabling uses the common settings transaction fence and rotates the configuration.
Every in-flight runner loses write/command permission, while an unresolved bounded
lease stays until release/expiry so another instance cannot overlap it.
The runtime transport reports command start and terminal Success/Error internally.
An unresolved initialization (pending, expired, timed out or revoked before status
confirmation) retains its ninety-second lease; retry/backoff cannot release that
exclusion early. Read-only failures and confirmed terminal commands release normally.

Each worker observation revalidates the consented POS group/version/table, calls scoped
`init_by_table`, confirms `commands/status`, then performs full table and saved-ID reads.
A private WeakMap transport receipt binds the exact returned probe to the lease/local
revision and deadline; copied, serialized, mutated, foreign or expired probes cannot
certify visibility. Ordinary read-only observations and manual loading still cannot
supply it. Every restored saved-ID scope, including active/suppressed/unresolved sets
over 2000 IDs, must succeed before the reducer applies any part. The reducer keeps
its whole-ledger unknown/conflict/tombstone fence and permits explicit closure only
with fresh receipts for every scope. Missing responses never imply closure.

The 15-second scheduler, 45-second cycle deadline, 90-second PostgreSQL lease, 32-link
fair cursor and persistent bounded backoff remain. Each individual read/load stays
limited to 25 requests; the cycle additionally shares an 800-request budget across
all nested authentication/load/read calls. Larger/slow observations fail closed,
retain the last confirmed occupancy and continue through the fair cursor later.
The read source checks the same current consent in its repeatable-read, read-only
physical/ledger frame. POS contributes occupancy only; physical/manual status, booking
priority, hidden/closed rules, future dates and waiter suppression retain their policies.

The Director UI exposes only table numbers, conditions and enable/disable actions.
Opening it reads local settings only. Explicit preparation never enables or initializes;
acknowledgement and a separate enable action are required. Proofs clear on submission,
scope changes and close; late responses are discarded, duplicate clicks are blocked,
and accepted attempts refresh the consumed saved revision before sibling actions unlock.
No order/menu/customer/payment interface is added. Maps, photographs, geometry, table
numbers, click zones, status colors, waiter buttons and existing polling stay unchanged.
