import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const base = await mkdtemp(resolve(tmpdir(), "change-intelligence-production-topology-"));
const runtimeDir = resolve(base, "runtime");
const backupDir = resolve(base, "backups");
const port = 8799;
await mkdir(runtimeDir, { recursive: true });
await writeFile(resolve(runtimeDir, "workspace-watchlists.json"), `${JSON.stringify({ schemaVersion: "workspace-watchlist-ledger-v1", watchlists: [] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-comparison-views.json"), `${JSON.stringify({ schemaVersion: "workspace-comparison-view-ledger-v1", views: [] }, null, 2)}\n`);

const children = [];
function start(script, env) {
  const child = spawn(process.execPath, [resolve(root, script)], { cwd: root, env: { ...process.env, RUNTIME_DATA_DIR: runtimeDir, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  children.push({ child, script, getOutput: () => output });
  return children.at(-1);
}

async function waitForFile(name, predicate, label) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const value = JSON.parse(await readFile(resolve(runtimeDir, name), "utf8"));
      if (predicate(value)) return value;
    } catch {}
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function stop(entry) {
  if (!entry || entry.child.exitCode !== null) return;
  entry.child.kill("SIGTERM");
  await new Promise((resolveExit) => entry.child.once("exit", resolveExit));
}

try {
  let passed = false;
  const refresh = start("scripts/scheduler.mjs", { REFRESH_SKIP_SEC: "1", REFRESH_RETRIES: "0", REFRESH_INTERVAL_MS: "3600000" });
  await waitForFile("scheduler-status.json", (value) => value.status === "sleeping" && value.lastRunStatus === "complete", "refresh worker heartbeat");
  const backup = start("scripts/backup-scheduler.mjs", { BACKUP_DIR: backupDir, BACKUP_INTERVAL_MS: "3600000" });
  await waitForFile("backup-scheduler-status.json", (value) => value.status === "sleeping" && value.lastRunStatus === "complete", "backup worker heartbeat");
  const notifications = start("scripts/notification-scheduler.mjs", { NOTIFICATION_INTERVAL_MS: "3600000", OPERATOR_NOTIFICATION_DELIVERY_MODE: "disabled" });
  await waitForFile("notification-scheduler-status.json", (value) => value.status === "sleeping" && value.lastRunStatus === "complete", "notification worker heartbeat");
  const api = start("server.mjs", { PORT: String(port), BACKUP_DIR: backupDir, REQUIRE_WORKER_HEALTH: "1", WORKER_STATUS_MAX_AGE_MS: "86400000", MAX_REFRESH_AGE_MS: "86400000", MAX_SOURCE_AGE_MS: "86400000" });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/readiness`);
      const body = await response.json();
      if (response.status === 200) {
        if (body.status !== "ready" || body.checks.workers?.status !== "ok") throw new Error(`Production readiness was not healthy: ${JSON.stringify(body)}`);
        const operations = await (await fetch(`http://127.0.0.1:${port}/api/operations`)).json();
        if (operations.scheduler?.status !== "sleeping" || operations.backupScheduler?.status !== "sleeping" || operations.notificationScheduler?.status !== "sleeping") throw new Error(`Operations did not expose all live workers: ${JSON.stringify(operations)}`);
        console.log("Production topology test passed: refresh, backup, notification, and API processes shared one runtime and reached worker-aware readiness.");
        passed = true;
        break;
      }
    } catch (error) {
      if (error.message.startsWith("Production readiness") || error.message.startsWith("Operations did not")) throw error;
    }
    await new Promise((wait) => setTimeout(wait, 100));
  }
  if (!passed) throw new Error(`API did not reach production readiness: ${api.getOutput()}`);
} finally {
  for (const entry of children.slice().reverse()) await stop(entry);
}
