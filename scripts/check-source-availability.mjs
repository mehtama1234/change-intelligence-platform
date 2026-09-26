import { createHash } from "node:crypto";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const registry = JSON.parse(await readFile(resolve(root, "data/source-registry.json"), "utf8"));
const map = JSON.parse(await readFile(resolve(root, process.env.SOURCE_MAP_PATH ?? "data/source-maps/ai-work-control.sources.json"), "utf8"));
const sourceRoot = process.env.RESEARCH_ROOT ?? registry.researchRoot;
const outputPath = resolve(runtimeDir, process.env.SOURCE_AVAILABILITY_PATH ?? "latest-source-availability.json");
const historyPath = resolve(runtimeDir, "source-availability-history.json");
const eventsPath = resolve(runtimeDir, "source-availability-events.json");
const checkedAt = new Date().toISOString();
const previous = await (async () => { try { return JSON.parse(await readFile(outputPath, "utf8")); } catch (error) { if (error.code === "ENOENT") return { sources: [] }; throw error; } })();
const previousById = new Map((previous.sources ?? []).map((source) => [source.id, source]));
const sources = [];
for (const source of map.sources ?? []) {
  const path = resolve(sourceRoot, source.sourceRepository, source.sourcePath);
  try {
    const [metadata, raw] = await Promise.all([stat(path), readFile(path)]);
    sources.push({ id: source.id, repository: source.sourceRepository, sourcePath: source.sourcePath, status: "available", bytes: metadata.size, sha256: createHash("sha256").update(raw).digest("hex"), checkedAt });
  } catch (error) {
    sources.push({ id: source.id, repository: source.sourceRepository, sourcePath: source.sourcePath, status: "unavailable", reason: error.code === "ENOENT" ? "missing" : error.code ?? "unreadable", checkedAt });
  }
}
const repositories = (registry.repositories ?? []).map((repository) => {
  const records = sources.filter((source) => source.repository === repository.id);
  return { id: repository.id, status: records.every((source) => source.status === "available") ? "available" : "unavailable", available: records.filter((source) => source.status === "available").length, unavailable: records.filter((source) => source.status !== "available").length };
});
const runId = `availability-${checkedAt.replace(/[^0-9]/g, "").slice(0, 17)}`;
const transitions = sources.flatMap((source) => {
  const prior = previousById.get(source.id);
  if (!prior || prior.status === source.status) return [];
  return [{ id: `availability-event-${source.id}-${runId}`, runId, sourceId: source.id, repository: source.repository, sourcePath: source.sourcePath, fromStatus: prior.status, toStatus: source.status, reason: source.reason ?? null, occurredAt: checkedAt }];
});
const result = { schemaVersion: "source-availability-receipt-v1", runId, checkedAt, counts: { available: sources.filter((source) => source.status === "available").length, unavailable: sources.filter((source) => source.status !== "available").length }, repositories, sources, transitions };
await mkdir(runtimeDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
const history = await (async () => { try { return JSON.parse(await readFile(historyPath, "utf8")); } catch (error) { if (error.code === "ENOENT") return { schemaVersion: "source-availability-history-v1", runs: [] }; throw error; } })();
history.runs = [...(history.runs ?? []), { runId: result.runId, checkedAt: result.checkedAt, counts: result.counts, repositories: result.repositories, transitions }].slice(-100);
history.updatedAt = result.checkedAt;
await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
const events = await (async () => { try { return JSON.parse(await readFile(eventsPath, "utf8")); } catch (error) { if (error.code === "ENOENT") return { schemaVersion: "source-availability-event-ledger-v1", events: [] }; throw error; } })();
events.events = [...(events.events ?? []), ...transitions].slice(-500);
events.updatedAt = checkedAt;
await writeFile(eventsPath, `${JSON.stringify(events, null, 2)}\n`);
console.log(JSON.stringify({ runId: result.runId, counts: result.counts, repositories: result.repositories.length }, null, 2));
