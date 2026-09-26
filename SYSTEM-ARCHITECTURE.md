# System architecture

## Design principle

Keep the source systems independent, but connect them through a shared,
versioned evidence contract. Do not copy whole repositories into one giant
database without preserving ownership and provenance.

## Source adapters

Each existing project supplies an adapter that produces the common contract:

- `annual-report-research` → filings, quarterly changes, company packets, themes
- `company-atlas-lab` → dossiers, question matrices, external cases, briefings
- `trend-hunting` → signals, source versions, outcome bridges, counterexamples
- `cultural-geopolitical-theme-mining` → social, institutional, political, and geopolitical records
- `ibis-industries` → industry structure, operators, bottlenecks, and sector economics
- `inc5000-analysis` → private-company growth, customer pain, and business models

The first implementation uses a repository-files adapter. Its contract is
machine-checked before a refresh: every registered repository must have at
least one source record, every record must carry an identity, source path,
observation, mechanism, affected groups, claim state, date, and limits, and
the refresh environment can require every referenced file to be readable.
Adapter output is then hashed and stored as a source snapshot before review.
For local repository inputs, the refresh also retains the exact source bytes
under a digest-addressed capture path. A later change or source outage therefore
does not erase the material needed to replay and audit the prior reading.
The ingestion step writes a repository-by-repository ledger containing the
source digest, byte count, capture reference, and normalized research fields;
packet and atlas generation consume that ledger when it is available.

## Core services

1. **Scheduler** — runs source checks and refresh jobs, writes a durable
   `scheduler-status.json` heartbeat, and records the last run, exit state, and
   next scheduled run so an operator can tell whether the system is running,
   sleeping, failed, or stopped.
2. **Acquisition service** — retrieves documents and records immutable source metadata.
3. **Extraction service** — identifies passages, metrics, entities, dates, and changes.
4. **Normalization service** — preserves units, periods, populations, geography, and definitions.
5. **Evidence graph** — links sources, observations, companies, industries, themes, mechanisms, and affected groups.
6. **Change engine** — compares new records with prior versions.
7. **Insight engine** — proposes bounded explanations and alternatives.
8. **Review queue** — supports researcher acceptance, correction, rejection, and notes.
9. **Publication service** — generates HTML, JSON, APIs, alerts, and briefings.
10. **Refresh service** — rechecks published insights and records what changed.
11. **Pilot delivery service** — turns each refresh into a dated, reviewable
    workspace handoff tied to the partner's decision question and success
    measures.
12. **Operator health read model** — aggregates refresh failures, source age,
    alert dispositions, and delivery timing without exposing customer content.
13. **Operator policy evaluator** — runs after each refresh, applies warning
    thresholds and acknowledgment deadlines, escalates overdue warnings once,
    and writes private notification-outbox records for dispatch.
14. **Notification delivery worker** — optionally sends outbox envelopes to an
    explicitly configured webhook, records bounded retries, and moves exhausted
    failures to a dead-letter state.
15. **Customer delivery outbox** — records one refresh-handoff notification per
    workspace delivery, keeps it idempotent across reruns, and preserves the
    customer's choice to receive or suppress it without deleting history.
16. **Delivery history** — stores one non-content attempt record per delivery
    try so operators can see reliability by recipient and destination.
17. **Pilot readiness history** — records the commercial decision aid after each
    refresh, preserving the evidence that led to each recommendation.
18. **Source availability monitor** — checks source reachability on every cycle,
    records source-level outage and recovery transitions, and keeps those
    checks separate from full ingestion cadence.

## Background jobs

Jobs should run at different speeds:

- daily: source availability and high-priority alerts;
- weekly: trend, policy, private-company, and industry refreshes;
- quarterly: company-report ingestion and financial comparison;
- monthly: cross-source synthesis and contradiction review;
- on demand: customer watchlists, briefings, and custom research.

The refresh planner enforces those cadences. Each run records which
repositories were due and which were deferred. Deferred repositories remain in
the evidence packet from their last accepted snapshot; they are not silently
removed and are not treated as newly changed. A failed run does not advance a
repository's last-refresh time, so the next run retries the work.

After the research steps complete, a configured pilot workspace receives a
delivery snapshot. It records what the refresh produced and what the partner
should review. It does not claim that free-text success measures were met
without a human assessment.

The customer delivery outbox creates one in-app handoff notification for each
new delivery. Re-running a refresh does not create a duplicate. Suppressing
handoff notifications changes delivery state to `suppressed`; it does not erase
the delivery or its history.

The operator policy evaluator runs before the runtime-store synchronization. It
is safe to rerun: a resolved warning is left alone, an already escalated
warning is not escalated again, and each warning has at most one notification
outbox item.

The system should create review work, not silently publish uncertain claims.

The scheduler status is operational evidence, not proof that a refresh produced
good research. Operators must still inspect the refresh receipt, failed steps,
source freshness, and review queues before treating a delivery as ready.

An unavailable source creates a source-specific workspace alert. A customer
delivery is held while that alert is open; a later availability check records
the recovery and allows the next delivery to be prepared. The recovery closes
the operational alert but does not erase the outage history.

## Storage

Use separate stores for:

- original sources and immutable captures;
- structured observations and metrics;
- claim and evidence relationships;
- review decisions and publication versions;
- customer watchlists and private workspaces.

Every published artifact should record source IDs, source versions, generation
time, code version, reviewer state, and known limitations.

## API boundaries

The frontend should receive validated read models. It should never call source
providers, databases, or model providers directly. Commands such as accepting,
rejecting, publishing, or saving a briefing need authenticated scope,
idempotency, version checks, and an auditable receipt.

## Human and model roles

Models may classify, summarize, compare, draft, find contradictions, and
propose questions. They may not silently promote evidence, invent a source,
close an open question, or turn adjacency into causation.

Researchers decide whether a claim is publishable. Customers can see the
review state and evidence boundary.
