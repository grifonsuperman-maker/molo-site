# Syrve: audit, safety boundaries and staged implementation

Initial audit: `e5a9a8cc417cc18f8335546a8d65b9ef5cf85d11` (2026-09-25).
PR 5 starts from fresh main `f9092f500de0106c01fa44b3174d7f4aa2e3bc51` (2026-09-30),
after manual merges of PRs #261, #264, #265, #266, #267 and #268. Client diagnostics, link schema preparation,
read-only catalog preview and explicit UUID confirmation are implemented. Real Syrve is not connected or
queried during development; tests use synthetic credentials and mocked fetch.
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
  No scheduler, order observations, manual-action hooks or status integration are enabled.
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
| 5 | Rename by persisted UUID link, only `tableNumber`, atomic conflict protection (this PR); internal methods remain unreachable from HTTP/automatic callers | Syrve rename service/plan, canonical table-number uniqueness migration, read-only Director diagnostics, partial status saves and concurrency tests |
| 6 | Read-only order observation and POS/permissions diagnostics; classify explicit closure vs unknown | Syrve order client/observer and fixtures/tests; no status application |
| 7 | Pure state transition rules covering order sets, explicit closure, stale observations, manual overrides and priority | isolated Syrve state reducer and regression tests; no enabled worker |
| 8 | Transactional manual-action hooks and unified effective status reads, existing waiter/booking behavior retained | `TablesService`, map/status read services, dependency wiring and regression tests; sync remains off |
| 9 | Disabled-by-default backend worker, configuration fencing, one runner, backoff and durable last good state | Syrve worker/module/state service and failure/concurrency tests; no automatic activation |
| 10 | Final Director activation, complete diagnostics, regression hardening and reviewed schema-adoption path after a fresh production audit | Director dock/API, activation DTO/controller, migration operator/registry, diagnostics, operational documentation and full regression suite |

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
