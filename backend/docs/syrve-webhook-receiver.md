# Syrve bill notification receiver

`POST /api/syrve-webhook/:configurationRevision` receives `TableOrderUpdate`
notifications. `eventInfo` is the OpenAPI `TableOrderInfo` wrapper, normalized
by the same parser as polling. Its integer `timestamp` is the provider version;
`eventTime`, item/customer fields and `TableOrderError` are not lifecycle evidence.
The endpoint accepts a notification array or one envelope, at most 100 events.
The existing Nest JSON body limit (100 KiB) remains in force.

## Authentication and activation

The JWT-public route has its own mandatory authorization guard. Generate the
callback token on the backend with `syrveWebhookToken(configurationRevision)`
and pass it to Syrve's `authToken` setting. The receiver accepts that exact token
in `Authorization`, with or without `Bearer `. It uses constant-time comparison.
The secret derives from `SYRVE_CREDENTIALS_SECRET` with a separate HMAC domain;
it must never be placed in a URL, browser response, repository or log.
Neither an API login nor a Director JWT can authorize callbacks.

The organization and current configuration revision must match the saved
connection, and the Director's existing auto-status consent must still be valid.
Disconnecting, disabling or changing bindings revokes processing. This PR does
not configure `/api/1/webhooks/update_settings` or test write permission. After
deployment, register the HTTPS receiver URL and token through a backend-only
setup action or a trusted Syrve operator. Read existing settings first to avoid
overwriting another integration's callback.

## State policy

Notifications are deltas, not complete table lists. Other active bill UUIDs are
retained. A newly associated open bill occupies its physical table once; closing
the last confirmed active bill frees that table. Explicit transfers update the
source and mapped destinations in the same transaction. Real POS status is
preserved in the shared fingerprint. No booking/banquet or POS write is made.
Repeated bill updates, equal versions and older versions cannot reapply a
physical action. Equal-version contradictions remain unresolved. Historical
unknown transfer repairs preserve physical status and remove association only
when membership can be updated atomically.

All relevant physical rows use captured status and full PostgreSQL
`updated_at::text` fences, including microseconds. The durable bill watermarks
are checked across every mapped association both for callbacks and polling,
so an old poll cannot reopen an unseen destination after a newer transfer.
The entire callback batch rolls back on a changed fence or database failure.
Distinct versions in one delivery are processed in order; equal-version
conflicts are reconciled before any action.

## Cash-group evidence and recovery

The existing initialized batch transport issues a private topology receipt only
after complete successful reads. Catalog UUIDs, active groups, `isAlive` and
initialized visible tables are checked. It expires at the earlier of dictionary
expiry or 120 seconds after the availability response. Callbacks add no Syrve
API calls and do not alter request quotas or the exact 15-second polling interval.
Offline availability and credential authorization failures revoke cached proof.

This cache is intentionally process-local. A restarted or separate cold instance
returns 503 until its worker completes a fresh check. Expired, deleted, missing,
uninitialized or mismatched destinations likewise return 503 and consume no bill
event. HTTP 200 acknowledges committed processing, including safe duplicates
and ignored non-bill events. Whether Syrve retries failed deliveries must be
verified in the live acceptance test; normal polling remains the recovery path.
Large deliveries rejected by the existing body limit also recover via polling.

No migration is required: the existing per-link versions, memberships and local
revisions provide durable deduplication. Run the unit/HTTP checks with the normal
backend suite. `backend/scripts/syrve-webhook-validation.mjs` additionally runs
only against the guarded disposable loopback PostgreSQL CI database, testing two
pools, rollback on the second transfer write, microseconds, ordering, duplicates,
multiple bills, cold cache, stale polls and unchanged bookings.
