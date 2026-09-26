import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const registry = JSON.parse(await readFile(resolve(root, "data/source-registry.json"), "utf8"));
const statePath = resolve(runtimeDir, "refresh-scope-state.json");
const outputPath = resolve(runtimeDir, process.env.REFRESH_SCOPE_OUTPUT ?? "refresh-scope.json");
const now = new Date(process.env.REFRESH_NOW ?? Date.now());
if (!Number.isFinite(now.getTime())) throw new Error("REFRESH_NOW must be a valid date.");
const durations = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000, monthly: 30 * 24 * 60 * 60 * 1000, quarterly: 90 * 24 * 60 * 60 * 1000 };
const prior = existsSync(statePath) ? JSON.parse(await readFile(statePath, "utf8")) : { lastRunAtByRepository: {} };
const forced = process.env.REFRESH_FORCE_ALL === "1";
const repositories = (registry.repositories ?? []).map((repository) => {
  const intervalMs = durations[repository.refresh];
  if (!intervalMs) throw new Error(`${repository.id}: unsupported refresh cadence ${repository.refresh}`);
  const lastRunAt = prior.lastRunAtByRepository?.[repository.id] ?? null;
  const nextDueAt = lastRunAt ? new Date(Date.parse(lastRunAt) + intervalMs).toISOString() : now.toISOString();
  const due = forced || !lastRunAt || Date.parse(nextDueAt) <= now.getTime();
  return { id: repository.id, cadence: repository.refresh, lastRunAt, nextDueAt, state: due ? "due" : "deferred" };
});
const dueRepositories = repositories.filter((repository) => repository.state === "due").map((repository) => repository.id);
const scope = { schemaVersion: "refresh-scope-v1", runId: process.env.REFRESH_RUN_ID ?? null, plannedAt: now.toISOString(), forced, dueRepositories, deferredRepositories: repositories.filter((repository) => repository.state === "deferred").map((repository) => repository.id), repositories };
await mkdir(runtimeDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(scope, null, 2)}\n`);
console.log(JSON.stringify({ runId: scope.runId, dueRepositories: scope.dueRepositories, deferredRepositories: scope.deferredRepositories }, null, 2));
