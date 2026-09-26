import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const registryPath = resolve(root, "data/source-registry.json");
const mapPath = resolve(root, "data/source-maps/ai-work-control.sources.json");
const runDir = resolve(root, "data/processed/runs/ai-work-control");
const latestPath = resolve(runDir, "latest-source-scan.json");
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
    result.status = !old ? "new" : old.sha256 === result.sha256 ? "unchanged" : "changed";
  }
  sources.push(result);
}

const counts = Object.fromEntries(["new", "changed", "unchanged", "missing"].map((status) => [status, sources.filter((source) => source.status === status).length]));
const receipt = {
  schemaVersion: "source-scan-receipt-v1",
  runId: `scan-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`,
  generatedAt: new Date().toISOString(),
  domain: map.domain,
  repositories: registry.repositories.map((repository) => repository.id),
  counts,
  sources
};

await mkdir(runDir, { recursive: true });
await writeFile(latestPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ runId: receipt.runId, counts, repositories: receipt.repositories.length }, null, 2));
console.log(`Wrote ${latestPath}`);
