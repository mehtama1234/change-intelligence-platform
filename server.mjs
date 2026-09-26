import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore, importRuntimeLedgers } from "./storage.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT ?? 8780);
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const packetPath = resolve(root, process.env.PACKET_PATH ?? "data/processed/ai-work-control.packet.json");
const reviewPath = resolve(runtimeDir, "latest-review-work.json");
const historyPath = resolve(runtimeDir, "versioned-evidence-ledger.json");
const refreshPath = resolve(runtimeDir, "latest-refresh.json");
const refreshHistoryPath = resolve(runtimeDir, "refresh-history.json");
const alertsPath = resolve(runtimeDir, "workspace-alerts.json");
const questionsPath = resolve(runtimeDir, "workspace-questions.json");
const questionEvaluationsPath = resolve(runtimeDir, "question-evaluations.json");
const briefingsPath = resolve(runtimeDir, "workspace-briefings.json");
const briefingPublicationsPath = resolve(runtimeDir, "briefing-publications.json");
const insightDecisionsPath = resolve(runtimeDir, "insight-decisions.json");
const insightCandidatesPath = resolve(runtimeDir, "insight-candidates.json");
const insightPublicationsPath = resolve(runtimeDir, "insight-publications.json");
const decisionOutcomesPath = resolve(runtimeDir, "decision-outcomes.json");
const watchlistsPath = resolve(runtimeDir, "workspace-watchlists.json");
const pilotProfilesPath = resolve(runtimeDir, "workspace-pilot-profiles.json");
const pilotDeliveriesPath = resolve(runtimeDir, "workspace-pilot-deliveries.json");
const pilotDecisionsPath = resolve(runtimeDir, "workspace-pilot-decisions.json");
const operatorWarningsPath = resolve(runtimeDir, "operator-warning-events.json");
const operatorNotificationsPath = resolve(runtimeDir, "operator-notification-outbox.json");
const operatorRoutesPath = resolve(runtimeDir, "operator-notification-routes.json");
const operatorAttemptsPath = resolve(runtimeDir, "operator-notification-attempts.json");
const auditPath = resolve(runtimeDir, "audit-log.json");
const operationsPath = resolve(runtimeDir, "idempotency-operations.json");
const sourceScanPath = resolve(runtimeDir, "latest-source-scan.json");
const sourceScanHistoryPath = resolve(runtimeDir, "source-scan-history.json");
const evidenceLedgerPath = resolve(runtimeDir, "versioned-evidence-ledger.json");
const reviewDecisionsPath = resolve(runtimeDir, "review-decisions.json");
const reviewEventsPath = resolve(runtimeDir, "review-events.json");
const workspaceDir = resolve(root, "data/fixtures/workspaces");
const sourceRegistryPath = resolve(root, "data/source-registry.json");
const authMode = process.env.AUTH_MODE ?? "demo";
const tokenActors = authMode === "token" ? JSON.parse(process.env.AUTH_TOKENS_JSON ?? "{}") : {};
const operatorActors = new Set(JSON.parse(process.env.OPERATOR_ACTORS_JSON ?? "[]"));
const backupDir = process.env.BACKUP_DIR ? resolve(root, process.env.BACKUP_DIR) : undefined;
const maxRefreshAgeMs = Number(process.env.MAX_REFRESH_AGE_MS ?? 7 * 24 * 60 * 60 * 1000);
const maxSourceAgeMs = Number(process.env.MAX_SOURCE_AGE_MS ?? 14 * 24 * 60 * 60 * 1000);
const maxFalseAlertRate = Number(process.env.OPERATOR_MAX_FALSE_ALERT_RATE ?? 0.4);
const maxFailedRefreshes = Number(process.env.OPERATOR_MAX_FAILED_REFRESHES ?? 0);
const maxDelayedDeliveries = Number(process.env.OPERATOR_MAX_DELAYED_DELIVERIES ?? 0);
const operatorWarningAckSlaMs = Number(process.env.OPERATOR_WARNING_ACK_SLA_MS ?? 4 * 60 * 60 * 1000);
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
  pilotProfiles: pilotProfilesPath,
  pilotDeliveries: pilotDeliveriesPath,
  pilotDecisions: pilotDecisionsPath,
  operatorWarnings: operatorWarningsPath,
  operatorNotifications: operatorNotificationsPath,
  operatorRoutes: operatorRoutesPath,
  operatorAttempts: operatorAttemptsPath,
  workspaceDir,
  sourceScan: sourceScanPath,
  evidenceLedger: evidenceLedgerPath,
  reviewDecisions: reviewDecisionsPath,
  reviewEvents: reviewEventsPath
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

