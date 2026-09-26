import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packet = JSON.parse(await readFile(resolve(root, process.env.INSIGHT_PACKET_PATH ?? "data/processed/ai-work-control.packet.json"), "utf8"));
const records = new Map(packet.records.map((record) => [record.id, record]));
const runtimeDir = process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control";
const decisionsPath = resolve(root, process.env.INSIGHT_DECISIONS_PATH ?? `${runtimeDir}/insight-decisions.json`);
const publicationsPath = resolve(root, process.env.INSIGHT_PUBLICATIONS_PATH ?? `${runtimeDir}/insight-publications.json`);
const decisions = existsSync(decisionsPath) ? JSON.parse(await readFile(decisionsPath, "utf8")) : { decisions: [] };
const publications = existsSync(publicationsPath) ? JSON.parse(await readFile(publicationsPath, "utf8")) : { publications: [] };
const latestDecision = new Map();
for (const decision of decisions.decisions) latestDecision.set(decision.candidateKey, decision);
const latestPublication = new Map();
for (const publication of publications.publications) latestPublication.set(publication.candidateKey, publication);
const candidates = packet.insights.map((insight) => {
  const evidence = insight.recordIds.map((id) => records.get(id)).filter(Boolean).map((record) => ({
    recordId: record.id,
    sourceRepository: record.sourceRepository,
    sourceRef: record.sourceRef,
    sourceRole: record.sourceRole,
    sourceDigest: record.sourceDigest,
    ...(record.researchReview ? { researchReview: record.researchReview } : {})
  }));
  const evidenceDigest = createHash("sha256").update(JSON.stringify(evidence.map((item) => [item.recordId, item.sourceDigest]))).digest("hex");
  const claimDigest = createHash("sha256").update(JSON.stringify({ title: insight.title, plainLanguageSummary: insight.plainLanguageSummary, strongestAlternative: insight.strongestAlternative, whatWouldChangeOurMind: insight.whatWouldChangeOurMind, nextTest: insight.nextTest, evidenceDigest })).digest("hex");
  const candidateKey = insight.id;
  const decision = latestDecision.get(candidateKey);
  const currentDecision = decision?.evidenceDigest === evidenceDigest && (!insight.origin || decision.claimDigest === claimDigest) ? decision : undefined;
  const publication = latestPublication.get(candidateKey);
  const currentPublication = publication?.evidenceDigest === evidenceDigest && (!insight.origin || publication.claimDigest === claimDigest) && currentDecision?.decision === "accept" ? publication : undefined;
  // A changed publication makes the candidate stale until a researcher reviews
  // the new digest. Once that review accepts the candidate, keep the old
  // publication history but move the candidate back to the publishable queue.
  const stalePublication = publication && !currentPublication && !currentDecision;
  const resultingState = currentPublication ? "published" : stalePublication ? "stale" : currentDecision ? ({ accept: "accepted_for_publication", defer: "deferred", reject: "rejected", correct: "correction_required" }[currentDecision.decision] ?? "needs_researcher_review") : "needs_researcher_review";
  return {
    id: `candidate-${insight.id}-${evidenceDigest.slice(0, 12)}`,
    insightId: insight.id,
    title: insight.title,
    plainLanguageSummary: insight.plainLanguageSummary,
    status: resultingState,
    publication: currentPublication ? "published" : stalePublication ? "needs_republish" : "not_published",
    ...(stalePublication ? { staleReason: "The evidence digest changed after the last publication. Re-review the changed evidence before publishing again.", previousEvidenceDigest: publication.evidenceDigest } : {}),
    generatedAt: new Date().toISOString(),
    candidateKey,
    evidenceDigest,
    claimDigest,
    ...(insight.origin ? { origin: insight.origin, promotionId: insight.promotionId ?? null } : {}),
    ...(currentDecision ? { decisionId: currentDecision.id, decidedBy: currentDecision.reviewer, decidedAt: currentDecision.decidedAt, decisionNote: currentDecision.note } : {}),
    ...(currentPublication ? { publicationId: currentPublication.id, publishedBy: currentPublication.publisher, publishedAt: currentPublication.publishedAt } : {}),
    evidence,
    strongestAlternative: insight.strongestAlternative,
    whatWouldChangeOurMind: insight.whatWouldChangeOurMind,
    nextTest: insight.nextTest,
    limits: ["This candidate was assembled from current evidence references; it is not a new causal finding."]
  };
});
const result = { schemaVersion: "insight-candidate-ledger-v1", generatedAt: new Date().toISOString(), candidates };
const outputDir = resolve(root, process.env.INSIGHT_OUTPUT_DIR ?? runtimeDir);
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "insight-candidates.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ candidates: candidates.length, needsResearcherReview: candidates.filter((candidate) => candidate.status === "needs_researcher_review").length }, null, 2));
