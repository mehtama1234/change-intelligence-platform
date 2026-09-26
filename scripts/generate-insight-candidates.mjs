import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packet = JSON.parse(await readFile(resolve(root, "data/processed/ai-work-control.packet.json"), "utf8"));
const records = new Map(packet.records.map((record) => [record.id, record]));
const candidates = packet.insights.map((insight) => {
  const evidence = insight.recordIds.map((id) => records.get(id)).filter(Boolean).map((record) => ({
    recordId: record.id,
    sourceRepository: record.sourceRepository,
    sourceRef: record.sourceRef,
    sourceRole: record.sourceRole,
    sourceDigest: record.sourceDigest
  }));
  const evidenceDigest = createHash("sha256").update(JSON.stringify(evidence.map((item) => [item.recordId, item.sourceDigest]))).digest("hex");
  return {
    id: `candidate-${insight.id}-${evidenceDigest.slice(0, 12)}`,
    insightId: insight.id,
    title: insight.title,
    plainLanguageSummary: insight.plainLanguageSummary,
    status: "needs_researcher_review",
    publication: "not_published",
    generatedAt: new Date().toISOString(),
    evidenceDigest,
    evidence,
    strongestAlternative: insight.strongestAlternative,
    whatWouldChangeOurMind: insight.whatWouldChangeOurMind,
    nextTest: insight.nextTest,
    limits: ["This candidate was assembled from current evidence references; it is not a new causal finding."]
  };
});
const result = { schemaVersion: "insight-candidate-ledger-v1", generatedAt: new Date().toISOString(), candidates };
const outputDir = resolve(root, "data/processed/runs/ai-work-control");
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "insight-candidates.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ candidates: candidates.length, needsResearcherReview: candidates.filter((candidate) => candidate.status === "needs_researcher_review").length }, null, 2));
