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

The Director panel now provides **Підключити сповіщення для MOLO**, backed by
`POST /api/syrve-integration/webhook-setup` with the current revision and
`confirmed: true`. Existing auto-status consent must be enabled. This explicit
action reads settings, writes at most once, then verifies the saved URL, token
and all four supported bill statuses. An already matching configuration is
read without another write and does not claim newly tested write permission.
It never claims callback delivery or changes a MOLO table/booking/POS bill.

The callback origin comes from server `SYRVE_WEBHOOK_BASE_URL` or Render's
automatic `RENDER_EXTERNAL_URL` ([Render documentation](https://render.com/docs/environment-variables)).
Browser URLs, Host and forwarded headers are not used. A nonempty foreign
receiver is refused; an earlier MOLO revision is replaced only when both its
origin/path and its HMAC token prove ownership. Other webhook filters are
preserved. Syrve offers no compare-and-set for these settings, so its upstream
read/write is not atomic with concurrent changes by a separate operator.
Mutation failures are not retried automatically. After uncertain failure,
the next explicit attempt rereads settings before deciding whether to write.

The organization and current configuration revision must match the saved
connection, and the Director's existing auto-status consent must still be valid.
Disconnecting, disabling or changing bindings revokes processing. Re-run the
Director setup after enabling consent for a new revision. The same saved scope
and Director-session guards are checked before every quota-paced request.
Only a successful update and matching readback report write permission as
confirmed. A live POS test must still confirm opening, transfer and closure.

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
An unknown notification without table UUIDs stores its watermark on every link,
as polling already does. It conservatively blocks last-bill release until a newer
usable version scopes the UUID, and survives a restart without allowing an older
opening to overwrite staff status.

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
initialized visible tables are checked. Normalized bill evidence also fences
older callbacks and blocks a last-bill release when the complete read discovered
another bill that the worker has not yet committed. Customer and item fields are
excluded, and this proof never projects cached physical statuses.
It expires at the earlier of dictionary
expiry or 120 seconds after the availability response. Callbacks add no Syrve
API calls and do not alter request quotas or the exact 15-second polling interval.
Offline availability and credential authorization failures revoke cached proof.
The pinned proof is checked again before commit, so revocation or replacement
during database writes rolls back the callback as well.

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
