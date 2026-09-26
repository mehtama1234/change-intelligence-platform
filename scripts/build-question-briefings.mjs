import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packetPath = resolve(root, process.env.PACKET_OUTPUT_PATH ?? "data/processed/ai-work-control.packet.json");
const questionsPath = resolve(root, process.env.QUESTIONS_PATH ?? "data/processed/runs/ai-work-control/workspace-questions.json");
const evaluationsPath = resolve(root, process.env.QUESTION_EVALUATIONS_PATH ?? "data/processed/runs/ai-work-control/question-evaluations.json");
const outputDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const outputPath = process.env.BRIEFINGS_PATH ? resolve(process.env.BRIEFINGS_PATH) : resolve(outputDir, "workspace-briefings.json");
const publicationsPath = process.env.BRIEFING_PUBLICATIONS_PATH ? resolve(process.env.BRIEFING_PUBLICATIONS_PATH) : resolve(outputDir, "briefing-publications.json");
const insightCandidatesPath = process.env.INSIGHT_CANDIDATES_PATH ? resolve(process.env.INSIGHT_CANDIDATES_PATH) : resolve(outputDir, "insight-candidates.json");
const insightPublicationsPath = process.env.INSIGHT_PUBLICATIONS_PATH ? resolve(process.env.INSIGHT_PUBLICATIONS_PATH) : resolve(outputDir, "insight-publications.json");
const workspaceSourcesPath = resolve(root, process.env.WORKSPACE_SOURCES_PATH ?? `${outputDir}/workspace-sources.json`);
const packet = JSON.parse(await readFile(packetPath, "utf8"));
const questions = existsSync(questionsPath) ? JSON.parse(await readFile(questionsPath, "utf8")) : { questions: [] };
const evaluations = existsSync(evaluationsPath) ? JSON.parse(await readFile(evaluationsPath, "utf8")) : { evaluations: [] };
const publications = existsSync(publicationsPath) ? JSON.parse(await readFile(publicationsPath, "utf8")) : { publications: [] };
const insightCandidates = existsSync(insightCandidatesPath) ? JSON.parse(await readFile(insightCandidatesPath, "utf8")) : { candidates: [] };
const insightPublications = existsSync(insightPublicationsPath) ? JSON.parse(await readFile(insightPublicationsPath, "utf8")) : { publications: [] };
const workspaceSourceLedger = existsSync(workspaceSourcesPath) ? JSON.parse(await readFile(workspaceSourcesPath, "utf8")) : { sources: [] };
const publicationByBriefing = new Map();
for (const publication of publications.publications ?? []) {
  const current = publicationByBriefing.get(publication.briefingId);
  if (!current || Number(publication.publicationOrder ?? 0) > Number(current.publicationOrder ?? 0) || (Number(publication.publicationOrder ?? 0) === Number(current.publicationOrder ?? 0) && String(publication.publishedAt).localeCompare(String(current.publishedAt)) > 0)) publicationByBriefing.set(publication.briefingId, publication);
}
const insightById = new Map(packet.insights.map((insight) => [insight.id, insight]));
const candidateByKey = new Map((insightCandidates.candidates ?? []).map((candidate) => [candidate.candidateKey, candidate]));
const insightPublicationsByKey = new Map();
for (const publication of insightPublications.publications ?? []) insightPublicationsByKey.set(publication.candidateKey, [...(insightPublicationsByKey.get(publication.candidateKey) ?? []), publication]);
const recordsById = new Map(packet.records.map((record) => [record.id, record]));
for (const source of workspaceSourceLedger.sources ?? []) if (source.reviewState === "accepted") recordsById.set(source.id, { ...source, sourceRole: "workspace_source", sourceRepository: "customer-provided", sourceExcerpt: source.sourceExcerpt, asOf: source.submittedAt, limits: ["This is customer-provided evidence. It remains private to the workspace and has not been independently verified."] });
const evaluationByQuestion = new Map(evaluations.evaluations.map((evaluation) => [evaluation.questionId, evaluation]));

