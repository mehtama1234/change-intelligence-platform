import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-scheduler-"));
await writeFile(resolve(runtimeDir, "workspace-watchlists.json"), `${JSON.stringify({ schemaVersion: "workspace-watchlist-ledger-v1", watchlists: [] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-comparison-views.json"), `${JSON.stringify({ schemaVersion: "workspace-comparison-view-ledger-v1", views: [] }, null, 2)}\n`);
const env = { ...process.env, RUNTIME_DATA_DIR: runtimeDir, REFRESH_SKIP_SEC: "1", REFRESH_RETRIES: "0", REFRESH_INTERVAL_MS: "1", SCHEDULER_MAX_CYCLES: "1" };
await exec(process.execPath, [resolve(root, "scripts/scheduler.mjs")], { cwd: root, env, maxBuffer: 10 * 1024 * 1024 });
const status = JSON.parse(await readFile(resolve(runtimeDir, "scheduler-status.json"), "utf8"));
const refresh = JSON.parse(await readFile(resolve(runtimeDir, "latest-refresh.json"), "utf8"));
if (status.schemaVersion !== "refresh-scheduler-status-v1" || status.status !== "stopped" || status.runCount !== 1 || status.lastRunStatus !== "complete" || status.lastRunId !== refresh.runId || refresh.status !== "complete") throw new Error("Scheduler did not persist a complete one-cycle status contract.");
console.log(`Scheduler test passed: one refresh cycle completed as ${status.lastRunId}, and stopped with durable status.`);
