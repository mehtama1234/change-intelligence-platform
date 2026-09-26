import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRoot = process.env.RESEARCH_ROOT ?? "/home/mehta/git-repo";
const mapPath = resolve(root, "data/source-maps/ai-work-control.sources.json");
const outputPath = resolve(root, "data/processed/ai-work-control.packet.json");
const captureManifestPath = resolve(root, "data/raw/ai-work-control/c3-ai/manifest.json");
const xbrlExtractPath = resolve(root, "data/processed/ai-work-control/c3-ai.xbrl.json");
const sourceScanPath = resolve(root, "data/processed/runs/ai-work-control/latest-source-scan.json");
const map = JSON.parse(await readFile(mapPath, "utf8"));
const sourceScan = existsSync(sourceScanPath) ? JSON.parse(await readFile(sourceScanPath, "utf8")) : undefined;

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
  return markdown.split("\n")
    .filter((line) => /^\|\s*Q\d/.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
      return {
        period: cells[0],
        operatingLoss: parseAmount(cells[1]),
        netLoss: parseAmount(cells[2])
      };
    });
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
  const quarters = parseQuarterBridge(bridge);
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
  const movementQuarters = directMatchesBridge ? directQuarters : quarters;
  if (movementQuarters.length < 3) throw new Error(`${source.id}: expected at least three quarterly rows`);
  const first = movementQuarters[0];
  const last = movementQuarters.at(-1);
  return {
    annualBaseline: "FY2025 10-K",
    quarters: movementQuarters,
    metrics: {
      operatingLossMagnitudeChangeQ3vsQ1Pct: percentageChange(first.operatingLoss, last.operatingLoss),
      netLossMagnitudeChangeQ3vsQ1Pct: percentageChange(first.netLoss, last.netLoss),
      operatingLossQ2vsQ1: movementQuarters[1].operatingLoss - first.operatingLoss,
      operatingLossQ3vsQ2: movementQuarters[2].operatingLoss - movementQuarters[1].operatingLoss
    },
    reading: "Loss magnitude improved in Q2 and worsened in Q3; this is a reported accounting movement, not a causal explanation or an outcome for workers or customers.",
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
for (const source of map.sources) {
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
        reviewQueue: sourceScan.reviewQueue
      }
    }
  } : {}),
  records,
  insights: [map.insight]
};

await mkdir(resolve(root, "data/processed"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
console.log(`Built ${records.length} records from ${new Set(records.map((record) => record.sourceRepository)).size} repositories.`);
console.log(`Wrote ${outputPath}`);
