import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore, importRuntimeLedgers } from "../storage.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const paths = {
  runtimeDir,
  questions: resolve(runtimeDir, "workspace-questions.json"),
  audit: resolve(runtimeDir, "audit-log.json"),
  operations: resolve(runtimeDir, "idempotency-operations.json"),
  alerts: resolve(runtimeDir, "workspace-alerts.json"),
  briefingPublications: resolve(runtimeDir, "briefing-publications.json"),
  insightDecisions: resolve(runtimeDir, "insight-decisions.json"),
  insightPublications: resolve(runtimeDir, "insight-publications.json"),
  decisionOutcomes: resolve(runtimeDir, "decision-outcomes.json"),
  watchlists: resolve(runtimeDir, "workspace-watchlists.json"),
  notificationPreferences: resolve(runtimeDir, "workspace-notification-preferences.json"),
  deliveryNotifications: resolve(runtimeDir, process.env.WORKSPACE_NOTIFICATIONS_PATH ?? "workspace-delivery-notifications.json"),
  deliveryNotificationAttempts: resolve(runtimeDir, process.env.WORKSPACE_NOTIFICATION_ATTEMPTS_PATH ?? "workspace-delivery-notification-attempts.json"),
  pilotProfiles: resolve(runtimeDir, "workspace-pilot-profiles.json"),
  pilotDeliveries: resolve(runtimeDir, "workspace-pilot-deliveries.json"),
  pilotDecisions: resolve(runtimeDir, "workspace-pilot-decisions.json"),
  operatorWarnings: resolve(runtimeDir, "operator-warning-events.json"),
  operatorNotifications: resolve(runtimeDir, "operator-notification-outbox.json"),
  operatorRoutes: resolve(runtimeDir, "operator-notification-routes.json"),
  operatorAttempts: resolve(runtimeDir, "operator-notification-attempts.json"),
  pilotReadiness: resolve(runtimeDir, "pilot-readiness.json"),
  sourceScan: resolve(runtimeDir, "latest-source-scan.json"),
  evidenceLedger: resolve(runtimeDir, "versioned-evidence-ledger.json"),
  reviewDecisions: resolve(runtimeDir, "review-decisions.json"),
  reviewEvents: resolve(runtimeDir, "review-events.json")
};
const maxAttempts = Math.max(1, Number(process.env.WORKSPACE_NOTIFICATION_MAX_ATTEMPTS ?? 3));
const retryDelayMs = Math.max(0, Number(process.env.WORKSPACE_NOTIFICATION_RETRY_DELAY_MS ?? 60000));
const timeoutMs = Math.max(100, Number(process.env.WORKSPACE_NOTIFICATION_TIMEOUT_MS ?? 5000));
const actorId = process.env.WORKSPACE_NOTIFICATION_ACTOR ?? "workspace-notification-delivery";
const store = createRuntimeStore(runtimeDir);

try {
  await importRuntimeLedgers(store, paths);
  const notifications = store.recordsLedger("delivery_notification", "workspace-delivery-notification-ledger-v1", "notifications").notifications;
  const preferences = store.recordsLedger("notification_preference", "workspace-notification-preference-ledger-v1", "preferences").preferences;
  const now = Date.now();
  const pending = notifications.filter((notification) => notification.status === "pending" && notification.channel === "webhook" && (!notification.nextAttemptAt || Date.parse(notification.nextAttemptAt) <= now));
  let delivered = 0;
  let failed = 0;
  for (const original of pending) {
    const preference = preferences.find((candidate) => candidate.workspaceId === original.workspaceId);
    const attempts = Number(original.attempts ?? 0) + 1;
    const attemptedAt = new Date().toISOString();
    let result;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const target = new URL(String(preference?.webhookUrl ?? ""));
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("Webhook URL must use HTTP or HTTPS.");
      const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json", "user-agent": "change-intelligence-workspace-delivery/1" }, body: JSON.stringify({ schemaVersion: "workspace-delivery-notification-v1", notification: { id: original.id, workspaceId: original.workspaceId, deliveryId: original.deliveryId, destinationId: original.destinationId, subject: original.subject, body: original.body, deliveryStatus: original.deliveryStatus ?? null, briefingStates: original.briefingStates ?? [], insightPublicationIds: original.insightPublicationIds ?? [], staleInsightTitles: original.staleInsightTitles ?? [], createdAt: original.createdAt } }), signal: controller.signal });
      result = response.ok ? { status: "delivered", deliveredAt: attemptedAt, lastError: null } : { status: attempts >= maxAttempts ? "dead_letter" : "pending", lastError: `Webhook returned HTTP ${response.status}` };
    } catch (error) {
      result = { status: attempts >= maxAttempts ? "dead_letter" : "pending", lastError: error.name === "AbortError" ? `Webhook timed out after ${timeoutMs}ms` : String(error.message ?? error).slice(0, 500) };
    } finally { clearTimeout(timer); }
    const updated = { ...original, ...result, attempts, lastAttemptAt: attemptedAt, nextAttemptAt: result.status === "pending" ? new Date(Date.now() + retryDelayMs).toISOString() : null, deliveredBy: result.status === "delivered" ? actorId : null };
    store.commitRecord({ kind: "delivery_notification", record: updated, audit: { requestId: `workspace-delivery-${updated.id}-${attempts}`, action: "deliver_workspace_notification", targetId: updated.id, workspaceId: updated.workspaceId, actorId, actorRole: "system", result: result.status, occurredAt: attemptedAt }, operation: { key: null } });
    store.syncRecords("delivery_notification_attempt", [{ id: `workspace-delivery-attempt-${original.id}-${attempts}`, notificationId: original.id, workspaceId: original.workspaceId, destinationId: original.destinationId, attempt: attempts, status: result.status, attemptedAt, error: result.lastError }]);
    if (result.status === "delivered") delivered += 1; else failed += 1;
  }
  await writeFile(paths.deliveryNotifications, `${JSON.stringify(store.recordsLedger("delivery_notification", "workspace-delivery-notification-ledger-v1", "notifications"), null, 2)}\n`);
  await writeFile(paths.deliveryNotificationAttempts, `${JSON.stringify(store.recordsLedger("delivery_notification_attempt", "workspace-delivery-notification-attempt-ledger-v1", "attempts"), null, 2)}\n`);
  console.log(JSON.stringify({ pending: pending.length, delivered, failed }, null, 2));
} finally {
  store.close();
}
