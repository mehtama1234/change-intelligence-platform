import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT ?? 8780);
const packetPath = resolve(root, "data/processed/ai-work-control.packet.json");
const reviewPath = resolve(root, "data/processed/runs/ai-work-control/latest-review-work.json");
const historyPath = resolve(root, "data/processed/runs/ai-work-control/versioned-evidence-ledger.json");
const refreshPath = resolve(root, "data/processed/runs/ai-work-control/latest-refresh.json");
const alertsPath = resolve(root, "data/processed/runs/ai-work-control/workspace-alerts.json");
const questionsPath = resolve(root, "data/processed/runs/ai-work-control/workspace-questions.json");
const questionEvaluationsPath = resolve(root, "data/processed/runs/ai-work-control/question-evaluations.json");
const briefingsPath = resolve(root, "data/processed/runs/ai-work-control/workspace-briefings.json");
const briefingPublicationsPath = resolve(root, "data/processed/runs/ai-work-control/briefing-publications.json");
const insightDecisionsPath = resolve(root, "data/processed/runs/ai-work-control/insight-decisions.json");
const insightCandidatesPath = resolve(root, "data/processed/runs/ai-work-control/insight-candidates.json");
const insightPublicationsPath = resolve(root, "data/processed/runs/ai-work-control/insight-publications.json");
const workspaceDir = resolve(root, "data/fixtures/workspaces");
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const json = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

async function requestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) throw Object.assign(new Error("Request body is too large."), { code: "PAYLOAD_TOO_LARGE" });
  }
  return body ? JSON.parse(body) : {};
}

