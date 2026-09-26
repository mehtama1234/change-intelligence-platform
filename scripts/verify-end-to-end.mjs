import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
async function json(path) { return JSON.parse(await readFile(resolve(root, path), "utf8")); }
const packet = await json("data/processed/ai-work-control.packet.json");
const scan = await json("data/processed/runs/ai-work-control/latest-source-scan.json");
const refresh = await json("data/processed/runs/ai-work-control/latest-refresh.json");
const alerts = await json("data/processed/runs/ai-work-control/workspace-alerts.json");
const evaluations = await json("data/processed/runs/ai-work-control/question-evaluations.json");
const briefings = await json("data/processed/runs/ai-work-control/workspace-briefings.json");
const insightCandidates = await json("data/processed/runs/ai-work-control/insight-candidates.json");
const insightEvaluation = await json("data/processed/runs/ai-work-control/insight-evaluation.json");
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };
const records = new Map(packet.records.map((record) => [record.id, record]));
const requiredSteps = ["capture-sec-filings", "extract-sec-xbrl", "validate-source-adapters", "scan-repositories", "evaluate-watchlists", "process-review-work", "materialize-evidence", "build-packet", "evaluate-questions", "build-question-briefings", "publish-question-evaluations", "generate-insight-candidates", "evaluate-insight-quality", "publish-insight-candidates", "evaluate-operator-warnings", "sync-runtime-store", "dispatch-operator-notifications"];

assert(packet.records.length >= 7, "packet should contain the six-repository vertical slice records");
assert(new Set(packet.records.map((record) => record.sourceRepository)).size === 6, "packet must cover all six research repositories");
assert(packet.insights.every((insight) => insight.recordIds.every((id) => records.has(id))), "insights must reference existing records");
assert(packet.insights.every((insight) => insight.whatWouldChangeOurMind?.length), "insights need explicit falsifiers");
assert(scan.repositories.length === 6 && scan.counts.missing === 0, "source scan must cover six repositories without missing sources");
assert(refresh.status === "complete", `latest refresh is ${refresh.status}, not complete`);
for (const step of requiredSteps) assert(refresh.steps.some((stepResult) => stepResult.name === step && stepResult.status === "complete"), `refresh missing completed step: ${step}`);
const report = packet.records.find((record) => record.reportWindow)?.reportWindow;
assert(report?.movementSource === "sec_xbrl", "report movement must come from direct SEC XBRL");
assert(report?.sourceRefs.captureStatus === "complete", "all direct SEC records must be captured");
assert(evaluations.evaluations.every((evaluation) => evaluation.state === "evidence_retrieved"), "question evaluations must remain evidence retrieval, not answers");
assert(briefings.briefings.every((briefing) => ["draft", "published", "stale"].includes(briefing.state)), "briefings must have an explicit publication state");
assert(insightCandidates.candidates.length === packet.insights.length, "each insight must produce one candidate");
assert(insightEvaluation.status === "pass" && insightEvaluation.evaluations.length === packet.insights.length, "insight quality evaluation must pass for every insight");
assert(insightCandidates.candidates.every((candidate) => ["needs_researcher_review", "accepted_for_publication", "published", "stale", "deferred", "rejected", "correction_required"].includes(candidate.status)), "insight candidates must have an explicit review state");
assert(insightCandidates.candidates.every((candidate) => candidate.status !== "stale" || (candidate.staleReason && candidate.previousEvidenceDigest)), "stale insights need an explanation and prior digest");
assert(insightCandidates.candidates.every((candidate) => candidate.status !== "published" || (candidate.publication === "published" && candidate.publicationId)), "published insights need a publication receipt");
for (const candidate of insightCandidates.candidates) for (const evidence of candidate.evidence) assert(records.get(evidence.recordId)?.sourceDigest === evidence.sourceDigest, `${candidate.id}: insight evidence digest does not match packet`);
for (const briefing of briefings.briefings) {
  for (const evidence of briefing.evidence) assert(records.get(evidence.recordId)?.sourceDigest === evidence.sourceDigest, `${briefing.id}: evidence digest does not match packet`);
  if (briefing.state === "published") assert(briefing.publication === "published" && briefing.publicationId, `${briefing.id}: published briefing lacks publication receipt`);
  if (briefing.state === "stale") assert(briefing.staleReason && briefing.previousEvidenceDigest, `${briefing.id}: stale briefing needs an explanation and prior digest`);
}
assert(alerts.workspaces.some((workspace) => workspace.id === "demo-research"), "workspace alert ledger must contain demo workspace");
assert(packet.operations?.workspaceAlerts, "packet must expose workspace alert read model");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`End-to-end verification passed: ${packet.records.length} records, ${scan.repositories.length} repositories, ${briefings.briefings.length} briefings, refresh ${refresh.runId}.`);
