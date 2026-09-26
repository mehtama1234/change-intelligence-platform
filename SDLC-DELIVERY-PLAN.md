# SDLC delivery plan

This plan follows the full software-development lifecycle. Each phase has a
clear output and a gate. Work does not advance because files exist; it advances
when the stated evidence shows that the product is useful, safe, and repeatable.

## Delivery rules

1. Build one complete vertical slice before building a large catalog.
2. Keep research truth separate from product presentation.
3. Treat source lineage and evidence boundaries as core product behavior.
4. Automate repeatable checks, not human judgment.
5. Version every source, claim, insight, and publication.
6. Design failure, correction, stale data, and source loss before scale.
7. Ship small increments with a working reader and an honest gap log.

## Phase 0 — mission and product boundaries

### Purpose

Agree what problem the first commercial product solves and what it refuses to
promise.

### Work

- select the first domain;
- identify the paying user and the decision they need to make;
- write three real customer questions;
- define the source families needed to answer them;
- define the evidence states and unacceptable claims;
- decide which existing repositories are read-only inputs;
- write the first privacy, licensing, and source-use review.

### Deliverables

- product brief;
- domain boundary;
- user and decision map;
- source inventory;
- non-goals and claim restrictions;
- initial success measures.

### Gate

Three people who were not involved in writing the brief can explain the
customer, the first decision, the evidence needed, and what the product will
not claim.

## Phase 1 — discovery and workflow research

### Purpose

Understand how the first customer currently answers the question.

### Work

- interview or observe strategy, research, product, or risk users;
- collect their current spreadsheets, briefings, alerts, and review steps;
- record where they lose time, distrust a source, or repeat work;
- identify what decision follows the research;
- test whether the proposed evidence chain matches their real workflow.

### Deliverables

- observed workflow maps;
- five representative jobs;
- current-state pain and workaround log;
- first user-story map;
- design-partner candidates;
- measurable outcome hypothesis.

### Gate

At least three target users recognize the problem and can describe a decision
that would improve if the product worked.

## Phase 2 — domain and evidence design

### Purpose

Define the research system before building ingestion or interface code.

### Work

- define the first domain taxonomy;
- map signal, pressure, mechanism, response, outcome, and counterexample;
- identify one named workflow and separate measured stages from missing stages;
- define annual and quarterly report fields;
- define company, industry, private-company, social, institutional, and
  outcome records;
- define period, unit, denominator, geography, population, and source role;
- define what counts as a valid comparison;
- define claim states and evidence maturity;
- define refresh and retirement rules.

### Deliverables

- versioned schema;
- evidence dictionary;
- source and claim examples;
- comparison rules;
- domain coverage matrix;
- evidence-gate checklist.

### Gate

Researchers can take three real source records and encode them consistently,
including a record that must remain open or incompatible.

## Phase 3 — architecture and security design

### Purpose

Design the system so research can grow without losing provenance or customer
trust.

### Work

- choose the source store, structured store, search index, relationship store,
  job queue, API, and frontend boundaries;
- define source capture and content-addressing strategy;
- define tenant and workspace isolation;
- define authentication, authorization, audit logs, secrets, and encryption;
- define data retention, deletion, backup, and disaster recovery;
- define model-provider boundaries and prompt/version logging;
- threat-model source poisoning, prompt injection, data leakage, false claims,
  stale publication, and unauthorized export.

### Deliverables

- architecture decision records;
- system diagram;
- threat model;
- privacy and data-classification map;
- disaster-recovery objectives;
- API contract draft;
- cost model for the first domain.

### Gate

The design can explain where every source, claim, customer record, model call,
and published artifact lives, who can access it, and how it is recovered.

## Phase 4 — foundation and vertical-slice design

### Purpose

Build the smallest complete path from source to customer view.

### Work

- create source identity and immutable capture;
- implement the common evidence contract;
- import one source family from each existing repository;
- build company, industry, theme, claim, question, and review identifiers;
- implement one annual report plus three-quarter record;
- implement source passage inspection;
- define the first frontend reading path;
- create fixtures for clean, stale, missing, contradictory, and revised data.

### Deliverables

- working local service;
- migrations and seed data;
- adapter contract;
- first API read model;
- first frontend wireframes;
- fixture and test corpus;
- observability baseline.

### Gate

One source can be captured, extracted, reviewed, displayed, inspected, and
replayed from a clean environment.

## Phase 5 — build the research backend

### Purpose

Make recurring research operations reliable.

### Workstreams

#### Source acquisition

- scheduled fetches;
- document and page capture;
- source hashes and version comparison;
- robots, licensing, rate, and access handling;
- failure and unavailable-source records.

#### Report analysis

- annual business architecture extraction;
- quarterly change extraction;
- metric and period normalization;
- guidance and promise tracking;
- management-language change detection;
- segment, geography, cash, debt, capex, and working-capital bridges.

#### Cross-source analysis

- industry mapping;
- private-company pain and growth mapping;
- affected-group mapping;
- mechanism relationships;
- counterexample and alternative-explanation queue;
- outcome and implementation evidence.

#### Insight workflow

- candidate insight generation;
- source citation attachment;
- claim-state assignment;
- contradiction detection;
- researcher review;
- publication and refresh state.

### Deliverables

- repeatable background jobs;
- job receipts and retry behavior;
- evidence graph/query service;
- insight review queue;
- first domain knowledge base;
- machine-readable exports.

### Gate

The system can refresh the first domain twice from a clean starting point and
produce the same results apart from documented source changes.

