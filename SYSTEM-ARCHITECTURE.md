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
19. **Operator remediation queue** — exposes open source-availability issues as
    bounded work items with an owner-visible state, due time, overdue flag, and
    count of customer deliveries held by that source. It contains operational
    metadata only; it does not copy customer questions, review notes, or
    briefing content into the operator view.
20. **Question-to-insight relevance gate** — links a published insight to a
    customer briefing only when at least one of the insight's source records is
    among the records retrieved for that question. Publication alone does not
    make an insight relevant to every customer.
21. **Concept-based question retrieval** — gives terms such as appeal, remedy,
    correction, switching, and deployment shared concepts, while ignoring
    broad words such as AI and work when they appear alone. Each match records
    its concept and reason so a researcher can see why evidence was retrieved.
22. **Cross-repository opportunity discovery** — groups recurring mechanisms
    across independent repositories and writes review-only opportunities with
    source digests, alternative explanations, falsifiers, and next tests. The
    discovery stage proposes research work; it cannot publish or deliver a
    customer claim.
23. **Opportunity promotion** — lets an authenticated researcher rewrite a
    detected pattern into a bounded draft insight. The promotion keeps the
    opportunity ID, source record IDs, reviewer, and review event, then enters
    the ordinary insight decision and publication gates on the next refresh.
24. **Promoted-insight revision** — a later rewrite changes the claim digest,
    records a revision event, and forces a previously published promoted
    insight back into the stale/re-review path. Its opportunity provenance is
    carried into inspection and customer briefing provenance.
25. **Insight freshness read model** — customer inspection shows the current
    and published evidence/claim digests, explains whether the source or the
    wording changed, lists review and revision events, and names briefings that
    use the insight and whether each briefing is stale.
26. **Customer stale-action contract** — a changed linked insight gives the
    briefing and delivery a plain-language change type, a hold/review state,
    and explicit actions: do not rely on the old reading, inspect the changed
    evidence, and wait for re-review and republishing before acting on it.
27. **Briefing version history** — each workspace can inspect the briefing's
    publication versions, evidence digests, re-review events, current version,
    and stale actions without seeing another workspace's history.
28. **Change-intelligence feed** — a workspace-facing refresh read model turns
    source changes into plain-language review work, links the affected evidence,
    insights, and briefings, and states the next action without claiming that
    every changed file is important.
29. **Captured source difference** — a researcher can compare the prior and
    current immutable captures for a changed source through a bounded line-level
    read model before re-extracting or re-reviewing downstream claims.
30. **Insight evidence chain** — insight inspection groups cited records into
    signal, mechanism, response, affected-group, observed-result, and
    counterexample stages, marking missing stages as open instead of filling
    them with inference.
31. **Watchlist-scoped change feed** — a configured workspace sees refresh work
    for its selected sources or repositories; a workspace without a watchlist
    receives an explicit all-sources onboarding view rather than an unexplained
    empty feed.
32. **Workspace context isolation** — an explicit workspace request scopes
    watchlists and linked briefings even in demo mode; a workspace cannot shape
    another workspace's customer change feed through shared runtime records.
33. **Watchlist event-state filtering** — the customer feed honors each
    watchlist's requested `new`, `changed`, and `missing` states rather than
    treating every source membership as an alert.
34. **Workspace export** — an authenticated workspace member can download a
    source-linked bundle of that workspace's questions, briefings, watchlists,
    delivery history, decisions, receipts, and audit history; webhook secrets
    and other workspaces are excluded.

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

The timeline read model groups these records into an impact chain with the
outage time, recovery time, affected workspaces, held deliveries, and released
deliveries. It supports source, event-type, and time filters while applying the
same workspace visibility rules as the other customer read models.

Researchers and workspace owners can record remediation as `started` or
`completed` on a source-availability alert. That action is audited and appears
in the timeline, but it does not close the alert. Only a later independent
availability check can establish recovery and close the operational alert.

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

Workspace deletion is an owner-only, exact-confirmation command. It deletes
workspace-private rows in one SQLite transaction, writes the deletion audit
receipt, and rebuilds the JSON compatibility ledgers from SQLite so deleted
records cannot return after restart. Shared research evidence, immutable source
captures, and global scan history are deliberately preserved.

Private customer sources use a separate `workspace_source` record kind. A
workspace owner or researcher can submit a bounded excerpt and observation;
the service records a content digest and keeps the item in `pending_review`.
Only an explicit workspace review changes it to `accepted` or `rejected`, and
these records are never added to the shared packet automatically.
After acceptance, the question evaluator adds a source only to questions in
the same workspace. Briefings carry its digest and mark it private; pending
and rejected items are excluded. Customer evidence therefore remains useful
without becoming cross-tenant research truth.

The workspace onboarding read model turns pilot setup into an explicit
checklist: decision question, evidence scope, success measures, cadence,
saved question, and first handoff. It reports configuration and recorded
activity; it does not label a pilot successful without partner evidence.

The operator overview adds a privacy-preserving onboarding queue across
workspaces. It exposes only setup status, missing step identifiers, and
delivery counts—not customer questions, private excerpts, or review notes.

An operator can provision a partner workspace through the same service. The
command writes a durable runtime registry entry, creates the first owner
membership, records an audit event, and requires an idempotency key. The
registry is merged with fixture workspaces for reads, included in runtime
backups, and used by membership checks immediately. It stores identity IDs,
not passwords or tokens; a production identity provider remains responsible
for account creation, authentication, and invitations.

Memberships have an explicit lifecycle. A newly invited identity is recorded
as `invited` and cannot read or write workspace data. An operator activates it
only after the external identity provider confirms the account. Active-member
checks are applied centrally, so every existing workspace command receives the
same rule.

Invitation requests are kept in a separate runtime outbox. Each record names
the workspace, identity ID, role, provider boundary, and state (`pending` or
`activated`). This gives an external identity-provider adapter a durable item
to consume without putting credentials, reset links, or provider secrets in
the change-intelligence service.

The provider boundary is a signed webhook at
`/api/integrations/identity-provider/events`. It accepts only
`identity.confirmed` events, verifies an HMAC signature, uses the provider's
event ID for idempotency, activates matching invited memberships, and records
the confirmation in the invitation ledger and audit log. A missing webhook
secret disables the endpoint rather than allowing unsigned activation.
