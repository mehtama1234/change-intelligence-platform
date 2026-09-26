# Change Intelligence Platform

An evidence-led system for understanding how changes move through society,
industries, companies, and people's lives.

This repository is the shared product and technical specification for a
commercial intelligence platform. It connects the research already being
developed in:

- `annual-report-research` — public-company reports, quarterly change, and cross-company economics
- `company-atlas-lab` — readable dossiers, evidence gates, and visual research
- `trend-hunting` — early signals, outcome tests, and counterexamples
- `cultural-geopolitical-theme-mining` — lived conditions, institutions, politics, and power
- `ibis-industries` — industry structure, operators, bottlenecks, and sector economics
- `inc5000-analysis` — fast-growing private companies, customer pain, and new business models

The product is not a trend list, a financial dashboard, or an automated truth
machine. It is a continuously refreshed research system that shows what
changed, why it may matter, who benefits, who carries the cost, what the
evidence proves, and what remains open.

## Read the specifications

1. [Product specification](PRODUCT-SPEC.md)
2. [Evidence and insight model](EVIDENCE-MODEL.md)
3. [System architecture](SYSTEM-ARCHITECTURE.md)
4. [Commercial offering](COMMERCIAL-OFFERING.md)
5. [Delivery roadmap](DELIVERY-ROADMAP.md)
6. [Meaty end-to-end goal](MEATY-END-TO-END-GOAL.md)
7. [SDLC delivery plan](SDLC-DELIVERY-PLAN.md)
8. [Security boundary](SECURITY.md)
9. [Operations runbook](OPERATIONS-RUNBOOK.md)

Every push also runs the core release gate and a Linux container smoke test in
GitHub Actions. The container job validates Compose interpolation, builds the
production image, starts the API, checks its health state, and removes its
temporary volumes.

## North-star question

> What is changing, why is it changing, which companies and institutions are
> affected, who gains or carries the burden, and what evidence would change our
> mind?

## First principle

Every important insight must be traceable through:

```text
signal or condition
→ operating mechanism
→ company / industry / institutional response
→ affected people or organizations
→ benefit, burden, risk, or control shift
→ observed outcome or implementation result
→ counterexample
→ next test
```