## Phase 6 — build the frontend

### Purpose

Turn evidence into a usable research experience.

### Work

- build the change feed;
- build theme, industry, and company pages;
- build annual-versus-quarterly timeline;
- build evidence-chain inspection;
- build alternative-explanation and counterexample views;
- build questions and watchlists;
- build briefing composition and export/replay;
- add loading, stale, unavailable, partial, and corrected states;
- test keyboard use, mobile layout, enlarged text, and screen-reader basics.

### Deliverables

- usable first-domain reader;
- responsive design system;
- source inspector;
- saved question and watchlist flow;
- briefing export;
- accessibility findings and fixes.

### Gate

An unfamiliar researcher can complete the five core jobs without being told
where to click, can find the source behind a claim, and can explain the limits
of the displayed evidence.

## Phase 7 — model and insight evaluation

### Purpose

Use models to reduce research effort without allowing them to silently make
unsupported claims.

### Work

- build extraction and classification evaluations;
- test citation accuracy and source passage alignment;
- test period, unit, denominator, and company-identity errors;
- test contradiction and alternative-explanation suggestions;
- test prompt injection and hostile source text;
- compare model drafts with researcher decisions;
- record false positives, omissions, and unsupported language;
- version prompts, models, and evaluation sets.

### Deliverables

- golden evaluation set;
- model scorecard;
- review sampling plan;
- failure taxonomy;
- human-approval rules;
- rollback procedure.

### Gate

The product shows measurable improvement over manual search for the chosen
jobs while keeping unsupported-claim and citation-error rates below agreed
limits.

## Phase 8 — quality, security, and release readiness

### Purpose

Prove that the product works beyond a happy-path demo.

### Test layers

- unit tests for parsers, calculations, validators, and claim rules;
- contract tests between source adapters, API, and frontend;
- integration tests for scheduled jobs and persistence;
- browser tests for core research journeys;
- visual and accessibility checks;
- performance and cost tests;
- security and dependency scans;
- tenant-isolation and authorization tests;
- backup restore and failure-recovery tests;
- source-refresh and stale-publication tests.

### Release gate

Release only when the build is reproducible, critical paths pass, source
lineage is intact, private data is isolated, failure states are understandable,
and known limitations are published.

## Phase 9 — design-partner pilot

### Purpose

Test whether the system changes real research work.

### Work

- onboard three design partners;
- configure separate watchlists and workspaces;
- deliver weekly change notices and one quarterly briefing;
- observe how users verify, share, challenge, and reuse insights;
- record corrections and missed important changes;
- measure time to answer, source-trace use, briefing reuse, false alerts,
  missed important changes, correction time, and decision usefulness.

### Gate

At least one partner uses the product for a real decision, returns for another
cycle, and can name what the product helped them do better.

## Phase 10 — production operations

### Purpose

Keep the system trustworthy after launch.

### Operating loop

```text
monitor sources and jobs
→ review new or changed evidence
→ publish or hold insights
→ notify customers
→ collect corrections
→ refresh old claims
→ retire or revise weakened insights
```

### Required operations

- job health dashboard;
- source freshness dashboard;
- evidence and claim correction queue;
- customer support and escalation;
- cost and model-use monitoring;
- access and export audit;
- incident response;
- backup and recovery drills;
- monthly quality review;
- quarterly taxonomy and product review.

### Gate

The team can detect, explain, correct, and communicate a bad source, bad
extraction, stale insight, security issue, or customer-data incident.

## Phase 11 — scale and continuous delivery

Only after the first vertical slice and pilot work should we add more domains.

Each new domain must pass the same intake:

1. define the customer question;
2. map the evidence and source families;
3. identify the mechanism and affected groups;
4. prove annual/quarterly or equivalent time coverage;
5. add counterexamples and outcome evidence;
6. build the domain adapter;
7. pass the evidence and product gates;
8. add it to the commercial catalog.

Do not measure progress only by number of companies, reports, pages, charts,
or trends. Measure whether the system is producing better, faster, more
traceable decisions.

## First 90-day implementation sequence

### Days 1–15: scope and discovery

- choose the first domain and three customer jobs;
- interview target users;
- write the shared schema and claim rules;
- select five public companies and five private-company examples;
- choose independent evidence sources;
- define the first acceptance examples.

### Days 16–30: foundation

- initialize the application repository structure;
- implement source identity, capture, versioning, and lineage;
- import a small fixture from each connected repository;
- build annual-plus-quarterly comparison records;
- create the first API read model;
- set up CI, test data, logs, and deployment environments.

### Days 31–55: end-to-end slice

- implement background refresh for the first domain;
- create the change feed, company page, theme page, and evidence chain;
- add source inspection and open-question states;
- add one generated insight with researcher review;
- add briefing export and replay;
- run full browser and accessibility checks.

### Days 56–70: quality and safety

- build the model evaluation set;
- test stale, missing, contradictory, and revised sources;
- run authorization, tenant, export, backup, and recovery checks;
- fix the largest comprehension problems found in observation;
- document known limits.

### Days 71–90: pilot

- onboard three design partners;
- deliver recurring updates;
- observe real use;
- measure useful decisions, false alerts, trace inspection, and corrections;
- decide whether to improve the first domain or add the second.

## Final SDLC principle

The product is successful when the same system can repeatedly discover a
meaningful change, explain it in everyday language, show the evidence and
uncertainty, help someone make a decision, and later revise the explanation
when reality changes.
