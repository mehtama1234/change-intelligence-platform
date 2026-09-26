import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRoot = process.env.RESEARCH_ROOT ?? "/home/mehta/git-repo";
const mapPath = resolve(root, "data/source-maps/ai-work-control.sources.json");
const outputPath = resolve(root, "data/processed/ai-work-control.packet.json");
const map = JSON.parse(await readFile(mapPath, "utf8"));

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
  if (quarters.length < 3) throw new Error(`${source.id}: expected at least three quarterly rows`);
  const first = quarters[0];
  const last = quarters.at(-1);
  const directRecords = [...sourceLedger.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)]
    .map((match) => ({ label: match[1], url: match[2] }));
  return {
    annualBaseline: "FY2025 10-K",
    quarters,
    metrics: {
      operatingLossMagnitudeChangeQ3vsQ1Pct: percentageChange(first.operatingLoss, last.operatingLoss),
      netLossMagnitudeChangeQ3vsQ1Pct: percentageChange(first.netLoss, last.netLoss),
      operatingLossQ2vsQ1: quarters[1].operatingLoss - first.operatingLoss,
      operatingLossQ3vsQ2: quarters[2].operatingLoss - quarters[1].operatingLoss
    },
    reading: "Loss magnitude improved in Q2 and worsened in Q3; this is a reported accounting movement, not a causal explanation or an outcome for workers or customers.",
    sourceRefs: {
      bridge: source.reportWindow.bridgePath,
      initialRead: source.reportWindow.initialReadPath,
      initialReadDigest: createHash("sha256").update(initialRead).digest("hex"),
      directRecords
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
  records,
  insights: [map.insight]
};

await mkdir(resolve(root, "data/processed"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
console.log(`Built ${records.length} records from ${new Set(records.map((record) => record.sourceRepository)).size} repositories.`);
console.log(`Wrote ${outputPath}`);