function authenticatedActor(request, body) {
  if (authMode === "demo") return request.headers["x-workspace-actor"] || body.actorId;
  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return tokenActors[token];
}

async function workspaceConfig(id) {
  const files = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    const workspace = JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"));
    if (workspace.id === id) return workspace;
  }
  return undefined;
}

async function workspaceAccess(request, requestedWorkspaceId) {
  if (authMode !== "token") return { workspaceId: requestedWorkspaceId ?? null, workspaceIds: null, actorId: authenticatedActor(request, {}) };
  const actorId = authenticatedActor(request, {});
  if (!actorId) return { error: { status: 401, body: { error: "Authentication required." } } };
  const files = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
  const workspaces = [];
  for (const file of files) {
    const workspace = JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"));
    if (workspace.members?.some((member) => member.id === actorId)) workspaces.push(workspace);
  }
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

function buildCoverage(packet, registry) {
  const records = packet.records ?? [];
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
  return { schemaVersion: "coverage-read-model-v1", domain: packet.domain ?? null, sourceSnapshotDate: packet.sourceSnapshotDate ?? null, repositories, reportWindows, requirements, summary: { ready: requirements.filter((item) => item.status === "ready").length, partial: requirements.filter((item) => item.status === "partial").length, missing: requirements.filter((item) => item.status === "missing").length } };
}

function buildPilotMetrics({ workspaceId, auditEntries, alerts, outcomes, briefings }) {
  const resolvedAlerts = alerts.filter((alert) => alert.state === "resolved" || alert.resolutionDisposition);
  const responseTimes = resolvedAlerts.map((alert) => alert.responseTimeMs).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const median = responseTimes.length ? responseTimes[Math.floor(responseTimes.length / 2)] : null;
  const knownOutcomes = outcomes.filter((outcome) => ["held", "changed", "wrong"].includes(outcome.outcomeState));
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
      briefingsPublished: auditEntries.filter((entry) => entry.action === "publish_briefing").length,
      briefingsExported: auditEntries.filter((entry) => entry.action === "export_briefing").length,
      decisionFeedbackRecords: outcomes.length,
      decisionsUsingBriefings: outcomes.filter((outcome) => outcome.decisionState === "used").length,
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

function buildPilotLearningReport({ workspaceId, profile, deliveries, decisions }) {
  const reviewed = deliveries.filter((delivery) => delivery.review);
  const count = (items, value) => items.filter((item) => item === value).length;
  const usefulnessValues = reviewed.map((delivery) => delivery.review.usefulness);
  const impactValues = reviewed.map((delivery) => delivery.review.decisionImpact);
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
  return {
    schemaVersion: "pilot-learning-report-v1",
    workspaceId,
    profileId: profile?.id ?? null,
    decisionQuestion: profile?.decisionQuestion ?? null,
    generatedAt: new Date().toISOString(),
    observation: { deliveries: deliveries.length, reviewedDeliveries: reviewed.length, unreviewedDeliveries: deliveries.length - reviewed.length },
    checkpoint: { state: reviewed.length >= 3 ? "enough_observations_for_checkpoint" : "more_observations_needed", reviewedDeliveriesRequired: 3, explanation: reviewed.length >= 3 ? "The workspace has at least three reviewed deliveries; a human checkpoint can use this report." : "Use this report as a learning log, but collect at least three reviewed deliveries before making a commercial decision." },
    usefulness: { useful: count(usefulnessValues, "useful"), notUseful: count(usefulnessValues, "not_useful"), unclear: count(usefulnessValues, "unclear"), rate: reviewed.length ? count(usefulnessValues, "useful") / reviewed.length : null },
    decisionImpact: { changedDecision: count(impactValues, "changed_decision"), informedDecision: count(impactValues, "informed_decision"), noChange: count(impactValues, "no_change"), notApplicable: count(impactValues, "not_applicable") },
    measures,
    openIssues,
    recentNotes: reviewed.slice().sort((a, b) => String(b.review.reviewedAt).localeCompare(String(a.review.reviewedAt))).slice(0, 5).map((delivery) => ({ deliveryId: delivery.id, usefulness: delivery.review.usefulness, note: delivery.review.note, reviewedAt: delivery.review.reviewedAt })),
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

function buildOperatorPilotOverview({ workspaces, profiles, deliveries, decisions, auditEntries, refreshHistory, sourceScan, sourceScanHistory, alerts, warningEvents, notifications, notificationAttempts, maxSourceAgeMs, maxFalseAlertRate, maxFailedRefreshes, maxDelayedDeliveries, warningAckSlaMs }) {
  const summaries = workspaces.map((workspace) => {
    const workspaceDeliveries = deliveries.filter((delivery) => delivery.workspaceId === workspace.id);
    const reviewed = workspaceDeliveries.filter((delivery) => delivery.review);
    const workspaceDecisions = decisions.filter((decision) => decision.workspaceId === workspace.id);
    const profile = profiles.find((candidate) => candidate.workspaceId === workspace.id);
    const latestDeliveryAt = workspaceDeliveries.map((delivery) => delivery.generatedAt).sort().at(-1) ?? null;
    const cadenceMs = { weekly: 7 * 86400000, monthly: 31 * 86400000, quarterly: 93 * 86400000 }[profile?.cadence] ?? null;
    const deliveryDelayed = Boolean(profile && cadenceMs && (!latestDeliveryAt || Date.parse(latestDeliveryAt) + cadenceMs < Date.now()));
    return { id: workspace.id, name: workspace.name, pilotConfigured: Boolean(profile), deliveries: workspaceDeliveries.length, reviewedDeliveries: reviewed.length, usefulDeliveries: reviewed.filter((delivery) => delivery.review.usefulness === "useful").length, decisionChanges: reviewed.filter((delivery) => ["changed_decision", "informed_decision"].includes(delivery.review.decisionImpact)).length, latestDeliveryAt, deliveryDelayed, latestDecision: workspaceDecisions.slice().sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0]?.decision ?? null };
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
  return {
    schemaVersion: "operator-pilot-overview-v1",
    generatedAt: new Date().toISOString(),
    scope: { workspaceCount: workspaces.length, configuredPilots: profiles.length, deliveries: deliveries.length, reviewedDeliveries: reviewed.length },
    aggregate: { usefulDeliveries: reviewed.filter((delivery) => delivery.review.usefulness === "useful").length, notUsefulDeliveries: reviewed.filter((delivery) => delivery.review.usefulness === "not_useful").length, unclearDeliveries: reviewed.filter((delivery) => delivery.review.usefulness === "unclear").length, decisionChanges: reviewed.filter((delivery) => ["changed_decision", "informed_decision"].includes(delivery.review.decisionImpact)).length, pilotCheckpoints: decisions.length, checkpointCounts: Object.fromEntries(["improve", "continue", "expand", "stop"].map((decision) => [decision, decisions.filter((item) => item.decision === decision).length])), auditedPilotActions: auditEntries.filter((entry) => ["configure_pilot", "review_pilot_delivery", "decide_pilot"].includes(entry.action)).length, openAlerts: alerts.filter((alert) => alert.state === "open").length, falseAlerts: alerts.filter((alert) => alert.resolutionDisposition === "false_positive").length, alertCorrections: alerts.filter((alert) => alert.resolutionDisposition === "needs_correction").length },
    operations: { latestRefreshStatus: refreshHistory.at(-1)?.status ?? "not_run", failedRefreshRuns: failedRuns.length, lastRefreshAt: refreshHistory.at(-1)?.endedAt ?? null, sourceCount: sourceScan.sources?.length ?? 0, staleSources, oldestSourceAgeMs: sourceAges.length ? Math.max(...sourceAges.map((source) => source.ageMs)) : null, delayedDeliveries, falseAlertRate },
    thresholds: { maxSourceAgeMs, maxFalseAlertRate, maxFailedRefreshes, maxDelayedDeliveries, warningAckSlaMs },
    warnings: warningLifecycle,
    deliveryHealth: buildOperatorDeliveryHealth({ notifications, attempts: notificationAttempts }),
    trend,
    workspaces: summaries,
    limitation: "This operator view contains aggregate pilot health only. It intentionally excludes customer questions, review notes, source details, and private workspace content. Counts describe recorded activity, not general product-market fit or causation."
  };
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

async function readinessReport() {
  const now = Date.now();
  const refresh = await readJson(refreshPath, { status: "not_run", steps: [] });
  const sourceScan = await readJson(sourceScanPath, { counts: {}, sources: [] });
  const backupManifest = backupDir ? await readJson(resolve(backupDir, "manifest.json"), undefined) : undefined;
  const refreshAge = ageMs(refresh.endedAt, now);
  const sourceTimes = (sourceScan.sources ?? []).map((source) => ageMs(source.checkedAt, now)).filter((value) => value !== null);
  const sourceAge = sourceTimes.length ? Math.max(...sourceTimes) : null;
  const failedSteps = (refresh.steps ?? []).filter((step) => step.status === "failed").map((step) => step.name);
  const syncStep = (refresh.steps ?? []).find((step) => step.name === "sync-runtime-store");
  const database = store.health();
  const checks = {
    database: { status: database.integrity === "ok" ? "ok" : "failed", integrity: database.integrity },
    refresh: { status: refresh.status === "complete" && refreshAge !== null && refreshAge <= maxRefreshAgeMs && failedSteps.length === 0 ? "ok" : "failed", runId: refresh.runId ?? null, ageMs: refreshAge, maxAgeMs: maxRefreshAgeMs, failedSteps },
    sourceScan: { status: sourceScan.counts?.missing === 0 && sourceAge !== null && sourceAge <= maxSourceAgeMs ? "ok" : "failed", ageMs: sourceAge, maxAgeMs: maxSourceAgeMs, missing: sourceScan.counts?.missing ?? null, sourceCount: sourceScan.sources?.length ?? 0 },
    runtimeSync: { status: syncStep?.status === "complete" ? "ok" : "failed", attempts: syncStep?.attempts ?? null },
    backup: backupDir ? { status: backupManifest?.schemaVersion === "runtime-backup-v1" ? "ok" : "failed", createdAt: backupManifest?.createdAt ?? null, ageMs: ageMs(backupManifest?.createdAt, now), directory: backupDir } : { status: "not_configured", createdAt: null, ageMs: null }
  };
  const ready = Object.values(checks).every((check) => check.status === "ok");
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
      if (briefing.state === "stale" && body.confirmUpdatedEvidence !== true) return json(response, 409, { error: "This briefing is stale. Inspect the updated evidence and confirm it before republishing." });
      const now = new Date().toISOString();
      const publication = { id: `publication-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, briefingId, workspaceId: workspace.id, evidenceDigest: briefing.evidenceDigest, publishedBy: member.id, publishedRole: member.role, publishedAt: now, note: String(body.note ?? "").slice(0, 2000), ...(briefing.state === "stale" ? { reReviewedUpdatedEvidence: true, previousEvidenceDigest: briefing.previousEvidenceDigest ?? null } : {}) };
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
      const outcome = { id: `decision-outcome-${randomUUID()}`, workspaceId: workspace.id, briefingId: briefing.id, questionId: briefing.questionId ?? null, evidenceDigest: briefing.evidenceDigest ?? null, recordedBy: member.id, recordedRole: member.role, decisionState, outcomeState, decisionSummary: String(body.decisionSummary ?? "").trim().slice(0, 2000), outcomeNote: String(body.outcomeNote ?? "").trim().slice(0, 2000), recordedAt: now, reviewAt: body.reviewAt ? String(body.reviewAt).slice(0, 32) : null };
      store.commitRecord({ kind: "decision_outcome", record: outcome, audit: { requestId, action: "record_decision_outcome", targetId: briefing.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: outcome.outcomeState, occurredAt: now }, operation: { key: idempotencyKey, action: "record_decision_outcome", status: 201, body: outcome, completedAt: now } });
      await writeFile(decisionOutcomesPath, `${JSON.stringify(store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes"), null, 2)}\n`);
      store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "decision_outcome", targetId: briefing.id, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, outcome: outcome.outcomeState, decisionState: outcome.decisionState, occurredAt: now, decisionOutcomeId: outcome.id }]);
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
      const decision = { id: `insight-decision-${randomUUID()}`, candidateKey: candidate.candidateKey, candidateId, evidenceDigest: candidate.evidenceDigest, reviewer: member.id, reviewerRole: member.role, decision: body.decision, note: String(body.note ?? "").slice(0, 2000), decidedAt: new Date().toISOString(), publication: "not_published" };
      if (wasStale) decision.previousEvidenceDigest = candidate.previousEvidenceDigest ?? null;
      store.commitRecord({ kind: "insight_decision", record: decision, audit: { requestId, action: "decide_insight", targetId: candidate.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: decision.decision, occurredAt: decision.decidedAt }, operation: { key: idempotencyKey, action: "decide_insight", status: 200, body: decision, completedAt: decision.decidedAt } });
      await writeFile(insightDecisionsPath, `${JSON.stringify(store.recordsLedger("insight_decision", "insight-decision-ledger-v1", "decisions"), null, 2)}\n`);
      if (wasStale) {
        store.syncRecords("review_event", [{ id: `review-event-${randomUUID()}`, eventType: "insight_re_review", reviewType: "re_review", targetId: candidate.id, candidateKey: candidate.candidateKey, workspaceId: workspace.id, reviewer: member.id, reviewerRole: member.role, previousEvidenceDigest: decision.previousEvidenceDigest, currentEvidenceDigest: decision.evidenceDigest, outcome: decision.decision, occurredAt: decision.decidedAt, decisionId: decision.id }]);
        await writeReviewEvents();
      }
      return json(response, 200, decision);
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
      const publication = { id: `insight-publication-${randomUUID()}`, candidateKey: candidate.candidateKey, candidateId, workspaceId: workspace.id, evidenceDigest: candidate.evidenceDigest, publisher: member.id, publisherRole: member.role, publishedAt: new Date().toISOString(), note: String(body.note ?? "").slice(0, 2000) };
      store.commitRecord({ kind: "insight_publication", record: publication, audit: { requestId, action: "publish_insight", targetId: candidate.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "published", occurredAt: publication.publishedAt }, operation: { key: idempotencyKey, action: "publish_insight", status: 200, body: publication, completedAt: publication.publishedAt } });
      await writeFile(insightPublicationsPath, `${JSON.stringify(store.recordsLedger("insight_publication", "insight-publication-ledger-v1", "publications"), null, 2)}\n`);
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
      const allowedUsefulness = ["useful", "not_useful", "unclear"];
      const allowedImpact = ["changed_decision", "informed_decision", "no_change", "not_applicable"];
      if (!allowedUsefulness.includes(usefulness)) return json(response, 400, { error: "Usefulness must be useful, not_useful, or unclear." });
      if (!allowedImpact.includes(decisionImpact)) return json(response, 400, { error: "Decision impact is invalid." });
      if (!note) return json(response, 400, { error: "A review note is required." });
      const assessments = Array.isArray(body.measureAssessments) ? body.measureAssessments.map((assessment) => ({ name: String(assessment.name ?? "").trim().slice(0, 200), state: String(assessment.state ?? "unknown"), note: String(assessment.note ?? "").trim().slice(0, 500) })).filter((assessment) => assessment.name) : [];
      if (assessments.some((assessment) => !["met", "partially_met", "not_met", "unknown"].includes(assessment.state))) return json(response, 400, { error: "Each measure assessment must be met, partially_met, not_met, or unknown." });
      const now = new Date().toISOString();
      const review = { id: `pilot-delivery-review-${randomUUID()}`, deliveryId, workspaceId: workspace.id, reviewedBy: member.id, reviewedRole: member.role, usefulness, decisionImpact, note, measureAssessments: assessments, reviewedAt: now };
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
    if (request.method === "POST" && url.pathname.startsWith("/api/operator/warnings/") && url.pathname.endsWith("/state")) {
      const warningId = decodeURIComponent(url.pathname.slice("/api/operator/warnings/".length, -"/state".length));
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const body = await requestBody(request);
      const idempotencyKey = request.headers["idempotency-key"];
      if (!idempotencyKey) return json(response, 400, { error: "Idempotency-Key is required for operator writes." });
      const prior = await replayOperation(idempotencyKey);
      if (prior) return json(response, prior.status, prior.body);
      if (!["refresh-failures", "source-freshness", "false-alert-rate", "delivery-delay"].includes(warningId)) return json(response, 400, { error: "Unknown operator warning." });
      const state = String(body.state ?? "");
      const note = String(body.note ?? "").trim().slice(0, 2000);
      const ownerId = String(body.ownerId ?? "").trim().slice(0, 120) || operator.actorId;
      const escalationState = String(body.escalationState ?? "normal");
      if (!["acknowledged", "resolved"].includes(state)) return json(response, 400, { error: "Warning state must be acknowledged or resolved." });
      if (!["normal", "escalated"].includes(escalationState)) return json(response, 400, { error: "Escalation state must be normal or escalated." });
      if (!note) return json(response, 400, { error: "A note is required." });
      const now = new Date().toISOString();
      const warningObservation = { "refresh-failures": null, "source-freshness": null, "false-alert-rate": null, "delivery-delay": null }[warningId];
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
          publishedAt: briefing.publishedAt ?? null
        },
        evidence: briefing.evidence ?? []
      };
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${briefing.id}.json"`, "Cache-Control": "no-store" });
      return response.end(JSON.stringify(artifact, null, 2));
    }
    if (request.method !== "GET") return json(response, 405, { error: "This method is not supported for this endpoint." });
    if (url.pathname === "/api/health") return json(response, 200, { status: "ok", service: "change-intelligence-read-model", authMode, database: store.health(), generatedAt: new Date().toISOString() });
    if (url.pathname === "/api/readiness") {
      const report = await readinessReport();
      return json(response, report.status === "ready" ? 200 : 503, report);
    }
    if (url.pathname === "/api/operations") {
      const readiness = await readinessReport();
      const refresh = await readJson(refreshPath, { status: "not_run", steps: [] });
      const history = await readJson(refreshHistoryPath, { schemaVersion: "refresh-history-v1", runs: [] });
      const sourceScan = await readJson(sourceScanPath, { counts: {}, sources: [] });
      return json(response, 200, { schemaVersion: "operations-read-model-v1", generatedAt: new Date().toISOString(), readiness, refresh, refreshHistory: history.runs ?? [], sourceScan: { counts: sourceScan.counts, sourceCount: sourceScan.sources?.length ?? 0 }, database: store.health() });
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
      const briefingLedger = await readJson(briefingsPath, { briefings: [] });
      const briefings = briefingLedger.briefings.filter((briefing) => !access.workspaceIds || access.workspaceIds.includes(briefing.workspaceId));
      return json(response, 200, buildPilotMetrics({ workspaceId: access.workspaceId, auditEntries: entries, alerts, outcomes, briefings }));
    }
    if (url.pathname === "/api/workspace-update") {
      const workspaceId = url.searchParams.get("workspace");
      const access = await workspaceAccess(request, workspaceId);
      if (denyWorkspaceRead(response, access)) return;
      const workspace = workspaceId ? await workspaceConfig(workspaceId) : null;
      const entries = store.auditLedger().entries.filter((entry) => !access.workspaceIds || access.workspaceIds.includes(entry.workspaceId));
      const alerts = store.alertsLedger().alerts.filter((alert) => !access.workspaceIds || access.workspaceIds.includes(alert.workspaceId));
      const outcomes = store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes").outcomes.filter((outcome) => !access.workspaceIds || access.workspaceIds.includes(outcome.workspaceId));
      const questions = store.questionsLedger().questions.filter((question) => !access.workspaceIds || access.workspaceIds.includes(question.workspaceId));
      const briefingLedger = await readJson(briefingsPath, { briefings: [] });
      const briefings = briefingLedger.briefings.filter((briefing) => !access.workspaceIds || access.workspaceIds.includes(briefing.workspaceId));
      const packet = await readJson(packetPath, { domain: null, sourceSnapshotDate: null, records: [], insights: [] });
      const registry = await readJson(sourceRegistryPath, { repositories: [] });
      const refresh = await readJson(refreshPath, { status: "not_run", steps: [] });
      const coverage = buildCoverage(packet, registry);
      const readiness = await readinessReport();
      const metrics = buildPilotMetrics({ workspaceId: access.workspaceId, auditEntries: entries, alerts, outcomes, briefings });
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
      const learning = buildPilotLearningReport({ workspaceId: access.workspaceId, profile, deliveries, decisions });
      const deliveryHealth = buildWorkspaceDeliveryHealth({ workspaceId: access.workspaceId, notifications, attempts });
      return json(response, 200, buildWorkspaceServiceReport({ workspaceId: access.workspaceId, profile, deliveries, learning, deliveryHealth }));
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
    if (url.pathname === "/api/coverage") {
      const packet = await readJson(packetPath, { domain: null, sourceSnapshotDate: null, records: [] });
      const registry = await readJson(sourceRegistryPath, { repositories: [] });
      return json(response, 200, buildCoverage(packet, registry));
    }
    if (url.pathname === "/api/packet") return json(response, 200, publicPacket(await readJson(packetPath, { error: "Packet has not been built." })));
    if (url.pathname.startsWith("/api/evidence/")) {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const recordId = decodeURIComponent(url.pathname.slice("/api/evidence/".length));
      const packet = await readJson(packetPath, { records: [], insights: [] });
      const record = packet.records.find((candidate) => candidate.id === recordId);
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
      const candidate = packet.operations?.insightCandidates?.candidates?.find((item) => item.candidateKey === insight.id || item.id === insight.id);
      return json(response, 200, {
        schemaVersion: "insight-inspection-v1",
        insight,
        evidence: (insight.recordIds ?? []).map((recordId) => recordsById.get(recordId)).filter(Boolean),
        candidate: candidate ?? null,
        review: candidate ? { status: candidate.status, publication: candidate.publication, evidenceDigest: candidate.evidenceDigest } : null,
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
      const sourceHistory = await readJson(sourceScanHistoryPath, { runs: [] });
      const sourceRuns = sourceHistory.runs?.length ? sourceHistory.runs : [{ runId: null, sources: sourceSnapshots }];
      const allEvents = [
        ...sourceRuns.flatMap((run) => (run.sources ?? []).map((snapshot) => ({ eventType: "source_scan", targetId: snapshot.id, sourceId: snapshot.id, scanRunId: run.runId, status: snapshot.status, previousDigest: snapshot.previousSha256 ?? null, currentDigest: snapshot.sha256 ?? null, occurredAt: snapshot.checkedAt }))),
        ...reviewEvents,
        ...briefingPublications.map((publication) => ({ eventType: "briefing_publish", targetId: publication.briefingId, workspaceId: publication.workspaceId, reviewer: publication.publishedBy, currentEvidenceDigest: publication.evidenceDigest, occurredAt: publication.publishedAt, publicationId: publication.id })),
        ...insightPublications.map((publication) => ({ eventType: "insight_publish", targetId: publication.candidateId, candidateKey: publication.candidateKey, workspaceId: publication.workspaceId, reviewer: publication.publisher, currentEvidenceDigest: publication.evidenceDigest, occurredAt: publication.publishedAt, publicationId: publication.id })),
        ...decisionOutcomes.map((outcome) => ({ eventType: "decision_outcome", targetId: outcome.briefingId, workspaceId: outcome.workspaceId, reviewer: outcome.recordedBy, status: outcome.outcomeState, decisionState: outcome.decisionState, occurredAt: outcome.recordedAt, decisionOutcomeId: outcome.id }))
      ];
      const visible = (event) => !event.workspaceId || !access.workspaceIds || access.workspaceIds.includes(event.workspaceId);
      const events = allEvents.filter(visible).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
      return json(response, 200, { schemaVersion: "research-timeline-v1", eventCount: events.length, events });
    }
    if (url.pathname === "/api/refresh") return json(response, 200, await readJson(refreshPath, { schemaVersion: "refresh-receipt-v1", status: "not_run", steps: [] }));
    if (url.pathname === "/api/workspaces") {
      const access = await workspaceAccess(request);
      if (denyWorkspaceRead(response, access)) return;
      const configs = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
      const workspaces = [];
      for (const file of configs) {
        const workspace = JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"));
        if (!access.workspaceIds || access.workspaceIds.includes(workspace.id)) workspaces.push({ id: workspace.id, name: workspace.name, memberCount: workspace.members?.length ?? 0 });
      }
      return json(response, 200, workspaces);
    }
    if (url.pathname === "/api/workspace-pilot") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      return json(response, 200, { schemaVersion: "workspace-pilot-read-model-v1", workspaceId: access.workspaceId, profile: access.workspaceIds ? profiles.find((profile) => access.workspaceIds.includes(profile.workspaceId)) ?? null : profiles });
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
      return json(response, 200, buildPilotLearningReport({ workspaceId: access.workspaceId, profile, deliveries: visible, decisions }));
    }
    if (url.pathname === "/api/operator/notifications") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const attempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      return json(response, 200, { schemaVersion: "operator-notification-outbox-v1", notifications: store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications.map(({ body, ...notification }) => ({ ...notification, attemptHistory: attempts.filter((attempt) => attempt.notificationId === notification.id) })) });
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
    if (url.pathname === "/api/operator/pilot-overview") {
      const operator = operatorAccess(request);
      if (operator.error) return json(response, operator.error.status, operator.error.body);
      const workspaceFiles = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
      const workspaces = await Promise.all(workspaceFiles.map(async (file) => {
        const workspace = JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"));
        return { id: workspace.id, name: workspace.name };
      }));
      const profiles = store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles").profiles;
      const deliveries = store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries").deliveries;
      const decisions = store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions").decisions;
      const alerts = store.alertsLedger().alerts;
      const refreshHistory = (await readJson(refreshHistoryPath, { runs: [] })).runs ?? [];
      const sourceScan = await readJson(sourceScanPath, { sources: [] });
      const sourceScanHistory = await readJson(sourceScanHistoryPath, { runs: [] });
      const warningEvents = store.recordsLedger("operator_warning", "operator-warning-event-ledger-v1", "events").events;
      const notifications = store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications").notifications;
      const notificationAttempts = store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts").attempts;
      return json(response, 200, buildOperatorPilotOverview({ workspaces, profiles, deliveries, decisions, auditEntries: store.auditLedger().entries, refreshHistory, sourceScan, sourceScanHistory, alerts, warningEvents, notifications, notificationAttempts, maxSourceAgeMs, maxFalseAlertRate, maxFailedRefreshes, maxDelayedDeliveries, warningAckSlaMs: operatorWarningAckSlaMs }));
    }
    if (url.pathname === "/api/watchlists") {
      const access = await workspaceAccess(request, url.searchParams.get("workspace"));
      if (denyWorkspaceRead(response, access)) return;
      const watchlists = store.recordsLedger("watchlist", "workspace-watchlist-ledger-v1", "watchlists").watchlists;
      return json(response, 200, access.workspaceIds ? watchlists.filter((watchlist) => access.workspaceIds.includes(watchlist.workspaceId)) : watchlists);
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
