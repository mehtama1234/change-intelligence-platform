import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRoot = process.env.RESEARCH_ROOT ?? "/home/mehta/git-repo";
const runtimeDir = process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control";
const mapPath = resolve(root, process.env.SOURCE_MAP_PATH ?? "data/source-maps/ai-work-control.sources.json");
const outputPath = resolve(root, process.env.PACKET_OUTPUT_PATH ?? process.env.PACKET_PATH ?? "data/processed/ai-work-control.packet.json");
const previousPacketPath = outputPath;
const captureManifestPath = resolve(root, process.env.SEC_MANIFEST_PATH ?? "data/raw/ai-work-control/c3-ai/manifest.json");
const xbrlExtractPath = resolve(root, process.env.SEC_XBRL_PATH ?? "data/processed/ai-work-control/c3-ai.xbrl.json");
const sourceScanPath = resolve(root, process.env.SOURCE_SCAN_PATH ?? `${runtimeDir}/latest-source-scan.json`);
const ingestionPath = resolve(root, process.env.INGESTION_OUTPUT_PATH ?? `${runtimeDir}/research-ingestion.json`);
const reviewWorkPath = resolve(root, process.env.REVIEW_WORK_PATH ?? `${runtimeDir}/latest-review-work.json`);
const reviewDecisionsPath = resolve(root, process.env.REVIEW_DECISIONS_PATH ?? `${runtimeDir}/review-decisions.json`);
const evidenceLedgerPath = resolve(root, process.env.EVIDENCE_LEDGER_PATH ?? `${runtimeDir}/versioned-evidence-ledger.json`);
const alertsPath = resolve(root, process.env.ALERTS_PATH ?? `${runtimeDir}/workspace-alerts.json`);
const questionEvaluationsPath = resolve(root, process.env.QUESTION_EVALUATIONS_PATH ?? `${runtimeDir}/question-evaluations.json`);
const briefingsPath = resolve(root, process.env.BRIEFINGS_PATH ?? `${runtimeDir}/workspace-briefings.json`);
const insightCandidatesPath = resolve(root, process.env.INSIGHT_CANDIDATES_PATH ?? `${runtimeDir}/insight-candidates.json`);
const map = JSON.parse(await readFile(mapPath, "utf8"));
const sourceScan = existsSync(sourceScanPath) ? JSON.parse(await readFile(sourceScanPath, "utf8")) : undefined;
const ingestion = existsSync(ingestionPath) ? JSON.parse(await readFile(ingestionPath, "utf8")) : undefined;
const reviewWork = existsSync(reviewWorkPath) ? JSON.parse(await readFile(reviewWorkPath, "utf8")) : undefined;
const reviewDecisions = existsSync(reviewDecisionsPath) ? JSON.parse(await readFile(reviewDecisionsPath, "utf8")) : undefined;
const evidenceLedger = existsSync(evidenceLedgerPath) ? JSON.parse(await readFile(evidenceLedgerPath, "utf8")) : undefined;
const alerts = existsSync(alertsPath) ? JSON.parse(await readFile(alertsPath, "utf8")) : undefined;
const questionEvaluations = existsSync(questionEvaluationsPath) ? JSON.parse(await readFile(questionEvaluationsPath, "utf8")) : undefined;
const briefings = existsSync(briefingsPath) ? JSON.parse(await readFile(briefingsPath, "utf8")) : undefined;
const insightCandidates = existsSync(insightCandidatesPath) ? JSON.parse(await readFile(insightCandidatesPath, "utf8")) : undefined;
const previousPacket = existsSync(previousPacketPath) ? JSON.parse(await readFile(previousPacketPath, "utf8")) : undefined;
const previousRecordsById = new Map((previousPacket?.records ?? []).map((record) => [record.id, record]));

function stripMarkup(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(text, terms) {
  const clean = stripMarkup(text);
  const lower = clean.toLowerCase();
  const index = terms.map((term) => lower.indexOf(term.toLowerCase())).find((position) => position >= 0);
  if (index === undefined) return clean.slice(0, 420);
  const start = Math.max(0, index - 150);
  return clean.slice(start, start + 700);
}

function parseAmount(value) {
  const normalized = value.trim().replaceAll(",", "");
  if (normalized === "—" || normalized === "-") return null;
  const negative = normalized.startsWith("(") && normalized.endsWith(")");
  const number = Number(normalized.replace(/[()]/g, ""));
  return negative ? -number : number;
}

function parseQuarterBridge(markdown) {
  const lines = markdown.split("\n");
  const firstQuarter = lines.findIndex((line) => /^\|\s*Q\d/.test(line));
  const headerLine = lines.slice(0, firstQuarter).reverse().find((line) => /^\|/.test(line) && !/^\|\s*:?-+/.test(line));
  const columns = headerLine ? headerLine.split("|").map((cell) => cell.trim()).filter(Boolean).slice(1) : [];
  const quarters = lines
    .filter((line) => /^\|\s*Q\d/.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
      return {
        period: cells[0],
        values: cells.slice(1),
        operatingLoss: parseAmount(cells[1]),
        netLoss: parseAmount(cells[2])
      };
    });
  return { columns, quarters };
}

