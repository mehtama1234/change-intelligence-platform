import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore, importRuntimeLedgers } from "./storage.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT ?? 8780);
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const packetPath = resolve(root, "data/processed/ai-work-control.packet.json");
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
const auditPath = resolve(runtimeDir, "audit-log.json");
const operationsPath = resolve(runtimeDir, "idempotency-operations.json");
const sourceScanPath = resolve(runtimeDir, "latest-source-scan.json");
const evidenceLedgerPath = resolve(runtimeDir, "versioned-evidence-ledger.json");
const reviewDecisionsPath = resolve(runtimeDir, "review-decisions.json");
const workspaceDir = resolve(root, "data/fixtures/workspaces");
const authMode = process.env.AUTH_MODE ?? "demo";
const tokenActors = authMode === "token" ? JSON.parse(process.env.AUTH_TOKENS_JSON ?? "{}") : {};
const backupDir = process.env.BACKUP_DIR ? resolve(root, process.env.BACKUP_DIR) : undefined;
const maxRefreshAgeMs = Number(process.env.MAX_REFRESH_AGE_MS ?? 7 * 24 * 60 * 60 * 1000);
const maxSourceAgeMs = Number(process.env.MAX_SOURCE_AGE_MS ?? 14 * 24 * 60 * 60 * 1000);
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
  workspaceDir,
  sourceScan: sourceScanPath,
  evidenceLedger: evidenceLedgerPath,
  reviewDecisions: reviewDecisionsPath
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

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
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
      const now = new Date().toISOString();
      const publication = { id: `publication-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, briefingId, workspaceId: workspace.id, evidenceDigest: briefing.evidenceDigest, publishedBy: member.id, publishedRole: member.role, publishedAt: now, note: String(body.note ?? "").slice(0, 2000) };
      briefing.state = "published";
      briefing.publication = "published";
      briefing.publicationId = publication.id;
      briefing.publishedBy = member.id;
      briefing.publishedAt = now;
      await writeFile(briefingsPath, `${JSON.stringify(ledger, null, 2)}\n`);
      const publishedBriefing = { ...briefing, publication };
      store.commitRecord({ kind: "briefing_publication", record: publication, audit: { requestId, action: "publish_briefing", targetId: briefing.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: "published", occurredAt: now }, operation: { key: idempotencyKey, action: "publish_briefing", status: 200, body: publishedBriefing, completedAt: now } });
      await writeFile(briefingPublicationsPath, `${JSON.stringify(store.recordsLedger("briefing_publication", "briefing-publication-ledger-v1", "publications"), null, 2)}\n`);
      return json(response, 200, publishedBriefing);
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
      const decision = { id: `insight-decision-${randomUUID()}`, candidateKey: candidate.candidateKey, candidateId, evidenceDigest: candidate.evidenceDigest, reviewer: member.id, reviewerRole: member.role, decision: body.decision, note: String(body.note ?? "").slice(0, 2000), decidedAt: new Date().toISOString(), publication: "not_published" };
      store.commitRecord({ kind: "insight_decision", record: decision, audit: { requestId, action: "decide_insight", targetId: candidate.id, workspaceId: workspace.id, actorId: member.id, actorRole: member.role, result: decision.decision, occurredAt: decision.decidedAt }, operation: { key: idempotencyKey, action: "decide_insight", status: 200, body: decision, completedAt: decision.decidedAt } });
      await writeFile(insightDecisionsPath, `${JSON.stringify(store.recordsLedger("insight_decision", "insight-decision-ledger-v1", "decisions"), null, 2)}\n`);
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
    if (url.pathname === "/api/packet") return json(response, 200, publicPacket(await readJson(packetPath, { error: "Packet has not been built." })));
    if (url.pathname.startsWith("/api/evidence/")) {
      const recordId = decodeURIComponent(url.pathname.slice("/api/evidence/".length));
      const packet = await readJson(packetPath, { records: [], insights: [] });
      const record = packet.records.find((candidate) => candidate.id === recordId);
      if (!record) return json(response, 404, { error: "Evidence record not found." });
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
      const insightId = decodeURIComponent(url.pathname.slice("/api/insights/".length));
      const packet = await readJson(packetPath, { records: [], insights: [], operations: {} });
      const insight = packet.insights.find((candidate) => candidate.id === insightId);
      if (!insight) return json(response, 404, { error: "Insight not found." });
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
      const records = store.recordsLedger("evidence_version", "versioned-evidence-ledger-v1", "records").records;
      const decisionHistory = store.recordsLedger("review_decision", "review-decision-ledger-v1", "decisions").decisions;
      const sourceSnapshots = store.recordsLedger("source_scan", "source-snapshot-ledger-v1", "sources").sources;
      return json(response, 200, { schemaVersion: "versioned-evidence-ledger-v1", activeResearchRecordCount: records.length, decisionCount: decisionHistory.length, records, decisionHistory, sourceSnapshots });
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
