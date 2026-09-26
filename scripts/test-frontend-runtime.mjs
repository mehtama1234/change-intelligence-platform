import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const source = await readFile(resolve(root, "web/app.js"), "utf8");

class Element {
  constructor(id = "dynamic") {
    this.id = id;
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.options = [];
    this.selectedOptions = [];
  }
  addEventListener() {}
  dispatchEvent() {}
  scrollIntoView() {}
  querySelector() { return new Element("nested"); }
  querySelectorAll() { return []; }
  closest() { return this; }
  append() {}
}

const elementIds = [...source.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);
const elements = new Map(elementIds.map((id) => [id, new Element(id)]));
const document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return new Element(); }
};

const currentDelivery = {
  id: "delivery-current",
  status: "held_for_review",
  generatedAt: "2026-09-26T12:00:00.000Z",
  refreshRunId: "refresh-current",
  cadence: "monthly",
  headline: "1 briefing includes changed insight evidence and requires re-review.",
  evaluation: { reason: "This delivery is held until the updated evidence is reviewed." },
  insightActions: [],
  briefings: [{ id: "briefing-current", title: "What evidence links AI adoption to productivity and worker control?", state: "stale", publication: "needs_republish", staleReason: "The source evidence changed after this briefing was published.", customerActions: ["Open the changed evidence and republish only after review."], insightProvenance: [] }],
  insightProvenance: [],
  impact: { state: "no_open_source_availability_issue", unavailableSources: [], recoveredSources: [] },
  successMeasures: [],
  review: null
};
const oldDelivery = { ...currentDelivery, id: "delivery-old", generatedAt: "2026-09-25T12:00:00.000Z", status: "prepared", headline: "An older handoff is ready for review.", briefings: [{ ...currentDelivery.briefings[0], state: "published", publication: "published", staleReason: null, customerActions: [] }] };

