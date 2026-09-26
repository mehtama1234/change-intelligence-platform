import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const intervalMs = Number(process.env.REFRESH_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const statusPath = resolve(runtimeDir, "scheduler-status.json");
let stopping = false;
let activeChild;
let wakeScheduler;
let status = { schemaVersion: "refresh-scheduler-status-v1", status: "starting", pid: process.pid, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), runCount: 0, lastRunId: null, lastRunStatus: null, lastRunStartedAt: null, lastRunEndedAt: null, lastExitCode: null, nextRunAt: null, error: null };

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
  const runId = `refresh-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17)}-scheduled`;
  const runStartedAt = new Date().toISOString();
  status.runCount += 1;
  const childEnv = { ...process.env, REFRESH_RUN_ID: runId };
  return new Promise((resolveCycle) => {
    activeChild = spawn(process.execPath, [resolve(root, "scripts/run-refresh-cycle.mjs")], { cwd: root, env: childEnv, stdio: "inherit" });
    activeChild.on("close", async (code) => {
      const endedAt = new Date().toISOString();
      await writeStatus({ status: stopping ? "stopping" : code === 0 ? "sleeping" : "failed", lastRunId: runId, lastRunStatus: code === 0 ? "complete" : "failed", lastRunStartedAt: runStartedAt, lastRunEndedAt: endedAt, lastExitCode: code ?? 1, nextRunAt: stopping ? null : new Date(Date.now() + intervalMs).toISOString(), error: code === 0 ? null : `Refresh process exited with code ${code ?? 1}.` });
      activeChild = undefined;
      resolveCycle(code ?? 1);
    });
  });
}

async function main() {
  console.log(`Refresh scheduler started; interval ${intervalMs}ms.`);
  await writeStatus({ status: "starting", nextRunAt: new Date().toISOString(), error: null });
  const maxCycles = Number(process.env.SCHEDULER_MAX_CYCLES ?? 0);
  while (!stopping) {
    await writeStatus({ status: "running", nextRunAt: null, error: null });
    await cycle();
    if (stopping) break;
    if (maxCycles > 0 && status.runCount >= maxCycles) { stopping = true; break; }
    await writeStatus({ status: "sleeping", nextRunAt: new Date(Date.now() + intervalMs).toISOString() });
    await waitForNextCycle(intervalMs);
  }
  await writeStatus({ status: "stopped", nextRunAt: null });
  console.log("Refresh scheduler stopped.");
}

function stop() {
  stopping = true;
  wakeScheduler?.();
  if (activeChild) activeChild.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await main();
