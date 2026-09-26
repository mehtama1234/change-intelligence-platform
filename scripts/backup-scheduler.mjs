import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const intervalMs = Number(process.env.BACKUP_INTERVAL_MS ?? 24 * 60 * 60 * 1000);
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const backupDir = resolve(root, process.env.BACKUP_DIR ?? "data/backups/ai-work-control");
const statusPath = resolve(runtimeDir, "backup-scheduler-status.json");
let stopping = false;
let activeChild;
let wakeScheduler;
let status = { schemaVersion: "runtime-backup-scheduler-status-v1", status: "starting", pid: process.pid, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), runCount: 0, lastRunStartedAt: null, lastRunEndedAt: null, lastRunStatus: null, lastExitCode: null, lastBackupFileCount: null, nextRunAt: null, error: null };

async function writeStatus(patch = {}) {
  status = { ...status, ...patch, updatedAt: new Date().toISOString() };
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);
}

function waitForNextCycle(delayMs) {
  return new Promise((resolveSleep) => {
    const timer = setTimeout(() => { wakeScheduler = undefined; resolveSleep(); }, delayMs);
    wakeScheduler = () => { clearTimeout(timer); wakeScheduler = undefined; resolveSleep(); };
  });
}

function cycle() {
  const startedAt = new Date().toISOString();
  status.runCount += 1;
  return new Promise((resolveCycle) => {
    activeChild = spawn(process.execPath, [resolve(root, "scripts/backup-runtime.mjs")], { cwd: root, env: { ...process.env, RUNTIME_DATA_DIR: runtimeDir, BACKUP_DIR: backupDir }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    activeChild.stdout.on("data", (data) => { output += data; });
    activeChild.stderr.on("data", (data) => { output += data; });
    activeChild.on("close", async (code) => {
      const endedAt = new Date().toISOString();
      const successful = code === 0;
      const fileCount = successful ? Number(output.match(/with (\d+) files/)?.[1] ?? 0) : null;
      await writeStatus({ status: stopping ? "stopping" : successful ? "sleeping" : "failed", lastRunStartedAt: startedAt, lastRunEndedAt: endedAt, lastRunStatus: successful ? "complete" : "failed", lastExitCode: code ?? 1, lastBackupFileCount: fileCount, nextRunAt: stopping ? null : new Date(Date.now() + intervalMs).toISOString(), error: successful ? null : output.trim().slice(-2000) });
      activeChild = undefined;
      resolveCycle(code ?? 1);
    });
  });
}

async function main() {
  await writeStatus({ status: "starting", nextRunAt: new Date().toISOString(), error: null });
  const maxCycles = Number(process.env.BACKUP_SCHEDULER_MAX_CYCLES ?? 0);
  while (!stopping) {
    await writeStatus({ status: "running", nextRunAt: null, error: null });
    await cycle();
    if (stopping) break;
    if (maxCycles > 0 && status.runCount >= maxCycles) { stopping = true; break; }
    await writeStatus({ status: "sleeping", nextRunAt: new Date(Date.now() + intervalMs).toISOString() });
    await waitForNextCycle(intervalMs);
  }
  await writeStatus({ status: "stopped", nextRunAt: null });
}

function stop() {
  stopping = true;
  wakeScheduler?.();
  if (activeChild) activeChild.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await main();