const readiness = { status: "ready", checks: { refresh: { status: "ready" }, sourceScan: { status: "ready" }, runtimeSync: { status: "ready" }, backup: { status: "ready" } } };
const operations = { readiness, refresh: { runId: "refresh-current", status: "complete", endedAt: "2026-09-26T12:00:00.000Z", scope: { dueRepositories: [], deferredRepositories: [] } }, sourceAvailability: { counts: { unavailable: 0 } }, scheduler: { status: "not_started" }, refreshHistory: [] };
const pilotMetrics = { measures: { usefulAlerts: 0, alertsResolved: 0, falseAlerts: 0, medianAlertResponseMs: null, briefingsExported: 0, decisionFeedbackRecords: 0, decisionsUsingBriefings: 0, publishedInsightReceiptsUsed: 0, decisionOutcomesWithInsights: 0, knownDecisionResults: 0, readingsHeld: 0, readingsChanged: 0, readingsWrong: 0 }, interpretation: "Recorded workspace experience only." };
const payloads = new Map([
  ["/api/workspaces", [{ id: "demo-research", name: "Demo research" }]],
  ["/api/change-intelligence", { summary: { total: 0, downstreamItemsNeedingReview: 0 }, runId: "refresh-current", scope: { explanation: "All sources" }, limitation: "Bounded feed.", items: [] }],
  ["/api/operations", operations],
  ["/api/usage", { measures: { questionsSaved: 1, sourceReviews: 0, briefingsExported: 0, decisionFeedbackRecords: 0, decisionsUsingBriefings: 0, alertsResolved: 0, falseAlerts: 0, watchlistsCreated: 1, publishedInsightReceiptsUsed: 0, decisionOutcomesWithInsights: 0 } }],
  ["/api/pilot-metrics", pilotMetrics],
  ["/api/workspace-update", { freshness: { readiness: "ready", refreshStatus: "complete" }, headline: "Current handoff", limitation: "Bounded.", actions: [], changes: [] }],
  ["/api/workspace-delivery-health", { summary: { pending: 0, deadLetters: 0, notifications: 0, attempts: 0, retries: 0, successRate: null, averageLatencyMs: null }, limitation: "Transport only." }],
  ["/api/workspace-service-report", { status: "on_track", serviceLevel: { overdue: false, cadence: "monthly", nextExpectedAt: null }, observations: { reviewedDeliveries: 0, measures: [] }, limitation: "Recorded service state." }],
  ["/api/workspace-commercial-readiness", { recommendation: "continue", rationale: "Collect more observations.", limitation: "Human decision required.", history: [] }],
  ["/api/workspace-pilot", { profile: { status: "active", decisionQuestion: "What evidence links AI adoption to productivity and worker control?", cadence: "monthly", nextReviewAt: "2026-10-31", successMeasures: [] } }],
  ["/api/pilot-deliveries", { deliveries: [oldDelivery, currentDelivery] }],
  ["/api/pilot-report", { observation: { reviewedDeliveries: 0 }, usefulness: { rate: null }, decisionImpact: { changedDecision: 0, informedDecision: 0, noChange: 0 }, insightFeedback: { publishedReceiptsReferenced: 0, outcomesWithInsights: 0, byReceipt: [] }, checkpoint: { explanation: "More observations needed." }, limitation: "Recorded pilot only.", measures: [], openIssues: [], decisionHistory: [] }],
  ["/api/workspace-retention", { counts: {}, canDelete: false, warning: "No private records." }],
  ["/api/workspace-onboarding", { status: "active", nextAction: "Review the handoff.", limitation: "Configuration only.", steps: [] }],
  ["/api/workspace-schedule", { status: "first_delivery_ready", explanation: "A handoff exists.", nextScheduledAt: null }],
  ["/api/questions", [{ id: "question-current", question: currentDelivery.briefings[0].title, state: "active", createdBy: "researcher", createdAt: "2026-09-25T12:00:00.000Z", lastEvaluatedAt: "2026-09-26T12:00:00.000Z" }]],
  ["/api/question-evaluations", [{ questionId: "question-current", state: "evidence_retrieved", matchedRecordIds: ["record-current"], limitation: "Evidence is bounded." }]],
  ["/api/briefings", [{ id: "briefing-current", workspaceId: "demo-research", questionId: "question-current", title: currentDelivery.briefings[0].title, state: "stale", publication: "needs_republish", reading: "Updated evidence requires review.", boundary: "Bounded.", nextTest: "Review the changed source.", evidence: [], staleReason: currentDelivery.briefings[0].staleReason, customerActions: currentDelivery.briefings[0].customerActions }]],
  ["/api/decision-outcomes", []],
  ["/api/watchlists", []],
  ["/api/comparison-views", []],
  ["/api/notification-preferences", { preferences: {} }],
  ["/api/workspace-notifications", { alerts: [] }],
  ["/api/workspace-delivery-notifications", { notifications: [] }],
  ["/api/workspace-sources", { sources: [], canSubmit: false, canReview: false }],
  ["/api/alerts", []],
  ["/api/coverage", { summary: { ready: 0, partial: 0, missing: 0 }, requirements: [], reportWindows: [], outcomeBridges: [] }],
  ["/api/atlas", { sourceRecordCount: 1, edges: [], sourceSnapshotDate: "2026-09-26", entities: { themes: [], mechanisms: [], companies: [], industries: [], affectedGroups: [], repositories: [] } }],
  ["/api/ingestion", { repositories: [] }],
  ["/api/evidence-history", { activeResearchRecordCount: 1, decisionCount: 0 }],
  ["/api/timeline", { eventCount: 0, events: [], impactSummary: {}, impactChains: [] }],
  ["/api/operator/pilot-overview", { remediation: { summary: {}, queue: [], slaMs: 0 } }],
  ["/api/packet", { sourceSnapshotDate: "2026-09-26", records: [], insights: [], operations: { insightCandidates: { candidates: [] }, insightOpportunities: { opportunities: [] } } }]
]);

function responseFor(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(data), blob: async () => new Blob([JSON.stringify(data)]) };
}
async function fetchMock(input) {
  const path = new URL(String(input), "http://frontend.test/").pathname;
  if (path === "/api/insights/insight-ai-capability-control-gap-001") return responseFor({}, 404);
  const key = [...payloads.keys()].find((candidate) => path === candidate || path.startsWith(`${candidate}/`));
  return responseFor(payloads.get(key) ?? {}, key ? 200 : 404);
}

const context = {
  console, document, fetch: fetchMock, Headers, FormData, Blob, URL, crypto: { randomUUID },
  Event: class Event {}, sessionStorage: { getItem: () => "", setItem() {}, removeItem() {} },
  window: { prompt: () => null }, setTimeout, clearTimeout
};
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "web/app.js" });
await new Promise((resolveWait) => setTimeout(resolveWait, 250));

const deliveryHtml = elements.get("pilot-delivery").innerHTML;
const questionsHtml = elements.get("questions-items").innerHTML;
if (!deliveryHtml.includes("held_for_review") || !deliveryHtml.includes("Briefings in this handoff") || !deliveryHtml.includes("The source evidence changed after this briefing was published.") || !deliveryHtml.includes("Inspect briefing evidence and history")) throw new Error(`Frontend did not render the latest stale briefing state and action: ${deliveryHtml}`);
if (!questionsHtml.includes("stale") || !questionsHtml.includes("Republish after reviewing updated evidence")) throw new Error(`Question surface did not render stale briefing recovery controls: ${questionsHtml}`);
console.log("Frontend runtime acceptance passed: the real app rendered the newest held delivery, stale briefing reason, customer action, and inspection control.");
