# Syrve: audit, safety boundaries and staged implementation

Initial audit: `e5a9a8cc417cc18f8335546a8d65b9ef5cf85d11` (2026-09-25).
PR 3 starts from fresh main `4740f75ac3e941a048d2bc7fe07ce51ef568bb65` (2026-09-30),
after manual merges of PRs #261 and #264. Client diagnostics, link schema preparation
and read-only catalog preview are implemented. Real Syrve is not connected or
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
  no actual mapping writes, scheduler, order observations, manual-action hooks or
  status integration are enabled.
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
- `GuestApp` and `AdminVisualTablePlanner` match static map slots by table NUMBER.
  `WaiterTablesByLocation` and `AdminTablesByLocation` group by number ranges.
  A database-only rename would therefore change the physical association/location.
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

Separately add an immutable physical `mapKey` to existing tables before renaming:
backfill from the current verified map slot, use UUID for actions and current
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
| 3 | Read-only terminal/section catalog, deleted/duplicate/unmapped diagnostics and proposals by unambiguous numbers (this PR); no mapping writes or migrations | Syrve client/catalog/service/controller/DTO/module and tests, `frontend/src/api/syrve.ts`, Director dock/preview panel/tests |
| 3b | Explicit UUID mapping confirmation; singleton/configuration revision and stale-preview fencing introduced with the first write transaction | integration entity + migration/registry, mapping DTO/service/controller, Director confirmation UI and PostgreSQL concurrency tests |
| 4 | Stable physical map identity and location before any rename; frozen geometry/asset comparison | table entity + migration, map/table API DTOs, `GuestApp.tsx`, `AdminVisualTablePlanner.tsx`, both `*TablesByLocation.tsx`, protected-map tests |
| 5 | Rename by persisted UUID link, only `tableNumber`, atomic conflict protection | Syrve rename service, table-number uniqueness migration if needed, DTO diagnostics and concurrency tests |
| 6 | Read-only order observation and POS/permissions diagnostics; classify explicit closure vs unknown | Syrve order client/observer and fixtures/tests; no status application |
| 7 | Pure state transition rules covering order sets, explicit closure, stale observations, manual overrides and priority | isolated Syrve state reducer and regression tests; no enabled worker |
| 8 | Transactional manual-action hooks and unified effective status reads, existing waiter/booking behavior retained | `TablesService`, map/status read services, dependency wiring and regression tests; sync remains off |
| 9 | Disabled-by-default backend worker, configuration fencing, one runner, backoff and durable last good state | Syrve worker/module/state service and failure/concurrency tests; no automatic activation |
| 10 | Final Director activation, complete diagnostics, regression hardening and reviewed schema-adoption path after a fresh production audit | Director dock/API, activation DTO/controller, migration operator/registry, diagnostics, operational documentation and full regression suite |

All paths above are under `backend/` unless prefixed `frontend/`. Boundaries may
be narrowed after each fresh-main review, never expanded to include unrelated fixes.
PR 4 is a prerequisite imposed by the existing implementation, not a redesign of
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
Connection saving still only saves the existing encrypted settings; no mapping/worker
is enabled. PR 3b remains a separate, newly authorized PR after merge and fresh main.

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