function parseDirectQuarterFacts(extract) {
  const targets = [
    ["Q1 ended Jul 31 2025", "2025-07-31", "2025-05-01"],
    ["Q2 ended Oct 31 2025", "2025-10-31", "2025-08-01"],
    ["Q3 ended Jan 31 2026", "2026-01-31", "2025-11-01"]
  ];
  return targets.map(([period, endDate, startDate]) => {
    const facts = extract.filings.flatMap((filing) => filing.facts)
      .filter((fact) => fact.period.startDate === startDate && fact.period.endDate === endDate);
    const fact = (name) => facts.find((item) => item.factName === name)?.value;
    const operatingLoss = fact("us-gaap:OperatingIncomeLoss");
    const netLoss = fact("us-gaap:NetIncomeLoss");
    if (operatingLoss === undefined || netLoss === undefined) return null;
    return { period, operatingLoss: operatingLoss / 1000, netLoss: netLoss / 1000 };
  }).filter(Boolean);
}

function percentageChange(start, end) {
  if (!start || start === 0) return null;
  return Number((((Math.abs(end) - Math.abs(start)) / Math.abs(start)) * 100).toFixed(1));
}

async function buildReportWindow(source, sourceLedger) {
  const bridgePath = resolve(sourceRoot, source.sourceRepository, source.reportWindow.bridgePath);
  const initialReadPath = resolve(sourceRoot, source.sourceRepository, source.reportWindow.initialReadPath);
  const bridge = await readFile(bridgePath, "utf8");
  const initialRead = await readFile(initialReadPath, "utf8");
  const parsedBridge = parseQuarterBridge(bridge);
  const quarters = parsedBridge.quarters;
  const directRecords = [...sourceLedger.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)]
    .map((match) => ({ label: match[1], url: match[2] }));
  const captureManifest = existsSync(captureManifestPath)
    ? JSON.parse(await readFile(captureManifestPath, "utf8"))
    : undefined;
  const xbrlExtract = existsSync(xbrlExtractPath)
    ? JSON.parse(await readFile(xbrlExtractPath, "utf8"))
    : undefined;
  const directQuarters = xbrlExtract ? parseDirectQuarterFacts(xbrlExtract) : [];
  const directMatchesBridge = directQuarters.length === quarters.length && directQuarters.every((direct, index) =>
    direct.operatingLoss === quarters[index].operatingLoss && direct.netLoss === quarters[index].netLoss);
  const movementQuarters = directMatchesBridge ? directQuarters.map((quarter, index) => ({ ...quarter, values: quarters[index].values })) : quarters;
  if (movementQuarters.length < 3) throw new Error(`${source.id}: expected at least three quarterly rows`);
  const first = movementQuarters[0];
  const last = movementQuarters.at(-1);
  return {
    annualBaseline: source.reportWindow.annualBaseline ?? "FY2025 10-K",
    columns: source.reportWindow.columns ?? parsedBridge.columns,
    quarters: movementQuarters,
    metrics: {
      operatingLossMagnitudeChangeQ3vsQ1Pct: percentageChange(first.operatingLoss, last.operatingLoss),
      netLossMagnitudeChangeQ3vsQ1Pct: percentageChange(first.netLoss, last.netLoss),
      operatingLossQ2vsQ1: movementQuarters[1].operatingLoss - first.operatingLoss,
      operatingLossQ3vsQ2: movementQuarters[2].operatingLoss - movementQuarters[1].operatingLoss
    },
    reading: source.reportWindow.reading ?? "This is a reported accounting movement, not a causal explanation or an outcome for workers or customers.",
    movementSource: directMatchesBridge ? "sec_xbrl" : "atlas_bridge",
    sourceRefs: {
      bridge: source.reportWindow.bridgePath,
      initialRead: source.reportWindow.initialReadPath,
      initialReadDigest: createHash("sha256").update(initialRead).digest("hex"),
      directRecords,
      ...(xbrlExtract ? {
        directExtract: "data/processed/ai-work-control/c3-ai.xbrl.json",
        directExtractStatus: directMatchesBridge ? "matches_bridge" : "does_not_match_bridge"
      } : {}),
      ...(captureManifest ? {
        captureManifest: "data/raw/ai-work-control/c3-ai/manifest.json",
        captureStatus: captureManifest.records.every((record) => record.status === "retrieved") ? "complete" : "incomplete",
        capturedRecords: captureManifest.records.filter((record) => record.status === "retrieved").length,
        attemptedRecords: captureManifest.records.length
      } : { captureStatus: "not_attempted" })
    }
  };
}

