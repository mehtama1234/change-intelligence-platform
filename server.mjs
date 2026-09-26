import { createServer } from "node:http";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore, importRuntimeLedgers } from "./storage.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT ?? 8780);
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const packetPath = resolve(root, process.env.PACKET_PATH ?? "data/processed/ai-work-control.packet.json");
const atlasPath = resolve(runtimeDir, "domain-atlas.json");
const staticAtlasPath = resolve(root, "data/processed/ai-work-control.atlas.json");
const ingestionPath = resolve(runtimeDir, "research-ingestion.json");
const staticIngestionPath = resolve(root, "data/processed/ai-work-control.ingestion.json");
const reviewPath = resolve(runtimeDir, "latest-review-work.json");
const historyPath = resolve(runtimeDir, "versioned-evidence-ledger.json");
const refreshPath = resolve(runtimeDir, "latest-refresh.json");
const refreshHistoryPath = resolve(runtimeDir, "refresh-history.json");
const schedulerStatusPath = resolve(runtimeDir, "scheduler-status.json");
const backupSchedulerStatusPath = resolve(runtimeDir, "backup-scheduler-status.json");
const notificationSchedulerStatusPath = resolve(runtimeDir, "notification-scheduler-status.json");
const alertsPath = resolve(runtimeDir, "workspace-alerts.json");
const questionsPath = resolve(runtimeDir, "workspace-questions.json");
const questionEvaluationsPath = resolve(runtimeDir, "question-evaluations.json");
const briefingsPath = resolve(runtimeDir, "workspace-briefings.json");
const briefingPublicationsPath = resolve(runtimeDir, "briefing-publications.json");
const insightDecisionsPath = resolve(runtimeDir, "insight-decisions.json");
const insightCandidatesPath = resolve(runtimeDir, "insight-candidates.json");
const insightPublicationsPath = resolve(runtimeDir, "insight-publications.json");
const insightOpportunitiesPath = resolve(runtimeDir, "insight-opportunities.json");
const insightPromotionsPath = resolve(runtimeDir, "insight-promotions.json");
const decisionOutcomesPath = resolve(runtimeDir, "decision-outcomes.json");
const watchlistsPath = resolve(runtimeDir, "workspace-watchlists.json");
const workspaceSourcesPath = resolve(runtimeDir, "workspace-sources.json");
const comparisonViewsPath = resolve(runtimeDir, "workspace-comparison-views.json");
const notificationPreferencesPath = resolve(runtimeDir, "workspace-notification-preferences.json");
const deliveryNotificationsPath = resolve(runtimeDir, "workspace-delivery-notifications.json");
const deliveryNotificationAttemptsPath = resolve(runtimeDir, "workspace-delivery-notification-attempts.json");
const pilotProfilesPath = resolve(runtimeDir, "workspace-pilot-profiles.json");
const pilotDeliveriesPath = resolve(runtimeDir, "workspace-pilot-deliveries.json");
const pilotDecisionsPath = resolve(runtimeDir, "workspace-pilot-decisions.json");
const pilotReadinessPath = resolve(runtimeDir, "pilot-readiness.json");
const commercialOffersPath = resolve(runtimeDir, "workspace-commercial-offers.json");
const operatorWarningsPath = resolve(runtimeDir, "operator-warning-events.json");
const operatorNotificationsPath = resolve(runtimeDir, "operator-notification-outbox.json");
const operatorRoutesPath = resolve(runtimeDir, "operator-notification-routes.json");
const operatorAttemptsPath = resolve(runtimeDir, "operator-notification-attempts.json");
const auditPath = resolve(runtimeDir, "audit-log.json");
const operationsPath = resolve(runtimeDir, "idempotency-operations.json");
const sourceScanPath = resolve(runtimeDir, "latest-source-scan.json");
const sourceScanHistoryPath = resolve(runtimeDir, "source-scan-history.json");
const captureLedgerPath = resolve(runtimeDir, "source-capture-ledger.json");
const sourceAvailabilityPath = resolve(runtimeDir, "latest-source-availability.json");
const evidenceLedgerPath = resolve(runtimeDir, "versioned-evidence-ledger.json");
const reviewDecisionsPath = resolve(runtimeDir, "review-decisions.json");
const reviewEventsPath = resolve(runtimeDir, "review-events.json");
const supportRequestsPath = resolve(runtimeDir, "workspace-support-requests.json");
const workspaceDir = resolve(root, "data/fixtures/workspaces");
const workspaceRegistryPath = resolve(runtimeDir, "workspace-registry.json");
const workspaceInvitationsPath = resolve(runtimeDir, "workspace-invitations.json");
const workspaceRefreshOutcomesPath = resolve(runtimeDir, "workspace-refresh-outcomes.json");
const sourceRegistryPath = resolve(root, "data/source-registry.json");
const authMode = process.env.AUTH_MODE ?? "demo";
const tokenActors = authMode === "token" ? JSON.parse(process.env.AUTH_TOKENS_JSON ?? "{}") : {};
const operatorActors = new Set(JSON.parse(process.env.OPERATOR_ACTORS_JSON ?? "[]"));
const identityProviderWebhookSecret = process.env.IDENTITY_PROVIDER_WEBHOOK_SECRET ?? "";
const backupDir = process.env.BACKUP_DIR ? resolve(root, process.env.BACKUP_DIR) : undefined;
const maxRefreshAgeMs = Number(process.env.MAX_REFRESH_AGE_MS ?? 7 * 24 * 60 * 60 * 1000);
const maxSourceAgeMs = Number(process.env.MAX_SOURCE_AGE_MS ?? 14 * 24 * 60 * 60 * 1000);
const maxFalseAlertRate = Number(process.env.OPERATOR_MAX_FALSE_ALERT_RATE ?? 0.4);
const maxFailedRefreshes = Number(process.env.OPERATOR_MAX_FAILED_REFRESHES ?? 0);
const maxDelayedDeliveries = Number(process.env.OPERATOR_MAX_DELAYED_DELIVERIES ?? 0);
const requireWorkerHealth = process.env.REQUIRE_WORKER_HEALTH === "1";
const maxWorkerStatusAgeMs = Number(process.env.WORKER_STATUS_MAX_AGE_MS ?? 24 * 60 * 60 * 1000);
const operatorWarningAckSlaMs = Number(process.env.OPERATOR_WARNING_ACK_SLA_MS ?? 4 * 60 * 60 * 1000);
const operatorRemediationSlaMs = Number(process.env.OPERATOR_REMEDIATION_SLA_MS ?? 24 * 60 * 60 * 1000);
const supportSlaMs = { urgent: Number(process.env.SUPPORT_URGENT_SLA_MS ?? 4 * 60 * 60 * 1000), normal: Number(process.env.SUPPORT_NORMAL_SLA_MS ?? 24 * 60 * 60 * 1000), low: Number(process.env.SUPPORT_LOW_SLA_MS ?? 3 * 24 * 60 * 60 * 1000) };
const defaultNotificationPreferences = { comparisonAlerts: true, sourceAlerts: true, deliveryUpdates: true };
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
await mkdir(runtimeDir, { recursive: true });
const store = createRuntimeStore(runtimeDir);
await importRuntimeLedgers(store, {
  runtimeDir,
  questions: questionsPath,
  audit: auditPath,
  operations: operationsPath,
  alerts: alertsPath,
  briefingPublications: briefingPublicationsPath,
  insightDecisions: insightDecisionsPath,
  insightPublications: insightPublicationsPath,
  decisionOutcomes: decisionOutcomesPath,
  watchlists: watchlistsPath,
  workspaceSources: workspaceSourcesPath,
  comparisonViews: comparisonViewsPath,
  notificationPreferences: notificationPreferencesPath,
  deliveryNotifications: deliveryNotificationsPath,
  deliveryNotificationAttempts: deliveryNotificationAttemptsPath,
  pilotProfiles: pilotProfilesPath,
  pilotDeliveries: pilotDeliveriesPath,
  pilotDecisions: pilotDecisionsPath,
  commercialOffers: commercialOffersPath,
  operatorWarnings: operatorWarningsPath,
  operatorNotifications: operatorNotificationsPath,
  operatorRoutes: operatorRoutesPath,
  operatorAttempts: operatorAttemptsPath,
  workspaceDir,
  sourceScan: sourceScanPath,
  evidenceLedger: evidenceLedgerPath,
  reviewDecisions: reviewDecisionsPath,
  reviewEvents: reviewEventsPath,
  supportRequests: supportRequestsPath
});

const json = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

const text = (response, status, body, contentType = "text/plain; version=0.0.4; charset=utf-8") => {
  response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  response.end(body);
};

async function requestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw Object.assign(new Error("Request body is too large."), { code: "PAYLOAD_TOO_LARGE" });
  }
  return body ? JSON.parse(body) : {};
}

async function requestTextBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw Object.assign(new Error("Request body is too large."), { code: "PAYLOAD_TOO_LARGE" });
  }
  return body;
}

