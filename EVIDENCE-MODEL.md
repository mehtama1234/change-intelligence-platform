# Evidence and insight model

## Evidence roles

Every record must have one primary role:

- `company_report` — annual report, quarterly filing, earnings release, or call
- `industry` — industry structure, market, operator, or supply-chain evidence
- `private_company` — Inc. 5000 or similar company/business-model evidence
- `social_cultural` — behavior, meaning, trust, identity, or consumer evidence
- `institutional` — government, regulator, court, public program, or policy record
- `research` — academic, survey, or measured study
- `geopolitical` — state, alliance, trade, strategic, or international record
- `open_question` — a clearly stated request for evidence not yet obtained

These roles must never be silently blended.

## Core entities

```text
Source
Observation
Metric
Company
Industry
Theme
Mechanism
AffectedGroup
Claim
Counterexample
Outcome
Question
Briefing
```

## Claim states

Every claim is labelled as one of:

- `reported` — directly stated by a source;
- `calculated` — reproducible arithmetic from reported values;
- `measured` — independently measured observation;
- `compared` — compatible comparison with stated limits;
- `interpreted` — reasoned reading of evidence;
- `inferred_across_sources` — a bridge across separate sources;
- `open` — not established;
- `disproved_or_weakened` — evidence materially conflicts with it.

## Annual and quarterly analysis

The annual report establishes the company's structure:

- business lines and customers;
- revenue and cost architecture;
- assets, debt, capital spending, and labor;
- accounting boundaries;
- strategy, governance, and risks;
- multi-year operating history.

Quarterly reports test movement inside that structure:

- price, volume, and mix;
- demand and orders;
- segment and geography changes;
- margins and cash conversion;
- inventory, receivables, payables, and debt;
- guidance and promise tracking;
- new or migrating risks;
- changes in management language.

The system must preserve reporting period, filing date, source date, fiscal
calendar, unit, currency, denominator, and restatement status.

## Insight admission gate

An insight can be published only when the record answers:

1. What changed?
2. Which source shows it?
3. What is the step from evidence to interpretation?
4. Who or what is affected?
5. What is the strongest alternative explanation?
6. What evidence is missing?
7. What would weaken or reverse the insight?

## Evidence maturity

Use a visible maturity ladder:

```text
signal → documented condition → repeated pattern → mechanism evidence
→ outcome / implementation evidence → counterexample-tested conclusion
```

The ladder is not a confidence score. It describes what kind of proof exists.

## Outcome bridges

An outcome bridge is a declared comparison between separate evidence rails. It
must name the company records, independent outcome records, and any
counterexample. It must also state the question, the supported reading, the
unsupported reading, and the next test.

Company movement plus independent outcome evidence is not automatically a
causal link. Until the same workflow, population, and period are matched, the
bridge remains an open comparison rather than a conclusion.
