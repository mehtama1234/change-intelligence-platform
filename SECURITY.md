# Security boundary

The local server defaults to `AUTH_MODE=demo` so the reader can be run without
an identity provider. In this mode, write requests may use the demo actor in
the request body or `X-Workspace-Actor` header. This is only for local
development.

For a deployed instance, set:

```sh
AUTH_MODE=token
AUTH_TOKENS_JSON='{"token-value":"workspace-member-id"}'
```

The internal aggregate operator view is separate from workspace membership. In
token mode, configure its actor allowlist explicitly:

```sh
OPERATOR_ACTORS_JSON='["operations-user-id"]'
```

The operator view exposes pilot counts and delivery status only. It does not
expose customer questions, review notes, source passages, or private workspace
content.

Operator warning limits are configuration, not hidden product judgments:
`OPERATOR_MAX_FALSE_ALERT_RATE` defaults to `0.4`, while failed refreshes and
delayed deliveries default to `0`. Source age uses `MAX_SOURCE_AGE_MS`. The
automatic policy uses `OPERATOR_WARNING_ACK_SLA_MS` (four hours by default) to
decide when an open warning is overdue.
operator response returns the observed value and threshold beside each warning.
Operator warning acknowledgments and resolutions require the same explicit
operator allowlist, an idempotency key, a note, and an audit receipt. The
warning record also preserves the assigned operator, escalation state, and
response time. Escalation creates a private notification-outbox record addressed
to that operator; dispatching it requires an operator token, an idempotency key,
and a note, and produces its own audit receipt. The default acknowledgment
deadline is four hours and is exposed as a timestamp so an operator can judge
whether the warning is overdue.

Notification delivery is disabled unless `OPERATOR_NOTIFICATION_DELIVERY_MODE`
is explicitly set to `webhook` and `OPERATOR_NOTIFICATION_WEBHOOK_URL` is
provided. Delivery uses bounded timeouts and attempts; exhausted failures are
marked `dead_letter` for operator action. The webhook receives only the
notification envelope, not customer workspace records or source passages.
Routes are configured explicitly through `OPERATOR_NOTIFICATION_ROUTES_JSON`:
`warningIds` routes global warning types, `workspaces` routes workspace-scoped
warnings, and `default` is the fallback recipient list. A workspace-scoped
notification carries only its workspace ID and warning summary. Operators can
manage the same settings through the authenticated `/api/operator/notification-routes`
command; changes are persisted, idempotent, and audited.
Each destination has a named ID and validated HTTP(S) URL. Notification records
store only the destination ID; the delivery worker records every attempt in a
separate ledger, including success, retry, or dead-letter outcome.
The operator delivery-health read model exposes counts, success rate, retry
count, latency, and recipient/workspace breakdowns without exposing message
bodies.
Workspace members receive a smaller `/api/workspace-delivery-health` read model
limited to their workspace. It omits recipients, destination URLs, error text,
and other workspaces; delivery health describes transport reliability, not the
truth or usefulness of the intelligence.
The `/api/workspace-service-report` adds the workspace’s configured cadence,
expected next delivery, overdue status, and recorded success-measure observations
under the same membership boundary.
The `/api/workspace-commercial-readiness` response is only a bounded decision
aid. It exposes its recommendation, evidence basis, and human-checkpoint flag;
it cannot create an `expand`, `continue`, `improve`, or `stop` decision by itself.

Write requests must then send `Authorization: Bearer token-value`. The server
ignores any actor ID in the request body and uses the server-side token map
before checking the member's workspace role.

Token-authenticated reads of workspace data use the same membership check. A
request without a token receives `401`; a signed-in user who is not a member of
the requested workspace receives `403`; a request without a workspace filter
returns only workspaces where that actor is a member. The domain evidence packet
and source-linked inspection endpoints are not customer-private workspace data.
The public packet intentionally omits workspace alerts, questions, evaluations,
and briefings; those are available only through membership-checked endpoints.
The demo reader keeps a manually entered token only for the current browser
session; production should replace this with an identity provider and secure
session cookie.

Token-authenticated write requests must also send an `Idempotency-Key`. A
retry with the same key replays the original result instead of creating a
second question, decision, publication, or acknowledgment.

The server stores questions, alert acknowledgements, publication records,
insight review decisions, audit receipts, and idempotency operations in a
SQLite database under `RUNTIME_DATA_DIR` using transactional writes and WAL
mode. The JSON files beside it are compatibility views for the current refresh
tools; production backups must include the SQLite database and its WAL files,
and restore tests must verify both the database and generated research
artifacts.

Use `npm run backup:runtime` with an explicit `BACKUP_DIR` to create a
checksum-manifested backup. Restore into an explicit `RUNTIME_DATA_DIR` with
`npm run restore:runtime`; the backup test exercises database and compatibility
ledger recovery before a deployment is trusted.

Operational probes are separate: `/api/health` is a liveness check, while
`/api/readiness` returns `200` only when the database is intact, the latest
refresh is recent and complete, source data is present, runtime synchronization
completed, and a valid backup manifest exists. A failed readiness check returns
`503` with the failing condition so an operator can act on it.

This token map is a small deployment adapter, not a replacement for an
identity provider. A production deployment should place a real identity and
token-validation service in front of the API, keep secrets outside the
repository, use TLS, rotate credentials, and retain audit logs.
