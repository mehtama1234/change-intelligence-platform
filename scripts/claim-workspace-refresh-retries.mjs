import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const runId = String(process.env.REFRESH_RUN_ID ?? "");
const startedAt = process.env.REFRESH_STARTED_AT ?? new Date().toISOString();
if (!runId) throw new Error("REFRESH_RUN_ID is required.");
const path = resolve(runtimeDir, "workspace-refresh-outcomes.json");
let ledger;
try { ledger = JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") { console.log(JSON.stringify({ runId, claimed: 0 })); process.exit(0); } throw error; }
let claimed = 0;
ledger.outcomes = (ledger.outcomes ?? []).map((outcome) => {
  if (outcome.status !== "retry_requested") return outcome;
  claimed += 1;
  return { ...outcome, status: "retrying", retryStartedAt: startedAt, retryRunId: runId, retryAttempts: Number(outcome.retryAttempts ?? 0) + 1 };
});
ledger.updatedAt = startedAt;
await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify({ runId, claimed }, null, 2));
