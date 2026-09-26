import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const registry = JSON.parse(await readFile(resolve(root, "data/source-registry.json"), "utf8"));
const map = JSON.parse(await readFile(resolve(root, process.env.SOURCE_MAP_PATH ?? "data/source-maps/ai-work-control.sources.json"), "utf8"));
const sourceRoot = process.env.RESEARCH_ROOT ?? registry.researchRoot;
const runtimeDir = process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control";
const scanPath = resolve(root, process.env.SOURCE_SCAN_PATH ?? `${runtimeDir}/latest-source-scan.json`);
const outputPath = resolve(root, process.env.INGESTION_OUTPUT_PATH ?? `${runtimeDir}/research-ingestion.json`);
const scan = existsSync(scanPath) ? JSON.parse(await readFile(scanPath, "utf8")) : { sources: [] };
const scanById = new Map((scan.sources ?? []).map((source) => [source.id, source]));
const repositoryIds = new Set((registry.repositories ?? []).map((repository) => repository.id));
const records = [];
const errors = [];
for (const source of map.sources ?? []) {
  if (!repositoryIds.has(source.sourceRepository)) errors.push(`${source.id}: repository is not registered`);
  const sourcePath = resolve(sourceRoot, source.sourceRepository, source.sourcePath);
  if (!existsSync(sourcePath)) { errors.push(`${source.id}: source file is unavailable`); continue; }
  const raw = await readFile(sourcePath);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const scanRecord = scanById.get(source.id);
  if (scanRecord?.sha256 && scanRecord.sha256 !== sha256) errors.push(`${source.id}: scan digest does not match source bytes`);
  records.push({ ...source, sourceDigest: sha256, sourceBytes: raw.length, capturePath: scanRecord?.capturePath ?? null, ingestedAt: new Date().toISOString() });
}
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
const repositories = (registry.repositories ?? []).map((repository) => ({ ...repository, recordCount: records.filter((record) => record.sourceRepository === repository.id).length, status: records.some((record) => record.sourceRepository === repository.id) ? "ingested" : "empty" }));
const result = { schemaVersion: "research-ingestion-ledger-v1", generatedAt: new Date().toISOString(), domain: map.domain, sourceSnapshotDate: map.snapshotDate, scanRunId: scan.runId ?? null, repositories, records };
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, repositories: repositories.length, records: records.length, readable: records.filter((record) => record.capturePath).length }, null, 2));
