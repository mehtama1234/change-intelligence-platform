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
await writeFile(resolve(runtimeDir, "workspace-comparison-views.json"), `${JSON.stringify({ schemaVersion: "workspace-comparison-view-ledger-v1", views: [{ id: "comparison-test", workspaceId: "demo-research", name: "Backup comparison", kind: "companies", entityIds: ["company:nvidia", "company:microsoft"] }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-notification-preferences.json"), `${JSON.stringify({ schemaVersion: "workspace-notification-preference-ledger-v1", preferences: [{ id: "notification-preference-demo-research", workspaceId: "demo-research", comparisonAlerts: false, sourceAlerts: true, delivery: "in_app" }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-delivery-notifications.json"), `${JSON.stringify({ schemaVersion: "workspace-delivery-notification-ledger-v1", notifications: [{ id: "workspace-delivery-notification-test", workspaceId: "demo-research", status: "pending" }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-sources.json"), `${JSON.stringify({ schemaVersion: "workspace-source-ledger-v1", sources: [{ id: "workspace-source-backup-test", workspaceId: "demo-research", title: "Backup private source", sourceRef: "backup-test", sourceExcerpt: "Private source excerpt for backup coverage.", observation: "Backup must retain the private source record.", sourceDigest: "backup-digest", reviewState: "pending_review" }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-registry.json"), `${JSON.stringify({ schemaVersion: "workspace-registry-v1", workspaces: [{ schemaVersion: "workspace-v1", id: "workspace-backup-test", name: "Backup workspace", members: [{ id: "backup-owner", role: "owner" }] }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-invitations.json"), `${JSON.stringify({ schemaVersion: "workspace-invitation-ledger-v1", invitations: [{ id: "invitation-backup-test", workspaceId: "workspace-backup-test", identityId: "backup-viewer", role: "viewer", status: "pending" }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-refresh-outcomes.json"), `${JSON.stringify({ schemaVersion: "workspace-refresh-outcome-ledger-v1", outcomes: [{ id: "workspace-refresh-outcome-backup-test", workspaceId: "workspace-backup-test", status: "open", reason: "refresh_failed" }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "scheduler-status.json"), `${JSON.stringify({ schemaVersion: "refresh-scheduler-status-v1", status: "sleeping", runCount: 4 }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "backup-scheduler-status.json"), `${JSON.stringify({ schemaVersion: "runtime-backup-scheduler-status-v1", status: "sleeping", runCount: 4 }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "notification-scheduler-status.json"), `${JSON.stringify({ schemaVersion: "notification-scheduler-status-v1", status: "sleeping", runCount: 4 }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "refresh-scope.json"), `${JSON.stringify({ schemaVersion: "refresh-scope-v1", dueRepositories: [], deferredRepositories: ["annual-report-research"] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "refresh-scope-state.json"), `${JSON.stringify({ schemaVersion: "refresh-scope-state-v1", lastRunAtByRepository: { "annual-report-research": "2026-09-26T00:00:00.000Z" } }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "latest-source-availability.json"), `${JSON.stringify({ schemaVersion: "source-availability-receipt-v1", counts: { available: 1, unavailable: 0 } }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "source-availability-history.json"), `${JSON.stringify({ schemaVersion: "source-availability-history-v1", runs: [] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "source-availability-events.json"), `${JSON.stringify({ schemaVersion: "source-availability-event-ledger-v1", events: [] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "insight-opportunities.json"), `${JSON.stringify({ schemaVersion: "insight-opportunity-ledger-v1", opportunities: [] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "insight-promotions.json"), `${JSON.stringify({ schemaVersion: "insight-promotion-ledger-v1", promotions: [] }, null, 2)}\n`);
for (const name of ["workspace-questions.json", "audit-log.json", "idempotency-operations.json", "workspace-alerts.json", "workspace-sources.json", "briefing-publications.json", "insight-decisions.json", "insight-publications.json", "workspace-pilot-profiles.json", "workspace-pilot-deliveries.json", "workspace-pilot-decisions.json", "operator-warning-events.json", "operator-notification-outbox.json", "operator-notification-routes.json", "operator-notification-attempts.json", "pilot-readiness.json", "latest-source-scan.json", "source-scan-history.json", "source-capture-ledger.json", "research-ingestion.json", "domain-atlas.json", "versioned-evidence-ledger.json", "review-decisions.json", "review-events.json", "refresh-history.json", "insight-evaluation.json", "insight-opportunities.json", "insight-promotions.json"]) {
  if (existsSync(resolve(sourceRuntime, name))) await copyFile(resolve(sourceRuntime, name), resolve(runtimeDir, name));
}
const store = createRuntimeStore(runtimeDir);
await importRuntimeLedgers(store, {
  runtimeDir,
  questions: resolve(runtimeDir, "workspace-questions.json"),
  audit: resolve(runtimeDir, "audit-log.json"),
  operations: resolve(runtimeDir, "idempotency-operations.json"),
  alerts: resolve(runtimeDir, "workspace-alerts.json"),
  workspaceSources: resolve(runtimeDir, "workspace-sources.json"),
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
if (!manifest.files.some((file) => file.name === "workspace-comparison-views.json")) throw new Error("Backup omitted saved comparison views.");
if (!manifest.files.some((file) => file.name === "workspace-notification-preferences.json")) throw new Error("Backup omitted workspace notification preferences.");
if (!manifest.files.some((file) => file.name === "workspace-delivery-notifications.json")) throw new Error("Backup omitted workspace delivery notifications.");
if (!manifest.files.some((file) => file.name === "workspace-sources.json")) throw new Error("Backup omitted private workspace sources.");
if (!manifest.files.some((file) => file.name === "workspace-registry.json")) throw new Error("Backup omitted provisioned workspace registry.");
if (!manifest.files.some((file) => file.name === "workspace-invitations.json")) throw new Error("Backup omitted workspace invitation outbox.");
if (!manifest.files.some((file) => file.name === "workspace-refresh-outcomes.json")) throw new Error("Backup omitted workspace refresh outcomes.");
if (!manifest.files.some((file) => file.name === "scheduler-status.json")) throw new Error("Backup omitted scheduler status.");
if (!manifest.files.some((file) => file.name === "backup-scheduler-status.json")) throw new Error("Backup omitted backup scheduler status.");
if (!manifest.files.some((file) => file.name === "notification-scheduler-status.json")) throw new Error("Backup omitted notification scheduler status.");
if (!manifest.files.some((file) => file.name === "refresh-scope.json") || !manifest.files.some((file) => file.name === "refresh-scope-state.json")) throw new Error("Backup omitted refresh scope state.");
if (!manifest.files.some((file) => file.name === "latest-source-availability.json") || !manifest.files.some((file) => file.name === "source-availability-history.json")) throw new Error("Backup omitted source availability state.");
if (!manifest.files.some((file) => file.name === "source-availability-events.json")) throw new Error("Backup omitted source availability events.");
if (!manifest.files.some((file) => file.name === "insight-opportunities.json") || !manifest.files.some((file) => file.name === "insight-promotions.json")) throw new Error("Backup omitted insight discovery and promotion state.");
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
