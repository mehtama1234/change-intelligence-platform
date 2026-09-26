import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runDir = resolve(root, "data/processed/runs/ai-work-control");
const lockPath = resolve(runDir, "refresh.lock");
const receiptPath = resolve(runDir, "latest-refresh.json");
const runId = `refresh-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
const steps = [];
let lock;

async function runStep(name, script, optional = false) {
  const startedAt = new Date().toISOString();
  try {
    const result = await exec(process.execPath, [resolve(root, "scripts", script)], {
      cwd: root,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });
    steps.push({ name, status: "complete", startedAt, endedAt: new Date().toISOString(), output: result.stdout.trim().slice(-2000) });
  } catch (error) {
    const status = optional ? "warning" : "failed";
    steps.push({ name, status, startedAt, endedAt: new Date().toISOString(), exitCode: error.code, output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim().slice(-2000) });
  }
}

try {
  await mkdir(runDir, { recursive: true });
  lock = await open(lockPath, "wx");
  await runStep("capture-sec-filings", "acquire-sec-filing-window.mjs", true);
  if (existsSync(resolve(root, "data/raw/ai-work-control/c3-ai/manifest.json"))) {
    await runStep("extract-sec-xbrl", "extract-sec-xbrl-window.mjs", true);
  } else {
    steps.push({ name: "extract-sec-xbrl", status: "skipped", reason: "No SEC capture manifest exists." });
  }
  await runStep("scan-repositories", "scan-source-changes.mjs");
  await runStep("evaluate-watchlists", "evaluate-watchlists.mjs");
  await runStep("process-review-work", "process-source-review.mjs");
  await runStep("materialize-evidence", "materialize-evidence-versions.mjs");
  await runStep("build-packet", "build-ai-work-control-packet.mjs");
  await runStep("evaluate-questions", "evaluate-questions.mjs");
  await runStep("publish-question-evaluations", "build-ai-work-control-packet.mjs");
  const failed = steps.filter((step) => step.status === "failed");
  const receipt = {
    schemaVersion: "refresh-receipt-v1",
    runId,
    startedAt: steps[0]?.startedAt ?? new Date().toISOString(),
    endedAt: new Date().toISOString(),
    status: failed.length ? "partial" : "complete",
    steps
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ runId, status: receipt.status, steps: steps.map(({ name, status }) => ({ name, status })) }, null, 2));
  if (failed.length) process.exitCode = 1;
} catch (error) {
  if (error.code === "EEXIST") {
    console.error(`Refresh already running; lock: ${lockPath}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
} finally {
  await lock?.close();
  if (lock) await unlink(lockPath).catch(() => {});
}