function validWebhookSignature(body, header) {
  if (!identityProviderWebhookSecret || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const supplied = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", identityProviderWebhookSecret).update(body).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function authenticatedActor(request, body) {
  if (authMode === "demo") return request.headers["x-workspace-actor"] || body.actorId;
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return tokenActors[token];
}

async function configuredWorkspaces() {
  const files = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
  const workspaces = await Promise.all(files.map(async (file) => JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"))));
  const registry = await readJson(workspaceRegistryPath, { workspaces: [] });
  const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  for (const workspace of registry.workspaces ?? []) byId.set(workspace.id, workspace);
  return [...byId.values()];
}

async function workspaceConfig(id) {
  const workspace = (await configuredWorkspaces()).find((candidate) => candidate.id === id);
  if (!workspace) return undefined;
  return { ...workspace, members: (workspace.members ?? []).filter((member) => !["invited", "pending_identity", "suspended"].includes(member.status)) };
}

async function workspaceAccess(request, requestedWorkspaceId) {
  if (authMode !== "token") return { workspaceId: requestedWorkspaceId ?? null, workspaceIds: null, actorId: authenticatedActor(request, {}) };
  const actorId = authenticatedActor(request, {});
  if (!actorId) return { error: { status: 401, body: { error: "Authentication required." } } };
  const workspaces = (await configuredWorkspaces()).filter((workspace) => workspace.members?.some((member) => member.id === actorId && !["invited", "pending_identity", "suspended"].includes(member.status)));
  if (requestedWorkspaceId) {
    const requested = await workspaceConfig(requestedWorkspaceId);
    if (!requested) return { error: { status: 404, body: { error: "Workspace not found." } } };
    if (!workspaces.some((workspace) => workspace.id === requestedWorkspaceId)) return { error: { status: 403, body: { error: "You are not a member of this workspace." } } };
    return { workspaceId: requestedWorkspaceId, workspaceIds: [requestedWorkspaceId], actorId };
  }
  return { workspaceId: null, workspaceIds: workspaces.map((workspace) => workspace.id), actorId };
}

function denyWorkspaceRead(response, access) {
  if (!access.error) return false;
  json(response, access.error.status, access.error.body);
  return true;
}

function operatorAccess(request) {
  const actorId = authenticatedActor(request, {});
  if (!actorId) return { error: { status: 401, body: { error: "Authentication required." } } };
  if (!operatorActors.has(actorId)) return { error: { status: 403, body: { error: "Operator access is required." } } };
  return { actorId };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function persistWorkspaceRegistryEntry(workspace) {
  const registry = await readJson(workspaceRegistryPath, { schemaVersion: "workspace-registry-v1", workspaces: [] });
  registry.schemaVersion = "workspace-registry-v1";
  registry.workspaces = [...(registry.workspaces ?? []).filter((candidate) => candidate.id !== workspace.id), workspace];
  await writeFile(workspaceRegistryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

async function writeWorkspaceInvitations(invitations) {
  await writeFile(workspaceInvitationsPath, `${JSON.stringify({ schemaVersion: "workspace-invitation-ledger-v1", updatedAt: new Date().toISOString(), invitations }, null, 2)}\n`);
}

async function ensureWorkspaceOnboardingNotification({ workspaceId, identityId, actorId, actorRole, occurredAt, requestId }) {
  const notifications = store.recordsLedger("delivery_notification", "workspace-delivery-notification-ledger-v1", "notifications").notifications;
  const id = `workspace-onboarding-ready-${workspaceId}`;
  if (notifications.some((notification) => notification.id === id)) return false;
  const notification = { id, workspaceId, deliveryId: null, type: "onboarding_ready", channel: "in_app", destinationId: null, status: "pending", subject: "Your workspace is ready for onboarding", body: "Your account is confirmed. Sign in to complete the decision question, evidence scope, success measures, cadence, and first handoff checklist.", deliveryStatus: "ready_for_onboarding", createdAt: occurredAt, deliveredAt: null, activatedIdentityId: identityId };
  store.commitRecord({ kind: "delivery_notification", record: notification, audit: { requestId, action: "queue_workspace_onboarding_notification", targetId: notification.id, workspaceId, actorId, actorRole, result: "pending", occurredAt }, operation: { key: null } });
  await writeFile(deliveryNotificationsPath, `${JSON.stringify(store.recordsLedger("delivery_notification", "workspace-delivery-notification-ledger-v1", "notifications"), null, 2)}\n`);
  return true;
}

function buildCoverage(packet, registry) {
  const records = packet.records ?? [];
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const countByRole = (roles) => records.filter((record) => roles.includes(record.sourceRole)).length;
  const reportWindows = records.filter((record) => record.reportWindow).map((record) => ({
    recordId: record.id,
    company: record.company ?? null,
    industry: record.industry ?? null,
    annualBaseline: record.reportWindow.annualBaseline ?? null,
    quarterCount: record.reportWindow.quarters?.length ?? 0,
    captureStatus: record.reportWindow.sourceRefs?.captureStatus ?? "not recorded",
    movementSource: record.reportWindow.movementSource ?? null,
    sourceRefs: record.reportWindow.sourceRefs?.directRecords?.length ?? 0
  }));
  const requirements = [
    { id: "early-signal", label: "Early signal", evidence: countByRole(["trend_signal"]), target: 1, meaning: "A visible change or condition to investigate." },
    { id: "social-and-institutional", label: "People and institutions", evidence: countByRole(["social_cultural", "institutional", "geopolitical"]), target: 1, meaning: "Evidence about lived conditions, institutions, or power." },
    { id: "industry-mechanism", label: "Industry mechanism", evidence: countByRole(["industry"]), target: 1, meaning: "How the change operates inside an industry." },
    { id: "private-company", label: "Private-company response", evidence: countByRole(["private_company"]), target: 1, meaning: "A growing private company and the customer problem it serves." },
    { id: "public-company-history", label: "Public-company annual plus quarterly history", evidence: reportWindows.length, target: 5, meaning: "At least five companies with one annual baseline and three or more quarters." },
    { id: "independent-outcome", label: "Independent outcome evidence", evidence: records.filter((record) => ["measured", "compared"].includes(record.claimState) && !["company_report", "industry", "private_company"].includes(record.sourceRole)).length, target: 3, meaning: "Evidence that tests what happened in practice, not only what was promised." },
    { id: "counterexample", label: "Counterexample or weakened case", evidence: records.filter((record) => record.claimState === "disproved_or_weakened").length, target: 1, meaning: "A case that makes the main reading less certain." },
    { id: "open-question", label: "Open question", evidence: countByRole(["open_question"]), target: 1, meaning: "A concrete question that determines the next research step." }
  ].map((item) => ({ ...item, status: item.evidence >= item.target ? "ready" : item.evidence > 0 ? "partial" : "missing" }));
  const repositories = (registry.repositories ?? []).map((source) => {
    const sourceRecords = records.filter((record) => record.sourceRepository === source.id);
    return { id: source.id, refresh: source.refresh, purpose: source.purpose, recordCount: sourceRecords.length, latestAsOf: sourceRecords.map((record) => record.asOf).sort().at(-1) ?? null, status: sourceRecords.length ? "present" : "missing" };
  });
  const outcomeBridges = (packet.outcomeBridges ?? []).map((bridge) => {
    const group = (ids) => (ids ?? []).map((id) => recordsById.get(id)).filter(Boolean).map((record) => ({ id: record.id, title: record.title, sourceRole: record.sourceRole, claimState: record.claimState, asOf: record.asOf ?? null, stageLedger: record.stageLedger ? { status: record.stageLedger.status, checked: record.stageLedger.checked, requiredStageOrder: record.stageLedger.requiredStageOrder, records: record.stageLedger.records, result: record.stageLedger.result, nextTest: record.stageLedger.nextTest } : null }));
    return { ...bridge, companyRecords: group(bridge.companyRecordIds), independentRecords: group(bridge.independentRecordIds), namedWorkflowRecords: group(bridge.namedWorkflowRecordIds), counterexampleRecords: group(bridge.counterexampleRecordIds) };
  });
  return { schemaVersion: "coverage-read-model-v1", domain: packet.domain ?? null, sourceSnapshotDate: packet.sourceSnapshotDate ?? null, repositories, reportWindows, outcomeBridges, requirements, summary: { ready: requirements.filter((item) => item.status === "ready").length, partial: requirements.filter((item) => item.status === "partial").length, missing: requirements.filter((item) => item.status === "missing").length } };
}

function buildPilotMetrics({ workspaceId, auditEntries, alerts, outcomes, briefings, deliveries = [] }) {
  const resolvedAlerts = alerts.filter((alert) => alert.state === "resolved" || alert.resolutionDisposition);
  const responseTimes = resolvedAlerts.map((alert) => alert.responseTimeMs).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const median = responseTimes.length ? responseTimes[Math.floor(responseTimes.length / 2)] : null;
  const correctionResponseTimes = resolvedAlerts.filter((alert) => alert.resolutionDisposition === "needs_correction").map((alert) => alert.responseTimeMs).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const medianCorrectionResponseMs = correctionResponseTimes.length ? correctionResponseTimes[Math.floor(correctionResponseTimes.length / 2)] : null;
  const deliveryReviewTimes = deliveries.map((delivery) => delivery.review && Number.isFinite(Date.parse(delivery.generatedAt)) && Number.isFinite(Date.parse(delivery.review.reviewedAt)) ? Math.max(0, Date.parse(delivery.review.reviewedAt) - Date.parse(delivery.generatedAt)) : null).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const medianDeliveryReviewMs = deliveryReviewTimes.length ? deliveryReviewTimes[Math.floor(deliveryReviewTimes.length / 2)] : null;
  const answerTimes = deliveries.map((delivery) => delivery.review?.answerTimeMinutes).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const medianAnswerTimeMinutes = answerTimes.length ? answerTimes[Math.floor(answerTimes.length / 2)] : null;
  const reviewedDeliveries = deliveries.filter((delivery) => delivery.review);
  const knownOutcomes = outcomes.filter((outcome) => ["held", "changed", "wrong"].includes(outcome.outcomeState));
  const publishedBriefings = auditEntries.filter((entry) => entry.action === "publish_briefing").length;
  const reusedBriefingIds = new Set(outcomes.filter((outcome) => outcome.decisionState === "used").map((outcome) => outcome.briefingId).filter(Boolean));
  return {
    schemaVersion: "pilot-metrics-v1",
    workspaceId,
    generatedAt: new Date().toISOString(),
    measures: {
      sourcesReviewed: auditEntries.filter((entry) => entry.action === "review_source").length,
      alertsSeen: alerts.length,
      alertsResolved: resolvedAlerts.length,
      usefulAlerts: resolvedAlerts.filter((alert) => alert.resolutionDisposition === "useful").length,
      falseAlerts: resolvedAlerts.filter((alert) => alert.resolutionDisposition === "false_positive").length,
      alertsNeedingCorrection: resolvedAlerts.filter((alert) => alert.resolutionDisposition === "needs_correction").length,
      medianAlertResponseMs: median,
      medianCorrectionResponseMs,
      medianDeliveryReviewMs,
      medianAnswerTimeMinutes,
      answerTimeObservations: answerTimes.length,
      missedImportantChanges: reviewedDeliveries.filter((delivery) => delivery.review.missedChangeState === "yes").length,
      missedChangeObservations: reviewedDeliveries.filter((delivery) => ["yes", "none", "unknown"].includes(delivery.review.missedChangeState)).length,
      sourceTraceInspections: auditEntries.filter((entry) => ["inspect_evidence", "inspect_insight"].includes(entry.action)).length,
      briefingsPublished: publishedBriefings,
      briefingsExported: auditEntries.filter((entry) => entry.action === "export_briefing").length,
      decisionFeedbackRecords: outcomes.length,
      decisionsUsingBriefings: outcomes.filter((outcome) => outcome.decisionState === "used").length,
      briefingReuseCount: reusedBriefingIds.size,
      briefingReuseRate: publishedBriefings ? reusedBriefingIds.size / publishedBriefings : null,
      decisionOutcomesWithInsights: outcomes.filter((outcome) => outcome.insightProvenance?.length).length,
      insightReceiptsUsed: outcomes.filter((outcome) => outcome.decisionState === "used").reduce((total, outcome) => total + (outcome.insightProvenance?.length ?? 0), 0),
      publishedInsightReceiptsUsed: outcomes.filter((outcome) => outcome.decisionState === "used").reduce((total, outcome) => total + (outcome.insightProvenance ?? []).filter((insight) => insight.state === "published").length, 0),
      deliveryReviews: auditEntries.filter((entry) => entry.action === "review_pilot_delivery").length,
      knownDecisionResults: knownOutcomes.length,
      readingsHeld: outcomes.filter((outcome) => outcome.outcomeState === "held").length,
      readingsChanged: outcomes.filter((outcome) => outcome.outcomeState === "changed").length,
      readingsWrong: outcomes.filter((outcome) => outcome.outcomeState === "wrong").length,
      activeBriefings: briefings.filter((briefing) => ["draft", "published", "stale"].includes(briefing.state)).length
    },
    interpretation: "These are workspace activity and follow-up measures. They describe product use and recorded experience; they do not prove alert quality, customer causation, or general market value."
  };
}

function buildWorkspaceUpdate({ workspaceId, workspaceName, refresh, readiness, coverage, metrics, alerts, questions, briefings }) {
  const openAlerts = alerts.filter((alert) => alert.state === "open");
  const activeQuestions = questions.filter((question) => question.state === "active");
  const activeBriefings = briefings.filter((briefing) => ["draft", "published", "stale"].includes(briefing.state));
  const staleBriefings = activeBriefings.filter((briefing) => briefing.state === "stale");
  const actions = [];
  if (openAlerts.length) actions.push({ type: "review_alerts", count: openAlerts.length, label: "Review open change alerts." });
  if (staleBriefings.length) actions.push({ type: "re_review_briefings", count: staleBriefings.length, label: "Re-check briefings whose evidence changed." });
  if (activeQuestions.length) actions.push({ type: "check_questions", count: activeQuestions.length, label: "Check whether saved questions have enough new evidence." });
  if (coverage.summary.missing || coverage.summary.partial) actions.push({ type: "close_evidence_gaps", count: coverage.summary.missing + coverage.summary.partial, label: "Close or explain incomplete evidence coverage." });
  const headline = openAlerts.length ? `${openAlerts.length} change${openAlerts.length === 1 ? "" : "s"} need review.` : "No open change alerts need review.";
  return {
    schemaVersion: "workspace-update-v1",
    workspaceId,
    workspaceName,
    generatedAt: new Date().toISOString(),
    headline,
    freshness: { refreshStatus: refresh.status ?? "not_run", refreshRunId: refresh.runId ?? null, refreshEndedAt: refresh.endedAt ?? null, readiness: readiness.status },
    changes: openAlerts.slice(0, 12).map((alert) => ({ id: alert.id, severity: alert.severity, watchlistName: alert.watchlistName, kind: alert.kind, reason: alert.reason, sourceId: alert.sourceId, createdAt: alert.createdAt })),
    actions,
    coverage: coverage.summary,
    activity: metrics.measures,
    briefings: activeBriefings.slice().sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? ""))).slice(0, 8).map((briefing) => ({ id: briefing.id, title: briefing.title, state: briefing.state, updatedAt: briefing.updatedAt ?? briefing.createdAt ?? null })),
    limitation: "This is a current workspace handoff, not a claim that every change matters or that the recorded activity caused a business result. Open the source and evidence chain before acting."
  };
}

function buildChangeIntelligenceFeed({ packet, scan, briefings = [], candidates = [], watchlists = [], workspaceId = null, workspaceIds = null }) {
  const recordsById = new Map((packet.records ?? []).map((record) => [record.id, record]));
  const recordsByPath = new Map((packet.records ?? []).map((record) => [record.sourceRef, record]));
  const candidatesByKey = new Map(candidates.map((candidate) => [candidate.candidateKey, candidate]));
  const visibleWorkspace = (item) => workspaceIds ? workspaceIds.includes(item.workspaceId) : (!workspaceId || item.workspaceId === workspaceId);
  const visibleBriefings = briefings.filter(visibleWorkspace);
  const visibleWatchlists = watchlists.filter(visibleWorkspace);
  const scopedSourceIds = new Set(visibleWatchlists.flatMap((watchlist) => watchlist.sourceIds ?? []));
  const scopedRepositoryIds = new Set(visibleWatchlists.flatMap((watchlist) => watchlist.repositoryIds ?? []));
  const hasWatchlistScope = visibleWatchlists.length > 0;
  const sourceMatchesWatchlist = (source, watchlist) => {
    const identityMatches = (watchlist.sourceIds ?? []).includes(source.id) || (watchlist.repositoryIds ?? []).includes(source.repository);
    const allowedStates = watchlist.alertOn?.length ? watchlist.alertOn : ["changed", "missing"];
    return identityMatches && allowedStates.includes(source.status);
  };
  const items = (scan.sources ?? [])
    .filter((source) => source.status !== "unchanged" && (!hasWatchlistScope || visibleWatchlists.some((watchlist) => sourceMatchesWatchlist(source, watchlist))))
    .map((source) => {
      const record = recordsById.get(source.id) ?? recordsByPath.get(source.path);
      const linkedInsights = record ? (packet.insights ?? []).filter((insight) => (insight.recordIds ?? []).includes(record.id)).map((insight) => {
        const candidate = candidatesByKey.get(insight.id);
        return { id: insight.id, title: insight.title, status: candidate?.status ?? insight.status ?? "not_generated", stale: candidate?.status === "stale", nextTest: insight.nextTest ?? null };
      }) : [];
      const linkedBriefings = record ? visibleBriefings.filter((briefing) => (briefing.evidence ?? []).some((evidence) => evidence.recordId === record.id)).map((briefing) => ({ id: briefing.id, title: briefing.title, state: briefing.state, stale: briefing.state === "stale" })) : [];
      const action = source.status === "missing" ? "Restore or replace the unavailable source before relying on this reading." : source.status === "changed" ? "Open the updated source and re-check linked interpretations." : source.status === "new" ? "Review the new source before using it in a published reading." : "Check this deferred source when its refresh cadence is due.";
      return {
        id: `change-${source.id}-${source.checkedAt ?? scan.runId ?? "current"}`,
        sourceId: source.id,
        status: source.status,
        repository: source.repository,
        sourcePath: source.path,
        checkedAt: source.checkedAt ?? scan.generatedAt ?? null,
        previousSha256: source.previousSha256 ?? null,
        currentSha256: source.sha256 ?? null,
        title: record?.title ?? source.path,
        plainLanguage: source.status === "missing" ? "The source is unavailable, so the evidence chain may no longer be complete." : source.status === "changed" ? "The source material changed since the last scan." : source.status === "new" ? "A new source was found in the research set." : "This source was deferred because its refresh cadence has not arrived.",
        whyItMatters: record?.mechanism ?? source.reviewReason ?? "The source needs an explicit review before downstream claims are treated as current.",
        observation: record?.observation ?? null,
        sourceRole: record?.sourceRole ?? null,
        claimState: record?.claimState ?? null,
        asOf: record?.asOf ?? null,
        affectedGroups: record?.affectedGroups ?? [],
        limits: record?.limits ?? [],
        nextAction: action,
        recordId: record?.id ?? null,
        linkedInsights,
        linkedBriefings,
        staleDownstreamCount: linkedInsights.filter((insight) => insight.stale).length + linkedBriefings.filter((briefing) => briefing.stale).length
      };
    });
  return {
    schemaVersion: "change-intelligence-feed-v1",
    runId: scan.runId ?? null,
    generatedAt: scan.generatedAt ?? null,
    items,
    scope: { mode: hasWatchlistScope ? "watchlists" : "all_sources", watchlistCount: visibleWatchlists.length, sourceCount: scopedSourceIds.size, repositoryCount: scopedRepositoryIds.size, explanation: hasWatchlistScope ? "Only sources selected by this workspace's watchlists are shown." : "No watchlist is configured, so all changed sources in the current research set are shown until the workspace narrows the scope." },
    summary: { total: items.length, changed: items.filter((item) => item.status === "changed").length, new: items.filter((item) => item.status === "new").length, missing: items.filter((item) => item.status === "missing").length, deferred: items.filter((item) => item.status === "deferred").length, downstreamItemsNeedingReview: items.filter((item) => item.staleDownstreamCount > 0).length },
    limitation: "This feed identifies source and publication work triggered by a refresh. It does not decide whether a change matters in the world; inspect the source, limits, and linked evidence before acting."
  };
}

function summarizeSourceDiff(beforeText, afterText) {
  const limit = 200000;
  const beforeTruncated = beforeText.length > limit;
  const afterTruncated = afterText.length > limit;
  const beforeLines = beforeText.slice(0, limit).split(/\r?\n/);
  const afterLines = afterText.slice(0, limit).split(/\r?\n/);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < beforeLines.length - prefix && suffix < afterLines.length - prefix && beforeLines.at(-1 - suffix) === afterLines.at(-1 - suffix)) suffix += 1;
  const removedLines = beforeLines.slice(prefix, beforeLines.length - suffix).slice(0, 80);
  const addedLines = afterLines.slice(prefix, afterLines.length - suffix).slice(0, 80);
  return {
    state: beforeText === afterText ? "unchanged" : "changed",
    firstChangedLine: prefix + 1,
    removedLines,
    addedLines,
    removedLineCount: Math.max(0, beforeLines.length - prefix - suffix),
    addedLineCount: Math.max(0, afterLines.length - prefix - suffix),
    truncated: beforeTruncated || afterTruncated || removedLines.length < Math.max(0, beforeLines.length - prefix - suffix) || addedLines.length < Math.max(0, afterLines.length - prefix - suffix),
    limitation: "This is a bounded line-level comparison of captured source bytes. It identifies changed text; it does not decide whether the underlying claim is true or important."
  };
}

async function readSourceDiff(source) {
  const captureLedger = await readJson(captureLedgerPath, { captures: [] });
  const captures = captureLedger.captures ?? [];
  const currentCapture = captures.find((capture) => capture.id === source.id && capture.sha256 === source.sha256) ?? (source.capturePath ? { id: source.id, sha256: source.sha256, capturePath: source.capturePath } : null);
  const previousCapture = source.previousSha256 ? captures.find((capture) => capture.id === source.id && capture.sha256 === source.previousSha256) : null;
  const readCapture = async (capture) => {
    if (!capture?.capturePath || capture.capturePath.startsWith("/") || capture.capturePath.includes("..")) return null;
    try { return await readFile(resolve(runtimeDir, capture.capturePath), "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  const before = await readCapture(previousCapture);
  const after = await readCapture(currentCapture);
  return {
    schemaVersion: "source-diff-v1",
    sourceId: source.id,
    status: source.status,
    repository: source.repository,
    sourcePath: source.path,
    previousSha256: source.previousSha256 ?? null,
    currentSha256: source.sha256 ?? null,
    captures: { previous: Boolean(before), current: Boolean(after) },
    diff: before !== null && after !== null ? summarizeSourceDiff(before, after) : null,
    limitation: "A missing capture prevents comparison. The source scan still records the digest and availability state, but no text difference is inferred."
  };
}

function buildInsightEvidenceChain(insight, recordsById) {
  const evidence = (insight.recordIds ?? []).map((recordId) => recordsById.get(recordId)).filter(Boolean);
  const recordView = (record) => ({ id: record.id, title: record.title, sourceRole: record.sourceRole, claimState: record.claimState, asOf: record.asOf ?? null, observation: record.observation, limits: record.limits ?? [] });
  const stages = [
    { id: "signal_or_condition", label: "Signal or condition", records: evidence.filter((record) => ["trend_signal", "social_cultural", "institutional", "geopolitical"].includes(record.sourceRole)), meaning: "What was observed before we explain it." },
    { id: "operating_mechanism", label: "Operating mechanism", records: evidence.filter((record) => record.mechanism), meaning: "The process the sources describe; this is an explanation, not proof of causation." },
    { id: "industry_and_company_response", label: "Industry and company response", records: evidence.filter((record) => ["industry", "private_company", "company_report"].includes(record.sourceRole)), meaning: "How organizations and markets are responding or reporting movement." },
    { id: "affected_groups", label: "Affected groups", records: evidence.filter((record) => (record.affectedGroups ?? []).length), meaning: "Who may benefit, carry cost, do the work, or lose control." },
    { id: "observed_result", label: "Observed result", records: evidence.filter((record) => ["measured", "compared"].includes(record.claimState) && !["company_report", "industry", "private_company"].includes(record.sourceRole)), meaning: "Independent or measured evidence about what happened in practice." },
    { id: "counterexample", label: "Counterexample or weakening evidence", records: evidence.filter((record) => record.claimState === "disproved_or_weakened"), meaning: "Evidence that makes the main reading less certain." }
  ].map((stage) => ({ ...stage, status: stage.records.length ? "present" : "missing", records: stage.records.map(recordView) }));
  const affectedGroups = [...new Set(evidence.flatMap((record) => record.affectedGroups ?? []))].sort();
  return {
    schemaVersion: "insight-evidence-chain-v1",
    stages,
    affectedGroups,
    nextTest: insight.nextTest ?? null,
    limitation: "This chain organizes source records into distinct roles. It does not turn adjacency into causation, and a missing stage means the insight remains open rather than proven."
  };
}

function workspaceRecords(records, workspaceId) {
  return (records ?? []).filter((record) => record.workspaceId === workspaceId);
}

function buildWorkspaceExport({ workspace, packet, questions, evaluations, briefings, watchlists, privateSources, comparisons, preferences, notifications, deliveries, pilotProfile, pilotDecisions, commercialOffers, outcomes, briefingPublications, insightPublications, auditEntries }) {
  const sourceIds = new Set();
  for (const question of questions) for (const sourceId of question.scope?.sourceIds ?? []) sourceIds.add(sourceId);
  for (const briefing of briefings) for (const evidence of briefing.evidence ?? []) sourceIds.add(evidence.recordId);
  for (const watchlist of watchlists) for (const sourceId of watchlist.sourceIds ?? []) sourceIds.add(sourceId);
  for (const delivery of deliveries) for (const briefing of delivery.briefings ?? []) for (const evidence of briefing.evidence ?? []) sourceIds.add(evidence.recordId);
  const sourceRecords = (packet.records ?? []).filter((record) => sourceIds.has(record.id)).map((record) => ({ id: record.id, title: record.title, sourceRepository: record.sourceRepository, sourceRef: record.sourceRef, sourceDigest: record.sourceDigest, sourceLocator: record.sourceLocator ?? null, sourceExcerpt: record.sourceExcerpt ?? null, claimState: record.claimState, asOf: record.asOf, observation: record.observation, mechanism: record.mechanism, affectedGroups: record.affectedGroups ?? [], limits: record.limits ?? [] }));
  const safePreferences = preferences ? { ...preferences, webhookUrl: undefined } : null;
  if (safePreferences) delete safePreferences.webhookUrl;
  return {
    schemaVersion: "workspace-export-v1",
    exportedAt: new Date().toISOString(),
    workspace: { id: workspace.id, name: workspace.name },
    questions,
    questionEvaluations: evaluations,
    briefings,
    watchlists,
    privateSources,
    comparisons,
    notificationPreferences: safePreferences,
    deliveryNotifications: notifications,
    pilot: { profile: pilotProfile, decisions: pilotDecisions, deliveries },
    commercialOffers,
    decisionOutcomes: outcomes,
    publicationReceipts: { briefings: briefingPublications, insights: insightPublications },
    sourceRecords,
    audit: auditEntries,
    limitation: "This export contains the selected workspace's recorded product history and source links. It is not a guarantee that the research was correct, complete, or useful, and it excludes webhook secrets and other workspaces."
  };
}

function buildPilotKickoff({ workspace, profile, questions, watchlists, deliveries, sourceCount }) {
  const latestDelivery = deliveries.slice().sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))[0] ?? null;
  return {
    schemaVersion: "pilot-kickoff-packet-v1",
    generatedAt: new Date().toISOString(),
    workspace: { id: workspace.id, name: workspace.name },
    offer: { name: "Evidence-backed change intelligence pilot", domain: "AI, work, and enterprise control", service: "Recurring source-linked briefings, change alerts, and decision follow-up" },
    decision: { question: profile?.decisionQuestion ?? null, context: profile?.decisionContext ?? null, status: profile ? "configured" : "needs_configuration" },
    scope: { watchlists: watchlists.map((watchlist) => ({ id: watchlist.id, name: watchlist.name, sourceCount: watchlist.sourceIds?.length ?? 0 })), savedQuestions: questions.length, acceptedPrivateSources: sourceCount },
    cadence: { delivery: profile?.cadence ?? null, nextReviewAt: profile?.nextReviewAt ?? null, successMeasures: profile?.successMeasures ?? [] },
    firstHandoff: { status: latestDelivery?.status ?? "not_generated", generatedAt: latestDelivery?.generatedAt ?? null, refreshRunId: latestDelivery?.refreshRunId ?? null, deliveryId: latestDelivery?.id ?? null },
    reviewProtocol: ["Inspect the evidence and limits", "Record whether the handoff was useful", "Record whether it informed or changed a decision", "Record any correction and the next test"],
    checkpoint: { afterReviewedDeliveries: 3, choices: ["improve", "continue", "expand", "stop"], humanDecisionRequired: true },
    boundaries: ["The service records evidence and decisions; it does not make the commercial decision silently.", "A prepared handoff is not proof of usefulness or general market value.", "Every claim remains bounded by its source coverage and unresolved alternatives."],
    nextAction: profile ? (latestDelivery ? "Review the first handoff, then record the partner's observation." : "Run the first refresh to create the reviewable handoff.") : "Configure the decision question, source scope, measures, and cadence before the first refresh."
  };
}

const workspaceDeletionSchema = "workspace-deletion-v1";

async function persistWorkspaceLedgersAfterDeletion() {
  const currentAlerts = await readJson(alertsPath, { workspaces: [] });
  const ledgers = [
    [questionsPath, store.questionsLedger()],
    [alertsPath, store.alertsLedger(currentAlerts.workspaces ?? [])],
    [briefingPublicationsPath, store.recordsLedger("briefing_publication", "briefing-publication-ledger-v1", "publications")],
    [insightDecisionsPath, store.recordsLedger("insight_decision", "insight-decision-ledger-v1", "decisions")],
    [insightPublicationsPath, store.recordsLedger("insight_publication", "insight-publication-ledger-v1", "publications")],
    [decisionOutcomesPath, store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes")],
    [watchlistsPath, store.recordsLedger("watchlist", "workspace-watchlist-ledger-v1", "watchlists")],
    [workspaceSourcesPath, store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources")],
    [comparisonViewsPath, store.recordsLedger("comparison_view", "workspace-comparison-view-ledger-v1", "views")],
    [notificationPreferencesPath, store.recordsLedger("notification_preference", "workspace-notification-preference-ledger-v1", "preferences")],
    [deliveryNotificationsPath, store.recordsLedger("delivery_notification", "workspace-delivery-notification-ledger-v1", "notifications")],
    [deliveryNotificationAttemptsPath, store.recordsLedger("delivery_notification_attempt", "workspace-delivery-notification-attempt-ledger-v1", "attempts")],
    [pilotProfilesPath, store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles")],
    [pilotDeliveriesPath, store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries")],
    [pilotDecisionsPath, store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions")],
    [pilotReadinessPath, store.recordsLedger("pilot_readiness", "pilot-readiness-ledger-v1", "snapshots")],
    [commercialOffersPath, store.recordsLedger("commercial_offer", "workspace-commercial-offer-ledger-v1", "offers")],
    [reviewDecisionsPath, store.recordsLedger("review_decision", "review-decision-ledger-v1", "decisions")],
    [reviewEventsPath, store.recordsLedger("review_event", "review-event-ledger-v1", "events")],
    [supportRequestsPath, store.recordsLedger("support_request", "workspace-support-request-ledger-v1", "requests")],
    [auditPath, store.auditLedger()]
  ];
  await Promise.all(ledgers.map(([path, body]) => writeFile(path, `${JSON.stringify(body, null, 2)}\n`)));
}

function buildPilotLearningReport({ workspaceId, profile, deliveries, decisions, outcomes = [] }) {
  const reviewed = deliveries.filter((delivery) => delivery.review);
  const count = (items, value) => items.filter((item) => item === value).length;
  const usefulnessValues = reviewed.map((delivery) => delivery.review.usefulness);
  const impactValues = reviewed.map((delivery) => delivery.review.decisionImpact);
  const correctionValues = reviewed.map((delivery) => delivery.review.correctionType ?? "none");
  const answerTimes = reviewed.map((delivery) => delivery.review.answerTimeMinutes).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const missedChangeValues = reviewed.map((delivery) => delivery.review.missedChangeState).filter(Boolean);
  const insightOutcomeRecords = outcomes.filter((outcome) => outcome.insightProvenance?.length);
  const insightReceiptUsage = new Map();
  for (const outcome of insightOutcomeRecords) {
    for (const insight of outcome.insightProvenance) {
      const key = insight.publicationId ?? insight.insightId ?? insight.title;
      if (!key) continue;
      const current = insightReceiptUsage.get(key) ?? { publicationId: insight.publicationId ?? null, insightId: insight.insightId ?? null, title: insight.title ?? "Untitled insight", outcomes: 0, usedInDecision: 0, publishedReceipts: 0 };
      current.outcomes += 1;
      if (outcome.decisionState === "used") current.usedInDecision += 1;
      if (insight.state === "published") current.publishedReceipts += 1;
      insightReceiptUsage.set(key, current);
    }
  }
  const insightFeedback = { outcomesWithInsights: insightOutcomeRecords.length, receiptsReferenced: [...insightReceiptUsage.values()].reduce((total, insight) => total + insight.outcomes, 0), publishedReceiptsReferenced: [...insightReceiptUsage.values()].reduce((total, insight) => total + insight.publishedReceipts, 0), byReceipt: [...insightReceiptUsage.values()].sort((a, b) => b.usedInDecision - a.usedInDecision || b.outcomes - a.outcomes || a.title.localeCompare(b.title)) };
  const measureNames = [...new Set([...(profile?.successMeasures ?? []), ...deliveries.flatMap((delivery) => delivery.successMeasures ?? [])])];
  const measures = measureNames.map((name) => {
    const assessments = reviewed.flatMap((delivery) => delivery.review.measureAssessments ?? []).filter((assessment) => assessment.name === name);
    return { name, observations: assessments.length, states: { met: count(assessments.map((assessment) => assessment.state), "met"), partiallyMet: count(assessments.map((assessment) => assessment.state), "partially_met"), notMet: count(assessments.map((assessment) => assessment.state), "not_met"), unknown: count(assessments.map((assessment) => assessment.state), "unknown") }, latestState: assessments.at(-1)?.state ?? null };
  });
  const openIssues = [];
  if (!reviewed.length) openIssues.push("No delivery has been reviewed yet.");
  if (deliveries.length > reviewed.length) openIssues.push(`${deliveries.length - reviewed.length} delivery${deliveries.length - reviewed.length === 1 ? " is" : "s are"} waiting for partner review.`);
  if (count(usefulnessValues, "not_useful") || count(usefulnessValues, "unclear")) openIssues.push(`${count(usefulnessValues, "not_useful") + count(usefulnessValues, "unclear")} reviewed deliver${count(usefulnessValues, "not_useful") + count(usefulnessValues, "unclear") === 1 ? "y was" : "ies were"} not clearly useful.`);
  if (measures.some((measure) => measure.states.notMet || measure.states.unknown)) openIssues.push("At least one agreed success measure is not met or still unknown.");
  if (correctionValues.some((value) => value !== "none")) openIssues.push(`${correctionValues.filter((value) => value !== "none").length} delivery correction${correctionValues.filter((value) => value !== "none").length === 1 ? " is" : "s are"} recorded for follow-up.`);
  return {
    schemaVersion: "pilot-learning-report-v1",
    workspaceId,
    profileId: profile?.id ?? null,
    decisionQuestion: profile?.decisionQuestion ?? null,
    generatedAt: new Date().toISOString(),
    observation: { deliveries: deliveries.length, reviewedDeliveries: reviewed.length, unreviewedDeliveries: deliveries.length - reviewed.length },
    checkpoint: { state: reviewed.length >= 3 ? "enough_observations_for_checkpoint" : "more_observations_needed", reviewedDeliveriesRequired: 3, explanation: reviewed.length >= 3 ? "The workspace has at least three reviewed deliveries; a human checkpoint can use this report." : "Use this report as a learning log, but collect at least three reviewed deliveries before making a commercial decision." },
    usefulness: { useful: count(usefulnessValues, "useful"), notUseful: count(usefulnessValues, "not_useful"), unclear: count(usefulnessValues, "unclear"), rate: reviewed.length ? count(usefulnessValues, "useful") / reviewed.length : null },
    corrections: { total: correctionValues.filter((value) => value !== "none").length, inaccurate: count(correctionValues, "inaccurate"), missingContext: count(correctionValues, "missing_context"), unclear: count(correctionValues, "unclear"), wrongScope: count(correctionValues, "wrong_scope") },
    answerTime: { observations: answerTimes.length, medianMinutes: answerTimes.length ? answerTimes[Math.floor(answerTimes.length / 2)] : null },
    missedChanges: { observations: missedChangeValues.length, reported: count(missedChangeValues, "yes"), noneReported: count(missedChangeValues, "none"), unknown: count(missedChangeValues, "unknown") },
    decisionImpact: { changedDecision: count(impactValues, "changed_decision"), informedDecision: count(impactValues, "informed_decision"), noChange: count(impactValues, "no_change"), notApplicable: count(impactValues, "not_applicable") },
    insightFeedback,
    measures,
    openIssues,
    recentNotes: reviewed.slice().sort((a, b) => String(b.review.reviewedAt).localeCompare(String(a.review.reviewedAt))).slice(0, 5).map((delivery) => ({ deliveryId: delivery.id, usefulness: delivery.review.usefulness, correctionType: delivery.review.correctionType ?? "none", correctionNote: delivery.review.correctionNote ?? null, missedChangeState: delivery.review.missedChangeState ?? "unknown", missedChangeNote: delivery.review.missedChangeNote ?? null, answerTimeMinutes: delivery.review.answerTimeMinutes ?? null, note: delivery.review.note, reviewedAt: delivery.review.reviewedAt })),
    latestDecision: decisions.slice().sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0] ?? null,
    decisionHistory: decisions.slice().sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt))).map((decision) => ({ decision: decision.decision, note: decision.note, nextStep: decision.nextStep, decidedAt: decision.decidedAt })),
    deliveryHistory: deliveries.slice().sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt))).map((delivery) => ({ id: delivery.id, generatedAt: delivery.generatedAt, status: delivery.status, refreshRunId: delivery.refreshRunId, headline: delivery.headline, usefulness: delivery.review?.usefulness ?? "not reviewed", decisionImpact: delivery.review?.decisionImpact ?? "not reviewed", reviewedAt: delivery.review?.reviewedAt ?? null })) ,
    limitation: "This report summarizes what this partner recorded about this pilot. It does not establish general market value, causation, or performance outside this workspace."
  };
}

function buildOperatorDeliveryHealth({ notifications, attempts }) {
  const terminal = notifications.filter((notification) => ["delivered", "dead_letter"].includes(notification.status));
  const latencies = notifications.map((notification) => Number.isFinite(Date.parse(notification.deliveredAt)) && Number.isFinite(Date.parse(notification.createdAt)) ? Date.parse(notification.deliveredAt) - Date.parse(notification.createdAt) : null).filter((value) => value !== null);
  const group = (key) => [...new Set(notifications.map((notification) => notification[key] ?? "unscoped"))].map((value) => {
    const scoped = notifications.filter((notification) => (notification[key] ?? "unscoped") === value);
    const scopedTerminal = scoped.filter((notification) => ["delivered", "dead_letter"].includes(notification.status));
    return { [key]: value, notifications: scoped.length, delivered: scoped.filter((notification) => notification.status === "delivered").length, deadLetters: scoped.filter((notification) => notification.status === "dead_letter").length, pending: scoped.filter((notification) => notification.status === "pending").length, attempts: attempts.filter((attempt) => scoped.some((notification) => notification.id === attempt.notificationId)).length, successRate: scopedTerminal.length ? scoped.filter((notification) => notification.status === "delivered").length / scopedTerminal.length : null };
  });
  return { schemaVersion: "operator-delivery-health-v1", generatedAt: new Date().toISOString(), summary: { notifications: notifications.length, attempts: attempts.length, delivered: notifications.filter((notification) => notification.status === "delivered").length, deadLetters: notifications.filter((notification) => notification.status === "dead_letter").length, pending: notifications.filter((notification) => notification.status === "pending").length, retries: attempts.filter((attempt) => attempt.attempt > 1).length, successRate: terminal.length ? notifications.filter((notification) => notification.status === "delivered").length / terminal.length : null, averageLatencyMs: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null }, byRecipient: group("recipient"), byWorkspace: group("workspaceId"), recentAttempts: attempts.slice().sort((a, b) => String(b.attemptedAt).localeCompare(String(a.attemptedAt))).slice(0, 30).map(({ error, ...attempt }) => ({ ...attempt, error: error ?? null })) };
}

function buildWorkspaceDeliveryHealth({ workspaceId, notifications, attempts }) {
  const scopedNotifications = notifications.filter((notification) => notification.workspaceId === workspaceId);
  const scopedIds = new Set(scopedNotifications.map((notification) => notification.id));
  const health = buildOperatorDeliveryHealth({ notifications: scopedNotifications, attempts: attempts.filter((attempt) => scopedIds.has(attempt.notificationId)) });
  return { schemaVersion: "workspace-delivery-health-v1", generatedAt: health.generatedAt, workspaceId, summary: health.summary, limitation: "This reports delivery records for this workspace only. It does not establish that the delivered intelligence was useful or correct." };
}

function buildWorkspaceServiceReport({ workspaceId, profile, deliveries, learning, deliveryHealth }) {
  const cadenceMs = { weekly: 7 * 86400000, monthly: 31 * 86400000, quarterly: 93 * 86400000 }[profile?.cadence] ?? null;
  const latestDeliveryAt = deliveries.map((delivery) => delivery.generatedAt).sort().at(-1) ?? null;
  const nextExpectedAt = latestDeliveryAt && cadenceMs ? new Date(Date.parse(latestDeliveryAt) + cadenceMs).toISOString() : null;
  const overdue = Boolean(nextExpectedAt && Date.parse(nextExpectedAt) < Date.now());
  const status = !profile ? "not_configured" : !deliveries.length ? "awaiting_first_delivery" : deliveryHealth.summary.deadLetters || deliveryHealth.summary.pending || overdue ? "attention" : "on_track";
  return { schemaVersion: "workspace-service-level-report-v1", generatedAt: new Date().toISOString(), workspaceId, status, serviceLevel: { cadence: profile?.cadence ?? null, nextReviewAt: profile?.nextReviewAt ?? null, latestDeliveryAt, nextExpectedAt, overdue, delivery: deliveryHealth.summary }, observations: { reviewedDeliveries: learning.observation.reviewedDeliveries, usefulnessRate: learning.usefulness.rate, decisionChanges: learning.decisionImpact.changedDecision + learning.decisionImpact.informedDecision, measures: learning.measures }, limitation: "This report describes the configured service cadence, recorded transport, and partner observations. It is not a guarantee of future delivery or a claim that the intelligence caused a business result." };
}

function buildCommercialPilotReadiness({ workspaceId, profile, learning, serviceReport, history }) {
  const reviewed = learning.observation.reviewedDeliveries;
  const measuresNotMet = learning.measures.filter((measure) => measure.states.notMet).length;
  const usefulnessRate = learning.usefulness.rate;
  let recommendation = "continue";
  let rationale = "Collect at least three reviewed deliveries before making a commercial decision.";
  if (!profile) { recommendation = "improve"; rationale = "Configure the pilot decision question, cadence, and success measures first."; }
  else if (serviceReport.status === "attention") { recommendation = "improve"; rationale = "Resolve delivery reliability or cadence issues before expansion."; }
  else if (reviewed >= 3 && usefulnessRate === 0) { recommendation = "stop"; rationale = "At least three reviewed deliveries were recorded and none was marked useful."; }
  else if (reviewed >= 3 && usefulnessRate >= 0.67 && learning.decisionImpact.changedDecision + learning.decisionImpact.informedDecision > 0 && !measuresNotMet) { recommendation = "expand"; rationale = "The pilot has repeated useful observations, recorded decision impact, and no failed success measure."; }
  return { schemaVersion: "commercial-pilot-readiness-v1", generatedAt: new Date().toISOString(), workspaceId, recommendation, humanCheckpointRequired: true, eligibility: { enoughReviewedDeliveries: reviewed >= 3, usefulRate: usefulnessRate, decisionImpactRecorded: learning.decisionImpact.changedDecision + learning.decisionImpact.informedDecision > 0, failedMeasures: measuresNotMet, serviceStatus: serviceReport.status }, rationale, latestRecordedDecision: learning.latestDecision ? { decision: learning.latestDecision.decision, decidedAt: learning.latestDecision.decidedAt, nextStep: learning.latestDecision.nextStep } : null, history: history.filter((snapshot) => snapshot.workspaceId === workspaceId).sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt))).slice(0, 30), limitation: "This is a decision aid based on recorded pilot observations. It does not make the commercial decision or prove general market value." };
}

function buildPilotCloseout({ workspace, profile, learning, readiness, metrics, serviceReport }) {
  const latestDecision = learning.latestDecision ? { decision: learning.latestDecision.decision, note: learning.latestDecision.note, nextStep: learning.latestDecision.nextStep, decidedAt: learning.latestDecision.decidedAt } : null;
  return {
    schemaVersion: "pilot-closeout-packet-v1",
    generatedAt: new Date().toISOString(),
    workspace: { id: workspace.id, name: workspace.name },
    decisionQuestion: profile?.decisionQuestion ?? null,
    observation: learning.observation,
    measures: metrics.measures,
    learning: { usefulness: learning.usefulness, decisionImpact: learning.decisionImpact, corrections: learning.corrections, insightFeedback: learning.insightFeedback, successMeasures: learning.measures, openIssues: learning.openIssues },
    service: { status: serviceReport.status, cadence: serviceReport.serviceLevel.cadence, latestDeliveryAt: serviceReport.serviceLevel.latestDeliveryAt, nextExpectedAt: serviceReport.serviceLevel.nextExpectedAt, overdue: serviceReport.serviceLevel.overdue },
    checkpoint: { recommendation: readiness.recommendation, rationale: readiness.rationale, humanCheckpointRequired: readiness.humanCheckpointRequired, eligibility: readiness.eligibility, latestRecordedDecision: readiness.latestRecordedDecision },
    humanDecision: latestDecision,
    nextAction: latestDecision?.nextStep ?? (readiness.recommendation === "expand" ? "Record the partner's commercial decision and define the recurring service scope." : readiness.recommendation === "stop" ? "Record the closeout reason and preserve the pilot history." : "Collect the next reviewed delivery and update the pilot checkpoint."),
    limits: ["This packet summarizes one workspace's recorded pilot experience.", "It does not prove causation, general market value, or performance outside this workspace.", "A recommendation is a decision aid; a human must record the commercial decision."]
  };
}

