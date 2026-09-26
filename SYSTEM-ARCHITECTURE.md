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

## Core services

1. **Scheduler** — runs source checks and refresh jobs.
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

## Background jobs

Jobs should run at different speeds:

- daily: source availability and high-priority alerts;
- weekly: trend, policy, private-company, and industry refreshes;
- quarterly: company-report ingestion and financial comparison;
- monthly: cross-source synthesis and contradiction review;
- on demand: customer watchlists, briefings, and custom research.

After the research steps complete, a configured pilot workspace receives a
delivery snapshot. It records what the refresh produced and what the partner
should review. It does not claim that free-text success measures were met
without a human assessment.

The system should create review work, not silently publish uncertain claims.

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
