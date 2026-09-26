import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const lockPath = resolve(runDir, "refresh.lock");
const receiptPath = resolve(runDir, "latest-refresh.json");
const historyPath = resolve(runDir, "refresh-history.json");
const secCaptureDir = resolve(runDir, "raw/ai-work-control/c3-ai");
const secManifestPath = resolve(secCaptureDir, "manifest.json");
const secXbrlPath = resolve(runDir, "c3-ai.xbrl.json");
const childEnv = {
  ...process.env,
  RUNTIME_DATA_DIR: runDir,
  PACKET_PATH: resolve(runDir, "ai-work-control.packet.json"),
  PACKET_OUTPUT_PATH: resolve(runDir, "ai-work-control.packet.json"),
  SOURCE_SCAN_PATH: resolve(runDir, "latest-source-scan.json"),
  ALERT_OUTPUT_DIR: runDir,
  WATCHLISTS_PATH: resolve(runDir, "workspace-watchlists.json"),
  PILOT_PROFILES_PATH: resolve(runDir, "workspace-pilot-profiles.json"),
  PILOT_DELIVERIES_PATH: resolve(runDir, "workspace-pilot-deliveries.json"),
  PILOT_DECISIONS_PATH: resolve(runDir, "workspace-pilot-decisions.json"),
  REVIEW_OUTPUT_DIR: runDir,
  EVIDENCE_OUTPUT_DIR: runDir,
  QUESTIONS_PATH: resolve(runDir, "workspace-questions.json"),
  QUESTION_OUTPUT_DIR: runDir,
  QUESTION_EVALUATIONS_PATH: resolve(runDir, "question-evaluations.json"),
  BRIEFINGS_PATH: resolve(runDir, "workspace-briefings.json"),
  BRIEFING_PUBLICATIONS_PATH: resolve(runDir, "briefing-publications.json"),
  INSIGHT_PACKET_PATH: resolve(runDir, "ai-work-control.packet.json"),
  INSIGHT_OUTPUT_DIR: runDir,
  INSIGHT_CANDIDATE_PATH: resolve(runDir, "insight-candidates.json"),
  INSIGHT_EVALUATION_PATH: resolve(runDir, "insight-evaluation.json"),
  ATLAS_OUTPUT_PATH: resolve(runDir, "domain-atlas.json"),
  SEC_CAPTURE_DIR: secCaptureDir,
  SEC_MANIFEST_PATH: secManifestPath,
  SEC_XBRL_PATH: secXbrlPath
};
const runId = `refresh-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17)}`;
childEnv.REFRESH_RUN_ID = runId;
const steps = [];
let lock;

async function runStep(name, script, optional = false) {
  const startedAt = new Date().toISOString();
  const startedEpoch = Date.now();
  const maxAttempts = Math.max(1, Number(process.env.REFRESH_RETRIES ?? 2) + 1);
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await exec(process.execPath, [resolve(root, "scripts", script)], {
        cwd: root,
        env: childEnv,
        maxBuffer: 10 * 1024 * 1024
      });
      steps.push({ name, status: "complete", attempts: attempt, startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - startedEpoch, output: result.stdout.trim().slice(-2000) });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise((resolveSleep) => setTimeout(resolveSleep, Number(process.env.REFRESH_RETRY_DELAY_MS ?? 1000) * attempt));
    }
  }
  const status = optional ? "warning" : "failed";
  steps.push({ name, status, attempts: maxAttempts, startedAt, endedAt: new Date().toISOString(), durationMs: Date.now() - startedEpoch, exitCode: lastError?.code, output: `${lastError?.stdout ?? ""}${lastError?.stderr ?? ""}`.trim().slice(-2000) });
}

try {
  await mkdir(runDir, { recursive: true });
  lock = await open(lockPath, "wx");
  if (process.env.REFRESH_SKIP_SEC === "1") {
    steps.push({ name: "capture-sec-filings", status: "skipped", reason: "SEC capture skipped by configuration." });
    steps.push({ name: "extract-sec-xbrl", status: "skipped", reason: "SEC extraction skipped by configuration." });
  } else {
    await runStep("capture-sec-filings", "acquire-sec-filing-window.mjs", true);
    if (existsSync(secManifestPath)) {
      await runStep("extract-sec-xbrl", "extract-sec-xbrl-window.mjs", true);
    } else {
      steps.push({ name: "extract-sec-xbrl", status: "skipped", reason: "No SEC capture manifest exists." });
    }
  }
  await runStep("validate-source-adapters", "validate-source-adapters.mjs");
  await runStep("scan-repositories", "scan-source-changes.mjs");
  await runStep("ingest-research-repositories", "ingest-research-repositories.mjs");
  await runStep("evaluate-watchlists", "evaluate-watchlists.mjs");
  await runStep("process-review-work", "process-source-review.mjs");
  await runStep("materialize-evidence", "materialize-evidence-versions.mjs");
  await runStep("build-packet", "build-ai-work-control-packet.mjs");
  await runStep("build-domain-atlas", "build-domain-atlas.mjs");
  await runStep("evaluate-questions", "evaluate-questions.mjs");
  await runStep("build-question-briefings", "build-question-briefings.mjs");
  await runStep("publish-question-evaluations", "build-ai-work-control-packet.mjs");
  await runStep("generate-insight-candidates", "generate-insight-candidates.mjs");
  await runStep("evaluate-insight-quality", "evaluate-insight-quality.mjs");
  await runStep("publish-insight-candidates", "build-ai-work-control-packet.mjs");
  await runStep("build-pilot-deliveries", "build-pilot-deliveries.mjs");
  await runStep("evaluate-operator-warnings", "evaluate-operator-warnings.mjs");
  await runStep("sync-runtime-store", "sync-runtime-store.mjs");
  await runStep("dispatch-operator-notifications", "dispatch-operator-notifications.mjs", true);
  await runStep("record-pilot-readiness", "record-pilot-readiness.mjs");
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
  const history = existsSync(historyPath) ? JSON.parse(await readFile(historyPath, "utf8")) : { schemaVersion: "refresh-history-v1", runs: [] };
  history.runs = [...(history.runs ?? []), { runId: receipt.runId, startedAt: receipt.startedAt, endedAt: receipt.endedAt, status: receipt.status, steps: receipt.steps.map(({ name, status, attempts, durationMs }) => ({ name, status, attempts, durationMs })) }].slice(-100);
  history.updatedAt = receipt.endedAt;
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`);
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