function buildWorkspaceOnboarding({ workspace, profile, questions, watchlists, privateSources, deliveries }) {
  const acceptedPrivateSources = privateSources.filter((source) => source.reviewState === "accepted");
  const steps = [
    { id: "decision_question", label: "Decision to improve", status: profile?.decisionQuestion ? "ready" : "missing", detail: profile?.decisionQuestion ?? "Write the decision this pilot should help the team make." },
    { id: "source_scope", label: "Evidence scope", status: watchlists.length || acceptedPrivateSources.length ? "ready" : "missing", detail: watchlists.length ? `${watchlists.length} watchlist${watchlists.length === 1 ? "" : "s"} configured.` : acceptedPrivateSources.length ? `${acceptedPrivateSources.length} accepted private source${acceptedPrivateSources.length === 1 ? "" : "s"} available.` : "Choose a watchlist or submit a private source for review." },
    { id: "success_measures", label: "Success measures", status: profile?.successMeasures?.length ? "ready" : "missing", detail: profile?.successMeasures?.length ? profile.successMeasures.join("; ") : "Name how the partner will judge usefulness." },
    { id: "delivery_cadence", label: "Delivery cadence", status: profile?.cadence && profile?.nextReviewAt ? "ready" : "missing", detail: profile?.cadence && profile?.nextReviewAt ? `${profile.cadence}; review ${profile.nextReviewAt}.` : "Set the update rhythm and first review date." },
    { id: "saved_question", label: "Saved research question", status: questions.length ? "ready" : "missing", detail: questions.length ? `${questions.length} active question${questions.length === 1 ? "" : "s"} saved.` : "Save the first question the recurring handoff should answer." },
    { id: "first_delivery", label: "First handoff", status: deliveries.length ? "ready" : "pending", detail: deliveries.length ? `${deliveries.length} deliver${deliveries.length === 1 ? "y" : "ies"} generated.` : "The first completed refresh will generate the reviewable handoff." }
  ];
  const missing = steps.filter((step) => step.status === "missing");
  return { schemaVersion: "workspace-onboarding-v1", workspaceId: workspace.id, workspaceName: workspace.name, status: missing.length ? "needs_setup" : deliveries.length ? "active" : "ready_for_first_delivery", steps, nextAction: missing[0]?.detail ?? (deliveries.length ? "Review the latest handoff and record what it changed." : "Run a refresh to generate the first handoff."), limitation: "This checklist proves configuration and recorded activity only. It does not prove that the pilot is useful or that a partner will renew." };
}

function buildWorkspaceSchedule({ workspaceId, profile, deliveries, scheduler }) {
  const latestDelivery = deliveries.slice().sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))[0] ?? null;
  if (!profile) return { schemaVersion: "workspace-schedule-v1", workspaceId, status: "not_configured", eligible: false, cadence: null, nextScheduledAt: null, latestDeliveryAt: null, latestDeliveryId: null, schedulerStatus: scheduler?.status ?? "unknown", explanation: "Configure the pilot before this workspace enters the recurring refresh schedule." };
  if (!latestDelivery) return { schemaVersion: "workspace-schedule-v1", workspaceId, status: "queued_for_first_refresh", eligible: true, cadence: profile.cadence, nextScheduledAt: profile.nextReviewAt ?? null, latestDeliveryAt: null, latestDeliveryId: null, schedulerStatus: scheduler?.status ?? "unknown", explanation: "The configured workspace will be included in the next eligible refresh; the first run will create a reviewable handoff." };
  const cadenceMs = { weekly: 7 * 86400000, monthly: 31 * 86400000, quarterly: 93 * 86400000 }[profile.cadence] ?? null;
  const nextScheduledAt = profile.nextReviewAt ?? (cadenceMs && Date.parse(latestDelivery.generatedAt) ? new Date(Date.parse(latestDelivery.generatedAt) + cadenceMs).toISOString() : null);
  return { schemaVersion: "workspace-schedule-v1", workspaceId, status: "first_delivery_ready", eligible: true, cadence: profile.cadence, nextScheduledAt, latestDeliveryAt: latestDelivery.generatedAt, latestDeliveryId: latestDelivery.id, latestDeliveryStatus: latestDelivery.status, schedulerStatus: scheduler?.status ?? "unknown", explanation: "A reviewable handoff exists. The next scheduled refresh will continue this workspace's cadence." };
}

function buildOperatorPortfolioReadiness({ workspaces, snapshots }) {
  const latestByWorkspace = new Map();
  for (const snapshot of snapshots) {
    const current = latestByWorkspace.get(snapshot.workspaceId);
    if (!current || String(snapshot.observedAt).localeCompare(String(current.observedAt)) > 0) latestByWorkspace.set(snapshot.workspaceId, snapshot);
  }
  const rows = workspaces.map((workspace) => {
    const snapshot = latestByWorkspace.get(workspace.id);
    return snapshot ? {
      id: workspace.id,
      name: workspace.name,
      recommendation: snapshot.recommendation,
      serviceStatus: snapshot.serviceStatus,
      reviewedDeliveries: snapshot.reviewedDeliveries,
      usefulnessRate: snapshot.usefulnessRate,
      decisionImpact: snapshot.decisionImpact,
      failedMeasures: snapshot.failedMeasures,
      observedAt: snapshot.observedAt
    } : { id: workspace.id, name: workspace.name, recommendation: "not_available", serviceStatus: "not_available", reviewedDeliveries: 0, usefulnessRate: null, decisionImpact: 0, failedMeasures: 0, observedAt: null };
  });
  const labels = ["improve", "continue", "expand", "stop", "not_available"];
  return {
    schemaVersion: "operator-portfolio-readiness-v1",
    generatedAt: new Date().toISOString(),
    scope: { workspaceCount: workspaces.length, snapshotCount: snapshots.length },
    counts: Object.fromEntries(labels.map((label) => [label, rows.filter((row) => row.recommendation === label).length])),
    workspaces: rows,
    limitation: "This portfolio view contains aggregate readiness signals only. It excludes customer questions, review notes, source details, and private workspace content; readiness remains a human decision."
  };
}

function buildOperatorOnboardingSummary({ workspace, profile, questionCount, watchlistCount, acceptedPrivateSourceCount, deliveryCount }) {
  const checks = [
    ["decision_question", Boolean(profile?.decisionQuestion)],
    ["source_scope", Boolean(watchlistCount || acceptedPrivateSourceCount)],
    ["success_measures", Boolean(profile?.successMeasures?.length)],
    ["delivery_cadence", Boolean(profile?.cadence && profile?.nextReviewAt)],
    ["saved_question", questionCount > 0]
  ];
  const missing = checks.filter(([, ready]) => !ready).map(([id]) => id);
  return { workspaceId: workspace.id, status: missing.length ? "needs_setup" : deliveryCount ? "active" : "ready_for_first_delivery", missingSteps: missing, deliveryCount };
}

function buildOperatorPilotOverview({ workspaces, profiles, deliveries, decisions, commercialOffers = [], auditEntries, outcomes = [], briefings = [], supportRequests = [], refreshHistory, sourceScan, sourceScanHistory, alerts, warningEvents, notifications, notificationAttempts, readinessSnapshots, onboardingByWorkspace, schedules = new Map(), schedulerStatuses = {}, maxSourceAgeMs, maxFalseAlertRate, maxFailedRefreshes, maxDelayedDeliveries, warningAckSlaMs, remediationSlaMs }) {
  const summaries = workspaces.map((workspace) => {
    const workspaceDeliveries = deliveries.filter((delivery) => delivery.workspaceId === workspace.id);
    const reviewed = workspaceDeliveries.filter((delivery) => delivery.review);
    const workspaceDecisions = decisions.filter((decision) => decision.workspaceId === workspace.id);
    const workspaceAudit = auditEntries.filter((entry) => entry.workspaceId === workspace.id);
    const workspaceAlerts = alerts.filter((alert) => alert.workspaceId === workspace.id);
    const workspaceOutcomes = outcomes.filter((outcome) => outcome.workspaceId === workspace.id);
    const workspaceBriefings = briefings.filter((briefing) => briefing.workspaceId === workspace.id);
    const workspaceSupportRequests = supportRequests.filter((supportRequest) => supportRequest.workspaceId === workspace.id);
    const currentOffer = commercialOffers.filter((offer) => offer.workspaceId === workspace.id).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null;
    const pilotMeasures = buildPilotMetrics({ workspaceId: workspace.id, auditEntries: workspaceAudit, alerts: workspaceAlerts, outcomes: workspaceOutcomes, briefings: workspaceBriefings, deliveries: workspaceDeliveries }).measures;
    const profile = profiles.find((candidate) => candidate.workspaceId === workspace.id);
    const latestDeliveryAt = workspaceDeliveries.map((delivery) => delivery.generatedAt).sort().at(-1) ?? null;
    const cadenceMs = { weekly: 7 * 86400000, monthly: 31 * 86400000, quarterly: 93 * 86400000 }[profile?.cadence] ?? null;
    const deliveryDelayed = Boolean(profile && cadenceMs && (!latestDeliveryAt || Date.parse(latestDeliveryAt) + cadenceMs < Date.now()));
    return { id: workspace.id, name: workspace.name, pilotConfigured: Boolean(profile), deliveries: workspaceDeliveries.length, reviewedDeliveries: reviewed.length, usefulDeliveries: reviewed.filter((delivery) => delivery.review.usefulness === "useful").length, decisionChanges: reviewed.filter((delivery) => ["changed_decision", "informed_decision"].includes(delivery.review.decisionImpact)).length, commercialOfferStatus: currentOffer?.status ?? "not_proposed", commercialOfferUpdatedAt: currentOffer?.updatedAt ?? null, openSupportRequests: workspaceSupportRequests.filter((supportRequest) => !["resolved", "closed"].includes(supportRequest.status)).length, urgentSupportRequests: workspaceSupportRequests.filter((supportRequest) => supportRequest.severity === "urgent" && !["resolved", "closed"].includes(supportRequest.status)).length, overdueSupportRequests: workspaceSupportRequests.filter((supportRequest) => !["resolved", "closed"].includes(supportRequest.status) && Number.isFinite(Date.parse(supportRequest.dueAt)) && Date.parse(supportRequest.dueAt) < Date.now()).length, latestDeliveryAt, deliveryDelayed, latestDecision: workspaceDecisions.slice().sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0]?.decision ?? null, pilotMeasures: { sourceTraceInspections: pilotMeasures.sourceTraceInspections, briefingReuseCount: pilotMeasures.briefingReuseCount, briefingReuseRate: pilotMeasures.briefingReuseRate, falseAlerts: pilotMeasures.falseAlerts, medianCorrectionResponseMs: pilotMeasures.medianCorrectionResponseMs, medianDeliveryReviewMs: pilotMeasures.medianDeliveryReviewMs }, schedule: schedules.get(workspace.id) ?? null, onboarding: onboardingByWorkspace.get(workspace.id) ?? { workspaceId: workspace.id, status: "needs_setup", missingSteps: ["decision_question", "source_scope", "success_measures", "delivery_cadence", "saved_question"], deliveryCount: workspaceDeliveries.length } };
  });
  const reviewed = deliveries.filter((delivery) => delivery.review);
  const now = Date.now();
  const sourceAges = (sourceScan.sources ?? []).map((source) => ({ id: source.id, ageMs: Number.isFinite(Date.parse(source.checkedAt)) ? Math.max(0, now - Date.parse(source.checkedAt)) : null })).filter((source) => source.ageMs !== null);
  const failedRuns = refreshHistory.filter((run) => run.status !== "complete");
  const dispositions = alerts.filter((alert) => ["useful", "false_positive", "needs_correction"].includes(alert.resolutionDisposition));
  const falseAlertRate = dispositions.length ? alerts.filter((alert) => alert.resolutionDisposition === "false_positive").length / dispositions.length : null;
  const delayedDeliveries = summaries.filter((workspace) => workspace.deliveryDelayed).length;
  const warnings = [];
  if (failedRuns.length > maxFailedRefreshes) warnings.push({ id: "refresh-failures", severity: "high", observed: failedRuns.length, threshold: maxFailedRefreshes, observedAt: failedRuns[0]?.endedAt ?? new Date(now).toISOString(), message: "One or more refresh runs are failing; inspect the failed steps before customer delivery." });
  const staleSources = sourceAges.filter((source) => source.ageMs > maxSourceAgeMs).length;
  if (staleSources > 0 || (sourceScan.counts?.missing ?? 0) > 0) warnings.push({ id: "source-freshness", severity: "high", observed: { stale: staleSources, missing: sourceScan.counts?.missing ?? 0 }, threshold: { maxAgeMs: maxSourceAgeMs, missing: 0 }, observedAt: sourceScan.generatedAt ?? sourceScan.sources?.map((source) => source.checkedAt).sort()[0] ?? new Date(now).toISOString(), message: "Sources are too old or unavailable for a fully current reading." });
  if (falseAlertRate !== null && falseAlertRate > maxFalseAlertRate) warnings.push({ id: "false-alert-rate", severity: "medium", observed: falseAlertRate, threshold: maxFalseAlertRate, observedAt: alerts.map((alert) => alert.resolvedAt).filter(Boolean).sort()[0] ?? new Date(now).toISOString(), message: "The recorded false-alert rate is above the operating limit; review watchlist rules and source changes." });
  if (delayedDeliveries > maxDelayedDeliveries) warnings.push({ id: "delivery-delay", severity: "medium", observed: delayedDeliveries, threshold: maxDelayedDeliveries, observedAt: new Date(now).toISOString(), message: "Configured pilot deliveries are behind their expected cadence." });
  const insightHeldDeliveries = deliveries.filter((delivery) => delivery.status === "held_for_review" && ((delivery.snapshot?.staleLinkedInsights ?? 0) > 0 || (delivery.insightProvenance ?? []).some((insight) => insight.state === "stale")));
  if (insightHeldDeliveries.length) warnings.push({ id: "insight-review-hold", severity: "high", observed: insightHeldDeliveries.length, workspaceIds: [...new Set(insightHeldDeliveries.map((delivery) => delivery.workspaceId))], observedAt: insightHeldDeliveries.map((delivery) => delivery.generatedAt).filter(Boolean).sort()[0] ?? new Date(now).toISOString(), message: "One or more customer handoffs are held because linked insight evidence needs researcher re-review." });
  const scansByRun = new Map((sourceScanHistory.runs ?? []).map((run) => [run.runId, run]));
  const deliveriesByRun = new Map();
  for (const delivery of deliveries) deliveriesByRun.set(delivery.refreshRunId, (deliveriesByRun.get(delivery.refreshRunId) ?? []).concat(delivery));
  const trend = refreshHistory.slice(-30).map((run) => {
    const scan = scansByRun.get(run.runId);
    const runDeliveries = deliveriesByRun.get(run.runId) ?? [];
    const runAlerts = alerts.filter((alert) => alert.scanRunId === run.runId);
    const runEnd = Date.parse(run.endedAt ?? "") || Date.now();
    const sourceAgesAtRun = (scan?.sources ?? []).map((source) => Date.parse(source.checkedAt)).filter(Number.isFinite).map((checkedAt) => Math.max(0, runEnd - checkedAt));
    return { runId: run.runId, startedAt: run.startedAt ?? null, endedAt: run.endedAt ?? null, status: run.status, failedSteps: (run.steps ?? []).filter((step) => step.status === "failed").map((step) => step.name), changedSources: scan?.counts?.changed ?? null, missingSources: scan?.counts?.missing ?? null, oldestSourceAgeMs: sourceAgesAtRun.length ? Math.max(...sourceAgesAtRun) : null, alertsSeen: runAlerts.length, usefulAlerts: runAlerts.filter((alert) => alert.resolutionDisposition === "useful").length, falseAlerts: runAlerts.filter((alert) => alert.resolutionDisposition === "false_positive").length, correctionAlerts: runAlerts.filter((alert) => alert.resolutionDisposition === "needs_correction").length, deliveriesPrepared: runDeliveries.length, deliveriesReviewed: runDeliveries.filter((delivery) => delivery.review).length };
  });
  const warningById = new Map(warningEvents.map((event) => [event.warningId, event]));
  const warningLifecycle = warnings.map((warning) => ({ ...warning, ackDeadlineAt: Number.isFinite(Date.parse(warning.observedAt)) ? new Date(Date.parse(warning.observedAt) + warningAckSlaMs).toISOString() : null, lifecycle: warningById.get(warning.id)?.state ?? "open", ownerId: warningById.get(warning.id)?.ownerId ?? null, escalationState: warningById.get(warning.id)?.escalationState ?? "normal", lastActionAt: warningById.get(warning.id)?.actedAt ?? null, responseTimeMs: warningById.get(warning.id)?.responseTimeMs ?? null, actionNote: warningById.get(warning.id)?.note ?? null }));
  const sourceAlerts = alerts.filter((alert) => alert.kind === "source_availability" && alert.state !== "resolved");
  const remediationQueue = sourceAlerts.map((alert) => {
    const createdAt = alert.createdAt ?? alert.detectedAt ?? new Date(now).toISOString();
    const createdMs = Date.parse(createdAt);
    const dueAt = Number.isFinite(createdMs) ? new Date(createdMs + remediationSlaMs).toISOString() : null;
    const affectedDeliveries = deliveries.filter((delivery) => delivery.status === "held_for_source_availability" && (delivery.impact?.unavailableSourceIds ?? delivery.snapshot?.unavailableSourceIds ?? []).includes(alert.sourceId));
    return { id: alert.id, workspaceId: alert.workspaceId, sourceId: alert.sourceId, repository: alert.repository, sourcePath: alert.sourcePath, severity: alert.severity, reason: alert.reason, recommendedAction: alert.recommendedAction ?? null, alertState: alert.state, remediationState: alert.remediationState ?? "not_started", remediationAt: alert.remediationAt ?? null, remediationBy: alert.remediationBy ?? null, createdAt, ageMs: Number.isFinite(createdMs) ? Math.max(0, now - createdMs) : null, dueAt, overdue: Number.isFinite(createdMs) ? now > createdMs + remediationSlaMs : false, heldDeliveries: affectedDeliveries.length, heldDeliveryIds: affectedDeliveries.map((delivery) => delivery.id) };
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (b.ageMs ?? 0) - (a.ageMs ?? 0));
  const remediation = { schemaVersion: "operator-remediation-queue-v1", slaMs: remediationSlaMs, summary: { open: remediationQueue.length, started: remediationQueue.filter((item) => item.remediationState === "started").length, completed: remediationQueue.filter((item) => item.remediationState === "completed").length, overdue: remediationQueue.filter((item) => item.overdue).length, heldDeliveries: remediationQueue.reduce((total, item) => total + item.heldDeliveries, 0) }, queue: remediationQueue };
  return {
    schemaVersion: "operator-pilot-overview-v1",
    generatedAt: new Date().toISOString(),
    scope: { workspaceCount: workspaces.length, configuredPilots: profiles.length, deliveries: deliveries.length, reviewedDeliveries: reviewed.length, supportRequests: supportRequests.length, openSupportRequests: supportRequests.filter((supportRequest) => !["resolved", "closed"].includes(supportRequest.status)).length, commercialOffers: commercialOffers.length },
    aggregate: { usefulDeliveries: reviewed.filter((delivery) => delivery.review.usefulness === "useful").length, notUsefulDeliveries: reviewed.filter((delivery) => delivery.review.usefulness === "not_useful").length, unclearDeliveries: reviewed.filter((delivery) => delivery.review.usefulness === "unclear").length, decisionChanges: reviewed.filter((delivery) => ["changed_decision", "informed_decision"].includes(delivery.review.decisionImpact)).length, commercialOfferCounts: Object.fromEntries(["proposed", "accepted", "active", "declined", "cancelled", "ended", "not_proposed"].map((status) => [status, summaries.filter((workspace) => workspace.commercialOfferStatus === status).length])), pilotCheckpoints: decisions.length, checkpointCounts: Object.fromEntries(["improve", "continue", "expand", "stop"].map((decision) => [decision, decisions.filter((item) => item.decision === decision).length])), auditedPilotActions: auditEntries.filter((entry) => ["configure_pilot", "review_pilot_delivery", "decide_pilot"].includes(entry.action)).length, openAlerts: alerts.filter((alert) => alert.state === "open").length, falseAlerts: alerts.filter((alert) => alert.resolutionDisposition === "false_positive").length, alertCorrections: alerts.filter((alert) => alert.resolutionDisposition === "needs_correction").length, openSupportRequests: supportRequests.filter((supportRequest) => !["resolved", "closed"].includes(supportRequest.status)).length, urgentSupportRequests: supportRequests.filter((supportRequest) => supportRequest.severity === "urgent" && !["resolved", "closed"].includes(supportRequest.status)).length, overdueSupportRequests: supportRequests.filter((supportRequest) => !["resolved", "closed"].includes(supportRequest.status) && Number.isFinite(Date.parse(supportRequest.dueAt)) && Date.parse(supportRequest.dueAt) < Date.now()).length },
    operations: { latestRefreshStatus: refreshHistory.at(-1)?.status ?? "not_run", failedRefreshRuns: failedRuns.length, lastRefreshAt: refreshHistory.at(-1)?.endedAt ?? null, refreshSchedulerStatus: schedulerStatuses.refresh?.status ?? "not_started", backupSchedulerStatus: schedulerStatuses.backup?.status ?? "not_started", notificationSchedulerStatus: schedulerStatuses.notification?.status ?? "not_started", sourceCount: sourceScan.sources?.length ?? 0, staleSources, oldestSourceAgeMs: sourceAges.length ? Math.max(...sourceAges.map((source) => source.ageMs)) : null, delayedDeliveries, heldInsightDeliveries: insightHeldDeliveries.length, falseAlertRate },
    thresholds: { maxSourceAgeMs, maxFalseAlertRate, maxFailedRefreshes, maxDelayedDeliveries, warningAckSlaMs, remediationSlaMs },
    remediation,
    warnings: warningLifecycle,
    deliveryHealth: buildOperatorDeliveryHealth({ notifications, attempts: notificationAttempts }),
    portfolioReadiness: buildOperatorPortfolioReadiness({ workspaces, snapshots: readinessSnapshots }),
    trend,
    workspaces: summaries,
    limitation: "This operator view contains aggregate pilot health only. It intentionally excludes customer questions, review notes, source details, and private workspace content. Counts describe recorded activity, not general product-market fit or causation."
  };
}

function buildOperatorCohortReport({ overview }) {
  const workspaces = overview.workspaces ?? [];
  const readiness = overview.portfolioReadiness ?? { counts: { improve: 0, continue: 0, expand: 0, stop: 0, not_available: 0 }, workspaces: [] };
  const byId = new Map(readiness.workspaces.map((workspace) => [workspace.id, workspace]));
  return {
    schemaVersion: "operator-pilot-cohort-v1",
    generatedAt: new Date().toISOString(),
    cohort: {
      workspaceCount: workspaces.length,
      configuredPilots: workspaces.filter((workspace) => workspace.pilotConfigured).length,
      firstDeliveries: workspaces.filter((workspace) => workspace.deliveries > 0).length,
      reviewedPilots: workspaces.filter((workspace) => workspace.reviewedDeliveries > 0).length,
      checkpointEligible: workspaces.filter((workspace) => workspace.reviewedDeliveries >= 3).length,
      recommendations: readiness.counts
    },
    workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, onboarding: workspace.onboarding, pilotConfigured: workspace.pilotConfigured, deliveries: workspace.deliveries, reviewedDeliveries: workspace.reviewedDeliveries, usefulDeliveries: workspace.usefulDeliveries, decisionChanges: workspace.decisionChanges, commercialOfferStatus: workspace.commercialOfferStatus, latestDecision: workspace.latestDecision, pilotMeasures: workspace.pilotMeasures, recommendation: byId.get(workspace.id)?.recommendation ?? "not_available", serviceStatus: byId.get(workspace.id)?.serviceStatus ?? "not_available" })),
    limitation: "This cohort report contains aggregate operating signals only. It excludes customer questions, review notes, source details, and private workspace content. It supports human service decisions; it does not determine whether a pilot should expand."
  };
}

function buildAtlasComparison({ kind, ids, atlas, packet, sourceScan }) {
  const selected = ids.map((id) => (atlas.entities?.[kind] ?? []).find((candidate) => candidate.id === id)).filter(Boolean);
  const comparisons = selected.map((entity) => {
    const record = (packet.records ?? []).find((candidate) => entity.evidenceIds.includes(candidate.id) && candidate.reportWindow);
    const columns = record?.reportWindow?.columns ?? [];
    return { id: entity.id, label: entity.label, recordId: record?.id ?? null, sourceRef: record?.sourceRef ?? null, sourceDigest: record?.sourceDigest ?? null, columns, quarters: record?.reportWindow?.quarters ?? [], annualBaseline: record?.reportWindow?.annualBaseline ?? null, reading: record?.reportWindow?.reading ?? null };
  });
  const sharedColumns = comparisons.length ? comparisons.reduce((shared, comparison) => shared.filter((column) => comparison.columns.includes(column)), comparisons[0].columns) : [];
  const incompatibilities = comparisons.filter((comparison) => comparison.columns.length === 0 || sharedColumns.length !== comparison.columns.length).map((comparison) => ({ entityId: comparison.id, entity: comparison.label, missingFromSharedView: comparison.columns.filter((column) => !sharedColumns.includes(column)), reason: comparison.columns.length ? "This entity reports a different column set." : "No comparable annual-plus-quarterly report window is available." }));
  const sourceIds = comparisons.map((comparison) => comparison.recordId).filter(Boolean);
  const changedSources = (sourceScan?.sources ?? []).filter((source) => sourceIds.includes(source.id) && source.status !== "unchanged").map((source) => ({ id: source.id, status: source.status, checkedAt: source.checkedAt, reason: source.reviewReason }));
  const latestPeriods = comparisons.map((comparison) => ({ entityId: comparison.id, entity: comparison.label, period: comparison.quarters.at(-1)?.period ?? comparison.annualBaseline ?? null }));
  return { schemaVersion: "atlas-comparison-read-model-v1", kind, selected: comparisons.map(({ id, label, recordId }) => ({ id, label, recordId })), compatibleColumns: sharedColumns, comparisons, incompatibilities, comparable: sharedColumns.length > 0 && incompatibilities.length === 0, freshness: { status: changedSources.length ? "changed" : "current", changedSources, latestPeriods, checkedAt: sourceScan?.generatedAt ?? null }, limitation: "Only identically labelled columns are compared. Different definitions, units, periods, currencies, or reporting boundaries remain incompatible and are not ranked." };
}

async function appendAudit(entry) {
  store.appendAudit(entry);
  await writeFile(auditPath, `${JSON.stringify(store.auditLedger(), null, 2)}\n`);
}

async function replayOperation(key) {
  return key ? store.findOperation(key) : undefined;
}

async function storeOperation(operation) {
  store.storeOperation(operation);
  await writeFile(operationsPath, `${JSON.stringify(store.operationsLedger(), null, 2)}\n`);
}

async function writeReviewEvents() {
  await writeFile(reviewEventsPath, `${JSON.stringify(store.recordsLedger("review_event", "review-event-ledger-v1", "events"), null, 2)}\n`);
}

function publicPacket(packet) {
  const operations = { ...(packet.operations ?? {}) };
  delete operations.workspaceAlerts;
  delete operations.questionEvaluations;
  delete operations.briefings;
  return { ...packet, operations };
}

function ageMs(value, now) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}

async function workerStatus(path, schemaVersion, now) {
  const status = await readJson(path, { schemaVersion, status: "not_started", updatedAt: null });
  const age = ageMs(status.updatedAt, now);
  const live = ["starting", "running", "sleeping"].includes(status.status) && age !== null && age <= maxWorkerStatusAgeMs;
  return { schemaVersion: status.schemaVersion ?? schemaVersion, status: status.status ?? "not_started", updatedAt: status.updatedAt ?? null, ageMs: age, live };
}

