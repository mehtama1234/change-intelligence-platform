import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packetPath = resolve(root, "data/processed/ai-work-control.packet.json");
const questionsPath = resolve(root, "data/processed/runs/ai-work-control/workspace-questions.json");
const outputDir = resolve(root, "data/processed/runs/ai-work-control");
const outputPath = resolve(outputDir, "question-evaluations.json");
const workspaceDir = resolve(root, "data/fixtures/workspaces");
const packet = JSON.parse(await readFile(packetPath, "utf8"));
const ledger = existsSync(questionsPath) ? JSON.parse(await readFile(questionsPath, "utf8")) : { schemaVersion: "workspace-question-ledger-v1", questions: [] };
const workspaceFiles = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
const workspaces = await Promise.all(workspaceFiles.map(async (file) => JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"))));
const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
const now = new Date().toISOString();
const stopWords = new Set(["what", "will", "does", "how", "can", "the", "and", "for", "with", "that", "this", "from", "change"]);

function terms(question) {
  return question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((term) => term.length > 2 && !stopWords.has(term));
}

const evaluations = [];
for (const question of ledger.questions.filter((item) => item.state === "active")) {
  const workspace = workspaceById.get(question.workspaceId);
  const requestedIds = new Set(question.scope?.sourceIds ?? []);
  for (const watchlistId of question.scope?.watchlistIds ?? []) {
    const watchlist = workspace?.watchlists?.find((item) => item.id === watchlistId);
    for (const sourceId of watchlist?.sourceIds ?? []) requestedIds.add(sourceId);
  }
  const words = terms(question.question);
  const candidates = packet.records.filter((record) => !requestedIds.size || requestedIds.has(record.id));
  const matches = candidates.map((record) => {
    const text = [record.title, record.observation, record.mechanism, record.theme, record.sourceRepository].join(" ").toLowerCase();
    const matchedTerms = words.filter((word) => text.includes(word));
    return { recordId: record.id, matchedTerms, score: matchedTerms.length };
  }).filter((match) => match.score > 0).sort((a, b) => b.score - a.score);
  evaluations.push({
    questionId: question.id,
    workspaceId: question.workspaceId,
    evaluatedAt: now,
    state: "evidence_retrieved",
    matchedRecordIds: matches.map((match) => match.recordId),
    matches,
    limitation: "Text matches identify evidence to inspect; they do not answer the question or establish causation."
  });
  question.lastEvaluatedAt = now;
  question.lastEvaluation = { state: "evidence_retrieved", matchedRecordCount: matches.length };
  question.updatedAt = now;
}

ledger.updatedAt = now;
await mkdir(outputDir, { recursive: true });
await writeFile(questionsPath, `${JSON.stringify(ledger, null, 2)}\n`);
await writeFile(outputPath, `${JSON.stringify({ schemaVersion: "question-evaluation-ledger-v1", generatedAt: now, evaluations }, null, 2)}\n`);
console.log(JSON.stringify({ questionsEvaluated: evaluations.length, matches: evaluations.reduce((sum, item) => sum + item.matchedRecordIds.length, 0) }, null, 2));
console.log(`Wrote ${outputPath}`);