function insightProvenanceForQuestion(workspaceId, matchedRecordIds) {
  const matched = new Set(matchedRecordIds ?? []);
  return [...insightPublicationsByKey.entries()].flatMap(([candidateKey, candidatePublications]) => {
    const publication = candidatePublications.filter((item) => !item.workspaceId || item.workspaceId === workspaceId).sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt))).at(-1);
    if (!publication) return [];
    const candidate = candidateByKey.get(candidateKey);
    const insight = insightById.get(candidateKey);
    if (!candidate || !insight) return [];
    const insightRecordIds = new Set((candidate.evidence ?? []).map((item) => item.recordId));
    if (!([...insightRecordIds].some((recordId) => matched.has(recordId)))) return [];
    const evidenceChanged = publication.evidenceDigest !== candidate.evidenceDigest;
    const claimChanged = candidate.origin ? publication.claimDigest !== candidate.claimDigest : Boolean(candidate.claimDigest && publication.claimDigest && publication.claimDigest !== candidate.claimDigest);
    const currentPublication = candidate.status === "published" && !evidenceChanged && !claimChanged;
    const changeTypes = [...(evidenceChanged ? ["source evidence"] : []), ...(claimChanged ? ["insight wording"] : [])];
    return [{
      insightId: insight.id,
      candidateKey,
      candidateId: candidate.id,
      title: insight.title,
      plainLanguageSummary: insight.plainLanguageSummary,
      state: currentPublication ? "published" : "stale",
      publicationId: publication.id,
      publishedBy: publication.publisher,
      publishedAt: publication.publishedAt,
      publicationEvidenceDigest: publication.evidenceDigest,
      currentEvidenceDigest: candidate.evidenceDigest,
      publicationClaimDigest: publication.claimDigest ?? null,
      currentClaimDigest: candidate.claimDigest ?? null,
      sourceRecordIds: (candidate.evidence ?? []).map((item) => item.recordId),
      sourceEvidence: (candidate.evidence ?? []).map((item) => ({ recordId: item.recordId, sourceRepository: item.sourceRepository, sourceRef: item.sourceRef, sourceDigest: item.sourceDigest })),
      ...(insight.origin ? { origin: insight.origin, promotionId: insight.promotionId ?? null } : {}),
      strongestAlternative: candidate.strongestAlternative,
      whatWouldChangeOurMind: candidate.whatWouldChangeOurMind ?? [],
      nextTest: candidate.nextTest,
      ...(currentPublication ? {} : { changeTypes, staleReason: changeTypes.length ? `The ${changeTypes.join(" and ")} changed after this publication.` : "The linked insight is not currently published.", customerActions: ["Do not treat the prior insight as current decision evidence.", "Open the updated evidence and briefing before relying on the reading.", "Ask the research owner to re-review and republish the insight and briefing before acting on it."] })
    }];
  });
}

const briefings = questions.questions.filter((question) => question.state === "active").map((question) => {
  const evaluation = evaluationByQuestion.get(question.id);
  const evidence = (evaluation?.matchedRecordIds ?? []).map((id) => recordsById.get(id)).filter((record) => record && (!record.workspaceId || record.workspaceId === question.workspaceId)).map((record) => ({
    recordId: record.id,
    title: record.title,
    sourceRepository: record.sourceRepository,
    sourceRef: record.sourceRef,
    observation: record.observation,
    limits: record.limits,
    sourceDigest: record.sourceDigest,
    ...(record.sourceRole === "workspace_source" ? { private: true, reviewState: record.reviewState } : {}),
    ...(record.researchReview ? { researchReview: record.researchReview } : {})
  }));
  const insightProvenance = insightProvenanceForQuestion(question.workspaceId, evaluation?.matchedRecordIds);
  const briefingDigestInput = insightProvenance.length ? { evidence: evidence.map((item) => [item.recordId, item.sourceDigest]), insights: insightProvenance.map((item) => [item.candidateKey, item.publicationId, item.publicationEvidenceDigest, item.currentEvidenceDigest, item.publicationClaimDigest, item.currentClaimDigest, item.state]) } : evidence.map((item) => [item.recordId, item.sourceDigest]);
  const briefingEvidenceDigest = createHash("sha256").update(JSON.stringify(briefingDigestInput)).digest("hex");
  const publication = publicationByBriefing.get(`briefing-${question.id}`);
  const currentPublication = publication?.evidenceDigest === briefingEvidenceDigest ? publication : undefined;
  const stalePublication = publication && !currentPublication;
  return {
    id: `briefing-${question.id}`,
    workspaceId: question.workspaceId,
    questionId: question.id,
    title: question.question,
    state: currentPublication ? "published" : stalePublication ? "stale" : "draft",
    publication: currentPublication ? "published" : stalePublication ? "needs_republish" : "not_published",
    ...(stalePublication ? { staleReason: "The source evidence or a linked insight publication changed after the last publication. Inspect the updated provenance before republishing.", previousEvidenceDigest: publication.evidenceDigest, customerActions: ["Do not rely on this briefing as current decision evidence.", "Open the changed evidence and linked insight history.", "Ask the research owner to re-review and republish this briefing before using it."] } : {}),
    ...(currentPublication ? { publishedBy: currentPublication.publishedBy, publishedAt: currentPublication.publishedAt, publicationId: currentPublication.id } : {}),
    evidenceDigest: briefingEvidenceDigest,
    generatedAt: new Date().toISOString(),
    evidence,
    insightProvenance,
    insightActions: insightProvenance.filter((insight) => insight.state === "stale").flatMap((insight) => insight.customerActions ?? []),
    reading: evidence.length ? `The system found ${evidence.length} related source record${evidence.length === 1 ? "" : "s"}. A researcher must inspect them before making a conclusion.` : "The current packet contains no matching source records.",
    boundary: evaluation?.limitation ?? "No evaluation has run yet.",
    nextTest: insightProvenance.map((item) => item.nextTest).filter(Boolean).join(" ") || (packet.insights[0]?.nextTest ?? "Define the next test before publication.")
  };
});

const result = { schemaVersion: "workspace-briefing-ledger-v1", generatedAt: new Date().toISOString(), briefings };
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ briefings: briefings.length, drafts: briefings.filter((briefing) => briefing.state === "draft").length }, null, 2));
console.log(`Wrote ${outputPath}`);
