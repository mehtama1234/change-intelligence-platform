import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
await mkdir(resolve(runtimeDir, "raw/source-captures/test-source"), { recursive: true });
await writeFile(resolve(runtimeDir, "raw/source-captures/test-source/abc.source"), "immutable captured source\n");
await writeFile(resolve(runtimeDir, "source-capture-ledger.json"), `${JSON.stringify({ schemaVersion: "source-capture-ledger-v1", captures: [{ id: "test-source", sha256: "abc", capturePath: "raw/source-captures/test-source/abc.source" }] }, null, 2)}\n`);
for (const name of ["workspace-questions.json", "audit-log.json", "idempotency-operations.json", "workspace-alerts.json", "briefing-publications.json", "insight-decisions.json", "insight-publications.json", "workspace-pilot-profiles.json", "workspace-pilot-deliveries.json", "workspace-pilot-decisions.json", "operator-warning-events.json", "operator-notification-outbox.json", "operator-notification-routes.json", "operator-notification-attempts.json", "pilot-readiness.json", "latest-source-scan.json", "source-scan-history.json", "source-capture-ledger.json", "research-ingestion.json", "domain-atlas.json", "versioned-evidence-ledger.json", "review-decisions.json", "review-events.json", "refresh-history.json", "insight-evaluation.json"]) {
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
  insightPublications: resolve(runtimeDir, "insight-publications.json"),
  pilotProfiles: resolve(runtimeDir, "workspace-pilot-profiles.json"),
  pilotDeliveries: resolve(runtimeDir, "workspace-pilot-deliveries.json")
  ,pilotDecisions: resolve(runtimeDir, "workspace-pilot-decisions.json")
  ,operatorWarnings: resolve(runtimeDir, "operator-warning-events.json")
  ,operatorNotifications: resolve(runtimeDir, "operator-notification-outbox.json")
  ,operatorRoutes: resolve(runtimeDir, "operator-notification-routes.json")
  ,operatorAttempts: resolve(runtimeDir, "operator-notification-attempts.json")
  ,pilotReadiness: resolve(runtimeDir, "pilot-readiness.json")
  ,sourceScan: resolve(runtimeDir, "latest-source-scan.json")
  ,evidenceLedger: resolve(runtimeDir, "versioned-evidence-ledger.json")
  ,reviewDecisions: resolve(runtimeDir, "review-decisions.json")
  ,reviewEvents: resolve(runtimeDir, "review-events.json")
});
store.close();
const manifest = await backupRuntime({ runtimeDir, destination: backupDir });
if (!manifest.files.some((file) => file.name === "change-intelligence.sqlite")) throw new Error("Backup omitted SQLite database.");
if (!manifest.files.some((file) => file.name === "raw/source-captures/test-source/abc.source")) throw new Error("Backup omitted immutable source capture.");
await restoreRuntime({ backup: backupDir, destination: restoredDir });
if ((await readFile(resolve(restoredDir, "raw/source-captures/test-source/abc.source"), "utf8")) !== "immutable captured source\n") throw new Error("Restore did not recover immutable source capture.");
const restoredStore = createRuntimeStore(restoredDir);
await importRuntimeLedgers(restoredStore, {
  runtimeDir: restoredDir,
  questions: resolve(restoredDir, "workspace-questions.json"),
  audit: resolve(restoredDir, "audit-log.json"),
  operations: resolve(restoredDir, "idempotency-operations.json"),
  alerts: resolve(restoredDir, "workspace-alerts.json"),
  briefingPublications: resolve(restoredDir, "briefing-publications.json"),
  insightDecisions: resolve(restoredDir, "insight-decisions.json"),
  insightPublications: resolve(restoredDir, "insight-publications.json"),
  pilotProfiles: resolve(restoredDir, "workspace-pilot-profiles.json"),
  pilotDeliveries: resolve(restoredDir, "workspace-pilot-deliveries.json")
  ,pilotDecisions: resolve(restoredDir, "workspace-pilot-decisions.json")
  ,operatorWarnings: resolve(restoredDir, "operator-warning-events.json")
  ,operatorNotifications: resolve(restoredDir, "operator-notification-outbox.json")
  ,operatorRoutes: resolve(restoredDir, "operator-notification-routes.json")
  ,operatorAttempts: resolve(restoredDir, "operator-notification-attempts.json")
  ,pilotReadiness: resolve(restoredDir, "pilot-readiness.json")
  ,sourceScan: resolve(restoredDir, "latest-source-scan.json")
  ,evidenceLedger: resolve(restoredDir, "versioned-evidence-ledger.json")
  ,reviewDecisions: resolve(restoredDir, "review-decisions.json")
  ,reviewEvents: resolve(restoredDir, "review-events.json")
});
if (!restoredStore.questionsLedger().questions.length || !restoredStore.alertsLedger().alerts.length || !restoredStore.recordsLedger("source_scan", "source-snapshot-ledger-v1", "sources").sources.length) throw new Error("Restored runtime did not recover durable records.");
restoredStore.close();
const restoredManifest = JSON.parse(await readFile(resolve(backupDir, "manifest.json"), "utf8"));
if (restoredManifest.schemaVersion !== "runtime-backup-v1") throw new Error("Backup manifest schema was not preserved.");
console.log(`Runtime backup test passed: ${manifest.files.length} files backed up and restored with checksums.`);
