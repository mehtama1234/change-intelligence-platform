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
const packet = JSON.parse(await readFile(packetPath, "utf8"));
const questions = existsSync(questionsPath) ? JSON.parse(await readFile(questionsPath, "utf8")) : { questions: [] };
const evaluations = existsSync(evaluationsPath) ? JSON.parse(await readFile(evaluationsPath, "utf8")) : { evaluations: [] };
const publications = existsSync(publicationsPath) ? JSON.parse(await readFile(publicationsPath, "utf8")) : { publications: [] };
const publicationByBriefing = new Map(publications.publications.map((publication) => [publication.briefingId, publication]));
const recordsById = new Map(packet.records.map((record) => [record.id, record]));
const evaluationByQuestion = new Map(evaluations.evaluations.map((evaluation) => [evaluation.questionId, evaluation]));

const briefings = questions.questions.filter((question) => question.state === "active").map((question) => {
  const evaluation = evaluationByQuestion.get(question.id);
  const evidence = (evaluation?.matchedRecordIds ?? []).map((id) => recordsById.get(id)).filter(Boolean).map((record) => ({
    recordId: record.id,
    title: record.title,
    sourceRepository: record.sourceRepository,
    sourceRef: record.sourceRef,
    observation: record.observation,
    limits: record.limits,
    sourceDigest: record.sourceDigest,
    ...(record.researchReview ? { researchReview: record.researchReview } : {})
  }));
  const evidenceDigest = createHash("sha256").update(JSON.stringify(evidence.map((item) => [item.recordId, item.sourceDigest]))).digest("hex");
  const publication = publicationByBriefing.get(`briefing-${question.id}`);
  const currentPublication = publication?.evidenceDigest === evidenceDigest ? publication : undefined;
  const stalePublication = publication && !currentPublication;
  return {
    id: `briefing-${question.id}`,
    workspaceId: question.workspaceId,
    questionId: question.id,
    title: question.question,
    state: currentPublication ? "published" : stalePublication ? "stale" : "draft",
    publication: currentPublication ? "published" : stalePublication ? "needs_republish" : "not_published",
    ...(stalePublication ? { staleReason: "The evidence digest changed after the last publication. Inspect the updated evidence before republishing.", previousEvidenceDigest: publication.evidenceDigest } : {}),
    ...(currentPublication ? { publishedBy: currentPublication.publishedBy, publishedAt: currentPublication.publishedAt, publicationId: currentPublication.id } : {}),
    evidenceDigest,
    generatedAt: new Date().toISOString(),
    evidence,
    reading: evidence.length ? `The system found ${evidence.length} related source record${evidence.length === 1 ? "" : "s"}. A researcher must inspect them before making a conclusion.` : "The current packet contains no matching source records.",
    boundary: evaluation?.limitation ?? "No evaluation has run yet.",
    nextTest: packet.insights[0]?.nextTest ?? "Define the next test before publication."
  };
});

const result = { schemaVersion: "workspace-briefing-ledger-v1", generatedAt: new Date().toISOString(), briefings };
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ briefings: briefings.length, drafts: briefings.filter((briefing) => briefing.state === "draft").length }, null, 2));
console.log(`Wrote ${outputPath}`);
