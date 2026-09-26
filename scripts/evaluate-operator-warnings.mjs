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
  operatorRoutes: resolve(runtimeDir, "operator-notification-routes.json"),
  operatorAttempts: resolve(runtimeDir, "operator-notification-attempts.json"),
  sourceScan: resolve(runtimeDir, "latest-source-scan.json"),
  evidenceLedger: resolve(runtimeDir, "versioned-evidence-ledger.json"),
  reviewDecisions: resolve(runtimeDir, "review-decisions.json"),
  reviewEvents: resolve(runtimeDir, "review-events.json")
};
const readJson = async (path, fallback) => { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; } };
const now = Date.now();
const nowIso = new Date(now).toISOString();
const ackSlaMs = Number(process.env.OPERATOR_WARNING_ACK_SLA_MS ?? 4 * 60 * 60 * 1000);
const maxSourceAgeMs = Number(process.env.MAX_SOURCE_AGE_MS ?? 14 * 24 * 60 * 60 * 1000);
const maxFalseAlertRate = Number(process.env.OPERATOR_MAX_FALSE_ALERT_RATE ?? 0.4);
const maxFailedRefreshes = Number(process.env.OPERATOR_MAX_FAILED_REFRESHES ?? 0);
const maxDelayedDeliveries = Number(process.env.OPERATOR_MAX_DELAYED_DELIVERIES ?? 0);
const actorId = process.env.OPERATOR_SYSTEM_ACTOR ?? "operator-policy";
let notificationRoutes = {};
try { notificationRoutes = JSON.parse(process.env.OPERATOR_NOTIFICATION_ROUTES_JSON ?? "{}"); } catch { throw new Error("OPERATOR_NOTIFICATION_ROUTES_JSON must be valid JSON."); }
const configuredRecipients = (warning) => {
  const warningRecipients = notificationRoutes.warningIds?.[warning.id];
  if (Array.isArray(warningRecipients) && warningRecipients.length) return warningRecipients;
  const workspaceRecipients = [...new Set((warning.workspaceIds ?? []).flatMap((workspaceId) => notificationRoutes.workspaces?.[workspaceId] ?? []))];
  if (workspaceRecipients.length) return workspaceRecipients;
  if (Array.isArray(notificationRoutes.default) && notificationRoutes.default.length) return notificationRoutes.default;
  return [actorId];
};
const [refreshHistory, sourceScan, profiles, deliveries] = await Promise.all([
  readJson(resolve(runtimeDir, "refresh-history.json"), { runs: [] }),
  readJson(paths.sourceScan, { sources: [], counts: {} }),
  readJson(paths.pilotProfiles, { profiles: [] }),
  readJson(paths.pilotDeliveries, { deliveries: [] })
]);
const store = createRuntimeStore(runtimeDir);
try {
  await importRuntimeLedgers(store, paths);
  const persistedRoutes = store.findRecord("operator_notification_route", "operator-notification-routes");
  if (persistedRoutes) notificationRoutes = persistedRoutes;
  const alerts = store.alertsLedger().alerts;
  const warnings = [];
  const failedRuns = (refreshHistory.runs ?? []).filter((run) => run.status !== "complete");
  if (failedRuns.length > maxFailedRefreshes) warnings.push({ id: "refresh-failures", severity: "high", observedAt: failedRuns[0]?.endedAt ?? nowIso, message: "One or more refresh runs are failing; inspect the failed steps before customer delivery." });
  const staleSources = (sourceScan.sources ?? []).filter((source) => Number.isFinite(Date.parse(source.checkedAt)) && now - Date.parse(source.checkedAt) > maxSourceAgeMs);
  if (staleSources.length || (sourceScan.counts?.missing ?? 0) > 0) warnings.push({ id: "source-freshness", severity: "high", observedAt: sourceScan.generatedAt ?? staleSources.map((source) => source.checkedAt).sort()[0] ?? nowIso, message: "Sources are too old or unavailable for a fully current reading." });
  const dispositions = alerts.filter((alert) => ["useful", "false_positive", "needs_correction"].includes(alert.resolutionDisposition));
  const falseAlertRate = dispositions.length ? alerts.filter((alert) => alert.resolutionDisposition === "false_positive").length / dispositions.length : null;
  if (falseAlertRate !== null && falseAlertRate > maxFalseAlertRate) warnings.push({ id: "false-alert-rate", severity: "medium", observedAt: alerts.map((alert) => alert.resolvedAt).filter(Boolean).sort()[0] ?? nowIso, message: "The recorded false-alert rate is above the operating limit; review watchlist rules and source changes." });
  const cadenceMs = { weekly: 7 * 86400000, monthly: 31 * 86400000, quarterly: 93 * 86400000 };
  const delayedDeliveries = (profiles.profiles ?? []).filter((profile) => {
    const latest = (deliveries.deliveries ?? []).filter((delivery) => delivery.workspaceId === profile.workspaceId).map((delivery) => Date.parse(delivery.generatedAt)).filter(Number.isFinite).sort().at(-1);
    return cadenceMs[profile.cadence] && (!latest || latest + cadenceMs[profile.cadence] < now);
  });
  if (delayedDeliveries.length > maxDelayedDeliveries) warnings.push({ id: "delivery-delay", severity: "medium", workspaceIds: delayedDeliveries.map((profile) => profile.workspaceId), observedAt: nowIso, message: "Configured pilot deliveries are behind their expected cadence." });
  const insightHeldDeliveries = (deliveries.deliveries ?? []).filter((delivery) => delivery.status === "held_for_review" && ((delivery.snapshot?.staleLinkedInsights ?? 0) > 0 || (delivery.insightProvenance ?? []).some((insight) => insight.state === "stale")));
  if (insightHeldDeliveries.length) warnings.push({ id: "insight-review-hold", severity: "high", workspaceIds: [...new Set(insightHeldDeliveries.map((delivery) => delivery.workspaceId))], observedAt: insightHeldDeliveries.map((delivery) => delivery.generatedAt).filter(Boolean).sort()[0] ?? nowIso, message: "One or more customer handoffs are held because linked insight evidence needs researcher re-review." });

  const warningEvents = store.recordsLedger("operator_warning", "operator-warning-event-ledger-v1", "events").events;
  const notificationRecords = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
  const eventById = new Map(warningEvents.map((event) => [event.warningId, event]));
  const notificationByWarning = new Map(notificationRecords.map((notification) => [`${notification.warningId}:${notification.recipient}`, notification]));
  const escalated = [];
  for (const warning of warnings) {
    const observedEpoch = Date.parse(warning.observedAt);
    if (!Number.isFinite(observedEpoch) || observedEpoch + ackSlaMs > now) continue;
    const prior = eventById.get(warning.id);
    if (prior?.state === "resolved" || prior?.escalationState === "escalated") continue;
    const recipients = configuredRecipients(warning);
    const event = { id: `operator-warning-${warning.id}`, warningId: warning.id, state: "acknowledged", note: `Automatically escalated after the ${ackSlaMs / 3600000}-hour acknowledgment deadline.`, ownerId: prior?.ownerId ?? recipients[0], escalationState: "escalated", observedAt: warning.observedAt, responseTimeMs: Math.max(0, now - observedEpoch), actedBy: actorId, actedAt: nowIso };
    store.syncRecords("operator_warning", [event]);
    store.appendAudit({ requestId: `operator-policy-${process.env.REFRESH_RUN_ID ?? now}`, action: "auto_escalate_operator_warning", targetId: warning.id, workspaceId: null, actorId, actorRole: "system", result: "escalated", occurredAt: nowIso });
    eventById.set(warning.id, event);
    for (const recipient of recipients) {
      const notificationKey = `${warning.id}:${recipient}`;
      if (notificationByWarning.has(notificationKey)) continue;
      const notification = { id: `operator-notification-${warning.id}-${recipient}`, warningId: warning.id, workspaceId: warning.workspaceIds?.length === 1 ? warning.workspaceIds[0] : null, channel: "operator-outbox", recipient, destinationId: notificationRoutes.destinations?.[recipient]?.id ?? recipient, status: "pending", subject: `Automatically escalated operator warning: ${warning.id}`, body: event.note, createdBy: actorId, createdAt: nowIso, dispatchedAt: null, dispatchNote: null };
      store.syncRecords("operator_notification", [notification]);
      store.appendAudit({ requestId: `operator-policy-${process.env.REFRESH_RUN_ID ?? now}`, action: "queue_operator_notification", targetId: notification.id, workspaceId: notification.workspaceId, actorId, actorRole: "system", result: "pending", occurredAt: nowIso });
      notificationByWarning.set(notificationKey, notification);
    }
    escalated.push(warning.id);
  }
  await writeFile(paths.operatorWarnings, `${JSON.stringify(store.recordsLedger("operator_warning", "operator-warning-event-ledger-v1", "events"), null, 2)}\n`);
  await writeFile(paths.operatorNotifications, `${JSON.stringify(store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications"), null, 2)}\n`);
  console.log(JSON.stringify({ evaluated: warnings.length, overdue: escalated.length, escalated }, null, 2));
} finally {
  store.close();
}
