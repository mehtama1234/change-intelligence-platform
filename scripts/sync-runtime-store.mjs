import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore, importRuntimeLedgers } from "../storage.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const store = createRuntimeStore(runtimeDir);
try {
  await importRuntimeLedgers(store, {
    runtimeDir,
    questions: resolve(runtimeDir, "workspace-questions.json"),
    audit: resolve(runtimeDir, "audit-log.json"),
    operations: resolve(runtimeDir, "idempotency-operations.json"),
    alerts: resolve(runtimeDir, "workspace-alerts.json"),
    briefingPublications: resolve(runtimeDir, "briefing-publications.json"),
    insightDecisions: resolve(runtimeDir, "insight-decisions.json"),
    insightPublications: resolve(runtimeDir, "insight-publications.json"),
    notificationPreferences: resolve(runtimeDir, "workspace-notification-preferences.json"),
    deliveryNotifications: resolve(runtimeDir, "workspace-delivery-notifications.json"),
    deliveryNotificationAttempts: resolve(runtimeDir, "workspace-delivery-notification-attempts.json"),
    pilotProfiles: resolve(runtimeDir, "workspace-pilot-profiles.json"),
    pilotDeliveries: resolve(runtimeDir, "workspace-pilot-deliveries.json"),
    pilotDecisions: resolve(runtimeDir, "workspace-pilot-decisions.json"),
    operatorWarnings: resolve(runtimeDir, "operator-warning-events.json"),
    operatorNotifications: resolve(runtimeDir, "operator-notification-outbox.json"),
    operatorRoutes: resolve(runtimeDir, "operator-notification-routes.json"),
    operatorAttempts: resolve(runtimeDir, "operator-notification-attempts.json"),
    pilotReadiness: resolve(runtimeDir, "pilot-readiness.json"),
    workspaceDir: resolve(root, "data/fixtures/workspaces"),
    sourceScan: resolve(runtimeDir, "latest-source-scan.json"),
    evidenceLedger: resolve(runtimeDir, "versioned-evidence-ledger.json"),
    reviewDecisions: resolve(runtimeDir, "review-decisions.json"),
    reviewEvents: resolve(runtimeDir, "review-events.json")
  });
  console.log(`Synchronized runtime store: ${store.databasePath}`);
} finally {
  store.close();
}
