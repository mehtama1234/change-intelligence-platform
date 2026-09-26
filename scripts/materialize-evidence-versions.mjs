import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const reviewPath = resolve(root, process.env.REVIEW_WORK_PATH ?? "data/processed/runs/ai-work-control/latest-review-work.json");
const decisionsPath = resolve(root, process.env.REVIEW_DECISIONS_PATH ?? "data/processed/runs/ai-work-control/review-decisions.json");
const outputDir = resolve(root, process.env.EVIDENCE_OUTPUT_DIR ?? "data/processed/runs/ai-work-control");
const outputName = process.env.EVIDENCE_OUTPUT_NAME ?? "versioned-evidence-ledger.json";
const reviewWork = JSON.parse(await readFile(reviewPath, "utf8"));
const decisionLedger = existsSync(decisionsPath) ? JSON.parse(await readFile(decisionsPath, "utf8")) : { decisions: [] };
const candidates = new Map(reviewWork.candidates.map((candidate) => [candidate.id, candidate]));
const decisions = decisionLedger.decisions ?? [];
const latestByCandidate = new Map();
for (const decision of decisions) latestByCandidate.set(decision.candidateId, decision);

const records = [];
for (const [candidateId, decision] of latestByCandidate) {
  const candidate = candidates.get(candidateId);
  if (!candidate || decision.resultingState !== "accepted_for_research") continue;
  const versionId = `${candidate.sourceId}-${candidate.sourceDigest.slice(0, 12)}`;
  records.push({
    versionId,
    sourceId: candidate.sourceId,
    sourceDigest: candidate.sourceDigest,
    state: "accepted_for_research",
    publication: "not_published",
    acceptedBy: decision.reviewer,
    acceptedAt: decision.decidedAt,
    decisionId: decision.id,
    record: {
      id: candidate.sourceId,
      sourceRole: candidate.sourceRole,
      sourceRepository: candidate.repository,
      sourceRef: candidate.sourcePath,
      sourceLocator: candidate.sourceLocator,
      title: candidate.title,
      observation: candidate.observation,
      theme: candidate.theme,
      mechanism: candidate.mechanism,
      affectedGroups: candidate.affectedGroups,
      claimState: candidate.claimState,
      asOf: candidate.asOf,
      limits: candidate.limits
    }
  });
}

const result = {
  schemaVersion: "versioned-evidence-ledger-v1",
  generatedAt: new Date().toISOString(),
  sourceReviewRun: reviewWork.scanRunId,
  decisionCount: decisions.length,
  activeResearchRecordCount: records.length,
  records,
  decisionHistory: decisions
};
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, outputName), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ decisionCount: result.decisionCount, activeResearchRecordCount: result.activeResearchRecordCount }, null, 2));
console.log(`Wrote ${resolve(outputDir, outputName)}`);
