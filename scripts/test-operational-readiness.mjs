import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore, importRuntimeLedgers } from "../storage.mjs";
import { backupRuntime } from "../runtime-backup.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRuntime = resolve(root, "data/processed/runs/ai-work-control");
const baseTemp = `/tmp/change-intelligence-readiness-${Date.now()}`;
const runtimeDir = resolve(baseTemp, "runtime");
const backupDir = resolve(baseTemp, "backup");
const port = 8797;
await mkdir(runtimeDir, { recursive: true });
for (const name of ["latest-refresh.json", "latest-source-scan.json", "refresh-history.json"]) await copyFile(resolve(sourceRuntime, name), resolve(runtimeDir, name));
const store = createRuntimeStore(runtimeDir);
await importRuntimeLedgers(store, { runtimeDir, questions: resolve(runtimeDir, "workspace-questions.json"), audit: resolve(runtimeDir, "audit-log.json"), operations: resolve(runtimeDir, "idempotency-operations.json"), alerts: resolve(runtimeDir, "workspace-alerts.json"), briefingPublications: resolve(runtimeDir, "briefing-publications.json"), insightDecisions: resolve(runtimeDir, "insight-decisions.json"), insightPublications: resolve(runtimeDir, "insight-publications.json"), sourceScan: resolve(runtimeDir, "latest-source-scan.json"), evidenceLedger: resolve(runtimeDir, "versioned-evidence-ledger.json"), reviewDecisions: resolve(runtimeDir, "review-decisions.json") });
store.close();
await backupRuntime({ runtimeDir, destination: backupDir });

const child = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, BACKUP_DIR: backupDir, MAX_REFRESH_AGE_MS: String(24 * 60 * 60 * 1000), MAX_SOURCE_AGE_MS: String(24 * 60 * 60 * 1000) }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
async function readiness() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/api/readiness`); if (response.status !== 503 || attempt > 0) return { response, body: await response.json() }; } catch {}
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error(`API did not start. ${output}`);
}
try {
  const healthy = await readiness();
  if (healthy.response.status !== 200 || healthy.body.status !== "ready" || healthy.body.checks.backup.status !== "ok") throw new Error(`Expected ready response: ${JSON.stringify(healthy.body)}`);
  const operationsResponse = await fetch(`http://127.0.0.1:${port}/api/operations`);
  const operations = await operationsResponse.json();
  if (operationsResponse.status !== 200 || operations.schemaVersion !== "operations-read-model-v1" || !operations.database.integrity || !operations.refreshHistory.length) throw new Error("Operations read model contract failed.");
  const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`);
  const metrics = await metricsResponse.text();
  if (metricsResponse.status !== 200 || !metrics.includes("change_intelligence_ready 1") || !metrics.includes("change_intelligence_refresh_age_seconds")) throw new Error("Metrics contract failed.");
  await writeFile(resolve(runtimeDir, "latest-refresh.json"), `${JSON.stringify({ status: "partial", endedAt: new Date().toISOString(), steps: [] })}\n`);
  const degraded = await readiness();
  if (degraded.response.status !== 503 || degraded.body.status !== "degraded" || degraded.body.checks.refresh.status !== "failed") throw new Error(`Expected degraded response: ${JSON.stringify(degraded.body)}`);
  console.log("Operational readiness test passed: healthy and degraded states are observable.");
} finally {
  child.kill("SIGTERM");
}
