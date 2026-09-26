import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const registry = JSON.parse(await readFile(resolve(root, "data/source-registry.json"), "utf8"));
const map = JSON.parse(await readFile(resolve(root, "data/source-maps/ai-work-control.sources.json"), "utf8"));
const scanPath = resolve(root, process.env.SOURCE_SCAN_PATH ?? "data/processed/runs/ai-work-control/latest-source-scan.json");
const outputDir = resolve(root, process.env.REVIEW_OUTPUT_DIR ?? "data/processed/runs/ai-work-control");
const outputPath = resolve(outputDir, process.env.REVIEW_OUTPUT_NAME ?? "latest-review-work.json");
const scan = JSON.parse(await readFile(scanPath, "utf8"));
const sourceRoot = process.env.RESEARCH_ROOT ?? registry.researchRoot;
const sourceById = new Map(map.sources.map((source) => [source.id, source]));

function stripMarkup(text) {
  return text.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function excerpt(text, terms = []) {
  const clean = stripMarkup(text);
  const lower = clean.toLowerCase();
  const position = terms.map((term) => lower.indexOf(term.toLowerCase())).find((index) => index >= 0);
  if (position === undefined) return clean.slice(0, 700);
  return clean.slice(Math.max(0, position - 180), position + 520);
}

const candidates = [];
for (const item of scan.reviewQueue) {
  const source = sourceById.get(item.sourceId);
  if (!source) throw new Error(`Review item references unknown source: ${item.sourceId}`);
  const path = resolve(sourceRoot, source.sourceRepository, source.sourcePath);
  if (item.action === "investigate_source_loss" || !existsSync(path)) {
    candidates.push({
      id: item.id,
      sourceId: item.sourceId,
      repository: item.repository,
      state: "blocked",
      action: item.action,
      reason: item.reason,
      sourcePath: item.sourcePath
    });
    continue;
  }
  const raw = await readFile(path, "utf8");
  const sha256 = createHash("sha256").update(raw).digest("hex");
  candidates.push({
    id: item.id,
    sourceId: item.sourceId,
    repository: item.repository,
    state: "ready_for_researcher",
    action: item.action,
    reason: item.reason,
    sourcePath: item.sourcePath,
    sourceRole: source.sourceRole,
    sourceLocator: source.sourceLocator,
    title: source.title,
    observation: source.observation,
    theme: source.theme,
    mechanism: source.mechanism,
    affectedGroups: source.affectedGroups,
    claimState: source.claimState,
    asOf: source.asOf,
    sourceDigest: sha256,
    sourceBytes: Buffer.byteLength(raw),
    sourceExcerpt: excerpt(raw, source.excerptTerms),
    limits: source.limits,
    publication: "not_published"
  });
}

const result = {
  schemaVersion: "source-review-work-v1",
  generatedAt: new Date().toISOString(),
  scanRunId: scan.runId,
  reviewRequired: candidates.length,
  readyForResearcher: candidates.filter((candidate) => candidate.state === "ready_for_researcher").length,
  blocked: candidates.filter((candidate) => candidate.state === "blocked").length,
  candidates
};
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ scanRunId: result.scanRunId, reviewRequired: result.reviewRequired, readyForResearcher: result.readyForResearcher, blocked: result.blocked }, null, 2));
console.log(`Wrote ${outputPath}`);
