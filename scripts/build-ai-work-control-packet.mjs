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

const records = [];
for (const source of map.sources) {
  const fullPath = resolve(sourceRoot, source.sourceRepository, source.sourcePath);
  const raw = await readFile(fullPath, "utf8");
  const digest = createHash("sha256").update(raw).digest("hex");
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