async function workspaceConfig(id) {
  const files = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    const workspace = JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"));
    if (workspace.id === id) return workspace;
  }
  return undefined;
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "POST" && url.pathname.startsWith("/api/alerts/") && url.pathname.endsWith("/acknowledge")) {
      const alertId = decodeURIComponent(url.pathname.slice("/api/alerts/".length, -"/acknowledge".length));
      const body = await requestBody(request);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === body.actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot acknowledge alerts." });
      const ledger = await readJson(alertsPath, { schemaVersion: "workspace-alert-ledger-v1", alerts: [] });
      const alert = ledger.alerts.find((candidate) => candidate.id === alertId && candidate.workspaceId === workspace.id);
      if (!alert) return json(response, 404, { error: "Alert not found in this workspace." });
      alert.state = "acknowledged";
      alert.acknowledgedBy = member.id;
      alert.acknowledgedRole = member.role;
      alert.acknowledgedAt = new Date().toISOString();
      alert.acknowledgmentNote = String(body.note ?? "").slice(0, 2000);
      await writeFile(alertsPath, `${JSON.stringify(ledger, null, 2)}\n`);
      return json(response, 200, alert);
    }
    if (request.method === "POST" && url.pathname === "/api/questions") {
      const body = await requestBody(request);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === body.actorId);
      const question = String(body.question ?? "").trim();
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot save questions." });
      if (question.length < 8 || question.length > 500) return json(response, 400, { error: "Question must be between 8 and 500 characters." });
      const ledger = await readJson(questionsPath, { schemaVersion: "workspace-question-ledger-v1", questions: [] });
      const now = new Date().toISOString();
      const saved = { id: `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, workspaceId: workspace.id, question, scope: body.scope ?? { watchlistIds: [] }, state: "active", createdBy: member.id, createdRole: member.role, createdAt: now, updatedAt: now, lastEvaluatedAt: null };
      ledger.questions.push(saved);
      ledger.updatedAt = now;
      await writeFile(questionsPath, `${JSON.stringify(ledger, null, 2)}\n`);
      return json(response, 201, saved);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/briefings/") && url.pathname.endsWith("/publish")) {
      const briefingId = decodeURIComponent(url.pathname.slice("/api/briefings/".length, -"/publish".length));
      const body = await requestBody(request);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === body.actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot publish briefings." });
      const ledger = await readJson(briefingsPath, { schemaVersion: "workspace-briefing-ledger-v1", briefings: [] });
      const briefing = ledger.briefings.find((candidate) => candidate.id === briefingId && candidate.workspaceId === workspace.id);
      if (!briefing) return json(response, 404, { error: "Briefing not found in this workspace." });
      const publications = await readJson(briefingPublicationsPath, { schemaVersion: "briefing-publication-ledger-v1", publications: [] });
      const now = new Date().toISOString();
      const publication = { id: `publication-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, briefingId, workspaceId: workspace.id, evidenceDigest: briefing.evidenceDigest, publishedBy: member.id, publishedRole: member.role, publishedAt: now, note: String(body.note ?? "").slice(0, 2000) };
      publications.publications.push(publication);
      publications.updatedAt = now;
      briefing.state = "published";
      briefing.publication = "published";
      briefing.publicationId = publication.id;
      briefing.publishedBy = member.id;
      briefing.publishedAt = now;
      await writeFile(briefingsPath, `${JSON.stringify(ledger, null, 2)}\n`);
      await writeFile(briefingPublicationsPath, `${JSON.stringify(publications, null, 2)}\n`);
      return json(response, 200, { ...briefing, publication });
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/insight-candidates/") && url.pathname.endsWith("/decision")) {
      const candidateId = decodeURIComponent(url.pathname.slice("/api/insight-candidates/".length, -"/decision".length));
      const body = await requestBody(request);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === body.actorId);
      const allowedDecisions = new Set(["accept", "defer", "reject", "correct"]);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot review insights." });
      if (!allowedDecisions.has(body.decision)) return json(response, 400, { error: "Decision must be accept, defer, reject, or correct." });
      if (["reject", "correct"].includes(body.decision) && !String(body.note ?? "").trim()) return json(response, 400, { error: "Reject and correction decisions require a note." });
      const candidates = await readJson(insightCandidatesPath, { candidates: [] });
      const candidate = candidates.candidates.find((item) => item.id === candidateId);
      if (!candidate) return json(response, 404, { error: "Insight candidate not found." });
      const ledger = await readJson(insightDecisionsPath, { schemaVersion: "insight-decision-ledger-v1", decisions: [] });
      const decision = { id: `insight-decision-${randomUUID()}`, candidateKey: candidate.candidateKey, candidateId, evidenceDigest: candidate.evidenceDigest, reviewer: member.id, reviewerRole: member.role, decision: body.decision, note: String(body.note ?? "").slice(0, 2000), decidedAt: new Date().toISOString(), publication: "not_published" };
      ledger.decisions.push(decision);
      ledger.updatedAt = decision.decidedAt;
      await writeFile(insightDecisionsPath, `${JSON.stringify(ledger, null, 2)}\n`);
      return json(response, 200, decision);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/insight-candidates/") && url.pathname.endsWith("/publish")) {
      const candidateId = decodeURIComponent(url.pathname.slice("/api/insight-candidates/".length, -"/publish".length));
      const body = await requestBody(request);
      const workspace = await workspaceConfig(body.workspaceId);
      const member = workspace?.members?.find((candidate) => candidate.id === body.actorId);
      if (!workspace) return json(response, 404, { error: "Workspace not found." });
      if (!member || !["owner", "researcher"].includes(member.role)) return json(response, 403, { error: "This workspace role cannot publish insights." });
      const candidates = await readJson(insightCandidatesPath, { candidates: [] });
      const candidate = candidates.candidates.find((item) => item.id === candidateId);
      if (!candidate) return json(response, 404, { error: "Insight candidate not found." });
      if (candidate.status !== "accepted_for_publication") return json(response, 409, { error: "Insight must be accepted for publication before publishing." });
      const ledger = await readJson(insightPublicationsPath, { schemaVersion: "insight-publication-ledger-v1", publications: [] });
      const publication = { id: `insight-publication-${randomUUID()}`, candidateKey: candidate.candidateKey, candidateId, workspaceId: workspace.id, evidenceDigest: candidate.evidenceDigest, publisher: member.id, publisherRole: member.role, publishedAt: new Date().toISOString(), note: String(body.note ?? "").slice(0, 2000) };
      ledger.publications.push(publication);
      ledger.updatedAt = publication.publishedAt;
      await writeFile(insightPublicationsPath, `${JSON.stringify(ledger, null, 2)}\n`);
      return json(response, 200, publication);
    }
    if (request.method !== "GET") return json(response, 405, { error: "Only GET and alert acknowledgement POST are supported." });
    if (url.pathname === "/api/health") return json(response, 200, { status: "ok", service: "change-intelligence-read-model", generatedAt: new Date().toISOString() });
    if (url.pathname === "/api/packet") return json(response, 200, await readJson(packetPath, { error: "Packet has not been built." }));
    if (url.pathname === "/api/review-work") return json(response, 200, await readJson(reviewPath, { schemaVersion: "source-review-work-v1", reviewRequired: 0, candidates: [] }));
    if (url.pathname === "/api/evidence-history") return json(response, 200, await readJson(historyPath, { schemaVersion: "versioned-evidence-ledger-v1", records: [], decisionHistory: [] }));
    if (url.pathname === "/api/refresh") return json(response, 200, await readJson(refreshPath, { schemaVersion: "refresh-receipt-v1", status: "not_run", steps: [] }));
    if (url.pathname === "/api/workspaces") return json(response, 200, (await readJson(alertsPath, { workspaces: [] })).workspaces ?? []);
    if (url.pathname === "/api/alerts") {
      const ledger = await readJson(alertsPath, { alerts: [] });
      const workspaceId = url.searchParams.get("workspace");
      return json(response, 200, workspaceId ? ledger.alerts.filter((alert) => alert.workspaceId === workspaceId) : ledger.alerts);
    }
    if (url.pathname === "/api/questions") {
      const ledger = await readJson(questionsPath, { schemaVersion: "workspace-question-ledger-v1", questions: [] });
      const workspaceId = url.searchParams.get("workspace");
      return json(response, 200, workspaceId ? ledger.questions.filter((question) => question.workspaceId === workspaceId) : ledger.questions);
    }
    if (url.pathname === "/api/question-evaluations") {
      const ledger = await readJson(questionEvaluationsPath, { schemaVersion: "question-evaluation-ledger-v1", evaluations: [] });
      const workspaceId = url.searchParams.get("workspace");
      return json(response, 200, workspaceId ? ledger.evaluations.filter((evaluation) => evaluation.workspaceId === workspaceId) : ledger.evaluations);
    }
    if (url.pathname === "/api/briefings") {
      const ledger = await readJson(briefingsPath, { schemaVersion: "workspace-briefing-ledger-v1", briefings: [] });
      const workspaceId = url.searchParams.get("workspace");
      return json(response, 200, workspaceId ? ledger.briefings.filter((briefing) => briefing.workspaceId === workspaceId) : ledger.briefings);
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
