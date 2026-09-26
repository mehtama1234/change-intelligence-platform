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

The operator portfolio readiness view compares only aggregate workspace signals;
it remains a human decision aid and does not automate expansion or stop decisions.

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
Readiness snapshots are recorded per workspace and the history read model shows
only that workspace’s counts and recommendation changes.
Delivery correction feedback follows the same membership and idempotency rules
as delivery review. It is stored as workspace-scoped pilot history, is visible
only in that workspace’s learning report, and is a request for research
follow-up rather than an automatic change to shared evidence.
Customer refresh-handoff notifications are also workspace-scoped. The
`/api/workspace-delivery-notifications` read model exposes only the notification
state, bounded subject/body, delivery identity, and timestamps for the caller’s
workspace. A suppression preference changes state to `suppressed` while keeping
the historical record; it does not expose another workspace’s delivery or
source content.
An owner or researcher may choose `in_app` or configure an HTTP(S) webhook
through the authenticated notification-preference command. The read model never
returns the configured webhook URL. Webhook delivery sends only the bounded
handoff envelope, uses a timeout and maximum-attempt limit, and records attempts
under the workspace boundary; exhausted failures become `dead_letter` for
follow-up rather than being silently discarded.

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
The `/api/workspace-export` endpoint requires one explicit workspace scope and
the same membership check. It exports only that workspace's private records
and bounded source links; it removes configured webhook URLs and does not
export another workspace's records.
The `/api/workspace-retention` endpoint shows the private-record counts for one
member workspace. The `/api/workspace-deletion` command is restricted to an
owner, requires the exact workspace confirmation phrase, requires an
idempotency key in token mode, and records an audit receipt. It removes only
workspace-private product records; shared evidence, immutable captures, and
global scan history remain available.
Private customer-source submissions use the same workspace membership boundary.
They are stored as private runtime records with a content digest and review
state; they are excluded from the shared packet until a researcher explicitly
reviews them. Source excerpts are returned only to members of that workspace.
Accepted private sources may be used by that workspace's question evaluator
and briefing builder, but are never copied into the shared packet or used for
another workspace's retrieval.
The demo reader keeps a manually entered token only for the current browser
session; production should replace this with an identity provider and secure
session cookie.

Workspace provisioning is operator-only and idempotent. It records member
identity IDs and workspace metadata, but never creates credentials or exposes
secrets. The identity provider must map those IDs to real accounts before
access is granted. Provisioned workspaces are included in the runtime backup
manifest so a restore cannot silently lose tenant boundaries.

Invited memberships are not treated as authenticated access. They remain
blocked until an operator records activation after the external identity
provider has confirmed the account. Suspended memberships are also excluded
from normal workspace access and cannot be reactivated through the ordinary
activation command.

Invitation records contain only an internal identity ID, workspace, role, and
state. They do not contain email credentials, invitation links, access tokens,
or password-reset data. A provider adapter must handle those sensitive values
outside this service and report confirmation back through the operator
activation boundary.

Identity confirmation events must use an HMAC signature over the exact request
body. Replayed event IDs return the original result, while an event with no
matching pending membership is rejected. The webhook receives an identity ID
and event metadata only; it does not receive provider access tokens or
credentials.

Activation notices use the normal workspace-scoped notification read model.
The notice contains no invitation link or secret and is created at most once
per workspace, so provider retries cannot create duplicate customer messages.

Schedule state uses the same membership check as onboarding and delivery
records. It exposes timing and delivery identifiers, not another workspace's
questions, evidence, or private source material.

Workspace refresh failure records expose only workspace ID, run ID, failed
step names, status, and retry timing to operators. Customers do not receive a
handoff notification merely because a refresh failed; a prepared delivery is
required before the normal delivery notice is valid.

Retry requests are operator-only, idempotent, and claimed by the scheduler
before any source work begins. A customer cannot cause an arbitrary refresh or
force an unreviewed delivery by manipulating the retry state.

Customer handoff acknowledgment is a workspace-member action, not an operator
or cross-tenant action. The server checks membership and notification ownership
before changing the notification, requires an idempotency key for token-auth
writes, and closes the matching refresh outcome only after the notification is
accepted. This prevents a caller from acknowledging another workspace's work
or making an incomplete delivery look successful.

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
