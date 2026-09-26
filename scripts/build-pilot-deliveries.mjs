import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const profilesPath = resolve(runtimeDir, process.env.PILOT_PROFILES_PATH ?? "workspace-pilot-profiles.json");
const outputPath = resolve(runtimeDir, process.env.PILOT_DELIVERIES_PATH ?? "workspace-pilot-deliveries.json");
const notificationsPath = resolve(runtimeDir, process.env.WORKSPACE_NOTIFICATIONS_PATH ?? "workspace-delivery-notifications.json");
const runId = process.env.REFRESH_RUN_ID ?? `manual-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17)}`;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

const profiles = (await readJson(profilesPath, { profiles: [] })).profiles ?? [];
const existing = await readJson(outputPath, { schemaVersion: "workspace-pilot-delivery-ledger-v1", deliveries: [] });
const deliveries = [...(existing.deliveries ?? [])];
const existingIds = new Set(deliveries.map((delivery) => delivery.id));
const notificationLedger = await readJson(notificationsPath, { schemaVersion: "workspace-delivery-notification-ledger-v1", notifications: [] });
const notifications = [...(notificationLedger.notifications ?? [])];
const existingNotificationIds = new Set(notifications.map((notification) => notification.id));
const preferences = (await readJson(resolve(runtimeDir, "workspace-notification-preferences.json"), { preferences: [] })).preferences ?? [];
const alerts = (await readJson(resolve(runtimeDir, "workspace-alerts.json"), { alerts: [] })).alerts ?? [];
const sourceAvailability = await readJson(resolve(runtimeDir, "latest-source-availability.json"), { sources: [], counts: {} });
const outcomes = (await readJson(resolve(runtimeDir, "decision-outcomes.json"), { outcomes: [] })).outcomes ?? [];
const audit = (await readJson(resolve(runtimeDir, "audit-log.json"), { entries: [] })).entries ?? [];
const briefings = (await readJson(resolve(runtimeDir, "workspace-briefings.json"), { briefings: [] })).briefings ?? [];
const refresh = await readJson(resolve(runtimeDir, "latest-refresh.json"), { status: "not_run", runId: null, endedAt: null });
const now = new Date().toISOString();
let created = 0;
for (const profile of profiles) {
  const workspaceAlerts = alerts.filter((alert) => alert.workspaceId === profile.workspaceId);
  const workspaceOutcomes = outcomes.filter((outcome) => outcome.workspaceId === profile.workspaceId);
  const workspaceAudit = audit.filter((entry) => entry.workspaceId === profile.workspaceId);
  const workspaceBriefings = briefings.filter((briefing) => briefing.workspaceId === profile.workspaceId);
  const openAlerts = workspaceAlerts.filter((alert) => alert.state === "open");
  const openAvailabilityAlerts = workspaceAlerts.filter((alert) => alert.kind === "source_availability" && alert.state === "open");
  const availabilityActions = openAvailabilityAlerts.map((alert) => ({ sourceId: alert.sourceId, action: alert.recommendedAction ?? "Check the source connection, then run another availability check." }));
  const recoveredAvailabilityAlerts = workspaceAlerts.filter((alert) => alert.kind === "source_availability" && alert.state === "resolved" && alert.resolutionDisposition === "source_recovered");
  const staleBriefings = workspaceBriefings.filter((briefing) => briefing.state === "stale");
  const linkedInsights = workspaceBriefings.flatMap((briefing) => (briefing.insightProvenance ?? []).map((insight) => ({ ...insight, briefingId: briefing.id, briefingTitle: briefing.title, briefingState: briefing.state })));
  const heldForReview = refresh.status === "partial" || staleBriefings.length > 0 || openAvailabilityAlerts.length > 0;
  const delivery = {
    id: `delivery-${profile.id}-${runId}`,
    workspaceId: profile.workspaceId,
    profileId: profile.id,
    generatedAt: now,
    refreshRunId: runId,
    refreshStatus: refresh.status ?? "not_run",
    status: heldForReview ? "held_for_review" : "prepared",
    cadence: profile.cadence,
    nextReviewAt: profile.nextReviewAt ?? null,
    decisionQuestion: profile.decisionQuestion,
    headline: openAvailabilityAlerts.length ? `${openAvailabilityAlerts.length} source availability alert${openAvailabilityAlerts.length === 1 ? "" : "s"} require review before use.` : openAlerts.length ? `${openAlerts.length} open change alert${openAlerts.length === 1 ? "" : "s"} require review.` : staleBriefings.length ? `${staleBriefings.length} briefing${staleBriefings.length === 1 ? "" : "s"} include changed insight evidence and require re-review.` : "No open change alerts require review.",
    snapshot: {
      openAlerts: openAlerts.length,
      alertsSeen: workspaceAlerts.length,
      alertsResolved: workspaceAlerts.filter((alert) => alert.state === "resolved").length,
      usefulAlerts: workspaceAlerts.filter((alert) => alert.resolutionDisposition === "useful").length,
      falseAlerts: workspaceAlerts.filter((alert) => alert.resolutionDisposition === "false_positive").length,
      briefingsPublished: workspaceAudit.filter((entry) => entry.action === "publish_briefing").length,
      briefingsExported: workspaceAudit.filter((entry) => entry.action === "export_briefing").length,
      decisionsRecorded: workspaceOutcomes.length,
      decisionsUsingBriefings: workspaceOutcomes.filter((outcome) => outcome.decisionState === "used").length,
      knownResults: workspaceOutcomes.filter((outcome) => ["held", "changed", "wrong"].includes(outcome.outcomeState)).length,
      activeBriefings: workspaceBriefings.filter((briefing) => ["draft", "published", "stale"].includes(briefing.state)).length,
      staleBriefings: staleBriefings.length,
      linkedInsights: linkedInsights.length,
      staleLinkedInsights: linkedInsights.filter((insight) => insight.state === "stale").length
      ,openAvailabilityAlerts: openAvailabilityAlerts.length
      ,unavailableSources: sourceAvailability.counts?.unavailable ?? 0
      ,unavailableSourceIds: openAvailabilityAlerts.map((alert) => alert.sourceId)
    },
    briefings: workspaceBriefings.map((briefing) => ({ id: briefing.id, title: briefing.title, state: briefing.state, publication: briefing.publication, evidenceDigest: briefing.evidenceDigest, staleReason: briefing.staleReason ?? null, insightProvenance: briefing.insightProvenance ?? [] })),
    insightProvenance: linkedInsights,
    impact: { state: openAvailabilityAlerts.length ? "held_for_source_availability" : recoveredAvailabilityAlerts.length ? "source_availability_recovered" : "no_open_source_availability_issue", unavailableSources: openAvailabilityAlerts.map((alert) => ({ sourceId: alert.sourceId, repository: alert.repository, sourcePath: alert.sourcePath, reason: alert.reason, recommendedAction: alert.recommendedAction ?? "Check the source connection, then run another availability check." })), recoveredSources: recoveredAvailabilityAlerts.map((alert) => ({ sourceId: alert.sourceId, recoveredAt: alert.resolvedAt, explanation: "The source became available again; this delivery uses the next available refresh." })), nextActions: availabilityActions },
    successMeasures: profile.successMeasures,
    evaluation: { state: "requires_partner_review", reason: "The system records usage and follow-up, but does not turn free-text success measures into a claimed score automatically." },
    limitation: "This delivery is a reviewable evidence handoff. It is not a recommendation, a causal result, or proof that the pilot created business value."
  };
  if (!existingIds.has(delivery.id)) { deliveries.push(delivery); created += 1; }
  if (!existingNotificationIds.has(`workspace-delivery-notification-${delivery.id}`)) {
    const preference = preferences.find((candidate) => candidate.workspaceId === profile.workspaceId);
    const briefingStates = workspaceBriefings.map((briefing) => ({ id: briefing.id, state: briefing.state, publication: briefing.publication ?? "not_published" }));
    const staleInsightTitles = linkedInsights.filter((insight) => insight.state === "stale").map((insight) => insight.title);
    const unavailableSourceIds = openAvailabilityAlerts.map((alert) => alert.sourceId);
    const body = `${delivery.headline}${unavailableSourceIds.length ? ` Unavailable source${unavailableSourceIds.length === 1 ? "" : "s"}: ${unavailableSourceIds.join(", ")}.` : ""}${linkedInsights.length ? ` ${linkedInsights.length} bounded insight${linkedInsights.length === 1 ? " is" : "s are"} linked with publication receipts.` : ""}${staleInsightTitles.length ? ` ${staleInsightTitles.length} linked insight${staleInsightTitles.length === 1 ? " needs" : "s need"} re-review before use.` : ""}`;
    notifications.push({ id: `workspace-delivery-notification-${delivery.id}`, workspaceId: profile.workspaceId, deliveryId: delivery.id, type: "pilot_delivery", channel: preference?.delivery ?? "in_app", destinationId: preference?.destinationId ?? null, status: preference?.deliveryUpdates === false ? "suppressed" : "pending", subject: `New ${profile.cadence} intelligence handoff`, body, deliveryStatus: delivery.status, briefingStates, insightPublicationIds: linkedInsights.map((insight) => insight.publicationId), staleInsightTitles, unavailableSourceIds, createdAt: now, deliveredAt: null, suppressedAt: preference?.deliveryUpdates === false ? now : null });
  }
}
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ schemaVersion: "workspace-pilot-delivery-ledger-v1", updatedAt: now, deliveries: deliveries.slice(-200) }, null, 2)}\n`);
await writeFile(notificationsPath, `${JSON.stringify({ schemaVersion: "workspace-delivery-notification-ledger-v1", updatedAt: now, notifications: notifications.slice(-500) }, null, 2)}\n`);
console.log(JSON.stringify({ profiles: profiles.length, deliveriesCreated: created, notificationsCreated: notifications.length - existingNotificationIds.size, outputPath, notificationsPath }, null, 2));
