import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore, importRuntimeLedgers } from "../storage.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const paths = { runtimeDir, ...Object.fromEntries(["questions", "audit", "operations", "alerts", "briefingPublications", "insightDecisions", "insightPublications", "decisionOutcomes", "watchlists", "notificationPreferences", "deliveryNotifications", "deliveryNotificationAttempts", "pilotProfiles", "pilotDeliveries", "pilotDecisions", "operatorWarnings", "operatorNotifications", "operatorRoutes", "operatorAttempts", "pilotReadiness", "sourceScan", "evidenceLedger", "reviewDecisions", "reviewEvents"].map((name) => [name, resolve(runtimeDir, ({ briefingPublications: "briefing-publications.json", insightDecisions: "insight-decisions.json", insightPublications: "insight-publications.json", decisionOutcomes: "decision-outcomes.json", watchlists: "workspace-watchlists.json", notificationPreferences: "workspace-notification-preferences.json", deliveryNotifications: "workspace-delivery-notifications.json", deliveryNotificationAttempts: "workspace-delivery-notification-attempts.json", pilotProfiles: "workspace-pilot-profiles.json", pilotDeliveries: "workspace-pilot-deliveries.json", pilotDecisions: "workspace-pilot-decisions.json", operatorWarnings: "operator-warning-events.json", operatorNotifications: "operator-notification-outbox.json", operatorRoutes: "operator-notification-routes.json", operatorAttempts: "operator-notification-attempts.json", pilotReadiness: "pilot-readiness.json", sourceScan: "latest-source-scan.json", evidenceLedger: "versioned-evidence-ledger.json", reviewDecisions: "review-decisions.json", reviewEvents: "review-events.json" }[name] ?? `${name}.json`))])) };
const now = Date.now();
const nowIso = new Date(now).toISOString();
const cadenceMs = { weekly: 7 * 86400000, monthly: 31 * 86400000, quarterly: 93 * 86400000 };
const store = createRuntimeStore(runtimeDir);
try {
  await importRuntimeLedgers(store, paths);
  const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
  const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
  const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions;
  const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
  const snapshots = [];
  for (const profile of profiles) {
    const workspaceDeliveries = deliveries.filter((delivery) => delivery.workspaceId === profile.workspaceId);
    const reviewed = workspaceDeliveries.filter((delivery) => delivery.review);
    const usefulnessRate = reviewed.length ? reviewed.filter((delivery) => delivery.review.usefulness === "useful").length / reviewed.length : null;
    const decisionImpact = reviewed.filter((delivery) => ["changed_decision", "informed_decision"].includes(delivery.review.decisionImpact)).length;
    const latestDeliveryAt = workspaceDeliveries.map((delivery) => delivery.generatedAt).sort().at(-1) ?? null;
    const nextExpectedAt = latestDeliveryAt && cadenceMs[profile.cadence] ? new Date(Date.parse(latestDeliveryAt) + cadenceMs[profile.cadence]).toISOString() : null;
    const scopedNotifications = notifications.filter((notification) => notification.workspaceId === profile.workspaceId);
    const serviceStatus = !workspaceDeliveries.length ? "awaiting_first_delivery" : scopedNotifications.some((notification) => ["pending", "dead_letter"].includes(notification.status)) || Boolean(nextExpectedAt && Date.parse(nextExpectedAt) < now) ? "attention" : "on_track";
    const failedMeasures = reviewed.flatMap((delivery) => delivery.review.measureAssessments ?? []).filter((assessment) => assessment.state === "not_met").length;
    let recommendation = "continue";
    if (serviceStatus === "attention") recommendation = "improve";
    else if (reviewed.length >= 3 && usefulnessRate === 0) recommendation = "stop";
    else if (reviewed.length >= 3 && usefulnessRate >= 0.67 && decisionImpact > 0 && failedMeasures === 0) recommendation = "expand";
    snapshots.push({ id: `pilot-readiness-${profile.workspaceId}-${process.env.REFRESH_RUN_ID ?? now}`, workspaceId: profile.workspaceId, refreshRunId: process.env.REFRESH_RUN_ID ?? null, observedAt: nowIso, recommendation, serviceStatus, cadence: profile.cadence, deliveries: workspaceDeliveries.length, reviewedDeliveries: reviewed.length, usefulnessRate, decisionImpact, failedMeasures, latestDeliveryAt, nextExpectedAt, latestDecision: decisions.filter((decision) => decision.workspaceId === profile.workspaceId).sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0]?.decision ?? null });
  }
  store.syncRecords("pilot_readiness", snapshots);
  await writeFile(paths.pilotReadiness, `${JSON.stringify(store.recordsLedger("pilot_readiness", "pilot-readiness-ledger-v1", "snapshots"), null, 2)}\n`);
  console.log(JSON.stringify({ snapshots: snapshots.length, refreshRunId: process.env.REFRESH_RUN_ID ?? null }, null, 2));
} finally { store.close(); }
