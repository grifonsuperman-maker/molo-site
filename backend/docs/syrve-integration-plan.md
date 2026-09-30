# Syrve: audit, safety boundaries and staged implementation

Audited main: `e5a9a8cc417cc18f8335546a8d65b9ef5cf85d11` (2026-09-25).
Only PR 1 is implemented with this document. Real Syrve is not connected or
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
- `syncEnabled` is hard-coded to false. No Syrve scheduler, table links, orders,
  manual order overrides or status integration currently exist.
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
- `activeSyrveOrderIds`, `manuallyFreedSyrveOrderIds` as validated UUID sets in jsonb;
  order metadata/timestamps sufficient to reject stale updates and prove closure.
- FK to an EXISTING MOLO table; unique MOLO binding and unique provider binding
  scoped to integration/organization. No cascade from Syrve to physical tables.
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
| 1 | Safe auth/organization client and diagnostics (this PR) | `src/syrve/syrve-client.ts`, service/module, `test/syrve-*.test.js`, `.env*example`, this document |
| 2 | Link/sync storage, uniqueness, configuration revision; reversible migration with explicit registration/application path | new Syrve entities/migration, integration entity/module, migration registry/bootstrap and schema tests |
| 3 | Read-only terminal/section catalog, deleted/duplicate/unmapped diagnostics, proposals by unambiguous numbers; explicit UUID mapping confirmation | Syrve client/service/controller/DTOs and tests, `frontend/src/api/syrve.ts`, `SyrveIntegrationDock.tsx` |
| 4 | Stable physical map identity and location before any rename; frozen geometry/asset comparison | table entity + migration, map/table API DTOs, `GuestApp.tsx`, `AdminVisualTablePlanner.tsx`, both `*TablesByLocation.tsx`, protected-map tests |
| 5 | Rename by persisted UUID link, only `tableNumber`, atomic conflict protection | Syrve rename service, table-number uniqueness migration if needed, DTO diagnostics and concurrency tests |
| 6 | Read-only order observation and POS/permissions diagnostics; classify explicit closure vs unknown | Syrve order client/observer and fixtures/tests; no status application |
| 7 | Pure state transition rules covering order sets, explicit closure, stale observations, manual overrides and priority | isolated Syrve state reducer and regression tests; no enabled worker |
| 8 | Transactional manual-action hooks and unified effective status reads, existing waiter/booking behavior retained | `TablesService`, map/status read services, dependency wiring and regression tests; sync remains off |
| 9 | Disabled-by-default backend worker, configuration fencing, one runner, backoff and durable last good state | Syrve worker/module/state service and failure/concurrency tests; no automatic activation |
| 10 | Final Director activation, complete connection/catalog/mapping/order diagnostics and regression hardening | Director dock/API, activation DTO/controller, diagnostics, operational documentation and full regression suite |

All paths above are under `backend/` unless prefixed `frontend/`. Boundaries may
be narrowed after each fresh-main review, never expanded to include unrelated fixes.
PR 4 is a prerequisite imposed by the existing implementation, not a redesign of
coordinates, photographs, click zones or colors. Do not combine occupied application
with a live worker before closure and manual override rules exist.

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