async function readinessReport() {
  const now = Date.now();
  const refresh = await readJson(refreshPath, { status: "not_run", steps: [] });
  const sourceScan = await readJson(sourceScanPath, { counts: {}, sources: [] });
  const sourceAvailability = await readJson(sourceAvailabilityPath, { counts: {}, sources: [] });
  const backupManifest = backupDir ? await readJson(resolve(backupDir, "manifest.json"), undefined) : undefined;
  const workerStatuses = {
    refresh: await workerStatus(schedulerStatusPath, "refresh-scheduler-status-v1", now),
    backup: await workerStatus(backupSchedulerStatusPath, "runtime-backup-scheduler-status-v1", now),
    notification: await workerStatus(notificationSchedulerStatusPath, "notification-scheduler-status-v1", now)
  };
  const refreshAge = ageMs(refresh.endedAt, now);
  const currentSources = (sourceScan.sources ?? []).filter((source) => source.status !== "deferred");
  const overdueDeferredSources = (sourceScan.sources ?? []).filter((source) => source.status === "deferred" && Date.parse(source.nextDueAt ?? "") <= now).length;
  const sourceTimes = currentSources.map((source) => ageMs(source.checkedAt, now)).filter((value) => value !== null);
  const sourceAge = sourceTimes.length ? Math.max(...sourceTimes) : null;
  const failedSteps = (refresh.steps ?? []).filter((step) => step.status === "failed").map((step) => step.name);
  const syncStep = (refresh.steps ?? []).find((step) => step.name === "sync-runtime-store");
  const database = store.health();
  const checks = {
    database: { status: database.integrity === "ok" ? "ok" : "failed", integrity: database.integrity },
    refresh: { status: refresh.status === "complete" && refreshAge !== null && refreshAge <= maxRefreshAgeMs && failedSteps.length === 0 ? "ok" : "failed", runId: refresh.runId ?? null, ageMs: refreshAge, maxAgeMs: maxRefreshAgeMs, failedSteps },
    sourceScan: { status: (sourceAvailability.counts?.unavailable ?? 0) === 0 && sourceScan.counts?.missing === 0 && overdueDeferredSources === 0 && (sourceAge === null || sourceAge <= maxSourceAgeMs) ? "ok" : "failed", ageMs: sourceAge, maxAgeMs: maxSourceAgeMs, missing: sourceScan.counts?.missing ?? null, unavailable: sourceAvailability.counts?.unavailable ?? null, deferred: sourceScan.counts?.deferred ?? 0, overdueDeferredSources, sourceCount: sourceScan.sources?.length ?? 0 },
    runtimeSync: { status: syncStep?.status === "complete" ? "ok" : "failed", attempts: syncStep?.attempts ?? null },
    backup: backupDir ? { status: backupManifest?.schemaVersion === "runtime-backup-v1" ? "ok" : "failed", createdAt: backupManifest?.createdAt ?? null, ageMs: ageMs(backupManifest?.createdAt, now), directory: backupDir } : { status: "not_configured", createdAt: null, ageMs: null },
    workers: { status: requireWorkerHealth ? Object.values(workerStatuses).every((worker) => worker.live) ? "ok" : "failed" : "not_required", required: requireWorkerHealth, maxAgeMs: maxWorkerStatusAgeMs, ...workerStatuses }
  };
  const ready = Object.values(checks).every((check) => ["ok", "not_required"].includes(check.status));
  return { schemaVersion: "operational-readiness-v1", generatedAt: new Date(now).toISOString(), status: ready ? "ready" : "degraded", checks };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    const requestId = request.headers["x-request-id"] || randomUUID();
    response.setHeader("X-Request-Id", requestId);
    if (request.method === "POST" && url.pathname.startsWith("/api/alerts/") && url.pathname.endsWith("/acknowledge")) {
      const alertId = decodeURIComponent(url.pathname.slice("/api/alerts/".length, -"/acknowledge".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot acknowledge alerts." });
      const alert = store.findRecord("alert", alertId);
      if (alert?.workspaceId !== workspace.id) return json(response, 404, { error: "Alert not found in this workspace." });
      if (!alert) return json(response, 404, { error: "Alert not found in this workspace." });
      alert.state = "acknowledged";
      alert.acknowledgedBy = member.id;
      alert.acknowledgedRole = member.role;
      alert.acknowledgedAt = new Date().toISOString();
      alert.acknowledgmentNote = String(body.note ?? "").slice(0, 2000);
      const auditEntry = { requestId, action: "acknowledge_alert", targetId: alert.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "acknowledged", occurredAt: alert.acknowledgedAt };
      store.commitRecord({ kind: "alert", record: alert, audit: auditEntry, operation: { key: idempotencyKey, action: "acknowledge_alert", status: 200, body: alert, completedAt: alert.acknowledgedAt } });
      const alertMetadata = await readJson(alertsPath, { workspaces: [] });
      await writeFile(alertsPath, `${JSON.stringify(store.alertsLedger(alertMetadata.workspaces ?? []), null, 2)}\n`);
      return json(response, 200, alert);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/alerts/") && url.pathname.endsWith("/remediation")) {
      const alertId = decodeURIComponent(url.pathname.slice("/api/alerts/".length, -"/remediation".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot record remediation." });
      const alert = store.findRecord("alert", alertId);
      if (!alert || alert.workspaceId !== workspace.id) return json(response, 404, { error: "Alert not found in this workspace." });
      if (alert.kind !== "source_availability") return json(response, 400, { error: "Remediation tracking is only available for source availability alerts." });
      const remediationState = String(body.state ?? "");
      if (!["started", "completed"].includes(remediationState)) return json(response, 400, { error: "Remediation state must be started or completed." });
      const note = String(body.note ?? "").trim().slice(0, 2000);
      if (!note) return json(response, 400, { error: "A remediation note is required." });
      const now = new Date().toISOString();
      alert.remediationState = remediationState;
      alert.remediationAction = String(body.action ?? alert.recommendedAction ?? "Check the source connection.").trim().slice(0, 500);
      alert.remediationBy = member.id;
      alert.remediationRole = member.role;
      alert.remediationAt = now;
      alert.remediationNote = note;
      const auditEntry = { requestId, action: "record_alert_remediation", targetId: alert.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: remediationState, occurredAt: now };
      store.commitRecord({ kind: "alert", record: alert, audit: auditEntry, operation: { key: idempotencyKey, action: "record_alert_remediation", status: 200, body: alert, completedAt: now } });
      const alertMetadata = await readJson(alertsPath, { workspaces: [] });
      await writeFile(alertsPath, `${JSON.stringify(store.alertsLedger(alertMetadata.workspaces ?? []), null, 2)}\n`);
      store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "source_remediation", targetId: alert.id, workspaceId: workspace.id, sourceId: alert.sourceId, reviewer: member.id, reviewerRole: member.role, status: remediationState, outcome: remediationState, remediationAction: alert.remediationAction, occurredAt: now }]);
      await writeReviewEvents();
      return json(response, 200, alert);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/alerts/") && url.pathname.endsWith("/resolve")) {
      const alertId = decodeURIComponent(url.pathname.slice("/api/alerts/".length, -"/resolve".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot resolve alerts." });
      const alert = store.findRecord("alert", alertId);
      if (!alert || alert.workspaceId !== workspace.id) return json(response, 404, { error: "Alert not found in this workspace." });
      const disposition = String(body.disposition ?? "");
      if (!["useful", "false_positive", "needs_correction"].includes(disposition)) return json(response, 400, { error: "Disposition must be useful, false_positive, or needs_correction." });
      if (["false_positive", "needs_correction"].includes(disposition) && !String(body.note ?? "").trim()) return json(response, 400, { error: "False-positive and correction dispositions require a note." });
      const now = new Date().toISOString();
      alert.state = "resolved";
      alert.resolvedBy = member.id;
      alert.resolvedRole = member.role;
      alert.resolvedAt = now;
      alert.resolutionDisposition = disposition;
      alert.resolutionNote = String(body.note ?? "").slice(0, 2000);
      alert.responseTimeMs = Math.max(0, Date.parse(now) - (Date.parse(alert.createdAt) || Date.now()));
      store.commitRecord({ kind: "alert", record: alert, audit: { requestId, action: "resolve_alert", targetId: alert.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: disposition, occurredAt: now }, operation: { key: idempotencyKey, action: "resolve_alert", status: 200, body: alert, completedAt: now } });
      const alertMetadata = await readJson(alertsPath, { workspaces: [] });
      await writeFile(alertsPath, `${JSON.stringify(store.alertsLedger(alertMetadata.workspaces ?? []), null, 2)}\n`);
      store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "alert_resolution", targetId: alert.id, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, status: disposition, outcome: disposition, occurredAt: now }]);
      await writeReviewEvents();
      return json(response, 200, alert);
    }
    if (request.method === "POST" && url.pathname === "/api/questions") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      const question = String(body.question ?? "").trim();
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot save questions." });
      if (question.length < 8 || question.length > 500) return json(response, 400, { error: "Question must be between 8 and 500 characters." });
      const now = new Date().toISOString();
      const saved = { id: `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, workspaceId: workspace.id, question, scope: body.scope ?? { watchlistIds: [] }, state: "active", createdBy: member.id, createdRole: member.role, createdAt: now, updatedAt: now, lastEvaluatedAt: null };
      const auditEntry = { requestId, action: "create_question", targetId: saved.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "created", occurredAt: now };
      store.commitQuestion({ question: saved, audit: auditEntry, operation: { key: idempotencyKey, action: "create_question", status: 201, body: saved, completedAt: now } });
      await writeFile(questionsPath, `${JSON.stringify(store.questionsLedger(), null, 2)}\n`);
      await writeFile(auditPath, `${JSON.stringify(store.auditLedger(), null, 2)}\n`);
      await writeFile(operationsPath, `${JSON.stringify(store.operationsLedger(), null, 2)}\n`);
      return json(response, 201, saved);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/briefings/") && url.pathname.endsWith("/publish")) {
      const briefingId = decodeURIComponent(url.pathname.slice("/api/briefings/".length, -"/publish".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot publish briefings." });
      const ledger = await readJson(briefingsPath, { schemaVersion: "workspace-briefing-ledger-v1", briefings: [] });
      const briefing = ledger.briefings.find((candidate) => candidate.id === briefingId && candidate.workspaceId === workspace.id);
      if (!briefing) return json(response, 404, { error: "Briefing not found in this workspace." });
      const staleInsight = (briefing.insightProvenance ?? []).find((insight) => insight.state === "stale");
      if (staleInsight) return json(response, 409, { error: `Linked insight publication is stale: ${staleInsight.title}. Re-review and republish the insight before republishing this briefing.` });
      if (briefing.state === "stale" && body.confirmUpdatedEvidence !== true) return json(response, 409, { error: "This briefing is stale. Inspect the updated evidence and confirm it before republishing." });
      const now = new Date().toISOString();
      const publicationOrder = store.recordsLedger("briefing_publication", "briefing-publication-ledger-v1", "publications").publications.filter((candidate) => candidate.briefingId === briefingId).length + 1;
      const publication = { id: `publication-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, briefingId, workspaceId: workspace.id, evidenceDigest: briefing.evidenceDigest, publishedBy: member.id, publishedRole: member.role, publishedAt: now, publicationOrder, note: String(body.note ?? "").slice(0, 2000), ...(briefing.state === "stale" ? { reReviewedUpdatedEvidence: true, previousEvidenceDigest: briefing.previousEvidenceDigest ?? null } : {}) };
      const wasStale = briefing.state === "stale";
      briefing.state = "published";
      briefing.publication = "published";
      briefing.publicationId = publication.id;
      briefing.publishedBy = member.id;
      briefing.publishedAt = now;
      await writeFile(briefingsPath, `${JSON.stringify(ledger, null, 2)}\n`);
      const publishedBriefing = { ...briefing, publication };
      store.commitRecord({ kind: "briefing_publication", record: publication, audit: { requestId, action: "publish_briefing", targetId: briefing.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "published", occurredAt: now }, operation: { key: idempotencyKey, action: "publish_briefing", status: 200, body: publishedBriefing, completedAt: now } });
      await writeFile(briefingPublicationsPath, `${JSON.stringify(store.recordsLedger("briefing_publication", "briefing-publication-ledger-v1", "publications"), null, 2)}\n`);
      if (wasStale) {
        store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "briefing_republish", reviewType: "re_review", targetId: briefing.id, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, previousEvidenceDigest: publication.previousEvidenceDigest, currentEvidenceDigest: publication.evidenceDigest, outcome: "republished", occurredAt: now, publicationId: publication.id }]);
        await writeReviewEvents();
      }
      return json(response, 200, publishedBriefing);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/briefings/") && url.pathname.endsWith("/outcome")) {
      const briefingId = decodeURIComponent(url.pathname.slice("/api/briefings/".length, -"/outcome".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot record decision outcomes." });
      const ledger = await readJson(briefingsPath, { briefings: [] });
      const briefing = ledger.briefings.find((candidate) => candidate.id === briefingId && candidate.workspaceId === workspace.id);
      if (!briefing) return json(response, 404, { error: "Briefing not found in this workspace." });
      const decisionState = String(body.decisionState ?? "");
      const outcomeState = String(body.outcomeState ?? "pending");
      if (!["used", "not_used", "deferred"].includes(decisionState)) return json(response, 400, { error: "decisionState must be used, not_used, or deferred." });
      if (!["pending", "held", "changed", "wrong", "unknown"].includes(outcomeState)) return json(response, 400, { error: "outcomeState must be pending, held, changed, wrong, or unknown." });
      const now = new Date().toISOString();
      const insightProvenance = (briefing.insightProvenance ?? []).map((insight) => ({ insightId: insight.insightId, title: insight.title, state: insight.state, publicationId: insight.publicationId, publicationEvidenceDigest: insight.publicationEvidenceDigest, sourceRecordIds: insight.sourceRecordIds ?? [] }));
      const outcome = { id: `decision-outcome-${randomUUID()}`, workspaceId: workspace.id, briefingId: briefing.id, questionId: briefing.questionId ?? null, evidenceDigest: briefing.evidenceDigest ?? null, insightProvenance, recordedBy: member.id, recordedRole: member.role, decisionState, outcomeState, decisionSummary: String(body.decisionSummary ?? "").trim().slice(0, 2000), outcomeNote: String(body.outcomeNote ?? "").trim().slice(0, 2000), recordedAt: now, reviewAt: body.reviewAt ? String(body.reviewAt).slice(0, 32) : null };
      store.commitRecord({ kind: "decision_outcome", record: outcome, audit: { requestId, action: "record_decision_outcome", targetId: briefing.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: outcome.outcomeState, occurredAt: now }, operation: { key: idempotencyKey, action: "record_decision_outcome", status: 201, body: outcome, completedAt: now } });
      await writeFile(decisionOutcomesPath, `${JSON.stringify(store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes"), null, 2)}\n`);
      store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "decision_outcome", targetId: briefing.id, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, outcome: outcome.outcomeState, decisionState: outcome.decisionState, insightPublicationIds: insightProvenance.map((insight) => insight.publicationId), occurredAt: now, decisionOutcomeId: outcome.id }]);
      await writeReviewEvents();
      return json(response, 201, outcome);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/insight-candidates/") && url.pathname.endsWith("/decision")) {
      const candidateId = decodeURIComponent(url.pathname.slice("/api/insight-candidates/".length, -"/decision".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      const allowedDecisions = new Set(["accept", "defer", "reject", "correct"]);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot review insights." });
      if (!allowedDecisions.has(body.decision)) return json(response, 400, { error: "Decision must be accept, defer, reject, or correct." });
      if (["reject", "correct"].includes(body.decision) && !String(body.note ?? "").trim()) return json(response, 400, { error: "Reject and correction decisions require a note." });
      const candidates = await readJson(insightCandidatesPath, { candidates: [] });
      const candidate = candidates.candidates.find((item) => item.id === candidateId);
      if (!candidate) return json(response, 404, { error: "Insight candidate not found." });
      const wasStale = candidate.status === "stale";
      const decision = { id: `insight-decision-${randomUUID()}`, candidateKey: candidate.candidateKey, candidateId, workspaceId: workspace.id, evidenceDigest: candidate.evidenceDigest, claimDigest: candidate.claimDigest ?? null, reviewer: member.id, reviewerRole: member.role, decision: body.decision, note: String(body.note ?? "").slice(0, 2000), decidedAt: new Date().toISOString(), publication: "not_published" };
      if (wasStale) decision.previousEvidenceDigest = candidate.previousEvidenceDigest ?? null;
      store.commitRecord({ kind: "insight_decision", record: decision, audit: { requestId, action: "decide_insight", targetId: candidate.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: decision.decision, occurredAt: decision.decidedAt }, operation: { key: idempotencyKey, action: "decide_insight", status: 200, body: decision, completedAt: decision.decidedAt } });
      await writeFile(insightDecisionsPath, `${JSON.stringify(store.recordsLedger("insight_decision", "insight-decision-ledger-v1", "decisions"), null, 2)}\n`);
      const resultingStatus = { accept: "accepted_for_publication", defer: "deferred", reject: "rejected", correct: "correction_required" }[decision.decision];
      candidate.status = resultingStatus;
      candidate.publication = "not_published";
      candidate.decisionId = decision.id;
      candidate.decidedBy = decision.reviewer;
      candidate.decidedAt = decision.decidedAt;
      candidate.decisionNote = decision.note;
      if (resultingStatus !== "stale") {
        delete candidate.staleReason;
        delete candidate.previousEvidenceDigest;
      }
      await writeFile(insightCandidatesPath, `${JSON.stringify(candidates, null, 2)}\n`);
      if (wasStale) {
        store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "insight_re_review", reviewType: "re_review", targetId: candidate.id, candidateKey: candidate.candidateKey, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, previousEvidenceDigest: decision.previousEvidenceDigest, currentEvidenceDigest: decision.evidenceDigest, outcome: decision.decision, occurredAt: decision.decidedAt, decisionId: decision.id }]);
        await writeReviewEvents();
      }
      return json(response, 200, decision);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/insight-promotions/") && url.pathname.endsWith("/revise")) {
      const promotionId = decodeURIComponent(url.pathname.slice("/api/insight-promotions/".length, -"/revise".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const promotions = await readJson(insightPromotionsPath, { schemaVersion: "insight-promotion-ledger-v1", promotions: [] });
      const promotion = promotions.promotions.find((item) => item.id === promotionId);
      if (!promotion) return json(response, 404, { error: "Insight promotion not found." });
      const workspace = await workspaceConfig(body.workspaceId ?? promotion.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (promotion.workspaceId !== workspace.id || !member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot revise this insight promotion." });
      const title = String(body.title ?? "").trim().slice(0, 240);
      const plainLanguageSummary = String(body.plainLanguageSummary ?? "").trim().slice(0, 2000);
      const strongestAlternative = String(body.strongestAlternative ?? "").trim().slice(0, 2000);
      const nextTest = String(body.nextTest ?? "").trim().slice(0, 2000);
      const whatWouldChangeOurMind = [...new Set((Array.isArray(body.whatWouldChangeOurMind) ? body.whatWouldChangeOurMind : []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 8);
      if (title.length < 10 || plainLanguageSummary.length < 30 || strongestAlternative.length < 20 || nextTest.length < 20 || whatWouldChangeOurMind.length < 1) return json(response, 400, { error: "Revision requires a substantive title, summary, alternative explanation, next test, and at least one falsifier." });
      const previousRevision = promotion.insight.revision ?? 1;
      const now = new Date().toISOString();
      promotion.insight = { ...promotion.insight, title, plainLanguageSummary, strongestAlternative, nextTest, whatWouldChangeOurMind, status: "draft", revision: previousRevision + 1 };
      promotion.revisedBy = member.id;
      promotion.revisedRole = member.role;
      promotion.revisedAt = now;
      promotion.revisionNote = String(body.note ?? "").trim().slice(0, 2000);
      promotions.updatedAt = now;
      await writeFile(insightPromotionsPath, `${JSON.stringify(promotions, null, 2)}\n`);
      const revision = { id: `insight-revision-${randomUUID()}`, promotionId, candidateKey: promotion.insight.id, workspaceId: workspace.id, revision: promotion.insight.revision, reviewer: member.id, reviewerRole: member.role, note: promotion.revisionNote, occurredAt: now };
      await appendAudit({ requestId, action: "revise_insight_promotion", targetId: promotionId, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "revised", occurredAt: now });
      await storeOperation({ key: idempotencyKey, action: "revise_insight_promotion", status: 200, body: revision, completedAt: now });
      store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "insight_promotion_revised", targetId: promotionId, promotionId, candidateKey: promotion.insight.id, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, revision: promotion.insight.revision, outcome: "draft_requires_re_review", occurredAt: now }]);
      await writeReviewEvents();
      return json(response, 200, { ...revision, insight: promotion.insight });
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/insight-opportunities/") && url.pathname.endsWith("/promote")) {
      const opportunityId = decodeURIComponent(url.pathname.slice("/api/insight-opportunities/".length, -"/promote".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot promote insight opportunities." });
      const opportunities = await readJson(insightOpportunitiesPath, { opportunities: [] });
      const opportunity = opportunities.opportunities.find((candidate) => candidate.id === opportunityId);
      if (!opportunity) return json(response, 404, { error: "Insight opportunity not found." });
      const promotions = await readJson(insightPromotionsPath, { schemaVersion: "insight-promotion-ledger-v1", promotions: [] });
      const existing = promotions.promotions.find((promotion) => promotion.opportunityId === opportunity.id);
      if (existing) return json(response, 409, { error: "This insight opportunity has already been promoted.", promotion: existing });
      const title = String(body.title ?? "").trim().slice(0, 240);
      const plainLanguageSummary = String(body.plainLanguageSummary ?? "").trim().slice(0, 2000);
      const strongestAlternative = String(body.strongestAlternative ?? "").trim().slice(0, 2000);
      const nextTest = String(body.nextTest ?? "").trim().slice(0, 2000);
      const whatWouldChangeOurMind = [...new Set((Array.isArray(body.whatWouldChangeOurMind) ? body.whatWouldChangeOurMind : []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 8);
      if (title.length < 10 || plainLanguageSummary.length < 30 || strongestAlternative.length < 20 || nextTest.length < 20 || whatWouldChangeOurMind.length < 1) return json(response, 400, { error: "Promotion requires a substantive title, summary, alternative explanation, next test, and at least one falsifier." });
      const packet = await readJson(packetPath, { records: [] });
      const knownRecordIds = new Set(packet.records.map((record) => record.id));
      const recordIds = [...new Set((opportunity.evidence ?? []).map((item) => item.recordId).filter((recordId) => knownRecordIds.has(recordId)))];
      if (recordIds.length < 2) return json(response, 409, { error: "The opportunity no longer has two current source records." });
      const now = new Date().toISOString();
      const promotion = { id: `promotion-${randomUUID()}`, opportunityId: opportunity.id, workspaceId: workspace.id, promotedBy: member.id, promotedRole: member.role, promotedAt: now, note: String(body.note ?? "").trim().slice(0, 2000), insight: { id: `insight-promoted-${randomUUID()}`, title, plainLanguageSummary, recordIds, strongestAlternative, whatWouldChangeOurMind, nextTest, status: "draft", refreshBy: body.refreshBy ? String(body.refreshBy).slice(0, 32) : null } };
      promotions.promotions = [...(promotions.promotions ?? []), promotion];
      promotions.updatedAt = now;
      await writeFile(insightPromotionsPath, `${JSON.stringify(promotions, null, 2)}\n`);
      const audit = { requestId, action: "promote_insight_opportunity", targetId: opportunity.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "promoted", occurredAt: now };
      await appendAudit(audit);
      await storeOperation({ key: idempotencyKey, action: "promote_insight_opportunity", status: 201, body: promotion, completedAt: now });
      store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "insight_opportunity_promoted", targetId: opportunity.id, promotionId: promotion.id, candidateKey: promotion.insight.id, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, outcome: "promoted_to_draft_insight", sourceRecordIds: recordIds, occurredAt: now }]);
      await writeReviewEvents();
      return json(response, 201, promotion);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/source-review/") && url.pathname.endsWith("/decision")) {
      const candidateId = decodeURIComponent(url.pathname.slice("/api/source-review/".length, -"/decision".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      const resultingStates = { accept: "accepted_for_research", reject: "rejected", defer: "deferred", correct: "correction_required" };
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot review sources." });
      if (!Object.hasOwn(resultingStates, body.decision)) return json(response, 400, { error: "Decision must be accept, defer, reject, or correct." });
      if (["reject", "correct"].includes(body.decision) && !String(body.note ?? "").trim()) return json(response, 400, { error: "Reject and correction decisions require a note." });
      const reviewWork = await readJson(reviewPath, { candidates: [] });
      const candidate = (reviewWork.candidates ?? []).find((item) => item.id === candidateId);
      if (!candidate) return json(response, 404, { error: "Source-review candidate not found." });
      const now = new Date().toISOString();
      const previousDecision = store.recordsLedger("review_decision", "review-decision-ledger-v1", "decisions").decisions.filter((item) => item.candidateId === candidate.id).at(-1);
      const decision = { id: `review-decision-${randomUUID()}`, candidateId: candidate.id, sourceId: candidate.sourceId, workspaceId: workspace.id, sourceDigest: candidate.sourceDigest ?? null, reviewer: member.id, reviewerRole: member.role, decision: body.decision, resultingState: resultingStates[body.decision], note: String(body.note ?? "").slice(0, 2000), decidedAt: now, publication: "not_published" };
      store.commitRecord({ kind: "review_decision", record: decision, audit: { requestId, action: "review_source", targetId: candidate.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: decision.resultingState, occurredAt: now }, operation: { key: idempotencyKey, action: "review_source", status: 200, body: decision, completedAt: now } });
      await writeFile(reviewDecisionsPath, `${JSON.stringify(store.recordsLedger("review_decision", "review-decision-ledger-v1", "decisions"), null, 2)}\n`);
      store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "source_review", reviewType: previousDecision ? "re_review" : "initial_review", targetId: candidate.id, sourceId: candidate.sourceId, reviewer: member.id, reviewerRole: member.role, sourceDigest: candidate.sourceDigest ?? null, previousDecisionId: previousDecision?.id ?? null, outcome: decision.resultingState, occurredAt: now, decisionId: decision.id }]);
      await writeReviewEvents();
      return json(response, 200, decision);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/insight-candidates/") && url.pathname.endsWith("/publish")) {
      const candidateId = decodeURIComponent(url.pathname.slice("/api/insight-candidates/".length, -"/publish".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot publish insights." });
      const candidates = await readJson(insightCandidatesPath, { candidates: [] });
      const candidate = candidates.candidates.find((item) => item.id === candidateId);
      if (!candidate) return json(response, 404, { error: "Insight candidate not found." });
      if (candidate.status !== "accepted_for_publication") return json(response, 409, { error: "Insight must be accepted for publication before publishing." });
      const publication = { id: `insight-publication-${randomUUID()}`, candidateKey: candidate.candidateKey, candidateId, workspaceId: workspace.id, evidenceDigest: candidate.evidenceDigest, claimDigest: candidate.claimDigest ?? null, publisher: member.id, publisherRole: member.role, publishedAt: new Date().toISOString(), note: String(body.note ?? "").slice(0, 2000) };
      store.commitRecord({ kind: "insight_publication", record: publication, audit: { requestId, action: "publish_insight", targetId: candidate.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "published", occurredAt: publication.publishedAt }, operation: { key: idempotencyKey, action: "publish_insight", status: 200, body: publication, completedAt: publication.publishedAt } });
      await writeFile(insightPublicationsPath, `${JSON.stringify(store.recordsLedger("insight_publication", "insight-publication-ledger-v1", "publications"), null, 2)}\n`);
      candidate.status = "published";
      candidate.publication = "published";
      candidate.publicationId = publication.id;
      candidate.publishedBy = publication.publisher;
      candidate.publishedAt = publication.publishedAt;
      await writeFile(insightCandidatesPath, `${JSON.stringify(candidates, null, 2)}\n`);
      return json(response, 200, publication);
    }
    if (request.method === "POST" && url.pathname === "/api/watchlists") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot create watchlists." });
      const name = String(body.name ?? "").trim();
      const sourceIds = [...new Set((Array.isArray(body.sourceIds) ? body.sourceIds : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 100);
      const repositoryIds = [...new Set((Array.isArray(body.repositoryIds) ? body.repositoryIds : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 20);
      const alertOn = [...new Set((Array.isArray(body.alertOn) ? body.alertOn : ["new", "changed", "missing"]).map((value) => String(value)))].filter((value) => ["new", "changed", "missing"].includes(value));
      const packet = await readJson(packetPath, { records: [] });
      const knownSourceIds = new Set(packet.records.map((record) => record.id));
      const knownRepositoryIds = new Set(packet.records.map((record) => record.sourceRepository));
      if (name.length < 3 || name.length > 120) return json(response, 400, { error: "Watchlist name must be between 3 and 120 characters." });
      if (!sourceIds.some((id) => knownSourceIds.has(id)) && !repositoryIds.some((id) => knownRepositoryIds.has(id))) return json(response, 400, { error: "Choose at least one known source or repository." });
      const now = new Date().toISOString();
      const watchlist = { id: `watchlist-${randomUUID()}`, workspaceId: workspace.id, name, sourceIds: sourceIds.filter((id) => knownSourceIds.has(id)), repositoryIds: repositoryIds.filter((id) => knownRepositoryIds.has(id)), alertOn: alertOn.length ? alertOn : ["changed", "missing"], createdBy: member.id, createdAt: now, updatedAt: now };
      store.commitRecord({ kind: "watchlist", record: watchlist, audit: { requestId, action: "create_watchlist", targetId: watchlist.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "created", occurredAt: now }, operation: { key: idempotencyKey, action: "create_watchlist", status: 201, body: watchlist, completedAt: now } });
      await writeFile(watchlistsPath, `${JSON.stringify(store.recordsLedger("watchlist", "workspace-watchlist-ledger-v1", "watchlists"), null, 2)}\n`);
      return json(response, 201, watchlist);
    }
    if (request.method === "POST" && url.pathname === "/api/workspace-sources") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot submit private sources." });
      const title = String(body.title ?? "").trim();
      const sourceRef = String(body.sourceRef ?? "").trim();
      const sourceLocator = String(body.sourceLocator ?? "").trim();
      const excerpt = String(body.excerpt ?? "").trim();
      const observation = String(body.observation ?? "").trim();
      const affectedGroups = [...new Set((Array.isArray(body.affectedGroups) ? body.affectedGroups : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 20);
      if (title.length < 3 || title.length > 200 || sourceRef.length < 3 || sourceRef.length > 500 || excerpt.length < 20 || excerpt.length > 5000 || observation.length < 10 || observation.length > 2000) return json(response, 400, { error: "Provide a title, source reference, excerpt of at least 20 characters, and observation of at least 10 characters." });
      const now = new Date().toISOString();
      const sourceDigest = createHash("sha256").update(`${sourceRef}\n${sourceLocator}\n${excerpt}`).digest("hex");
      const source = { id: `workspace-source-${randomUUID()}`, workspaceId: workspace.id, title, sourceRef, sourceLocator: sourceLocator || null, sourceExcerpt: excerpt, observation, affectedGroups, sourceDigest, claimState: "submitted", reviewState: "pending_review", submittedBy: member.id, submittedRole: member.role, submittedAt: now, reviewedBy: null, reviewedAt: null, reviewNote: null };
      store.commitRecord({ kind: "workspace_source", record: source, audit: { requestId, action: "submit_workspace_source", targetId: source.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "submitted", occurredAt: now }, operation: { key: idempotencyKey, action: "submit_workspace_source", status: 201, body: source, completedAt: now } });
      await writeFile(workspaceSourcesPath, `${JSON.stringify(store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources"), null, 2)}\n`);
      return json(response, 201, source);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/workspace-sources/") && url.pathname.endsWith("/review")) {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const sourceId = decodeURIComponent(url.pathname.slice("/api/workspace-sources/".length, -"/review".length));
      const source = store.findRecord("workspace_source", sourceId);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!source || !workspace || source.workspaceId !== workspace.id) return json(response, 404, { error: "Private source not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot review private sources." });
      const reviewState = String(body.reviewState ?? "");
      if (!['accepted', 'rejected'].includes(reviewState)) return json(response, 400, { error: "Review state must be accepted or rejected." });
      const now = new Date().toISOString();
      const reviewed = { ...source, claimState: reviewState === "accepted" ? "reviewed" : "rejected", reviewState, reviewedBy: member.id, reviewedAt: now, reviewNote: String(body.reviewNote ?? "").trim().slice(0, 2000) || null };
      store.commitRecord({ kind: "workspace_source", record: reviewed, audit: { requestId, action: "review_workspace_source", targetId: source.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: reviewState, occurredAt: now }, operation: { key: idempotencyKey, action: "review_workspace_source", status: 200, body: reviewed, completedAt: now } });
      await writeFile(workspaceSourcesPath, `${JSON.stringify(store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources"), null, 2)}\n`);
      return json(response, 200, reviewed);
    }
    if (request.method === "POST" && url.pathname === "/api/comparison-views") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot save comparisons." });
      const kind = String(body.kind ?? "");
      const entityIds = [...new Set((Array.isArray(body.entityIds) ? body.entityIds : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 8);
      const name = String(body.name ?? "").trim();
      if (!["companies", "industries"].includes(kind) || entityIds.length < 2 || name.length < 3 || name.length > 120) return json(response, 400, { error: "Provide a name and at least two companies or industries." });
      const atlas = await readJson(atlasPath, await readJson(staticAtlasPath, { entities: {} }));
      const known = new Map((atlas.entities?.[kind] ?? []).map((entity) => [entity.id, entity]));
      if (entityIds.some((id) => !known.has(id))) return json(response, 400, { error: "Every comparison entity must exist in the current atlas." });
      const now = new Date().toISOString();
      const view = { id: `comparison-${randomUUID()}`, workspaceId: workspace.id, name, kind, entityIds, entityLabels: entityIds.map((id) => known.get(id).label), createdBy: member.id, createdRole: member.role, createdAt: now, updatedAt: now };
      store.commitRecord({ kind: "comparison_view", record: view, audit: { requestId, action: "create_comparison_view", targetId: view.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "created", occurredAt: now }, operation: { key: idempotencyKey, action: "create_comparison_view", status: 201, body: view, completedAt: now } });
      await writeFile(comparisonViewsPath, `${JSON.stringify(store.recordsLedger("comparison_view", "workspace-comparison-view-ledger-v1", "views"), null, 2)}\n`);
      return json(response, 201, view);
    }
    if (request.method === "POST" && url.pathname === "/api/notification-preferences") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot change notification preferences." });
      const now = new Date().toISOString();
      const delivery = String(body.delivery ?? "in_app");
      let webhookUrl = null;
      if (delivery === "webhook") {
        try { const parsed = new URL(String(body.webhookUrl ?? "")); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid protocol"); webhookUrl = parsed.toString(); } catch { return json(response, 400, { error: "Webhook delivery requires a valid HTTP(S) URL." }); }
      } else if (delivery !== "in_app") return json(response, 400, { error: "Delivery must be in_app or webhook." });
      const preferences = { id: `notification-preference-${workspace.id}`, workspaceId: workspace.id, comparisonAlerts: body.comparisonAlerts !== false, sourceAlerts: body.sourceAlerts !== false, deliveryUpdates: body.deliveryUpdates !== false, delivery, destinationId: delivery === "webhook" ? String(body.destinationId ?? `workspace-${workspace.id}`).slice(0, 120) : null, webhookUrl, updatedBy: member.id, updatedRole: member.role, updatedAt: now };
      store.commitRecord({ kind: "notification_preference", record: preferences, audit: { requestId, action: "update_notification_preferences", targetId: preferences.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "updated", occurredAt: now }, operation: { key: idempotencyKey, action: "update_notification_preferences", status: 200, body: preferences, completedAt: now } });
      await writeFile(notificationPreferencesPath, `${JSON.stringify(store.recordsLedger("notification_preference", "workspace-notification-preference-ledger-v1", "preferences"), null, 2)}\n`);
      return json(response, 200, preferences);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/workspace-delivery-notifications/") && url.pathname.endsWith("/acknowledge")) {
      const notificationId = decodeURIComponent(url.pathname.slice("/api/workspace-delivery-notifications/".length, -"/acknowledge".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const access = await workspaceAccess(request, body.workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const notification = store.findRecord("delivery_notification", notificationId);
      if (!notification || notification.workspaceId !== access.workspaceId) return json(response, 404, { error: "Workspace notification not found." });
      if (notification.status === "acknowledged") return json(response, 200, notification);
      if (notification.status !== "pending") return json(response, 409, { error: "Only pending workspace notifications can be acknowledged." });
      const workspace = await workspaceConfig(access.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!member) return json(response, 403, { error: "You are not a member of this workspace." });
      const now = new Date().toISOString();
      const acknowledged = { ...notification, status: "acknowledged", acknowledgedAt: now, acknowledgedBy: member.id, acknowledgedRole: member.role };
      store.commitRecord({ kind: "delivery_notification", record: acknowledged, audit: { requestId, action: "acknowledge_workspace_notification", targetId: notification.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "acknowledged", occurredAt: now }, operation: { key: idempotencyKey, action: "acknowledge_workspace_notification", status: 200, body: acknowledged, completedAt: now } });
      await writeFile(deliveryNotificationsPath, `${JSON.stringify(store.recordsLedger("delivery_notification", "workspace-delivery-notification-ledger-v1", "notifications"), null, 2)}\n`);
      if (notification.type === "pilot_delivery" && notification.deliveryStatus === "prepared") {
        const outcomeLedger = await readJson(workspaceRefreshOutcomesPath, { schemaVersion: "workspace-refresh-outcome-ledger-v1", outcomes: [] });
        const outcomes = (outcomeLedger.outcomes ?? []).map((outcome) => outcome.workspaceId === workspace.id && outcome.deliveryId === notification.deliveryId && outcome.status !== "resolved" ? { ...outcome, status: "resolved", resolvedAt: now, resolvedBy: member.id, resolution: "customer_acknowledged", timeToResolutionMs: Number.isFinite(Date.parse(outcome.observedAt)) ? Math.max(0, Date.parse(now) - Date.parse(outcome.observedAt)) : null, resolvedRunId: outcome.resolvedRunId ?? notification.refreshRunId ?? null } : outcome);
        await writeFile(workspaceRefreshOutcomesPath, `${JSON.stringify({ ...outcomeLedger, updatedAt: now, outcomes }, null, 2)}\n`);
      }
      return json(response, 200, acknowledged);
    }
    if (request.method === "POST" && url.pathname === "/api/workspace-pilot") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot configure the pilot." });
      const decisionQuestion = String(body.decisionQuestion ?? "").trim();
      const decisionContext = String(body.decisionContext ?? "").trim().slice(0, 2000);
      const cadence = String(body.cadence ?? "monthly");
      const successMeasures = [...new Set((Array.isArray(body.successMeasures) ? body.successMeasures : []).map((value) => String(value).trim()).filter(Boolean))].slice(0, 8);
      const nextReviewAt = body.nextReviewAt ? String(body.nextReviewAt).slice(0, 32) : null;
      if (decisionQuestion.length < 8 || decisionQuestion.length > 500) return json(response, 400, { error: "Decision question must be between 8 and 500 characters." });
      if (!["weekly", "monthly", "quarterly"].includes(cadence)) return json(response, 400, { error: "Cadence must be weekly, monthly, or quarterly." });
      if (!successMeasures.length) return json(response, 400, { error: "Provide at least one success measure." });
      if (nextReviewAt && !Number.isFinite(Date.parse(nextReviewAt))) return json(response, 400, { error: "Next review date must be a valid date." });
      const now = new Date().toISOString();
      const profile = { id: `pilot-${workspace.id}`, workspaceId: workspace.id, status: "active", decisionQuestion, decisionContext, cadence, successMeasures, nextReviewAt, configuredBy: member.id, configuredRole: member.role, createdAt: store.findRecord("pilot_profile", `pilot-${workspace.id}`)?.createdAt ?? now, updatedAt: now };
      store.commitRecord({ kind: "pilot_profile", record: profile, audit: { requestId, action: "configure_pilot", targetId: profile.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "configured", occurredAt: now }, operation: { key: idempotencyKey, action: "configure_pilot", status: 200, body: profile, completedAt: now } });
      await writeFile(pilotProfilesPath, `${JSON.stringify(store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles"), null, 2)}\n`);
      return json(response, 200, profile);
    }
    if (request.method === "POST" && url.pathname === "/api/support-requests") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member) return json(response, 403, { error: "You are not a member of this workspace." });
      const category = String(body.category ?? "other");
      const severity = String(body.severity ?? "normal");
      const summary = String(body.summary ?? "").trim().slice(0, 200);
      const details = String(body.details ?? "").trim().slice(0, 3000);
      const allowedCategories = ["delivery", "source", "access", "billing", "other"];
      if (!allowedCategories.includes(category)) return json(response, 400, { error: "Support category is invalid." });
      if (!["low", "normal", "urgent"].includes(severity)) return json(response, 400, { error: "Support severity is invalid." });
      if (summary.length < 5) return json(response, 400, { error: "Describe the support issue in at least five characters." });
      if (details.length < 10) return json(response, 400, { error: "Include at least ten characters of detail so the team can investigate." });
      const now = new Date().toISOString();
      const record = { id: `support-${randomUUID()}`, workspaceId: workspace.id, category, severity, summary, details, status: "open", createdBy: member.id, createdRole: member.role, createdAt: now, updatedAt: now, dueAt: new Date(Date.parse(now) + supportSlaMs[severity]).toISOString(), firstResponseAt: null, responseTimeMs: null, resolvedAt: null, resolutionTimeMs: null, operatorNote: null, history: [{ status: "open", note: null, actorId: member.id, actorRole: member.role, occurredAt: now }] };
      store.commitRecord({ kind: "support_request", record, audit: { requestId, action: "create_support_request", targetId: record.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "open", occurredAt: now }, operation: { key: idempotencyKey, action: "create_support_request", status: 201, body: record, completedAt: now } });
      await writeFile(supportRequestsPath, `${JSON.stringify(store.recordsLedger("support_request", "workspace-support-request-ledger-v1", "requests"), null, 2)}\n`);
      return json(response, 201, record);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/pilot-deliveries/") && url.pathname.endsWith("/review")) {
      const deliveryId = decodeURIComponent(url.pathname.slice("/api/pilot-deliveries/".length, -"/review".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const delivery = store.findRecord("pilot_delivery", deliveryId);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!delivery || delivery.workspaceId !== workspace.id) return json(response, 404, { error: "Pilot delivery not found in this workspace." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot review pilot deliveries." });
      const usefulness = String(body.usefulness ?? "");
      const decisionImpact = String(body.decisionImpact ?? "");
      const note = String(body.note ?? "").trim().slice(0, 2000);
      const correctionType = String(body.correctionType ?? "none");
      const correctionNote = String(body.correctionNote ?? "").trim().slice(0, 2000);
      const missedChangeState = String(body.missedChangeState ?? "unknown");
      const missedChangeNote = String(body.missedChangeNote ?? "").trim().slice(0, 2000);
      const answerTimeMinutes = body.answerTimeMinutes === "" || body.answerTimeMinutes === null || body.answerTimeMinutes === undefined ? null : Number(body.answerTimeMinutes);
      const allowedUsefulness = ["useful", "not_useful", "unclear"];
      const allowedImpact = ["changed_decision", "informed_decision", "no_change", "not_applicable"];
      const allowedCorrections = ["none", "inaccurate", "missing_context", "unclear", "wrong_scope"];
      const allowedMissedChangeStates = ["yes", "none", "unknown"];
      if (!allowedUsefulness.includes(usefulness)) return json(response, 400, { error: "Usefulness must be useful, not_useful, or unclear." });
      if (!allowedImpact.includes(decisionImpact)) return json(response, 400, { error: "Decision impact is invalid." });
      if (!allowedCorrections.includes(correctionType)) return json(response, 400, { error: "Correction type is invalid." });
      if (correctionType !== "none" && !correctionNote) return json(response, 400, { error: "A correction note is required when reporting a delivery problem." });
      if (!allowedMissedChangeStates.includes(missedChangeState)) return json(response, 400, { error: "Missed-change state must be yes, none, or unknown." });
      if (missedChangeState === "yes" && !missedChangeNote) return json(response, 400, { error: "A note is required when reporting a missed important change." });
      if (answerTimeMinutes !== null && (!Number.isFinite(answerTimeMinutes) || answerTimeMinutes < 0 || answerTimeMinutes > 100000)) return json(response, 400, { error: "Answer time must be between 0 and 100000 minutes." });
      if (!note) return json(response, 400, { error: "A review note is required." });
      const assessments = Array.isArray(body.measureAssessments) ? body.measureAssessments.map((assessment) => ({ name: String(assessment.name ?? "").trim().slice(0, 200), state: String(assessment.state ?? "unknown"), note: String(assessment.note ?? "").trim().slice(0, 500) })).filter((assessment) => assessment.name) : [];
      if (assessments.some((assessment) => !["met", "partially_met", "not_met", "unknown"].includes(assessment.state))) return json(response, 400, { error: "Each measure assessment must be met, partially_met, not_met, or unknown." });
      const now = new Date().toISOString();
      const review = { id: `pilot-delivery-review-${randomUUID()}`, deliveryId, workspaceId: workspace.id, reviewedBy: member.id, reviewedRole: member.role, usefulness, decisionImpact, correctionType, correctionNote: correctionType === "none" ? null : correctionNote, missedChangeState, missedChangeNote: missedChangeState === "yes" ? missedChangeNote : null, answerTimeMinutes, note, measureAssessments: assessments, reviewedAt: now };
      const reviewedDelivery = { ...delivery, status: "reviewed", review };
      store.commitRecord({ kind: "pilot_delivery", record: reviewedDelivery, audit: { requestId, action: "review_pilot_delivery", targetId: deliveryId, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: usefulness, occurredAt: now }, operation: { key: idempotencyKey, action: "review_pilot_delivery", status: 200, body: reviewedDelivery, completedAt: now } });
      store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "pilot_delivery_review", targetId: deliveryId, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, outcome: usefulness, decisionImpact, occurredAt: now, deliveryReviewId: review.id }]);
      await writeReviewEvents();
      await writeFile(pilotDeliveriesPath, `${JSON.stringify(store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries"), null, 2)}\n`);
      return json(response, 200, reviewedDelivery);
    }
    if (request.method === "POST" && url.pathname === "/api/pilot-report/decision") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot record a pilot decision." });
      const decision = String(body.decision ?? "");
      const note = String(body.note ?? "").trim().slice(0, 2000);
      const nextStep = String(body.nextStep ?? "").trim().slice(0, 1000);
      if (!["improve", "continue", "expand", "stop"].includes(decision)) return json(response, 400, { error: "Decision must be improve, continue, expand, or stop." });
      if (!note || !nextStep) return json(response, 400, { error: "A decision note and next step are required." });
      const now = new Date().toISOString();
      const record = { id: `pilot-decision-${randomUUID()}`, workspaceId: workspace.id, decision, note, nextStep, decidedBy: member.id, decidedRole: member.role, decidedAt: now, reviewAt: body.reviewAt ? String(body.reviewAt).slice(0, 32) : null };
      store.commitRecord({ kind: "pilot_decision", record, audit: { requestId, action: "decide_pilot", targetId: record.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: decision, occurredAt: now }, operation: { key: idempotencyKey, action: "decide_pilot", status: 201, body: record, completedAt: now } });
      store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "pilot_decision", targetId: record.id, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, outcome: decision, occurredAt: now, pilotDecisionId: record.id }]);
      await writeReviewEvents();
      await writeFile(pilotDecisionsPath, `${JSON.stringify(store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions"), null, 2)}\n`);
      return json(response, 201, record);
    }
    if (request.method === "POST" && url.pathname === "/api/workspace-commercial-offer") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot create a commercial offer." });
      const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions.filter((decision) => decision.workspaceId === workspace.id);
      const latestDecision = decisions.slice().sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0];
      if (latestDecision?.decision !== "expand") return json(response, 409, { error: "Record a human expand checkpoint before proposing a recurring offer." });
      const offers = store.recordsLedger("commercial_offer", "workspace-commercial-offer-ledger-v1", "offers").offers.filter((offer) => offer.workspaceId === workspace.id);
      if (offers.some((offer) => ["proposed", "accepted", "active"].includes(offer.status))) return json(response, 409, { error: "This workspace already has an open commercial offer." });
      const planName = String(body.planName ?? "").trim().slice(0, 160);
      const serviceScope = String(body.serviceScope ?? "").trim().slice(0, 2000);
      const cadence = String(body.cadence ?? "");
      const billingInterval = String(body.billingInterval ?? "");
      const currency = String(body.currency ?? "USD").trim().toUpperCase().slice(0, 3);
      const amountCents = Number(body.amountCents);
      const startDate = body.startDate ? String(body.startDate).slice(0, 32) : null;
      const renewalDate = body.renewalDate ? String(body.renewalDate).slice(0, 32) : null;
      if (!planName || serviceScope.length < 20 || !["weekly", "monthly", "quarterly"].includes(cadence) || !["monthly", "quarterly", "annual"].includes(billingInterval) || !/^[A-Z]{3}$/.test(currency) || !Number.isInteger(amountCents) || amountCents < 0 || amountCents > 100000000) return json(response, 400, { error: "Offer requires a plan, a specific service scope, a supported cadence and billing interval, a three-letter currency, and a non-negative whole-cent amount." });
      const now = new Date().toISOString();
      const record = { id: `commercial-offer-${randomUUID()}`, workspaceId: workspace.id, status: "proposed", planName, serviceScope, cadence, billingInterval, amountCents, currency, startDate, renewalDate, terms: String(body.terms ?? "").trim().slice(0, 2000) || null, basedOnDecisionId: latestDecision.id, createdBy: member.id, createdRole: member.role, createdAt: now, updatedAt: now, history: [{ status: "proposed", note: "Offer proposed after the recorded human expand checkpoint.", actorId: member.id, actorRole: member.role, occurredAt: now }] };
      store.commitRecord({ kind: "commercial_offer", record, audit: { requestId, action: "propose_commercial_offer", targetId: record.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "proposed", occurredAt: now }, operation: { key: idempotencyKey, action: "propose_commercial_offer", status: 201, body: record, completedAt: now } });
      await writeFile(commercialOffersPath, `${JSON.stringify(store.recordsLedger("commercial_offer", "workspace-commercial-offer-ledger-v1", "offers"), null, 2)}\n`);
      return json(response, 201, record);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/workspace-commercial-offer/") && url.pathname.endsWith("/state")) {
      const offerId = decodeURIComponent(url.pathname.slice("/api/workspace-commercial-offer/".length, -"/state".length));
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      const offer = store.findRecord("commercial_offer", offerId);
      if (!workspace || !offer || offer.workspaceId !== workspace.id) return json(response, 404, { error: "Commercial offer not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot change a commercial offer." });
      const nextState = String(body.state ?? "");
      const transitions = { proposed: ["accepted", "declined", "cancelled"], accepted: ["active", "cancelled"], active: ["ended", "cancelled"], declined: [], cancelled: [], ended: [] };
      if (!transitions[offer.status]?.includes(nextState)) return json(response, 409, { error: `Cannot change an offer from ${offer.status} to ${nextState}.` });
      const note = String(body.note ?? "").trim().slice(0, 2000);
      if (!note) return json(response, 400, { error: "A note is required for every offer state change." });
      const now = new Date().toISOString();
      const updated = { ...offer, status: nextState, updatedAt: now, history: [...(offer.history ?? []), { status: nextState, note, actorId: member.id, actorRole: member.role, occurredAt: now }] };
      store.commitRecord({ kind: "commercial_offer", record: updated, audit: { requestId, action: "change_commercial_offer", targetId: offer.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: nextState, occurredAt: now }, operation: { key: idempotencyKey, action: "change_commercial_offer", status: 200, body: updated, completedAt: now } });
      await writeFile(commercialOffersPath, `${JSON.stringify(store.recordsLedger("commercial_offer", "workspace-commercial-offer-ledger-v1", "offers"), null, 2)}\n`);
      return json(response, 200, updated);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/operator/warnings/") && url.pathname.endsWith("/state")) {
      const warningId = decodeURIComponent(url.pathname.slice("/api/operator/warnings/".length, -"/state".length));
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const body = await requestBody(request);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for operator writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      if (!["refresh-failures", "source-freshness", "false-alert-rate", "delivery-delay", "insight-review-hold"].includes(warningId)) return json(response, 400, { error: "Unknown operator warning." });
      const state = String(body.state ?? "");
      const note = String(body.note ?? "").trim().slice(0, 2000);
      const ownerId = String(body.ownerId ?? "").trim().slice(0, 120) || operator.actorId;
      const escalationState = String(body.escalationState ?? "normal");
      if (!["acknowledged", "resolved"].includes(state)) return json(response, 400, { error: "Warning state must be acknowledged or resolved." });
      if (!["normal", "escalated"].includes(escalationState)) return json(response, 400, { error: "Escalation state must be normal or escalated." });
      if (!note) return json(response, 400, { error: "A note is required." });
      const now = new Date().toISOString();
      const warningObservation = { "refresh-failures": null, "source-freshness": null, "false-alert-rate": null, "delivery-delay": null, "insight-review-hold": null }[warningId];
      const observedAt = body.observedAt ? String(body.observedAt).slice(0, 32) : warningObservation;
      const responseTimeMs = observedAt && Number.isFinite(Date.parse(observedAt)) ? Math.max(0, Date.parse(now) - Date.parse(observedAt)) : null;
      const event = { id: `operator-warning-${warningId}`, warningId, state, note, ownerId, escalationState, observedAt, responseTimeMs, actedBy: operator.actorId, actedAt: now };
      store.commitRecord({ kind: "operator_warning", record: event, audit: { requestId, action: "change_operator_warning", targetId: warningId, workspaceId: null, actorId: operator.actorId, actorRole: "operator", result: state, occurredAt: now }, operation: { key: idempotencyKey, action: "change_operator_warning", status: 200, body: event, completedAt: now } });
      if (escalationState === "escalated") {
        const routeSettings = store.findRecord("operator_notification_route", "operator-notification-routes");
        const notification = { id: `operator-notification-${warningId}`, warningId, channel: "operator-outbox", recipient: ownerId, destinationId: routeSettings?.destinations?.[ownerId]?.id ?? ownerId, status: "pending", subject: `Escalated operator warning: ${warningId}`, body: note, createdBy: operator.actorId, createdAt: now, dispatchedAt: null, dispatchNote: null };
        store.syncRecords("operator_notification", [notification]);
        store.appendAudit({ requestId, action: "queue_operator_notification", targetId: notification.id, workspaceId: null, actorId: operator.actorId, actorRole: "operator", result: "pending", occurredAt: now });
        await writeFile(operatorNotificationsPath, `${JSON.stringify(store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications"), null, 2)}\n`);
      }
      await writeFile(operatorWarningsPath, `${JSON.stringify(store.recordsLedger("operator_warning", "operator-warning-event-ledger-v1", "events"), null, 2)}\n`);
      return json(response, 200, event);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/operator/support-requests/") && url.pathname.endsWith("/state")) {
      const requestIdTarget = decodeURIComponent(url.pathname.slice("/api/operator/support-requests/".length, -"/state".length));
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const body = await requestBody(request);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for operator writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const requestRecord = store.findRecord("support_request", requestIdTarget);
      if (!requestRecord) return json(response, 404, { error: "Support request not found." });
      const status = String(body.status ?? "");
      const note = String(body.note ?? "").trim().slice(0, 2000);
      if (!["acknowledged", "in_progress", "resolved", "closed"].includes(status)) return json(response, 400, { error: "Support status is invalid." });
      if (!note) return json(response, 400, { error: "A note is required when updating a support request." });
      const now = new Date().toISOString();
      const firstResponseAt = requestRecord.firstResponseAt ?? (["acknowledged", "in_progress", "resolved", "closed"].includes(status) ? now : null);
      const resolvedAt = ["resolved", "closed"].includes(status) ? (requestRecord.resolvedAt ?? now) : null;
      const updated = { ...requestRecord, status, updatedAt: now, firstResponseAt, responseTimeMs: requestRecord.responseTimeMs ?? (firstResponseAt && Number.isFinite(Date.parse(requestRecord.createdAt)) ? Math.max(0, Date.parse(firstResponseAt) - Date.parse(requestRecord.createdAt)) : null), resolvedAt, resolutionTimeMs: requestRecord.resolutionTimeMs ?? (resolvedAt && Number.isFinite(Date.parse(requestRecord.createdAt)) ? Math.max(0, Date.parse(resolvedAt) - Date.parse(requestRecord.createdAt)) : null), operatorNote: note, history: [...(requestRecord.history ?? []), { status, note, actorId: operator.actorId, actorRole: "operator", occurredAt: now }] };
      store.commitRecord({ kind: "support_request", record: updated, audit: { requestId, action: "update_support_request", targetId: updated.id, workspaceId: updated.workspaceId, actorId: operator.actorId, actorRole: "operator", result: status, occurredAt: now }, operation: { key: idempotencyKey, action: "update_support_request", status: 200, body: updated, completedAt: now } });
      await writeFile(supportRequestsPath, `${JSON.stringify(store.recordsLedger("support_request", "workspace-support-request-ledger-v1", "requests"), null, 2)}\n`);
      return json(response, 200, updated);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/operator/notifications/") && url.pathname.endsWith("/dispatch")) {
      const notificationId = decodeURIComponent(url.pathname.slice("/api/operator/notifications/".length, -"/dispatch".length));
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const body = await requestBody(request);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for operator writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const priorNotification = store.findRecord("operator_notification", notificationId);
      if (!priorNotification) return json(response, 404, { error: "Operator notification not found." });
      if (priorNotification.status !== "pending") return json(response, 409, { error: "Only pending notifications can be dispatched." });
      const note = String(body.note ?? "").trim().slice(0, 2000);
      if (!note) return json(response, 400, { error: "A dispatch note is required." });
      const now = new Date().toISOString();
      const notification = { ...priorNotification, status: "dispatched", dispatchedAt: now, dispatchedBy: operator.actorId, dispatchNote: note };
      store.commitRecord({ kind: "operator_notification", record: notification, audit: { requestId, action: "dispatch_operator_notification", targetId: notification.id, workspaceId: null, actorId: operator.actorId, actorRole: "operator", result: "dispatched", occurredAt: now }, operation: { key: idempotencyKey, action: "dispatch_operator_notification", status: 200, body: notification, completedAt: now } });
      await writeFile(operatorNotificationsPath, `${JSON.stringify(store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications"), null, 2)}\n`);
      return json(response, 200, notification);
    }
    if (request.method === "POST" && url.pathname === "/api/operator/notification-routes") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const body = await requestBody(request);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for operator writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const cleanList = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean))].slice(0, 100);
      const destinations = Object.fromEntries(Object.entries(body.destinations && typeof body.destinations === "object" ? body.destinations : {}).slice(0, 100).map(([recipient, destination]) => { const id = String(destination?.id ?? recipient).slice(0, 120); const mode = String(destination?.mode ?? "webhook"); let url; try { url = new URL(String(destination?.url ?? "")); } catch { return [recipient, null]; } if (mode !== "webhook" || !["http:", "https:"].includes(url.protocol)) return [recipient, null]; return [String(recipient).slice(0, 120), { id, mode, url: url.toString() }]; }).filter(([, destination]) => destination));
      const routes = { id: "operator-notification-routes", default: cleanList(body.default), warningIds: Object.fromEntries(Object.entries(body.warningIds && typeof body.warningIds === "object" ? body.warningIds : {}).slice(0, 50).map(([warningId, recipients]) => [String(warningId).slice(0, 120), cleanList(recipients)]).filter(([, recipients]) => recipients.length)), workspaces: Object.fromEntries(Object.entries(body.workspaces && typeof body.workspaces === "object" ? body.workspaces : {}).slice(0, 100).map(([workspaceId, recipients]) => [String(workspaceId).slice(0, 120), cleanList(recipients)]).filter(([, recipients]) => recipients.length)), destinations, updatedBy: operator.actorId, updatedAt: new Date().toISOString() };
      if (!routes.default.length && !Object.keys(routes.warningIds).length && !Object.keys(routes.workspaces).length) return json(response, 400, { error: "At least one notification route is required." });
      store.commitRecord({ kind: "operator_notification_route", record: routes, audit: { requestId, action: "configure_operator_notification_routes", targetId: routes.id, workspaceId: null, actorId: operator.actorId, actorRole: "operator", result: "configured", occurredAt: routes.updatedAt }, operation: { key: idempotencyKey, action: "configure_operator_notification_routes", status: 200, body: routes, completedAt: routes.updatedAt } });
      await writeFile(operatorRoutesPath, `${JSON.stringify(store.recordsLedger("operator_notification_route", "operator-notification-route-ledger-v1", "settings"), null, 2)}\n`);
      return json(response, 200, routes);
    }
    if (request.method === "POST" && url.pathname === "/api/operator/workspaces") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const body = await requestBody(request);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for operator writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const name = String(body.name ?? "").trim().slice(0, 120);
      const ownerId = String(body.ownerId ?? "").trim().slice(0, 120);
      if (name.length < 3) return json(response, 400, { error: "Workspace name must be at least 3 characters." });
      if (ownerId.length < 3) return json(response, 400, { error: "Owner identity ID must be at least 3 characters." });
      const requestedMembers = Array.isArray(body.members) ? body.members : [];
      if (requestedMembers.length > 49) return json(response, 400, { error: "A workspace can have at most 50 members at provisioning time." });
      const members = [{ id: ownerId, role: "owner", status: "active" }];
      for (const candidate of requestedMembers) {
        const id = String(candidate?.id ?? "").trim().slice(0, 120);
        const role = String(candidate?.role ?? "viewer");
        if (!id || id === ownerId || !["owner", "researcher", "viewer"].includes(role)) continue;
        if (!members.some((member) => member.id === id)) members.push({ id, role, status: "invited", invitedAt: new Date().toISOString(), invitedBy: operator.actorId });
      }
      const now = new Date().toISOString();
      const workspace = { schemaVersion: "workspace-v1", id: `workspace-${randomUUID()}`, name, members, watchlists: [], provisionedAt: now, provisionedBy: operator.actorId };
      await persistWorkspaceRegistryEntry(workspace);
      const invitationLedger = await readJson(workspaceInvitationsPath, { invitations: [] });
      const invitations = [...(invitationLedger.invitations ?? []), ...members.filter((member) => member.status === "invited").map((member) => ({ id: `invitation-${randomUUID()}`, workspaceId: workspace.id, identityId: member.id, role: member.role, status: "pending", provider: "external_identity_provider", createdAt: now, createdBy: operator.actorId, dispatchedAt: null, activatedAt: null }))];
      await writeWorkspaceInvitations(invitations);
      const responseBody = { ...workspace, identityProvisioning: "Map these member identity IDs to production identity-provider accounts before inviting the partner." };
      await appendAudit({ requestId, action: "provision_workspace", targetId: workspace.id, workspaceId: workspace.id, actorId: operator.actorId, actorRole: "operator", result: "provisioned", occurredAt: now });
      await storeOperation({ key: idempotencyKey, action: "provision_workspace", status: 201, body: responseBody, completedAt: now });
      return json(response, 201, responseBody);
    }
    if (request.method === "POST" && url.pathname.match(/^\/api\/operator\/workspaces\/[^/]+\/members$/)) {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const workspaceId = decodeURIComponent(url.pathname.split("/")[4]);
      const body = await requestBody(request);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for operator writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = (await configuredWorkspaces()).find((candidate) => candidate.id === workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      const identityId = String(body.identityId ?? "").trim().slice(0, 120);
      const role = String(body.role ?? "viewer");
      if (identityId.length < 3) return json(response, 400, { error: "Member identity ID must be at least 3 characters." });
      if (!["researcher", "viewer"].includes(role)) return json(response, 400, { error: "Invited member role must be researcher or viewer." });
      if (workspace.members?.some((member) => member.id === identityId)) return json(response, 409, { error: "This identity is already associated with the workspace." });
      const now = new Date().toISOString();
      const member = { id: identityId, role, status: "invited", invitedAt: now, invitedBy: operator.actorId };
      const updated = { ...workspace, members: [...(workspace.members ?? []), member] };
      await persistWorkspaceRegistryEntry(updated);
      const invitationLedger = await readJson(workspaceInvitationsPath, { invitations: [] });
      const invitation = { id: `invitation-${randomUUID()}`, workspaceId, identityId, role, status: "pending", provider: "external_identity_provider", createdAt: now, createdBy: operator.actorId, dispatchedAt: null, activatedAt: null };
      await writeWorkspaceInvitations([...(invitationLedger.invitations ?? []), invitation]);
      const responseBody = { workspaceId, member, identityProviderAction: "Invite this identity through the production identity provider, then activate the membership after the account is confirmed." };
      await appendAudit({ requestId, action: "invite_workspace_member", targetId: identityId, workspaceId, actorId: operator.actorId, actorRole: "operator", result: "invited", occurredAt: now });
      await storeOperation({ key: idempotencyKey, action: "invite_workspace_member", status: 201, body: responseBody, completedAt: now });
      return json(response, 201, responseBody);
    }
    if (request.method === "POST" && url.pathname.match(/^\/api\/operator\/workspaces\/[^/]+\/members\/[^/]+\/activate$/)) {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const pathParts = url.pathname.split("/");
      const workspaceId = decodeURIComponent(pathParts[4]);
      const identityId = decodeURIComponent(pathParts[6]);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for operator writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = (await configuredWorkspaces()).find((candidate) => candidate.id === workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      const existingMember = workspace.members?.find((member) => member.id === identityId);
      if (!existingMember) return json(response, 404, { error: "Workspace member invitation not found." });
      if (existingMember.status === "suspended") return json(response, 409, { error: "Suspended memberships must be restored through an explicit recovery flow." });
      const now = new Date().toISOString();
      const member = { ...existingMember, status: "active", activatedAt: now, activatedBy: operator.actorId };
      const updated = { ...workspace, members: workspace.members.map((candidate) => candidate.id === identityId ? member : candidate) };
      await persistWorkspaceRegistryEntry(updated);
      const invitationLedger = await readJson(workspaceInvitationsPath, { invitations: [] });
      const invitations = (invitationLedger.invitations ?? []).map((invitation) => invitation.workspaceId === workspaceId && invitation.identityId === identityId && invitation.status !== "activated" ? { ...invitation, status: "activated", activatedAt: now, activatedBy: operator.actorId } : invitation);
      await writeWorkspaceInvitations(invitations);
      await ensureWorkspaceOnboardingNotification({ workspaceId, identityId, actorId: operator.actorId, actorRole: "operator", occurredAt: now, requestId });
      const responseBody = { workspaceId, member };
      await appendAudit({ requestId, action: "activate_workspace_member", targetId: identityId, workspaceId, actorId: operator.actorId, actorRole: "operator", result: "active", occurredAt: now });
      await storeOperation({ key: idempotencyKey, action: "activate_workspace_member", status: 200, body: responseBody, completedAt: now });
      return json(response, 200, responseBody);
    }
    if (request.method === "POST" && url.pathname.match(/^\/api\/operator\/workspace-refresh-failures\/[^/]+\/retry$/)) {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const failureId = decodeURIComponent(url.pathname.slice("/api/operator/workspace-refresh-failures/".length, -"/retry".length));
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for operator writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const ledger = await readJson(workspaceRefreshOutcomesPath, { schemaVersion: "workspace-refresh-outcome-ledger-v1", outcomes: [] });
      const failure = (ledger.outcomes ?? []).find((outcome) => outcome.id === failureId);
      if (!failure) return json(response, 404, { error: "Workspace refresh failure not found." });
      if (failure.status === "resolved") return json(response, 409, { error: "This workspace refresh failure is already resolved." });
      const now = new Date().toISOString();
      const updated = { ...failure, status: "retry_requested", retryRequestedAt: now, retryRequestedBy: operator.actorId };
      ledger.outcomes = (ledger.outcomes ?? []).map((outcome) => outcome.id === failureId ? updated : outcome);
      await writeFile(workspaceRefreshOutcomesPath, `${JSON.stringify({ ...ledger, updatedAt: now }, null, 2)}\n`);
      const responseBody = { ...updated, nextAction: "The next scheduled refresh will retry this workspace; do not send a customer handoff until a prepared delivery exists." };
      await appendAudit({ requestId, action: "retry_workspace_refresh", targetId: failureId, workspaceId: failure.workspaceId, actorId: operator.actorId, actorRole: "operator", result: "retry_requested", occurredAt: now });
      await storeOperation({ key: idempotencyKey, action: "retry_workspace_refresh", status: 200, body: responseBody, completedAt: now });
      return json(response, 200, responseBody);
    }
    if (request.method === "POST" && url.pathname === "/api/integrations/identity-provider/events") {
      if (!identityProviderWebhookSecret) return json(response, 503, { error: "Identity-provider webhook integration is not configured." });
      const rawBody = await requestTextBody(request);
      if (!validWebhookSignature(rawBody, request.headers["x-identity-provider-signature"])) return json(response, 401, { error: "Invalid identity-provider webhook signature." });
      let body;
      try { body = JSON.parse(rawBody); } catch { return json(response, 400, { error: "Identity-provider webhook body must be valid JSON." }); }
      const eventId = String(body.eventId ?? "").trim().slice(0, 160);
      const eventType = String(body.type ?? "");
      const identityId = String(body.identityId ?? "").trim().slice(0, 120);
      if (eventId.length < 8 || identityId.length < 3) return json(response, 400, { error: "Webhook requires eventId and identityId." });
      if (eventType !== "identity.confirmed") return json(response, 400, { error: "Unsupported identity-provider event type." });
      const operationKey = `identity-provider:${eventId}`;
      const prior = await replayOperation(operationKey);
      if (prior) return json(response, prior.status, prior.body);
      const allWorkspaces = await configuredWorkspaces();
      const matchingWorkspaces = allWorkspaces.filter((workspace) => workspace.members?.some((member) => member.id === identityId && member.status === "invited"));
      if (!matchingWorkspaces.length) return json(response, 404, { error: "No pending workspace membership matches this confirmed identity." });
      const now = new Date().toISOString();
      for (const workspace of matchingWorkspaces) {
        const updated = { ...workspace, members: workspace.members.map((member) => member.id === identityId && member.status === "invited" ? { ...member, status: "active", activatedAt: now, activatedBy: "identity-provider-webhook", confirmationEventId: eventId } : member) };
        await persistWorkspaceRegistryEntry(updated);
      }
      const invitationLedger = await readJson(workspaceInvitationsPath, { invitations: [] });
      const invitations = (invitationLedger.invitations ?? []).map((invitation) => invitation.identityId === identityId && invitation.status === "pending" ? { ...invitation, status: "activated", activatedAt: now, activatedBy: "identity-provider-webhook", confirmationEventId: eventId } : invitation);
      await writeWorkspaceInvitations(invitations);
      const responseBody = { eventId, identityId, activatedWorkspaceIds: matchingWorkspaces.map((workspace) => workspace.id), activatedAt: now };
      for (const workspace of matchingWorkspaces) await ensureWorkspaceOnboardingNotification({ workspaceId: workspace.id, identityId, actorId: "identity-provider", actorRole: "integration", occurredAt: now, requestId });
      for (const workspace of matchingWorkspaces) await appendAudit({ requestId, action: "activate_workspace_member", targetId: identityId, workspaceId: workspace.id, actorId: "identity-provider", actorRole: "integration", result: "active", occurredAt: now });
      await storeOperation({ key: operationKey, action: "identity_provider_confirm_identity", status: 200, body: responseBody, completedAt: now });
      return json(response, 200, responseBody);
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/briefings/") && url.pathname.endsWith("/export")) {
      const briefingId = decodeURIComponent(url.pathname.slice("/api/briefings/".length, -"/export".length));
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const ledger = await readJson(briefingsPath, { briefings: [] });
      const briefing = ledger.briefings.find((candidate) => candidate.id === briefingId && (!workspaceId || candidate.workspaceId === workspaceId) && (!access.workspaceIds || access.workspaceIds.includes(candidate.workspaceId)));
      if (!briefing) return json(response, 404, { error: "Briefing not found in this workspace." });
      await appendAudit({ requestId, action: "export_briefing", targetId: briefing.id, workspaceId: briefing.workspaceId, actorId: access.actorId ?? null, actorRole: null, result: "exported", occurredAt: new Date().toISOString() });
      const artifact = {
        schemaVersion: "source-linked-briefing-export-v1",
        exportedAt: new Date().toISOString(),
        briefing: {
          id: briefing.id,
          workspaceId: briefing.workspaceId,
          questionId: briefing.questionId,
          title: briefing.title,
          state: briefing.state,
          reading: briefing.reading,
          boundary: briefing.boundary,
          nextTest: briefing.nextTest,
          publication: briefing.publication ?? "not_published",
          publishedAt: briefing.publishedAt ?? null,
          insightProvenance: briefing.insightProvenance ?? []
        },
        evidence: briefing.evidence ?? []
      };
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${briefing.id}.json"`, "Cache-Control": "no-store" });
      return response.end(JSON.stringify(artifact, null, 2));
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/briefings/") && url.pathname.endsWith("/history")) {
      const briefingId = decodeURIComponent(url.pathname.slice("/api/briefings/".length, -"/history".length));
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const briefingLedger = await readJson(briefingsPath, { briefings: [] });
      const briefing = briefingLedger.briefings.find((candidate) => candidate.id === briefingId && (!workspaceId || candidate.workspaceId === workspaceId) && (!access.workspaceIds || access.workspaceIds.includes(candidate.workspaceId)));
      if (!briefing) return json(response, 404, { error: "Briefing not found in this workspace." });
      const publications = store.recordsLedger("briefing_publication", "briefing-publication-ledger-v1", "publications").publications.filter((publication) => publication.briefingId === briefing.id && (!access.workspaceIds || access.workspaceIds.includes(publication.workspaceId)));
      const events = store.recordsLedger("review_event", "review-event-ledger-v1", "events").events.filter((event) => event.targetId === briefing.id && event.eventType === "briefing_republish" && (!access.workspaceIds || access.workspaceIds.includes(event.workspaceId)));
      const publicationOrder = (a, b) => Number(a.publicationOrder ?? 0) - Number(b.publicationOrder ?? 0) || String(a.publishedAt).localeCompare(String(b.publishedAt));
      const orderedPublications = publications.slice().sort(publicationOrder);
      const latestPublication = orderedPublications.at(-1);
      return json(response, 200, { schemaVersion: "briefing-history-v1", briefing: { id: briefing.id, workspaceId: briefing.workspaceId, title: briefing.title, state: briefing.state, publication: briefing.publication ?? "not_published", evidenceDigest: briefing.evidenceDigest ?? null, staleReason: briefing.staleReason ?? null, customerActions: briefing.customerActions ?? [], insightActions: briefing.insightActions ?? [] }, versions: orderedPublications.map((publication) => ({ id: publication.id, publishedAt: publication.publishedAt, publishedBy: publication.publishedBy, evidenceDigest: publication.evidenceDigest, previousEvidenceDigest: publication.previousEvidenceDigest ?? null, reReviewedUpdatedEvidence: publication.reReviewedUpdatedEvidence ?? false })), changes: events.sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt))).map((event) => ({ id: event.id, occurredAt: event.occurredAt, reviewer: event.reviewer, previousEvidenceDigest: event.previousEvidenceDigest ?? null, currentEvidenceDigest: event.currentEvidenceDigest ?? null, outcome: event.outcome })), currentPublicationId: latestPublication?.id ?? null, limitation: "History records publication and re-review events. It does not prove that the briefing was useful or that a decision based on it was correct." });
    }
    if (request.method !== "GET" && !(request.method === "POST" && url.pathname === "/api/workspace-deletion")) return json(response, 405, { error: "This method is not supported for this endpoint." });
    if (url.pathname === "/api/health") return json(response, 200, { status: "ok", service: "change-intelligence-read-model", authMode, database: store.health(), generatedAt: new Date().toISOString() });
    if (url.pathname === "/api/readiness") {
      const report = await readinessReport();
      return json(response, report.status === "ready" ? 200 : 503, report);
    }
    if (url.pathname === "/api/operations") {
      const readiness = await readinessReport();
      const refresh = await readJson(refreshPath, { status: "not_run", steps: [] });
      const scheduler = await readJson(schedulerStatusPath, { schemaVersion: "refresh-scheduler-status-v1", status: "not_started" });
      const backupScheduler = await readJson(backupSchedulerStatusPath, { schemaVersion: "runtime-backup-scheduler-status-v1", status: "not_started" });
      const notificationScheduler = await readJson(notificationSchedulerStatusPath, { schemaVersion: "notification-scheduler-status-v1", status: "not_started" });
      const history = await readJson(refreshHistoryPath, { schemaVersion: "refresh-history-v1", runs: [] });
      const sourceScan = await readJson(sourceScanPath, { counts: {}, sources: [] });
      const sourceAvailability = await readJson(sourceAvailabilityPath, { schemaVersion: "source-availability-receipt-v1", counts: {}, repositories: [] });
      return json(response, 200, { schemaVersion: "operations-read-model-v1", generatedAt: new Date().toISOString(), readiness, refresh, scheduler, backupScheduler, notificationScheduler, refreshHistory: history.runs ?? [], sourceScan: { counts: sourceScan.counts, sourceCount: sourceScan.sources?.length ?? 0 }, sourceAvailability: { checkedAt: sourceAvailability.checkedAt ?? null, counts: sourceAvailability.counts, repositories: sourceAvailability.repositories ?? [] }, database: store.health() });
    }
    if (url.pathname === "/api/usage") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const entries = store.auditLedger().entries.filter((entry) => !access.workspaceIds || access.workspaceIds.includes(entry.workspaceId));
      const counts = Object.fromEntries([...new Set(entries.map((entry) => entry.action))].map((action) => [action, entries.filter((entry) => entry.action === action).length]));
      return json(response, 200, { schemaVersion: "workspace-usage-v1", workspaceId: access.workspaceId, activity: { totalAuditEvents: entries.length, actions: counts, lastActivityAt: entries.at(-1)?.occurredAt ?? null }, measures: { questionsSaved: counts.create_question ?? 0, evidenceInspections: counts.inspect_evidence ?? 0, insightInspections: counts.inspect_insight ?? 0, sourceReviews: counts.review_source ?? 0, alertsAcknowledged: counts.acknowledge_alert ?? 0, alertsResolved: counts.resolve_alert ?? 0, falseAlerts: entries.filter((entry) => entry.action === "resolve_alert" && entry.result === "false_positive").length, briefingsPublished: counts.publish_briefing ?? 0, briefingsExported: counts.export_briefing ?? 0, insightsPublished: counts.publish_insight ?? 0, decisionOutcomesRecorded: counts.record_decision_outcome ?? 0, watchlistsCreated: counts.create_watchlist ?? 0 } });
    }
    if (url.pathname === "/api/pilot-metrics") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const entries = store.auditLedger().entries.filter((entry) => !access.workspaceIds || access.workspaceIds.includes(entry.workspaceId));
      const alerts = store.alertsLedger().alerts.filter((alert) => !access.workspaceIds || access.workspaceIds.includes(alert.workspaceId));
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes.filter((outcome) => !access.workspaceIds || access.workspaceIds.includes(outcome.workspaceId));
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries.filter((delivery) => !access.workspaceIds || access.workspaceIds.includes(delivery.workspaceId));
      const briefingLedger = await readJson(briefingsPath, { briefings: [] });
      const briefings = briefingLedger.briefings.filter((briefing) => !access.workspaceIds || access.workspaceIds.includes(briefing.workspaceId));
      return json(response, 200, buildPilotMetrics({ workspaceId: access.workspaceId, auditEntries: entries, alerts, outcomes, briefings, deliveries }));
    }
    if (url.pathname === "/api/workspace-update") {
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const workspace = workspaceId ? await workspaceConfig(workspaceId) : null;
      const entries = store.auditLedger().entries.filter((entry) => !access.workspaceIds || access.workspaceIds.includes(entry.workspaceId));
      const alerts = store.alertsLedger().alerts.filter((alert) => !access.workspaceIds || access.workspaceIds.includes(alert.workspaceId));
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes.filter((outcome) => !access.workspaceIds || access.workspaceIds.includes(outcome.workspaceId));
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries.filter((delivery) => !access.workspaceIds || access.workspaceIds.includes(delivery.workspaceId));
      const questions = store.questionsLedger().questions.filter((question) => !access.workspaceIds || access.workspaceIds.includes(question.workspaceId));
      const briefingLedger = await readJson(briefingsPath, { briefings: [] });
      const briefings = briefingLedger.briefings.filter((briefing) => !access.workspaceIds || access.workspaceIds.includes(briefing.workspaceId));
      const packet = await readJson(packetPath, { domain: null, sourceSnapshotDate: null, records: [], insights: [] });
      const registry = await readJson(sourceRegistryPath, { repositories: [] });
      const refresh = await readJson(refreshPath, { status: "not_run", steps: [] });
      const coverage = buildCoverage(packet, registry);
      const readiness = await readinessReport();
      const metrics = buildPilotMetrics({ workspaceId: access.workspaceId, auditEntries: entries, alerts, outcomes, briefings, deliveries });
      return json(response, 200, buildWorkspaceUpdate({ workspaceId: access.workspaceId, workspaceName: workspace?.name ?? access.workspaceId ?? "All workspaces", refresh, readiness, coverage, metrics, alerts, questions, briefings }));
    }
    if (url.pathname === "/api/workspace-delivery-health") {
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
      const attempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      return json(response, 200, buildWorkspaceDeliveryHealth({ workspaceId: access.workspaceId, notifications, attempts }));
    }
    if (url.pathname === "/api/workspace-service-report") {
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries.filter((delivery) => delivery.workspaceId === access.workspaceId);
      const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions.filter((decision) => decision.workspaceId === access.workspaceId);
      const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
      const attempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      const profile = profiles.find((candidate) => candidate.workspaceId === access.workspaceId) ?? null;
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes.filter((outcome) => outcome.workspaceId === access.workspaceId);
      const learning = buildPilotLearningReport({ workspaceId: access.workspaceId, profile, deliveries, decisions, outcomes });
      const deliveryHealth = buildWorkspaceDeliveryHealth({ workspaceId: access.workspaceId, notifications, attempts });
      return json(response, 200, buildWorkspaceServiceReport({ workspaceId: access.workspaceId, profile, deliveries, learning, deliveryHealth }));
    }
    if (url.pathname === "/api/workspace-commercial-readiness") {
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries.filter((delivery) => delivery.workspaceId === access.workspaceId);
      const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions.filter((decision) => decision.workspaceId === access.workspaceId);
      const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
      const attempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      const profile = profiles.find((candidate) => candidate.workspaceId === access.workspaceId) ?? null;
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes.filter((outcome) => outcome.workspaceId === access.workspaceId);
      const learning = buildPilotLearningReport({ workspaceId: access.workspaceId, profile, deliveries, decisions, outcomes });
      const deliveryHealth = buildWorkspaceDeliveryHealth({ workspaceId: access.workspaceId, notifications, attempts });
      const serviceReport = buildWorkspaceServiceReport({ workspaceId: access.workspaceId, profile, deliveries, learning, deliveryHealth });
      const history = store.recordsLedger("pilot_readiness", "pilot-readiness-ledger-v1", "snapshots").snapshots;
      return json(response, 200, buildCommercialPilotReadiness({ workspaceId: access.workspaceId, profile, learning, serviceReport, history }));
    }
    if (url.pathname === "/metrics") {
      const readiness = await readinessReport();
      const values = [
        ["change_intelligence_ready", readiness.status === "ready" ? 1 : 0],
        ["change_intelligence_database_integrity", readiness.checks.database.status === "ok" ? 1 : 0],
        ["change_intelligence_refresh_ok", readiness.checks.refresh.status === "ok" ? 1 : 0],
        ["change_intelligence_source_scan_ok", readiness.checks.sourceScan.status === "ok" ? 1 : 0],
        ["change_intelligence_runtime_sync_ok", readiness.checks.runtimeSync.status === "ok" ? 1 : 0],
        ["change_intelligence_backup_ok", readiness.checks.backup.status === "ok" ? 1 : 0],
        ["change_intelligence_workers_ok", ["ok", "not_required"].includes(readiness.checks.workers.status) ? 1 : 0],
        ["change_intelligence_sources_missing", readiness.checks.sourceScan.missing ?? -1],
        ["change_intelligence_refresh_age_seconds", readiness.checks.refresh.ageMs === null ? -1 : Math.round(readiness.checks.refresh.ageMs / 1000)],
        ["change_intelligence_backup_age_seconds", readiness.checks.backup.ageMs === null ? -1 : Math.round(readiness.checks.backup.ageMs / 1000)]
      ];
      return text(response, 200, `${values.map(([name, value]) => `${name} ${value}`).join("\n")}\n`);
    }
    if (url.pathname === "/api/catalog" || url.pathname === "/api/records") {
      const packet = await readJson(packetPath, { domain: null, sourceSnapshotDate: null, records: [], insights: [] });
      const filters = {
        theme: url.searchParams.get("theme"),
        company: url.searchParams.get("company"),
        industry: url.searchParams.get("industry"),
        sourceRole: url.searchParams.get("sourceRole")
      };
      const matches = packet.records.filter((record) => Object.entries(filters).every(([field, value]) => !value || record[field] === value));
      if (url.pathname === "/api/records") return json(response, 200, { schemaVersion: "evidence-record-read-model-v1", domain: packet.domain, sourceSnapshotDate: packet.sourceSnapshotDate, records: matches });
      const values = (field) => [...new Set(packet.records.map((record) => record[field]).filter(Boolean))].sort().map((value) => ({ value, count: packet.records.filter((record) => record[field] === value).length }));
      return json(response, 200, { schemaVersion: "catalog-read-model-v1", domain: packet.domain, sourceSnapshotDate: packet.sourceSnapshotDate, recordCount: packet.records.length, repositoryCount: new Set(packet.records.map((record) => record.sourceRepository)).size, themes: values("theme"), companies: values("company"), industries: values("industry"), sourceRoles: values("sourceRole") });
    }
    if (url.pathname === "/api/changes") {
      const scan = await readJson(sourceScanPath, { schemaVersion: "source-scan-receipt-v1", runId: null, generatedAt: null, counts: {}, sources: [] });
      const includeUnchanged = url.searchParams.get("includeUnchanged") === "true";
      const changes = (scan.sources ?? []).filter((source) => includeUnchanged || source.status !== "unchanged").map((source) => ({ id: source.id, repository: source.repository, sourcePath: source.path, status: source.status, needsReview: source.needsReview, reason: source.reviewReason, checkedAt: source.checkedAt, previousSha256: source.previousSha256 ?? null, currentSha256: source.sha256 ?? null }));
      return json(response, 200, { schemaVersion: "source-change-feed-v1", runId: scan.runId, generatedAt: scan.generatedAt, counts: scan.counts, changes });
    }
    if (url.pathname === "/api/change-intelligence") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const [packet, scan, briefingLedger, candidateLedger, watchlistLedger] = await Promise.all([
        readJson(packetPath, { records: [], insights: [] }),
        readJson(sourceScanPath, { runId: null, generatedAt: null, sources: [] }),
        readJson(briefingsPath, { briefings: [] }),
        readJson(insightCandidatesPath, { candidates: [] }),
        readJson(watchlistsPath, { watchlists: [] })
      ]);
      return json(response, 200, buildChangeIntelligenceFeed({ packet, scan, briefings: briefingLedger.briefings ?? [], candidates: candidateLedger.candidates ?? [], watchlists: watchlistLedger.watchlists ?? [], workspaceId: access.workspaceId, workspaceIds: access.workspaceIds }));
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/change-intelligence/") && url.pathname.endsWith("/diff")) {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const sourceId = decodeURIComponent(url.pathname.slice("/api/change-intelligence/".length, -"/diff".length));
      const scan = await readJson(sourceScanPath, { sources: [] });
      const source = (scan.sources ?? []).find((candidate) => candidate.id === sourceId);
      if (!source) return json(response, 404, { error: "Source change not found." });
      return json(response, 200, await readSourceDiff(source));
    }
    if (url.pathname === "/api/coverage") {
      const packet = await readJson(packetPath, { domain: null, sourceSnapshotDate: null, records: [] });
      const registry = await readJson(sourceRegistryPath, { repositories: [] });
      return json(response, 200, buildCoverage(packet, registry));
    }
    if (url.pathname === "/api/atlas") {
      const atlas = await readJson(atlasPath, await readJson(staticAtlasPath, { schemaVersion: "domain-atlas-v1", entities: {}, edges: [] }));
      return json(response, 200, atlas);
    }
    if (url.pathname === "/api/atlas/entity") {
      const kind = url.searchParams.get("kind");
      const id = url.searchParams.get("id");
      const allowedKinds = new Set(["themes", "companies", "industries", "mechanisms", "affectedGroups", "repositories"]);
      if (!allowedKinds.has(kind) || !id) return json(response, 400, { error: "A valid entity kind and id are required." });
      const atlas = await readJson(atlasPath, await readJson(staticAtlasPath, { entities: {}, edges: [] }));
      const entity = (atlas.entities?.[kind] ?? []).find((candidate) => candidate.id === id);
      if (!entity) return json(response, 404, { error: "Atlas entity not found." });
      const packet = await readJson(packetPath, { records: [] });
      const evidence = (packet.records ?? []).filter((record) => entity.evidenceIds.includes(record.id)).map((record) => ({ id: record.id, title: record.title, observation: record.observation, sourceRole: record.sourceRole, sourceRepository: record.sourceRepository, sourceRef: record.sourceRef, sourceDigest: record.sourceDigest, claimState: record.claimState, asOf: record.asOf, theme: record.theme ?? null, company: record.company ?? null, industry: record.industry ?? null, reportingPeriod: record.reportingPeriod ?? null, reportWindow: record.reportWindow ?? null }));
      const reportedMovement = evidence.flatMap((record) => record.reportWindow ? [{ period: record.reportWindow.annualBaseline ?? record.reportingPeriod ?? record.asOf, type: "annual_baseline", title: record.title, sourceRecordId: record.id, sourceRole: record.sourceRole, values: [], reading: record.reportWindow.reading }] .concat((record.reportWindow.quarters ?? []).map((quarter) => ({ period: quarter.period, type: "quarter", title: record.title, sourceRecordId: record.id, sourceRole: record.sourceRole, values: quarter.values ?? [], reading: record.reportWindow.reading }))) : [record.sourceRole === "company_report" || record.sourceRole === "industry" || record.sourceRole === "private_company" ? { period: record.reportingPeriod ?? record.asOf, type: "reported_record", title: record.title, sourceRecordId: record.id, sourceRole: record.sourceRole, values: [], reading: record.observation } : null].filter(Boolean));
      const theme = evidence.find((record) => record.theme)?.theme;
      const outcomeEvidence = (packet.records ?? []).filter((record) => record.theme === theme && ["research", "social_cultural", "institutional", "geopolitical"].includes(record.sourceRole)).map((record) => ({ id: record.id, title: record.title, sourceRole: record.sourceRole, claimState: record.claimState, asOf: record.asOf, observation: record.observation, limits: record.limits }));
      const comparisons = evidence.filter((record) => record.reportWindow).map((record) => ({ recordId: record.id, title: record.title, sourceRole: record.sourceRole, sourceRef: record.sourceRef, columns: record.reportWindow.columns ?? [], annualBaseline: record.reportWindow.annualBaseline ?? null, quarters: record.reportWindow.quarters ?? [], metrics: record.reportWindow.metrics ?? {}, reading: record.reportWindow.reading ?? null }));
      const nextTests = (packet.insights ?? []).filter((insight) => insight.recordIds?.some((recordId) => entity.evidenceIds.includes(recordId))).map((insight) => ({ insightId: insight.id, title: insight.title, nextTest: insight.nextTest }));
      const relatedEntityIds = new Set((atlas.edges ?? []).filter((edge) => edge.from && entity.evidenceIds.includes(edge.from)).map((edge) => edge.to).filter((relatedId) => relatedId !== entity.id));
      const related = Object.values(atlas.entities ?? {}).flat().filter((candidate) => relatedEntityIds.has(candidate.id)).map((candidate) => ({ id: candidate.id, label: candidate.label, evidenceCount: candidate.evidenceIds.length }));
      return json(response, 200, { schemaVersion: "atlas-entity-read-model-v1", entity: { id: entity.id, label: entity.label, kind, evidenceCount: entity.evidenceIds.length }, evidence, timeline: { reportedMovement, comparisons, outcomeEvidence, nextTests, boundary: "Reported movement and independent evidence are shown on separate rails. Neither rail alone proves a real-world outcome or causation." }, related, limitation: "This page groups source-linked records around a normalized label. It does not prove that the entity caused the recorded changes or that the records are a complete account." });
    }
    if (url.pathname === "/api/atlas/compare") {
      const kind = url.searchParams.get("kind");
      const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean))].slice(0, 8);
      if (!["companies", "industries"].includes(kind) || ids.length < 2) return json(response, 400, { error: "Choose at least two companies or industries to compare." });
      const atlas = await readJson(atlasPath, await readJson(staticAtlasPath, { entities: {}, edges: [] }));
      const packet = await readJson(packetPath, { records: [] });
      const selected = ids.map((id) => (atlas.entities?.[kind] ?? []).find((candidate) => candidate.id === id)).filter(Boolean);
      if (selected.length !== ids.length) return json(response, 404, { error: "One or more comparison entities were not found." });
      const sourceScan = await readJson(sourceScanPath, { sources: [] });
      return json(response, 200, buildAtlasComparison({ kind, ids, atlas, packet, sourceScan }));
    }
    if (url.pathname === "/api/ingestion") {
      return json(response, 200, await readJson(ingestionPath, await readJson(staticIngestionPath, { schemaVersion: "research-ingestion-ledger-v1", repositories: [], records: [] })));
    }
    if (url.pathname === "/api/packet") {
      const packet = await readJson(packetPath, { error: "Packet has not been built." });
      const runtimeCandidates = await readJson(insightCandidatesPath, undefined);
      return json(response, 200, publicPacket(runtimeCandidates ? { ...packet, operations: { ...(packet.operations ?? {}), insightCandidates: runtimeCandidates } } : packet));
    }
    if (url.pathname.startsWith("/api/evidence/")) {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const recordId = decodeURIComponent(url.pathname.slice("/api/evidence/".length));
      const packet = await readJson(packetPath, { records: [], insights: [] });
      const sharedRecord = packet.records.find((candidate) => candidate.id === recordId);
      const privateRecord = store.findRecord("workspace_source", recordId);
      const record = sharedRecord ?? (privateRecord && access.workspaceId && privateRecord.workspaceId === access.workspaceId ? { ...privateRecord, sourceRole: "workspace_source", sourceRepository: "customer-provided", asOf: privateRecord.submittedAt, limits: ["This is customer-provided evidence. It remains private to the workspace and has not been independently verified."] } : undefined);
      if (!record) return json(response, 404, { error: "Evidence record not found." });
      if (access.workspaceId) await appendAudit({ requestId, action: "inspect_evidence", targetId: record.id, workspaceId: access.workspaceId, actorId: access.actorId ?? null, actorRole: null, result: "opened", occurredAt: new Date().toISOString() });
      const relatedRecords = packet.records.filter((candidate) => (record.relatedRecordIds ?? []).includes(candidate.id));
      const insightLinks = packet.insights
        .filter((insight) => insight.recordIds?.includes(record.id))
        .map((insight) => ({ id: insight.id, title: insight.title, status: insight.status, strongestAlternative: insight.strongestAlternative, nextTest: insight.nextTest }));
      return json(response, 200, {
        schemaVersion: "evidence-inspection-v1",
        record,
        source: {
          repository: record.sourceRepository,
          path: record.sourceRef,
          locator: record.sourceLocator ?? null,
          digest: record.sourceDigest ?? null,
          bytes: record.sourceBytes ?? null,
          excerpt: record.sourceExcerpt ?? null
        },
        relatedRecords,
        insightLinks,
        boundaries: {
          claimState: record.claimState,
          limits: record.limits ?? [],
          isCausalClaim: false
        }
      });
    }
    if (url.pathname.startsWith("/api/insights/")) {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const insightId = decodeURIComponent(url.pathname.slice("/api/insights/".length));
      const packet = await readJson(packetPath, { records: [], insights: [], operations: {} });
      const insight = packet.insights.find((candidate) => candidate.id === insightId);
      if (!insight) return json(response, 404, { error: "Insight not found." });
      if (access.workspaceId) await appendAudit({ requestId, action: "inspect_insight", targetId: insight.id, workspaceId: access.workspaceId, actorId: access.actorId ?? null, actorRole: null, result: "opened", occurredAt: new Date().toISOString() });
      const recordsById = new Map(packet.records.map((record) => [record.id, record]));
      const runtimeCandidates = await readJson(insightCandidatesPath, undefined);
      const candidate = (runtimeCandidates?.candidates ?? packet.operations?.insightCandidates?.candidates ?? []).find((item) => item.candidateKey === insight.id || item.id === insight.id);
      const visible = (item) => !item.workspaceId || !access.workspaceId || item.workspaceId === access.workspaceId;
      const decisions = store.recordsLedger("insight_decision", "insight-decision-ledger-v1", "decisions").decisions.filter((item) => item.candidateKey === insight.id && visible(item));
      const publications = store.recordsLedger("insight_publication", "insight-publication-ledger-v1", "publications").publications.filter((item) => item.candidateKey === insight.id && visible(item));
      const reviewEvents = store.recordsLedger("review_event", "review-event-ledger-v1", "events").events.filter((item) => (item.candidateKey === insight.id || item.targetId === candidate?.id) && visible(item));
      const briefingLedger = await readJson(briefingsPath, { briefings: [] });
      const briefingLinks = briefingLedger.briefings.filter((briefing) => (!access.workspaceId || briefing.workspaceId === access.workspaceId) && (briefing.insightProvenance ?? []).some((item) => item.candidateKey === insight.id || item.insightId === insight.id)).map((briefing) => ({ id: briefing.id, workspaceId: briefing.workspaceId, title: briefing.title, state: briefing.state, publication: briefing.publication, publicationId: briefing.publicationId ?? null, evidenceDigest: briefing.evidenceDigest ?? null, staleReason: briefing.staleReason ?? null, generatedAt: briefing.generatedAt ?? null }));
      const latestPublicationForInsight = publications.slice().sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))[0];
      const evidenceChanged = Boolean(candidate && latestPublicationForInsight && candidate.evidenceDigest !== latestPublicationForInsight.evidenceDigest);
      const claimChanged = Boolean(candidate && latestPublicationForInsight && candidate.claimDigest && latestPublicationForInsight.claimDigest && candidate.claimDigest !== latestPublicationForInsight.claimDigest);
      return json(response, 200, {
        schemaVersion: "insight-inspection-v1",
        insight,
        evidence: (insight.recordIds ?? []).map((recordId) => recordsById.get(recordId)).filter(Boolean),
        chain: buildInsightEvidenceChain(insight, recordsById),
        candidate: candidate ?? null,
        review: candidate ? { status: candidate.status, publication: candidate.publication, evidenceDigest: candidate.evidenceDigest, decisionId: candidate.decisionId ?? null, decidedBy: candidate.decidedBy ?? null, decidedAt: candidate.decidedAt ?? null, decisionNote: candidate.decisionNote ?? null, publicationId: candidate.publicationId ?? null, publishedBy: candidate.publishedBy ?? null, publishedAt: candidate.publishedAt ?? null } : null,
        reviewHistory: { decisions, publications, events: reviewEvents },
        freshness: { state: candidate?.status === "stale" ? "stale" : candidate?.status ?? "not_generated", evidenceChanged, claimChanged, currentEvidenceDigest: candidate?.evidenceDigest ?? null, publishedEvidenceDigest: latestPublicationForInsight?.evidenceDigest ?? null, currentClaimDigest: candidate?.claimDigest ?? null, publishedClaimDigest: latestPublicationForInsight?.claimDigest ?? null },
        briefingLinks,
        boundaries: {
          strongestAlternative: insight.strongestAlternative,
          whatWouldChangeOurMind: insight.whatWouldChangeOurMind ?? [],
          nextTest: insight.nextTest,
          refreshBy: insight.refreshBy
        }
      });
    }
    if (url.pathname === "/api/review-work") return json(response, 200, await readJson(reviewPath, { schemaVersion: "source-review-work-v1", reviewRequired: 0, candidates: [] }));
    if (url.pathname === "/api/evidence-history") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const records = store.recordsLedger("evidence_version", "versioned-evidence-ledger-v1", "records").records;
      const visible = (item) => !item.workspaceId || !access.workspaceIds || access.workspaceIds.includes(item.workspaceId);
      const decisionHistory = store.recordsLedger("review_decision", "review-decision-ledger-v1", "decisions").decisions.filter(visible);
      const reviewEvents = store.recordsLedger("review_event", "review-event-ledger-v1", "events").events.filter(visible);
      const sourceSnapshots = store.recordsLedger("source_scan", "source-snapshot-ledger-v1", "sources").sources;
      return json(response, 200, { schemaVersion: "versioned-evidence-ledger-v1", activeResearchRecordCount: records.length, decisionCount: decisionHistory.length, records, decisionHistory, reviewEvents, sourceSnapshots });
    }
    if (url.pathname === "/api/timeline") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const sourceSnapshots = store.recordsLedger("source_scan", "source-snapshot-ledger-v1", "sources").sources;
      const reviewEvents = store.recordsLedger("review_event", "review-event-ledger-v1", "events").events;
      const briefingPublications = store.recordsLedger("briefing_publication", "briefing-publication-ledger-v1", "publications").publications;
      const insightPublications = store.recordsLedger("insight_publication", "insight-publication-ledger-v1", "publications").publications;
      const decisionOutcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes;
      const pilotDeliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
      const availabilityHistory = await readJson(resolve(runtimeDir, "source-availability-events.json"), { events: [] });
      const sourceHistory = await readJson(sourceScanHistoryPath, { runs: [] });
      const sourceRuns = sourceHistory.runs?.length ? sourceHistory.runs : [{ runId: null, sources: sourceSnapshots }];
      const allEvents = [
        ...sourceRuns.flatMap((run) => (run.sources ?? []).map((snapshot) => ({ eventType: "source_scan", targetId: snapshot.id, sourceId: snapshot.id, scanRunId: run.runId, status: snapshot.status, previousDigest: snapshot.previousSha256 ?? null, currentDigest: snapshot.sha256 ?? null, occurredAt: snapshot.checkedAt }))),
        ...reviewEvents,
        ...briefingPublications.map((publication) => ({ eventType: "briefing_publish", targetId: publication.briefingId, workspaceId: publication.workspaceId, reviewer: publication.publishedBy, currentEvidenceDigest: publication.evidenceDigest, occurredAt: publication.publishedAt, publicationId: publication.id })),
        ...insightPublications.map((publication) => ({ eventType: "insight_publish", targetId: publication.candidateId, candidateKey: publication.candidateKey, workspaceId: publication.workspaceId, reviewer: publication.publisher, currentEvidenceDigest: publication.evidenceDigest, occurredAt: publication.publishedAt, publicationId: publication.id })),
        ...decisionOutcomes.map((outcome) => ({ eventType: "decision_outcome", targetId: outcome.briefingId, workspaceId: outcome.workspaceId, reviewer: outcome.recordedBy, status: outcome.outcomeState, decisionState: outcome.decisionState, occurredAt: outcome.recordedAt, decisionOutcomeId: outcome.id, insightPublicationIds: outcome.insightProvenance?.map((insight) => insight.publicationId) ?? [] })),
        ...(availabilityHistory.events ?? []).map((event) => ({ eventType: "source_availability", targetId: event.sourceId, sourceId: event.sourceId, repository: event.repository, status: `${event.fromStatus}_to_${event.toStatus}`, reason: event.reason, occurredAt: event.occurredAt, availabilityEventId: event.id })),
        ...pilotDeliveries.map((delivery) => ({ eventType: "customer_delivery", targetId: delivery.id, workspaceId: delivery.workspaceId, status: delivery.status, deliveryStatus: delivery.status, refreshRunId: delivery.refreshRunId, unavailableSourceIds: delivery.snapshot?.unavailableSourceIds ?? [], occurredAt: delivery.generatedAt }))
      ];
      const visible = (event) => !event.workspaceId || !access.workspaceIds || access.workspaceIds.includes(event.workspaceId);
      const visibleEvents = allEvents.filter(visible).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
      const sourceFilter = url.searchParams.get("source");
      const eventTypeFilter = url.searchParams.get("eventType");
      const since = Date.parse(url.searchParams.get("since") ?? "");
      const matches = (event) => (!sourceFilter || event.sourceId === sourceFilter || event.unavailableSourceIds?.includes(sourceFilter)) && (!eventTypeFilter || event.eventType === eventTypeFilter) && (!Number.isFinite(since) || Date.parse(event.occurredAt) >= since);
      const events = visibleEvents.filter(matches);
      const availabilityEvents = visibleEvents.filter((event) => event.eventType === "source_availability");
      const deliveryEvents = visibleEvents.filter((event) => event.eventType === "customer_delivery");
      const impactChains = availabilityEvents.filter((event) => event.status.endsWith("_to_unavailable")).map((outage) => {
        const recovery = availabilityEvents.find((event) => event.sourceId === outage.sourceId && event.status.endsWith("_to_available") && Date.parse(event.occurredAt) > Date.parse(outage.occurredAt));
        const affectedDeliveries = deliveryEvents.filter((delivery) => delivery.unavailableSourceIds.includes(outage.sourceId) && Date.parse(delivery.occurredAt) >= Date.parse(outage.occurredAt) && (!recovery || Date.parse(delivery.occurredAt) <= Date.parse(recovery.occurredAt)));
        return { sourceId: outage.sourceId, outageAt: outage.occurredAt, recoveredAt: recovery?.occurredAt ?? null, state: recovery ? "recovered" : "active", affectedWorkspaces: [...new Set(affectedDeliveries.map((delivery) => delivery.workspaceId))], heldDeliveryIds: affectedDeliveries.filter((delivery) => delivery.status === "held_for_review").map((delivery) => delivery.targetId), releasedDeliveryIds: affectedDeliveries.filter((delivery) => delivery.status === "prepared").map((delivery) => delivery.targetId) };
      }).filter((chain) => !sourceFilter || chain.sourceId === sourceFilter);
      const impactSummary = { chains: impactChains.length, activeOutages: impactChains.filter((chain) => chain.state === "active").length, recoveredOutages: impactChains.filter((chain) => chain.state === "recovered").length, affectedWorkspaces: new Set(impactChains.flatMap((chain) => chain.affectedWorkspaces)).size, heldDeliveries: impactChains.reduce((total, chain) => total + chain.heldDeliveryIds.length, 0), releasedDeliveries: impactChains.reduce((total, chain) => total + chain.releasedDeliveryIds.length, 0) };
      return json(response, 200, { schemaVersion: "research-timeline-v1", eventCount: events.length, events, impactSummary, impactChains });
    }
    if (url.pathname === "/api/refresh") return json(response, 200, await readJson(refreshPath, { schemaVersion: "refresh-receipt-v1", status: "not_run", steps: [] }));
    if (url.pathname === "/api/workspaces") {
      const access = await workspaceAccess(request);
      if (denyWorkspaceRead(response, access)) return;
      const workspaces = (await configuredWorkspaces()).filter((workspace) => !access.workspaceIds || access.workspaceIds.includes(workspace.id)).map((workspace) => ({ id: workspace.id, name: workspace.name, memberCount: workspace.members?.length ?? 0 }));
      return json(response, 200, workspaces);
    }
    if (url.pathname === "/api/workspace-export") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      if (!access.workspaceId) return json(response, 400, { error: "Choose one workspace to export." });
      const workspace = await workspaceConfig(access.workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      const [packet, questionsLedger, evaluationsLedger, briefingsLedger, watchlistsLedger, comparisonsLedger, preferencesLedger, notificationsLedger, pilotProfilesLedger, pilotDecisionsLedger, commercialOffersLedger, outcomesLedger, auditLedger] = await Promise.all([
        readJson(packetPath, { records: [] }),
        readJson(questionsPath, { questions: [] }),
        readJson(questionEvaluationsPath, { evaluations: [] }),
        readJson(briefingsPath, { briefings: [] }),
        readJson(watchlistsPath, { watchlists: [] }),
        readJson(comparisonViewsPath, { views: [] }),
        readJson(notificationPreferencesPath, { preferences: [] }),
        readJson(deliveryNotificationsPath, { notifications: [] }),
        readJson(pilotProfilesPath, { profiles: [] }),
        readJson(pilotDecisionsPath, { decisions: [] }),
        readJson(commercialOffersPath, { offers: [] }),
        readJson(decisionOutcomesPath, { outcomes: [] }),
        readJson(auditPath, { entries: [] })
      ]);
      const pilotDeliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
      const briefingPublications = store.recordsLedger("briefing_publication", "briefing-publication-ledger-v1", "publications").publications;
      const insightPublications = store.recordsLedger("insight_publication", "insight-publication-ledger-v1", "publications").publications;
      const privateSources = store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources").sources;
      await appendAudit({ requestId, action: "export_workspace", targetId: workspace.id, workspaceId: workspace.id, actorId: access.actorId ?? null, actorRole: null, result: "exported", occurredAt: new Date().toISOString() });
      const exported = buildWorkspaceExport({
        workspace,
        packet,
        questions: workspaceRecords(questionsLedger.questions, workspace.id),
        evaluations: workspaceRecords(evaluationsLedger.evaluations, workspace.id),
        briefings: workspaceRecords(briefingsLedger.briefings, workspace.id),
        watchlists: workspaceRecords(watchlistsLedger.watchlists, workspace.id),
        privateSources: workspaceRecords(privateSources, workspace.id),
        comparisons: workspaceRecords(comparisonsLedger.views, workspace.id),
        preferences: workspaceRecords(preferencesLedger.preferences, workspace.id)[0] ?? null,
        notifications: workspaceRecords(notificationsLedger.notifications, workspace.id),
        deliveries: workspaceRecords(pilotDeliveries, workspace.id),
        pilotProfile: workspaceRecords(pilotProfilesLedger.profiles, workspace.id)[0] ?? null,
        pilotDecisions: workspaceRecords(pilotDecisionsLedger.decisions, workspace.id),
        commercialOffers: workspaceRecords(commercialOffersLedger.offers, workspace.id),
        outcomes: workspaceRecords(outcomesLedger.outcomes, workspace.id),
        briefingPublications: workspaceRecords(briefingPublications, workspace.id),
        insightPublications: workspaceRecords(insightPublications, workspace.id),
        auditEntries: workspaceRecords((await readJson(auditPath, { entries: [] })).entries, workspace.id)
      });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${workspace.id}-export.json"`, "Cache-Control": "no-store" });
      return response.end(JSON.stringify(exported));
    }
    if (url.pathname === "/api/pilot-kickoff") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      if (!access.workspaceId) return json(response, 400, { error: "Choose one workspace for the pilot kickoff packet." });
      const workspace = await workspaceConfig(access.workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      const [questionsLedger, watchlistsLedger, pilotProfilesLedger] = await Promise.all([
        readJson(questionsPath, { questions: [] }),
        readJson(watchlistsPath, { watchlists: [] }),
        readJson(pilotProfilesPath, { profiles: [] })
      ]);
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
      const privateSources = store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources").sources;
      const packet = buildPilotKickoff({
        workspace,
        profile: workspaceRecords(pilotProfilesLedger.profiles, workspace.id)[0] ?? null,
        questions: workspaceRecords(questionsLedger.questions, workspace.id),
        watchlists: workspaceRecords(watchlistsLedger.watchlists, workspace.id),
        deliveries: workspaceRecords(deliveries, workspace.id),
        sourceCount: workspaceRecords(privateSources, workspace.id).filter((source) => source.reviewState === "accepted").length
      });
      await appendAudit({ requestId, action: "export_pilot_kickoff", targetId: workspace.id, workspaceId: workspace.id, actorId: access.actorId ?? null, actorRole: null, result: "exported", occurredAt: new Date().toISOString() });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${workspace.id}-pilot-kickoff.json"`, "Cache-Control": "no-store" });
      return response.end(JSON.stringify(packet));
    }
    if (url.pathname === "/api/pilot-closeout") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      if (!access.workspaceId) return json(response, 400, { error: "Choose one workspace for the pilot closeout packet." });
      const workspace = await workspaceConfig(access.workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries.filter((delivery) => delivery.workspaceId === workspace.id);
      const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions.filter((decision) => decision.workspaceId === workspace.id);
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes.filter((outcome) => outcome.workspaceId === workspace.id);
      const alerts = store.alertsLedger().alerts.filter((alert) => alert.workspaceId === workspace.id);
      const briefingLedger = await readJson(briefingsPath, { briefings: [] });
      const briefings = briefingLedger.briefings.filter((briefing) => briefing.workspaceId === workspace.id);
      const entries = store.auditLedger().entries.filter((entry) => entry.workspaceId === workspace.id);
      const profile = profiles.find((candidate) => candidate.workspaceId === workspace.id) ?? null;
      const learning = buildPilotLearningReport({ workspaceId: workspace.id, profile, deliveries, decisions, outcomes });
      const metrics = buildPilotMetrics({ workspaceId: workspace.id, auditEntries: entries, alerts, outcomes, briefings, deliveries });
      const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
      const attempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      const deliveryHealth = buildWorkspaceDeliveryHealth({ workspaceId: workspace.id, notifications, attempts });
      const serviceReport = buildWorkspaceServiceReport({ workspaceId: workspace.id, profile, deliveries, learning, deliveryHealth });
      const history = store.recordsLedger("pilot_readiness", "pilot-readiness-ledger-v1", "snapshots").snapshots;
      const readiness = buildCommercialPilotReadiness({ workspaceId: workspace.id, profile, learning, serviceReport, history });
      const packet = buildPilotCloseout({ workspace, profile, learning, readiness, metrics, serviceReport });
      packet.commercialOffers = store.recordsLedger("commercial_offer", "workspace-commercial-offer-ledger-v1", "offers").offers.filter((offer) => offer.workspaceId === workspace.id);
      await appendAudit({ requestId, action: "export_pilot_closeout", targetId: workspace.id, workspaceId: workspace.id, actorId: access.actorId ?? null, actorRole: null, result: "exported", occurredAt: new Date().toISOString() });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${workspace.id}-pilot-closeout.json"`, "Cache-Control": "no-store" });
      return response.end(JSON.stringify(packet));
    }
    if (url.pathname === "/api/workspace-commercial-offer") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const offers = store.recordsLedger("commercial_offer", "workspace-commercial-offer-ledger-v1", "offers").offers.filter((offer) => !access.workspaceIds || access.workspaceIds.includes(offer.workspaceId));
      const visible = access.workspaceId ? offers.filter((offer) => offer.workspaceId === access.workspaceId) : offers;
      return json(response, 200, { schemaVersion: "workspace-commercial-offer-read-model-v1", workspaceId: access.workspaceId, current: visible.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null, offers: visible.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))), limitation: "This is a recorded service offer and acceptance history. It is not a payment authorization, invoice, or guarantee of delivery." });
    }
    if (url.pathname === "/api/workspace-retention") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      if (!access.workspaceId) return json(response, 400, { error: "Choose one workspace to inspect." });
      const workspace = await workspaceConfig(access.workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      const member = workspace.members?.find((candidate) => candidate.id === access.actorId);
      return json(response, 200, { schemaVersion: workspaceDeletionSchema, workspaceId: workspace.id, counts: store.workspaceRecordCounts(workspace.id), canDelete: member?.role === "owner", confirmation: `DELETE ${workspace.id}`, preserved: ["shared research evidence", "immutable source captures", "global source scan history"], warning: "Deletion is permanent for this workspace's private product records. Export the workspace first if you need a copy." });
    }
    if (request.method === "POST" && url.pathname === "/api/workspace-deletion") {
      const body = await requestBody(request);
      const actorId = authenticatedActor(request, body);
      if (!actorId) return json(response, 401, { error: "Authentication required." });
      const idempotencyKey = request.headers["idempotency-key"];
      if (authMode === "token" && !idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for token-authenticated writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || member.role !== "owner") return json(response, 403, { error: "Only a workspace owner can delete workspace data." });
      if (String(body.confirmation ?? "") !== `DELETE ${workspace.id}`) return json(response, 400, { error: `Type DELETE ${workspace.id} to confirm permanent workspace deletion.` });
      const now = new Date().toISOString();
      const deleted = store.deleteWorkspaceRecords(workspace.id);
      const result = { schemaVersion: workspaceDeletionSchema, workspaceId: workspace.id, deleted, preserved: ["shared research evidence", "immutable source captures", "global source scan history"], deletedAt: now, deletedBy: actorId };
      await appendAudit({ requestId, action: "delete_workspace_data", targetId: workspace.id, workspaceId: workspace.id, actorId, actorRole: member.role, result: "deleted", occurredAt: now });
      await persistWorkspaceLedgersAfterDeletion();
      await storeOperation({ key: idempotencyKey, action: "delete_workspace_data", status: 200, body: result, completedAt: now });
      return json(response, 200, result);
    }
    if (url.pathname === "/api/workspace-pilot") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      return json(response, 200, { schemaVersion: "workspace-pilot-read-model-v1", workspaceId: access.workspaceId, profile: access.workspaceId ? profiles.find((profile) => profile.workspaceId === access.workspaceId) ?? null : profiles });
    }
    if (url.pathname === "/api/workspace-onboarding") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      if (!access.workspaceId) return json(response, 400, { error: "Choose one workspace to inspect onboarding." });
      const workspace = await workspaceConfig(access.workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      const questions = store.questionsLedger().questions.filter((question) => question.workspaceId === workspace.id && question.state === "active");
      const watchlists = store.recordsLedger("watchlist", "workspace-watchlist-ledger-v1", "watchlists").watchlists.filter((watchlist) => watchlist.workspaceId === workspace.id);
      const privateSources = store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources").sources.filter((source) => source.workspaceId === workspace.id);
      const profile = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles.find((candidate) => candidate.workspaceId === workspace.id) ?? null;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries.filter((delivery) => delivery.workspaceId === workspace.id);
      return json(response, 200, buildWorkspaceOnboarding({ workspace, profile, questions, watchlists, privateSources, deliveries }));
    }
    if (url.pathname === "/api/workspace-schedule") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      if (!access.workspaceId) return json(response, 400, { error: "Choose one workspace to inspect scheduling." });
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries.filter((delivery) => delivery.workspaceId === access.workspaceId);
      const scheduler = await readJson(schedulerStatusPath, { status: "not_started" });
      return json(response, 200, buildWorkspaceSchedule({ workspaceId: access.workspaceId, profile: profiles.find((profile) => profile.workspaceId === access.workspaceId) ?? null, deliveries, scheduler }));
    }
    if (url.pathname === "/api/pilot-deliveries") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
      const visible = access.workspaceIds ? deliveries.filter((delivery) => access.workspaceIds.includes(delivery.workspaceId)) : deliveries;
      return json(response, 200, { schemaVersion: "workspace-pilot-delivery-read-model-v1", workspaceId: access.workspaceId, deliveries: visible.slice().sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt))) });
    }
    if (url.pathname === "/api/pilot-report") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
      const profile = profiles.find((candidate) => !access.workspaceIds || access.workspaceIds.includes(candidate.workspaceId));
      const visible = deliveries.filter((delivery) => !access.workspaceIds || access.workspaceIds.includes(delivery.workspaceId));
      const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions.filter((decision) => !access.workspaceIds || access.workspaceIds.includes(decision.workspaceId));
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes.filter((outcome) => !access.workspaceIds || access.workspaceIds.includes(outcome.workspaceId));
      return json(response, 200, buildPilotLearningReport({ workspaceId: access.workspaceId, profile, deliveries: visible, decisions, outcomes }));
    }
    if (url.pathname === "/api/operator/notifications") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const attempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      return json(response, 200, { schemaVersion: "operator-notification-outbox-v1", notifications: store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications.map(({ body, ...notification }) => ({ ...notification, attemptHistory: attempts.filter((attempt) => attempt.notificationId === notification.id) })) });
    }
    if (url.pathname === "/api/operator/support-requests") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const requests = store.recordsLedger("support_request", "workspace-support-request-ledger-v1", "requests").requests;
      return json(response, 200, { schemaVersion: "operator-support-request-read-model-v1", requests: requests.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) });
    }
    if (url.pathname === "/api/operator/workspace-invitations") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const ledger = await readJson(workspaceInvitationsPath, { invitations: [] });
      return json(response, 200, { schemaVersion: "workspace-invitation-read-model-v1", invitations: ledger.invitations ?? [], limitation: "This is a provider-neutral outbox. It records what must be sent or confirmed; it does not contain credentials or send identity-provider messages itself." });
    }
    if (url.pathname === "/api/operator/workspace-refresh-failures") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const ledger = await readJson(workspaceRefreshOutcomesPath, { schemaVersion: "workspace-refresh-outcome-ledger-v1", outcomes: [] });
      return json(response, 200, { schemaVersion: "workspace-refresh-failure-read-model-v1", outcomes: (ledger.outcomes ?? []).slice().sort((a, b) => String(b.observedAt).localeCompare(String(a.observedAt))), limitation: "Failures are workspace-scoped operational records. A retry request waits for the next scheduled refresh; a customer handoff is valid only when its delivery status is prepared." });
    }
    if (url.pathname === "/api/operator/notification-routes") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const settings = store.recordsLedger("operator_notification_route", "operator-notification-route-ledger-v1", "settings").settings[0] ?? { id: "operator-notification-routes", default: [], warningIds: {}, workspaces: {} };
      return json(response, 200, { schemaVersion: "operator-notification-route-read-model-v1", settings });
    }
    if (url.pathname === "/api/operator/delivery-health") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
      const notificationAttempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      return json(response, 200, buildOperatorDeliveryHealth({ notifications, attempts: notificationAttempts }));
    }
    if (url.pathname === "/api/operator/portfolio-readiness") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const workspaces = (await configuredWorkspaces()).map((workspace) => ({ id: workspace.id, name: workspace.name }));
      const snapshots = store.recordsLedger("pilot_readiness", "pilot-readiness-ledger-v1", "snapshots").snapshots;
      return json(response, 200, buildOperatorPortfolioReadiness({ workspaces, snapshots }));
    }
    if (url.pathname === "/api/operator/pilot-kickoff") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const workspaceId = url.searchParams.get("workspace");
      if (!workspaceId) return json(response, 400, { error: "Choose one workspace for the pilot kickoff packet." });
      const workspace = await workspaceConfig(workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      const [questionsLedger, watchlistsLedger, pilotProfilesLedger] = await Promise.all([
        readJson(questionsPath, { questions: [] }),
        readJson(watchlistsPath, { watchlists: [] }),
        readJson(pilotProfilesPath, { profiles: [] })
      ]);
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
      const privateSources = store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources").sources;
      const packet = buildPilotKickoff({
        workspace,
        profile: workspaceRecords(pilotProfilesLedger.profiles, workspace.id)[0] ?? null,
        questions: workspaceRecords(questionsLedger.questions, workspace.id),
        watchlists: workspaceRecords(watchlistsLedger.watchlists, workspace.id),
        deliveries: workspaceRecords(deliveries, workspace.id),
        sourceCount: workspaceRecords(privateSources, workspace.id).filter((source) => source.reviewState === "accepted").length
      });
      await appendAudit({ requestId, action: "operator_export_pilot_kickoff", targetId: workspace.id, workspaceId: workspace.id, actorId: operator.actorId, actorRole: "operator", result: "exported", occurredAt: new Date().toISOString() });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${workspace.id}-pilot-kickoff.json"`, "Cache-Control": "no-store" });
      return response.end(JSON.stringify(packet));
    }
    if (url.pathname === "/api/operator/pilot-closeout") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const workspaceId = url.searchParams.get("workspace");
      if (!workspaceId) return json(response, 400, { error: "Choose one workspace for the pilot closeout packet." });
      const workspace = await workspaceConfig(workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries.filter((delivery) => delivery.workspaceId === workspace.id);
      const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions.filter((decision) => decision.workspaceId === workspace.id);
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes.filter((outcome) => outcome.workspaceId === workspace.id);
      const alerts = store.alertsLedger().alerts.filter((alert) => alert.workspaceId === workspace.id);
      const briefingLedger = await readJson(briefingsPath, { briefings: [] });
      const briefings = briefingLedger.briefings.filter((briefing) => briefing.workspaceId === workspace.id);
      const entries = store.auditLedger().entries.filter((entry) => entry.workspaceId === workspace.id);
      const profile = profiles.find((candidate) => candidate.workspaceId === workspace.id) ?? null;
      const learning = buildPilotLearningReport({ workspaceId: workspace.id, profile, deliveries, decisions, outcomes });
      const metrics = buildPilotMetrics({ workspaceId: workspace.id, auditEntries: entries, alerts, outcomes, briefings, deliveries });
      const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
      const attempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      const deliveryHealth = buildWorkspaceDeliveryHealth({ workspaceId: workspace.id, notifications, attempts });
      const serviceReport = buildWorkspaceServiceReport({ workspaceId: workspace.id, profile, deliveries, learning, deliveryHealth });
      const history = store.recordsLedger("pilot_readiness", "pilot-readiness-ledger-v1", "snapshots").snapshots;
      const readiness = buildCommercialPilotReadiness({ workspaceId: workspace.id, profile, learning, serviceReport, history });
      const packet = buildPilotCloseout({ workspace, profile, learning, readiness, metrics, serviceReport });
      await appendAudit({ requestId, action: "operator_export_pilot_closeout", targetId: workspace.id, workspaceId: workspace.id, actorId: operator.actorId, actorRole: "operator", result: "exported", occurredAt: new Date().toISOString() });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${workspace.id}-pilot-closeout.json"`, "Cache-Control": "no-store" });
      return response.end(JSON.stringify(packet));
    }
    if (url.pathname === "/api/operator/pilot-cohort") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const workspaces = (await configuredWorkspaces()).map((workspace) => ({ id: workspace.id, name: workspace.name }));
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
      const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions;
      const commercialOffers = store.recordsLedger("commercial_offer", "workspace-commercial-offer-ledger-v1", "offers").offers;
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes;
      const alerts = store.alertsLedger().alerts;
      const refreshHistory = (await readJson(refreshHistoryPath, { runs: [] })).runs ?? [];
      const sourceScan = await readJson(sourceScanPath, { sources: [] });
      const sourceScanHistory = await readJson(sourceScanHistoryPath, { runs: [] });
      const warningEvents = store.recordsLedger("operator_warning", "operator-warning-event-ledger-v1", "events").events;
      const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
      const notificationAttempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      const readinessSnapshots = store.recordsLedger("pilot_readiness", "pilot-readiness-ledger-v1", "snapshots").snapshots;
      const supportRequests = store.recordsLedger("support_request", "workspace-support-request-ledger-v1", "requests").requests;
      const questions = store.questionsLedger().questions;
      const watchlists = store.recordsLedger("watchlist", "workspace-watchlist-ledger-v1", "watchlists").watchlists;
      const privateSources = store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources").sources;
      const briefings = (await readJson(briefingsPath, { briefings: [] })).briefings;
      const auditEntries = store.auditLedger().entries;
      const onboardingByWorkspace = new Map(workspaces.map((workspace) => [workspace.id, buildOperatorOnboardingSummary({ workspace, profile: profiles.find((profile) => profile.workspaceId === workspace.id), questionCount: questions.filter((question) => question.workspaceId === workspace.id && question.state === "active").length, watchlistCount: watchlists.filter((watchlist) => watchlist.workspaceId === workspace.id).length, acceptedPrivateSourceCount: privateSources.filter((source) => source.workspaceId === workspace.id && source.reviewState === "accepted").length, deliveryCount: deliveries.filter((delivery) => delivery.workspaceId === workspace.id).length })]));
      const scheduler = await readJson(schedulerStatusPath, { status: "not_started" });
      const backupScheduler = await readJson(backupSchedulerStatusPath, { status: "not_started" });
      const notificationScheduler = await readJson(notificationSchedulerStatusPath, { status: "not_started" });
      const schedules = new Map(workspaces.map((workspace) => [workspace.id, buildWorkspaceSchedule({ workspaceId: workspace.id, profile: profiles.find((profile) => profile.workspaceId === workspace.id) ?? null, deliveries: deliveries.filter((delivery) => delivery.workspaceId === workspace.id), scheduler })]));
      const overview = buildOperatorPilotOverview({ workspaces, profiles, deliveries, decisions, commercialOffers, outcomes, briefings, supportRequests, auditEntries, refreshHistory, sourceScan, sourceScanHistory, alerts, warningEvents, notifications, notificationAttempts, readinessSnapshots, onboardingByWorkspace, schedules, schedulerStatuses: { refresh: scheduler, backup: backupScheduler, notification: notificationScheduler }, maxSourceAgeMs, maxFalseAlertRate, maxFailedRefreshes, maxDelayedDeliveries, warningAckSlaMs: operatorWarningAckSlaMs, remediationSlaMs: operatorRemediationSlaMs });
      const report = buildOperatorCohortReport({ overview });
      await appendAudit({ requestId, action: "operator_export_pilot_cohort", targetId: "pilot-cohort", workspaceId: null, actorId: operator.actorId, actorRole: "operator", result: "exported", occurredAt: new Date().toISOString() });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=pilot-cohort-report.json", "Cache-Control": "no-store" });
      return response.end(JSON.stringify(report));
    }
    if (url.pathname === "/api/operator/pilot-overview") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const workspaces = (await configuredWorkspaces()).map((workspace) => ({ id: workspace.id, name: workspace.name }));
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
      const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions;
      const commercialOffers = store.recordsLedger("commercial_offer", "workspace-commercial-offer-ledger-v1", "offers").offers;
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes;
      const briefings = (await readJson(briefingsPath, { briefings: [] })).briefings;
      const alerts = store.alertsLedger().alerts;
      const refreshHistory = (await readJson(refreshHistoryPath, { runs: [] })).runs ?? [];
      const sourceScan = await readJson(sourceScanPath, { sources: [] });
      const sourceScanHistory = await readJson(sourceScanHistoryPath, { runs: [] });
      const warningEvents = store.recordsLedger("operator_warning", "operator-warning-event-ledger-v1", "events").events;
      const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
      const notificationAttempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      const readinessSnapshots = store.recordsLedger("pilot_readiness", "pilot-readiness-ledger-v1", "snapshots").snapshots;
      const supportRequests = store.recordsLedger("support_request", "workspace-support-request-ledger-v1", "requests").requests;
      const questions = store.questionsLedger().questions;
      const watchlists = store.recordsLedger("watchlist", "workspace-watchlist-ledger-v1", "watchlists").watchlists;
      const privateSources = store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources").sources;
      const onboardingByWorkspace = new Map(workspaces.map((workspace) => [workspace.id, buildOperatorOnboardingSummary({ workspace, profile: profiles.find((profile) => profile.workspaceId === workspace.id), questionCount: questions.filter((question) => question.workspaceId === workspace.id && question.state === "active").length, watchlistCount: watchlists.filter((watchlist) => watchlist.workspaceId === workspace.id).length, acceptedPrivateSourceCount: privateSources.filter((source) => source.workspaceId === workspace.id && source.reviewState === "accepted").length, deliveryCount: deliveries.filter((delivery) => delivery.workspaceId === workspace.id).length })]));
      const scheduler = await readJson(schedulerStatusPath, { status: "not_started" });
      const backupScheduler = await readJson(backupSchedulerStatusPath, { status: "not_started" });
      const notificationScheduler = await readJson(notificationSchedulerStatusPath, { status: "not_started" });
      const schedules = new Map(workspaces.map((workspace) => [workspace.id, buildWorkspaceSchedule({ workspaceId: workspace.id, profile: profiles.find((profile) => profile.workspaceId === workspace.id) ?? null, deliveries: deliveries.filter((delivery) => delivery.workspaceId === workspace.id), scheduler })]));
      return json(response, 200, buildOperatorPilotOverview({ workspaces, profiles, deliveries, decisions, commercialOffers, outcomes, briefings, supportRequests, auditEntries: store.auditLedger().entries, refreshHistory, sourceScan, sourceScanHistory, alerts, warningEvents, notifications, notificationAttempts, readinessSnapshots, onboardingByWorkspace, schedules, schedulerStatuses: { refresh: scheduler, backup: backupScheduler, notification: notificationScheduler }, maxSourceAgeMs, maxFalseAlertRate, maxFailedRefreshes, maxDelayedDeliveries, warningAckSlaMs: operatorWarningAckSlaMs, remediationSlaMs: operatorRemediationSlaMs }));
    }
    if (url.pathname === "/api/watchlists") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const watchlists = store.recordsLedger("watchlist", "workspace-watchlist-ledger-v1", "watchlists").watchlists;
      return json(response, 200, access.workspaceIds ? watchlists.filter((watchlist) => access.workspaceIds.includes(watchlist.workspaceId)) : watchlists);
    }
    if (url.pathname === "/api/workspace-sources") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const sources = store.recordsLedger("workspace_source", "workspace-source-ledger-v1", "sources").sources;
      const visible = access.workspaceIds ? sources.filter((source) => access.workspaceIds.includes(source.workspaceId)) : sources;
      const workspace = access.workspaceId ? await workspaceConfig(access.workspaceId) : null;
      const member = workspace?.members?.find((candidate) => candidate.id === access.actorId);
      return json(response, 200, { schemaVersion: "workspace-source-read-model-v1", workspaceId: access.workspaceId, canSubmit: member ? ["owner", "researcher"].includes(member.role) : false, canReview: member ? ["owner", "researcher"].includes(member.role) : false, sources: visible.slice().sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt))) });
    }
    if (url.pathname === "/api/comparison-views") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const views = store.recordsLedger("comparison_view", "workspace-comparison-view-ledger-v1", "views").views;
      const visible = access.workspaceIds ? views.filter((view) => access.workspaceIds.includes(view.workspaceId)) : views;
      const atlas = await readJson(atlasPath, await readJson(staticAtlasPath, { entities: {}, edges: [] }));
      const packet = await readJson(packetPath, { records: [] });
      const sourceScan = await readJson(sourceScanPath, { sources: [] });
      return json(response, 200, visible.map((view) => ({ ...view, freshness: buildAtlasComparison({ kind: view.kind, ids: view.entityIds, atlas, packet, sourceScan }).freshness })));
    }
    if (url.pathname === "/api/notification-preferences") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const preferences = store.recordsLedger("notification_preference", "workspace-notification-preference-ledger-v1", "preferences").preferences;
      const preference = preferences.find((candidate) => !access.workspaceIds || access.workspaceIds.includes(candidate.workspaceId)) ?? { ...defaultNotificationPreferences, delivery: "in_app", workspaceId: access.workspaceId ?? null };
      const { webhookUrl, ...safePreference } = { ...defaultNotificationPreferences, ...preference };
      return json(response, 200, { schemaVersion: "workspace-notification-preference-read-model-v1", preferences: safePreference });
    }
    if (url.pathname === "/api/workspace-notifications") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const preferences = store.recordsLedger("notification_preference", "workspace-notification-preference-ledger-v1", "preferences").preferences.find((candidate) => !access.workspaceIds || access.workspaceIds.includes(candidate.workspaceId)) ?? defaultNotificationPreferences;
      const alerts = store.alertsLedger().alerts.filter((alert) => (!access.workspaceIds || access.workspaceIds.includes(alert.workspaceId)) && ["comparison_refresh", "comparison_incompatible"].includes(alert.kind)).map((alert) => ({ id: alert.id, workspaceId: alert.workspaceId, comparisonViewId: alert.comparisonViewId, name: alert.watchlistName, kind: alert.kind, severity: alert.severity, reason: alert.reason, state: alert.state, createdAt: alert.createdAt, lastSeenAt: alert.lastSeenAt, notificationState: preferences.comparisonAlerts === false ? "suppressed" : "in_app" }));
      return json(response, 200, { schemaVersion: "workspace-notification-read-model-v1", preferences: { ...defaultNotificationPreferences, ...preferences }, alerts });
    }
    if (url.pathname === "/api/workspace-delivery-notifications") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const notifications = store.recordsLedger("delivery_notification", "workspace-delivery-notification-ledger-v1", "notifications").notifications;
      const visible = notifications.filter((notification) => !access.workspaceIds || access.workspaceIds.includes(notification.workspaceId)).map(({ body, ...notification }) => notification);
      return json(response, 200, { schemaVersion: "workspace-delivery-notification-read-model-v1", workspaceId: access.workspaceId, notifications: visible.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
    }
    if (url.pathname === "/api/support-requests") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const requests = store.recordsLedger("support_request", "workspace-support-request-ledger-v1", "requests").requests;
      const visible = access.workspaceIds ? requests.filter((supportRequest) => access.workspaceIds.includes(supportRequest.workspaceId)) : requests;
      const workspace = access.workspaceId ? await workspaceConfig(access.workspaceId) : null;
      const member = workspace?.members?.find((candidate) => candidate.id === access.actorId);
      return json(response, 200, { schemaVersion: "workspace-support-request-read-model-v1", workspaceId: access.workspaceId, canSubmit: Boolean(member), requests: visible.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) });
    }
    if (url.pathname === "/api/alerts") {
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const alerts = store.alertsLedger().alerts;
      return json(response, 200, access.workspaceIds ? alerts.filter((alert) => access.workspaceIds.includes(alert.workspaceId)) : alerts);
    }
    if (url.pathname === "/api/questions") {
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const questions = store.questionsLedger().questions;
      return json(response, 200, access.workspaceIds ? questions.filter((question) => access.workspaceIds.includes(question.workspaceId)) : questions);
    }
    if (url.pathname === "/api/question-evaluations") {
      const ledger = await readJson(questionEvaluationsPath, { schemaVersion: "question-evaluation-ledger-v1", evaluations: [] });
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      return json(response, 200, access.workspaceIds ? ledger.evaluations.filter((evaluation) => access.workspaceIds.includes(evaluation.workspaceId)) : ledger.evaluations);
    }
    if (url.pathname === "/api/briefings") {
      const ledger = await readJson(briefingsPath, { schemaVersion: "workspace-briefing-ledger-v1", briefings: [] });
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      return json(response, 200, access.workspaceIds ? ledger.briefings.filter((briefing) => access.workspaceIds.includes(briefing.workspaceId)) : ledger.briefings);
    }
    if (url.pathname === "/api/decision-outcomes") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes;
      return json(response, 200, access.workspaceIds ? outcomes.filter((outcome) => access.workspaceIds.includes(outcome.workspaceId)) : outcomes);
    }
    if (url.pathname === "/api/audit") {
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const entries = store.auditLedger().entries;
      return json(response, 200, access.workspaceIds ? entries.filter((entry) => access.workspaceIds.includes(entry.workspaceId)) : entries);
    }
    if (url.pathname === "/") {
      response.writeHead(302, { Location: "/web/index.html" });
      return response.end();
    }
    if (url.pathname.startsWith("/web/")) {
      const relative = normalize(url.pathname.slice(1));
      if (relative.includes("..")) return json(response, 400, { error: "Invalid path." });
      const path = resolve(root, relative);
      const body = await readFile(path);
      response.writeHead(200, { "Content-Type": contentTypes[relative.slice(relative.lastIndexOf("."))] ?? "application/octet-stream" });
      return response.end(body);
    }
    return json(response, 404, { error: "Not found." });
  } catch (error) {
    return json(response, error.code === "ENOENT" ? 404 : 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Change intelligence read model listening on http://127.0.0.1:${port}`));
