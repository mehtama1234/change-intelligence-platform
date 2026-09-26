import { copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore, importRuntimeLedgers } from "../storage.mjs";
import { backupRuntime, restoreRuntime } from "../runtime-backup.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRuntime = resolve(root, "data/processed/runs/ai-work-control");
const rootTemp = `/tmp/change-intelligence-backup-${Date.now()}`;
const runtimeDir = resolve(rootTemp, "runtime");
const backupDir = resolve(rootTemp, "backup");
const restoredDir = resolve(rootTemp, "restored");
await mkdir(runtimeDir, { recursive: true });
for (const name of ["workspace-questions.json", "audit-log.json", "idempotency-operations.json", "workspace-alerts.json", "briefing-publications.json", "insight-decisions.json", "insight-publications.json", "latest-source-scan.json", "versioned-evidence-ledger.json", "review-decisions.json", "refresh-history.json"]) {
  if (existsSync(resolve(sourceRuntime, name))) await copyFile(resolve(sourceRuntime, name), resolve(runtimeDir, name));
}
const store = createRuntimeStore(runtimeDir);
await importRuntimeLedgers(store, {
  runtimeDir,
  questions: resolve(runtimeDir, "workspace-questions.json"),
  audit: resolve(runtimeDir, "audit-log.json"),
  operations: resolve(runtimeDir, "idempotency-operations.json"),
  alerts: resolve(runtimeDir, "workspace-alerts.json"),
  briefingPublications: resolve(runtimeDir, "briefing-publications.json"),
  insightDecisions: resolve(runtimeDir, "insight-decisions.json"),
  insightPublications: resolve(runtimeDir, "insight-publications.json")
  ,sourceScan: resolve(runtimeDir, "latest-source-scan.json")
  ,evidenceLedger: resolve(runtimeDir, "versioned-evidence-ledger.json")
  ,reviewDecisions: resolve(runtimeDir, "review-decisions.json")
});
store.close();
const manifest = await backupRuntime({ runtimeDir, destination: backupDir });
if (!manifest.files.some((file) => file.name === "change-intelligence.sqlite")) throw new Error("Backup omitted SQLite database.");
await restoreRuntime({ backup: backupDir, destination: restoredDir });
const restoredStore = createRuntimeStore(restoredDir);
await importRuntimeLedgers(restoredStore, {
  runtimeDir: restoredDir,
  questions: resolve(restoredDir, "workspace-questions.json"),
  audit: resolve(restoredDir, "audit-log.json"),
  operations: resolve(restoredDir, "idempotency-operations.json"),
  alerts: resolve(restoredDir, "workspace-alerts.json"),
  briefingPublications: resolve(restoredDir, "briefing-publications.json"),
  insightDecisions: resolve(restoredDir, "insight-decisions.json"),
  insightPublications: resolve(restoredDir, "insight-publications.json")
  ,sourceScan: resolve(restoredDir, "latest-source-scan.json")
  ,evidenceLedger: resolve(restoredDir, "versioned-evidence-ledger.json")
  ,reviewDecisions: resolve(restoredDir, "review-decisions.json")
});
if (!restoredStore.questionsLedger().questions.length || !restoredStore.alertsLedger().alerts.length || !restoredStore.recordsLedger("source_scan", "source-snapshot-ledger-v1", "sources").sources.length) throw new Error("Restored runtime did not recover durable records.");
restoredStore.close();
const restoredManifest = JSON.parse(await readFile(resolve(backupDir, "manifest.json"), "utf8"));
if (restoredManifest.schemaVersion !== "runtime-backup-v1") throw new Error("Backup manifest schema was not preserved.");
console.log(`Runtime backup test passed: ${manifest.files.length} files backed up and restored with checksums.`);
