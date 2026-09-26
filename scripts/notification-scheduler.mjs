import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const intervalMs = Math.max(1000, Number(process.env.NOTIFICATION_INTERVAL_MS ?? 60 * 1000));
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const statusPath = resolve(runtimeDir, "notification-scheduler-status.json");
let stopping = false;
let wakeScheduler;
let activeChild;
let status = { schemaVersion: "notification-scheduler-status-v1", status: "starting", pid: process.pid, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), runCount: 0, lastRunStartedAt: null, lastRunEndedAt: null, lastRunStatus: null, lastExitCode: null, nextRunAt: null, error: null };

async function writeStatus(patch = {}) {
  status = { ...status, ...patch, updatedAt: new Date().toISOString() };
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);
}

function runDispatcher(script) {
  return new Promise((resolveRun) => {
    activeChild = spawn(process.execPath, [resolve(root, "scripts", script)], { cwd: root, env: { ...process.env, RUNTIME_DATA_DIR: runtimeDir }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    activeChild.stdout.on("data", (data) => { output += data; });
    activeChild.stderr.on("data", (data) => { output += data; });
    activeChild.on("close", (code) => { activeChild = undefined; resolveRun({ script, code: code ?? 1, output: output.trim().slice(-2000) }); });
  });
}

async function cycle() {
  const startedAt = new Date().toISOString();
  status.runCount += 1;
  await writeStatus({ status: "running", lastRunStartedAt: startedAt, nextRunAt: null, error: null });
  const results = [];
  for (const script of ["dispatch-operator-notifications.mjs", "dispatch-workspace-notifications.mjs"]) {
    if (stopping) break;
    results.push(await runDispatcher(script));
  }
  const failed = results.filter((result) => result.code !== 0);
  const endedAt = new Date().toISOString();
  await writeStatus({ status: stopping ? "stopping" : failed.length ? "failed" : "sleeping", lastRunEndedAt: endedAt, lastRunStatus: failed.length ? "failed" : "complete", lastExitCode: failed[0]?.code ?? 0, nextRunAt: stopping ? null : new Date(Date.now() + intervalMs).toISOString(), error: failed.length ? failed.map((result) => `${result.script}: ${result.output}`).join("\n").slice(-4000) : null });
}

function waitForNextCycle(delayMs) {
  return new Promise((resolveSleep) => {
    const timer = setTimeout(() => { wakeScheduler = undefined; resolveSleep(); }, delayMs);
    wakeScheduler = () => { clearTimeout(timer); wakeScheduler = undefined; resolveSleep(); };
  });
}

async function main() {
  await writeStatus({ status: "starting", nextRunAt: new Date().toISOString(), error: null });
  const maxCycles = Number(process.env.NOTIFICATION_SCHEDULER_MAX_CYCLES ?? 0);
  while (!stopping) {
    await cycle();
    if (stopping) break;
    if (maxCycles > 0 && status.runCount >= maxCycles) { stopping = true; break; }
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
