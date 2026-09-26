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
  pilotProfiles: resolve(runtimeDir, "workspace-pilot-profiles.json"),
  pilotDeliveries: resolve(runtimeDir, "workspace-pilot-deliveries.json"),
  pilotDecisions: resolve(runtimeDir, "workspace-pilot-decisions.json"),
  operatorWarnings: resolve(runtimeDir, "operator-warning-events.json"),
  operatorNotifications: resolve(runtimeDir, "operator-notification-outbox.json"),
  sourceScan: resolve(runtimeDir, "latest-source-scan.json"),
  evidenceLedger: resolve(runtimeDir, "versioned-evidence-ledger.json"),
  reviewDecisions: resolve(runtimeDir, "review-decisions.json"),
  reviewEvents: resolve(runtimeDir, "review-events.json")
};
const mode = process.env.OPERATOR_NOTIFICATION_DELIVERY_MODE ?? "disabled";
const webhookUrl = process.env.OPERATOR_NOTIFICATION_WEBHOOK_URL ?? "";
const maxAttempts = Math.max(1, Number(process.env.OPERATOR_NOTIFICATION_MAX_ATTEMPTS ?? 3));
const retryDelayMs = Math.max(0, Number(process.env.OPERATOR_NOTIFICATION_RETRY_DELAY_MS ?? 60000));
const timeoutMs = Math.max(100, Number(process.env.OPERATOR_NOTIFICATION_TIMEOUT_MS ?? 5000));
const actorId = process.env.OPERATOR_DELIVERY_ACTOR ?? "operator-delivery";
const readJson = async (path, fallback) => { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; } };
const store = createRuntimeStore(runtimeDir);
try {
  await importRuntimeLedgers(store, paths);
  const ledger = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications");
  const now = Date.now();
  const pending = ledger.notifications.filter((notification) => notification.status === "pending" && (!notification.nextAttemptAt || Date.parse(notification.nextAttemptAt) <= now));
  if (mode === "disabled") {
    console.log(JSON.stringify({ mode, pending: pending.length, delivered: 0, skipped: pending.length }, null, 2));
  } else {
    if (mode !== "webhook") throw new Error(`Unsupported operator notification delivery mode: ${mode}`);
    let target;
    try { target = new URL(webhookUrl); } catch { throw new Error("OPERATOR_NOTIFICATION_WEBHOOK_URL must be a valid URL when webhook delivery is enabled."); }
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error("Operator notification webhook must use http or https.");
    let delivered = 0;
    let failed = 0;
    for (const original of pending) {
      const attempts = Number(original.attempts ?? 0) + 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let result;
      try {
        const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json", "user-agent": "change-intelligence-operator-delivery/1" }, body: JSON.stringify({ schemaVersion: "operator-notification-v1", notification: { id: original.id, warningId: original.warningId, workspaceId: original.workspaceId ?? null, recipient: original.recipient, subject: original.subject, body: original.body, createdAt: original.createdAt } }), signal: controller.signal });
        result = response.ok ? { status: "delivered", deliveredAt: new Date().toISOString(), lastError: null } : { status: attempts >= maxAttempts ? "dead_letter" : "pending", lastError: `Webhook returned HTTP ${response.status}` };
      } catch (error) {
        result = { status: attempts >= maxAttempts ? "dead_letter" : "pending", lastError: error.name === "AbortError" ? `Webhook timed out after ${timeoutMs}ms` : String(error.message ?? error).slice(0, 500) };
      } finally { clearTimeout(timer); }
      const attemptedAt = new Date().toISOString();
      const notification = { ...original, ...result, attempts, lastAttemptAt: attemptedAt, nextAttemptAt: result.status === "pending" ? new Date(Date.now() + retryDelayMs).toISOString() : null, deliveredBy: result.status === "delivered" ? actorId : null };
      store.commitRecord({ kind: "operator_notification", record: notification, audit: { requestId: `operator-delivery-${notification.id}-${attempts}`, action: "deliver_operator_notification", targetId: notification.id, workspaceId: null, actorId, actorRole: "system", result: result.status, occurredAt: attemptedAt }, operation: { key: null } });
      if (result.status === "delivered") delivered += 1; else failed += 1;
    }
    await writeFile(paths.operatorNotifications, `${JSON.stringify(store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications"), null, 2)}\n`);
    console.log(JSON.stringify({ mode, pending: pending.length, delivered, failed }, null, 2));
  }
} finally {
  store.close();
}
