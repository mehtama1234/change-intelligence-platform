import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const registryPath = resolve(root, "data/source-registry.json");
const mapPath = resolve(root, "data/source-maps/ai-work-control.sources.json");
const runDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const latestPath = resolve(runDir, "latest-source-scan.json");
const historyPath = resolve(runDir, "source-scan-history.json");
const registry = JSON.parse(await readFile(registryPath, "utf8"));
const map = JSON.parse(await readFile(mapPath, "utf8"));
const configuredRepositories = new Set(registry.repositories.map((repository) => repository.id));
const sourceRoot = process.env.RESEARCH_ROOT ?? registry.researchRoot;
const previous = existsSync(latestPath) ? JSON.parse(await readFile(latestPath, "utf8")) : undefined;
const previousById = new Map((previous?.sources ?? []).map((source) => [source.id, source]));

const sources = [];
for (const source of map.sources) {
  if (!configuredRepositories.has(source.sourceRepository)) {
    throw new Error(`${source.id}: repository is not registered: ${source.sourceRepository}`);
  }
  const path = resolve(sourceRoot, source.sourceRepository, source.sourcePath);
  const result = {
    id: source.id,
    repository: source.sourceRepository,
    path: source.sourcePath,
    checkedAt: new Date().toISOString()
  };
  if (!existsSync(path)) {
    result.status = "missing";
  } else {
    const raw = await readFile(path);
    result.bytes = raw.length;
    result.sha256 = createHash("sha256").update(raw).digest("hex");
    const old = previousById.get(source.id);
    result.previousSha256 = old?.sha256;
    result.status = !old ? "new" : old.sha256 === result.sha256 ? "unchanged" : "changed";
  }
  result.needsReview = result.status !== "unchanged";
  result.reviewReason = {
    new: "No prior capture exists for this source.",
    changed: "Source bytes changed since the last scan; re-extract and review affected claims.",
    missing: "Configured source is unavailable; check the repository or source path.",
    unchanged: null
  }[result.status];
  sources.push(result);
}

const counts = Object.fromEntries(["new", "changed", "unchanged", "missing"].map((status) => [status, sources.filter((source) => source.status === status).length]));
const reviewQueue = sources.filter((source) => source.needsReview).map((source) => ({
  id: `review-${source.id}-${source.status}`,
  sourceId: source.id,
  repository: source.repository,
  sourcePath: source.path,
  state: "needs_review",
  action: source.status === "missing" ? "investigate_source_loss" : "reacquire_and_reextract",
  reason: source.reviewReason,
  previousSha256: source.previousSha256,
  currentSha256: source.sha256
}));
const receipt = {
  schemaVersion: "source-scan-receipt-v1",
  runId: `scan-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
  generatedAt: new Date().toISOString(),
  domain: map.domain,
  repositories: registry.repositories.map((repository) => repository.id),
  counts,
  reviewRequired: reviewQueue.length,
  reviewQueue,
  sources
};

await mkdir(runDir, { recursive: true });
await writeFile(latestPath, `${JSON.stringify(receipt, null, 2)}\n`);
const history = existsSync(historyPath) ? JSON.parse(await readFile(historyPath, "utf8")) : { schemaVersion: "source-scan-history-v1", runs: [] };
history.runs = [...(history.runs ?? []), { runId: receipt.runId, generatedAt: receipt.generatedAt, counts: receipt.counts, sources: receipt.sources }].slice(-100);
history.updatedAt = receipt.generatedAt;
await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
console.log(JSON.stringify({ runId: receipt.runId, counts, reviewRequired: receipt.reviewRequired, repositories: receipt.repositories.length }, null, 2));
console.log(`Wrote ${latestPath}`);