const records = [];
for (const source of ingestion?.records ?? map.sources) {
  if (source.refreshState === "deferred") {
    const previousRecord = previousRecordsById.get(source.id);
    if (!previousRecord) throw new Error(`${source.id}: deferred source has no prior packet record to carry forward`);
    records.push({ ...previousRecord, refreshState: "deferred", deferredAt: source.deferredAt ?? new Date().toISOString() });
    continue;
  }
  const fullPath = resolve(sourceRoot, source.sourceRepository, source.sourcePath);
  const raw = await readFile(fullPath, "utf8");
  const digest = createHash("sha256").update(raw).digest("hex");
  const reportWindow = source.reportWindow ? await buildReportWindow(source, raw) : undefined;
  records.push({
    id: source.id,
    sourceRole: source.sourceRole,
    sourceRepository: source.sourceRepository,
    sourceRef: source.sourcePath,
    sourceLocator: source.sourceLocator,
    sourceDigest: digest,
    sourceBytes: Buffer.byteLength(raw),
    sourceExcerpt: excerpt(raw, source.excerptTerms),
    title: source.title,
    observation: source.observation,
    theme: source.theme,
    mechanism: source.mechanism,
    affectedGroups: source.affectedGroups,
    claimState: source.claimState,
    asOf: source.asOf,
    ...(source.company ? { company: source.company } : {}),
    ...(source.industry ? { industry: source.industry } : {}),
    ...(source.reportingPeriod ? { reportingPeriod: source.reportingPeriod } : {}),
    ...(reportWindow ? { reportWindow } : {}),
    limits: source.limits
  });
}

const acceptedVersions = evidenceLedger?.records ?? [];
for (const version of acceptedVersions) {
  if (version.state !== "accepted_for_research" || !version.record?.id) continue;
  const current = records.find((record) => record.id === version.record.id);
  if (!current || current.sourceDigest !== version.sourceDigest) continue;
  current.researchReview = {
    state: version.state,
    versionId: version.versionId,
    decisionId: version.decisionId,
    reviewer: version.acceptedBy,
    acceptedAt: version.acceptedAt,
    sourceReviewRun: evidenceLedger.sourceReviewRun
  };
}

const packet = {
  schemaVersion: "change-intelligence-packet-v1",
  domain: map.domain,
  sourceSnapshotDate: map.snapshotDate,
  ...(sourceScan ? {
    operations: {
      latestSourceScan: {
        generatedAt: sourceScan.generatedAt,
        runId: sourceScan.runId,
        counts: sourceScan.counts,
        reviewRequired: sourceScan.reviewRequired,
        reviewQueue: sourceScan.reviewQueue,
        ...(reviewWork ? {
          reviewWork: {
            reviewRequired: reviewWork.reviewRequired,
            readyForResearcher: reviewWork.readyForResearcher,
            blocked: reviewWork.blocked,
            candidates: reviewWork.candidates,
            ...(reviewDecisions ? { decisions: reviewDecisions.decisions } : {})
            ,...(evidenceLedger ? { versionedEvidence: {
              activeResearchRecordCount: evidenceLedger.activeResearchRecordCount,
              decisionCount: evidenceLedger.decisionCount,
              records: evidenceLedger.records
            } } : {})
          }
        } : {}),
      },
      ...(alerts ? { workspaceAlerts: alerts } : {})
      ,...(questionEvaluations ? { questionEvaluations } : {})
      ,...(briefings ? { briefings } : {})
      ,...(insightCandidates ? { insightCandidates } : {})
    }
  } : {}),
  records,
  insights: [map.insight, ...(map.additionalInsights ?? [])]
};

await mkdir(resolve(root, "data/processed"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
console.log(`Built ${records.length} records from ${new Set(records.map((record) => record.sourceRepository)).size} repositories.`);
console.log(`Wrote ${outputPath}`);
