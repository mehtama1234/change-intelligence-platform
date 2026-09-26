import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packetPath = resolve(root, "data/processed/ai-work-control.packet.json");
const questionsPath = resolve(root, "data/processed/runs/ai-work-control/workspace-questions.json");
const evaluationsPath = resolve(root, "data/processed/runs/ai-work-control/question-evaluations.json");
const outputDir = resolve(root, "data/processed/runs/ai-work-control");
const outputPath = resolve(outputDir, "workspace-briefings.json");
const packet = JSON.parse(await readFile(packetPath, "utf8"));
const questions = existsSync(questionsPath) ? JSON.parse(await readFile(questionsPath, "utf8")) : { questions: [] };
const evaluations = existsSync(evaluationsPath) ? JSON.parse(await readFile(evaluationsPath, "utf8")) : { evaluations: [] };
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
    limits: record.limits
  }));
  return {
    id: `briefing-${question.id}`,
    workspaceId: question.workspaceId,
    questionId: question.id,
    title: question.question,
    state: "draft",
    publication: "not_published",
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
