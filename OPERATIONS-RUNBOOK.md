# Operations runbook

This is the launch and recovery procedure for the first commercial pilot. It
assumes the six research repositories are available through `RESEARCH_ROOT`
and that the deployment uses the Compose services in this repository.

## Before launch

1. Copy `.env.example` to `.env`.
2. Set `RESEARCH_ROOT` to an absolute path containing the registered research
   repositories. Keep that directory read-only to the containers.
3. Replace the example token and operator IDs. Store the token file outside
   source control and use TLS and an identity provider in front of the API.
4. Configure an HTTPS operator or customer webhook only after its receiver has
   been tested. Keep delivery disabled during the first data-only smoke test.
5. Review source licensing, rate limits, and the first pilot's decision
   question before making any customer workspace active.

For GitHub Actions, add a repository secret named
`RESEARCH_REPOSITORIES_TOKEN` with read-only access to the private
`company-atlas-lab`, `trend-hunting`, and `inc5000-analysis` repositories. CI
deliberately fails when this secret is missing; it does not replace private
research inputs with stale fixtures.

Check the rendered deployment before starting it:

```sh
docker compose config
npm run validate:deployment
npm run validate:runbook
```

## Start and verify

Build and start all four services from the same commit:

```sh
docker compose up -d --build
curl -fsS http://127.0.0.1:8780/api/health
curl -fsS -o /tmp/change-intelligence-readiness.json -w '%{http_code}\n' http://127.0.0.1:8780/api/readiness
curl -fsS http://127.0.0.1:8780/api/operations
curl -fsS http://127.0.0.1:8780/metrics
```

`/api/health` proves that the API process is alive. `/api/readiness` should
return `200` only after the latest refresh is complete, source data is current,
the runtime store is synchronized, a backup manifest exists, and all three
worker heartbeats are fresh. A `503` is an operating condition to investigate,
not a reason to send incomplete intelligence to a customer.

In `/api/operations`, confirm that `scheduler`, `backupScheduler`, and
`notificationScheduler` are all `sleeping` or `running`, and inspect their
`lastRunStatus`, `lastExitCode`, `nextRunAt`, and `error` fields. The operator
page shows the same worker states without exposing customer evidence.

## First pilot launch

Use the operator API to create a workspace and then configure, in order:

1. owner and researcher identity mapping;
2. the customer's decision question and scope;
3. a watchlist or explicitly reviewed private source;
4. success measures and delivery cadence;
5. the first saved research question;
6. the first refresh and reviewable handoff.

Do not call a pilot active because the workspace exists. The first handoff must
be prepared, source-linked, visible to the customer, and acknowledged or
successfully delivered through an approved channel. Record usefulness,
decision impact, corrections, and the next review date after each cycle.

## Normal operating loop

```text
worker heartbeat → source availability → refresh receipt
→ researcher review → bounded publication → customer handoff
→ acknowledgment / webhook receipt → pilot observation → next refresh
```

Check the operations read model at least once per business day. Review source
freshness, failed steps, held deliveries, false alerts, dead letters, and
stale briefings before sharing an update externally. A successful job receipt
does not prove that an insight is correct or useful.

## Notification failure

The notification service retries pending webhooks on `NOTIFICATION_INTERVAL_MS`
and records every attempt. For a pending item, inspect the destination, HTTP
status, timeout, and `nextAttemptAt`. For a `dead_letter` item, fix the
destination or receiver first, then dispatch it from the authenticated operator
workflow with an idempotency key. Do not edit the JSON ledger by hand.

If the notification worker is failed or its heartbeat is old, readiness remains
degraded even when the research refresh itself succeeded. This prevents a
customer handoff from being treated as delivered merely because it was built.

## Source or refresh failure

Inspect `/api/operations`, the refresh receipt, and the operator remediation
queue. A missing or unavailable source should hold the affected delivery. Do
not delete the alert or mark the delivery successful manually. Repair the
source, let the next availability check record recovery, and rerun the bounded
refresh or use the authenticated retry command for the affected workspace.

## Backup and restore drill

Backups run in a separate container and write a checksum manifest to the backup
volume. Test the path before the first paid cycle:

```sh
npm run test:backup
docker compose exec change-intelligence node scripts/backup-runtime.mjs
```

For a restore, stop writers first, restore into the shared runtime volume, then
start the services and verify readiness:

```sh
docker compose stop change-intelligence change-intelligence-scheduler change-intelligence-notifications change-intelligence-backup
docker compose run --rm --no-deps \
  -e BACKUP_DIR=/app/backups \
  -e RUNTIME_DATA_DIR=/app/runtime \
  change-intelligence node scripts/restore-runtime.mjs
docker compose up -d
curl -fsS http://127.0.0.1:8780/api/health
curl -fsS http://127.0.0.1:8780/api/readiness
```

Record the backup timestamp, restore result, readiness result, and any missing
source captures. A restore test is not complete until a workspace, its audit
history, and a source-linked briefing can be reopened.

## Incident boundary

Escalate immediately for suspected token exposure, cross-workspace data, source
licensing violations, incorrect public publication, or loss of the runtime
volume. Rotate credentials, stop external delivery, preserve logs and backup
manifests, and record the incident before changing data. The identity provider,
TLS termination, and customer webhook receiver remain outside this service and
need their own incident procedures.

## Release gate

Deploy only a pushed commit for which these pass:

```sh
npm run ci:core
npm run test:frontend-browser   # requires the local browser dependencies
```

The browser test is environment-dependent; the deterministic frontend runtime
test remains part of `ci:core`.
