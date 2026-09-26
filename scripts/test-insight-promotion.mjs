import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRuntime = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-promotion-"));
const packetPath = resolve(runtimeDir, "packet.json");
const port = 8797;
const base = `http://127.0.0.1:${port}`;
await mkdir(runtimeDir, { recursive: true });
for (const name of ["audit-log.json", "idempotency-operations.json", "review-events.json"]) await copyFile(resolve(sourceRuntime, name), resolve(runtimeDir, name));
const opportunity = JSON.parse(await readFile(resolve(sourceRuntime, "insight-opportunities.json"), "utf8")).opportunities[0];
await writeFile(resolve(runtimeDir, "insight-opportunities.json"), `${JSON.stringify({ schemaVersion: "insight-opportunity-ledger-v1", opportunities: [opportunity] }, null, 2)}\n`);
await writeFile(packetPath, `${JSON.stringify(await JSON.parse(await readFile(resolve(root, "data/processed/ai-work-control.packet.json"), "utf8")), null, 2)}\n`);
const child = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, PACKET_PATH: packetPath, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "research-token": "demo-researcher", "outsider-token": "outside-user" }) }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
  await new Promise((wait) => setTimeout(wait, 100));
  if (attempt === 49) throw new Error(`API did not start. ${output}`);
}
const auth = { Authorization: "Bearer research-token", "content-type": "application/json", "Idempotency-Key": "promote-opportunity-test" };
try {
  const body = { workspaceId: "demo-research", title: "A recurring correction path needs a direct workflow test", plainLanguageSummary: "Several independent sources describe correction as a mechanism, but the current records do not establish that people receive the same remedy in practice.", strongestAlternative: "The sources may use correction language for different processes rather than one shared mechanism.", nextTest: "Trace one named workflow from decision to appeal, correction, and later result across two reporting periods.", whatWouldChangeOurMind: ["Source review shows the records refer to different populations or definitions."], note: "Promoted after rewriting the detected mechanism pattern." };
  const outsider = await fetch(`${base}/api/insight-opportunities/${encodeURIComponent(opportunity.id)}/promote`, { method: "POST", headers: { Authorization: "Bearer outsider-token", "content-type": "application/json", "Idempotency-Key": "outsider-promotion" }, body: JSON.stringify(body) });
  if (outsider.status !== 403) throw new Error(`Unauthorized opportunity promotion returned ${outsider.status}`);
  const response = await fetch(`${base}/api/insight-opportunities/${encodeURIComponent(opportunity.id)}/promote`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const promotion = await response.json();
  if (response.status !== 201 || promotion.opportunityId !== opportunity.id || promotion.insight.recordIds.length < 2) throw new Error("Opportunity promotion did not persist a bounded source-linked draft.");
  const ledger = JSON.parse(await readFile(resolve(runtimeDir, "insight-promotions.json"), "utf8"));
  const events = JSON.parse(await readFile(resolve(runtimeDir, "review-events.json"), "utf8"));
  if (!ledger.promotions.some((item) => item.id === promotion.id) || !events.events.some((event) => event.eventType === "insight_opportunity_promoted" && event.promotionId === promotion.id)) throw new Error("Promotion provenance was not durable.");
  const pipelineEnv = { ...process.env, RUNTIME_DATA_DIR: runtimeDir, PACKET_OUTPUT_PATH: packetPath, INSIGHT_PROMOTIONS_PATH: resolve(runtimeDir, "insight-promotions.json"), INSIGHT_CANDIDATES_PATH: resolve(runtimeDir, "insight-candidates.json"), INSIGHT_OUTPUT_DIR: runtimeDir, INSIGHT_PACKET_PATH: packetPath, INSIGHT_DECISIONS_PATH: resolve(runtimeDir, "insight-decisions.json"), INSIGHT_PUBLICATIONS_PATH: resolve(runtimeDir, "insight-publications.json") };
  await exec(process.execPath, [resolve(root, "scripts/build-ai-work-control-packet.mjs")], { cwd: root, env: pipelineEnv });
  const packet = JSON.parse(await readFile(packetPath, "utf8"));
  if (!packet.insights.some((insight) => insight.id === promotion.insight.id && insight.origin === "discovered_opportunity" && insight.promotionId === promotion.id)) throw new Error("Promoted insight did not enter the next packet with opportunity provenance.");
  await exec(process.execPath, [resolve(root, "scripts/generate-insight-candidates.mjs")], { cwd: root, env: pipelineEnv });
  const initialCandidate = JSON.parse(await readFile(resolve(runtimeDir, "insight-candidates.json"), "utf8")).candidates.find((candidate) => candidate.candidateKey === promotion.insight.id);
  await writeFile(resolve(runtimeDir, "insight-decisions.json"), `${JSON.stringify({ schemaVersion: "insight-decision-ledger-v1", decisions: [{ id: "old-decision", candidateKey: initialCandidate.candidateKey, evidenceDigest: initialCandidate.evidenceDigest, claimDigest: initialCandidate.claimDigest, decision: "accept", reviewer: "demo-researcher", decidedAt: "2026-09-26T10:00:00.000Z" }] }, null, 2)}\n`);
  await writeFile(resolve(runtimeDir, "insight-publications.json"), `${JSON.stringify({ schemaVersion: "insight-publication-ledger-v1", publications: [{ id: "old-publication", candidateKey: initialCandidate.candidateKey, candidateId: initialCandidate.id, workspaceId: "demo-research", evidenceDigest: initialCandidate.evidenceDigest, claimDigest: initialCandidate.claimDigest, publisher: "demo-researcher", publishedAt: "2026-09-26T10:01:00.000Z" }] }, null, 2)}\n`);
  await exec(process.execPath, [resolve(root, "scripts/generate-insight-candidates.mjs")], { cwd: root, env: pipelineEnv });
  await writeFile(resolve(runtimeDir, "workspace-questions.json"), `${JSON.stringify({ questions: [{ id: "promotion-question", workspaceId: "demo-research", state: "active", question: "What should we test?" }] }, null, 2)}\n`);
  await writeFile(resolve(runtimeDir, "question-evaluations.json"), `${JSON.stringify({ evaluations: [{ questionId: "promotion-question", workspaceId: "demo-research", matchedRecordIds: [initialCandidate.evidence[0].recordId], limitation: "Synthetic promotion provenance test." }] }, null, 2)}\n`);
  await writeFile(resolve(runtimeDir, "briefing-publications.json"), `${JSON.stringify({ publications: [] }, null, 2)}\n`);
  await exec(process.execPath, [resolve(root, "scripts/build-question-briefings.mjs")], { cwd: root, env: { ...pipelineEnv, QUESTIONS_PATH: resolve(runtimeDir, "workspace-questions.json"), QUESTION_EVALUATIONS_PATH: resolve(runtimeDir, "question-evaluations.json"), BRIEFINGS_PATH: resolve(runtimeDir, "workspace-briefings.json"), BRIEFING_PUBLICATIONS_PATH: resolve(runtimeDir, "briefing-publications.json") } });
  const provenanceBriefing = JSON.parse(await readFile(resolve(runtimeDir, "workspace-briefings.json"), "utf8")).briefings[0];
  if (provenanceBriefing.insightProvenance?.[0]?.origin !== "discovered_opportunity" || provenanceBriefing.insightProvenance[0].promotionId !== promotion.id) throw new Error("Promoted insight provenance did not reach the customer briefing.");
  const inspectionResponse = await fetch(`${base}/api/insights/${encodeURIComponent(promotion.insight.id)}?workspace=demo-research`, { headers: { Authorization: "Bearer research-token" } });
  const inspection = await inspectionResponse.json();
  if (inspectionResponse.status !== 200 || inspection.insight.origin !== "discovered_opportunity" || inspection.freshness?.state !== "published" || !inspection.briefingLinks?.some((briefing) => briefing.id === provenanceBriefing.id) || !inspection.reviewHistory.events?.some((event) => event.eventType === "insight_opportunity_promoted")) throw new Error("Promoted insight inspection did not expose currentness, briefing linkage, and promotion history.");
  const revisionResponse = await fetch(`${base}/api/insight-promotions/${encodeURIComponent(promotion.id)}/revise`, { method: "POST", headers: { ...auth, "Idempotency-Key": "revise-opportunity-test" }, body: JSON.stringify({ workspaceId: "demo-research", title: "A revised correction path needs a direct workflow test", plainLanguageSummary: "The revised reading is narrower: sources describe correction mechanisms, but they do not show whether people receive the same remedy in practice.", strongestAlternative: "The sources may use correction language for different processes rather than one shared mechanism.", nextTest: "Trace one named workflow from decision to appeal, correction, and later result across two reporting periods.", whatWouldChangeOurMind: ["Source review shows the records refer to different populations or definitions."], note: "Revised after researcher review." }) });
  if (revisionResponse.status !== 200) throw new Error(`Promotion revision failed: ${revisionResponse.status}`);
  await exec(process.execPath, [resolve(root, "scripts/build-ai-work-control-packet.mjs")], { cwd: root, env: pipelineEnv });
  await exec(process.execPath, [resolve(root, "scripts/generate-insight-candidates.mjs")], { cwd: root, env: pipelineEnv });
  const revisedCandidate = JSON.parse(await readFile(resolve(runtimeDir, "insight-candidates.json"), "utf8")).candidates.find((candidate) => candidate.candidateKey === promotion.insight.id);
  if (revisedCandidate.status !== "stale" || revisedCandidate.origin !== "discovered_opportunity" || revisedCandidate.promotionId !== promotion.id || revisedCandidate.claimDigest === initialCandidate.claimDigest) throw new Error("Revised promoted insight did not become stale and retain promotion provenance.");
  console.log("Insight promotion test passed: authorization, durable provenance, and next-refresh packet promotion are enforced.");
} finally {
  child.kill("SIGTERM");
}
