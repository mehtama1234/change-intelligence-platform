import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control";
const packetPath = resolve(root, process.env.PACKET_PATH ?? "data/processed/ai-work-control.packet.json");
const questionsPath = resolve(root, process.env.QUESTIONS_PATH ?? `${runtimeDir}/workspace-questions.json`);
const outputDir = resolve(root, process.env.QUESTION_OUTPUT_DIR ?? runtimeDir);
const outputPath = resolve(outputDir, "question-evaluations.json");
const workspaceDir = resolve(root, "data/fixtures/workspaces");
const watchlistsPath = resolve(root, process.env.WATCHLISTS_PATH ?? `${runtimeDir}/workspace-watchlists.json`);
const workspaceSourcesPath = resolve(root, process.env.WORKSPACE_SOURCES_PATH ?? `${runtimeDir}/workspace-sources.json`);
const packet = JSON.parse(await readFile(packetPath, "utf8"));
const ledger = existsSync(questionsPath) ? JSON.parse(await readFile(questionsPath, "utf8")) : { schemaVersion: "workspace-question-ledger-v1", questions: [] };
const workspaceFiles = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
const workspaces = await Promise.all(workspaceFiles.map(async (file) => JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"))));
const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
const watchlistLedger = existsSync(watchlistsPath) ? JSON.parse(await readFile(watchlistsPath, "utf8")) : { watchlists: [] };
const workspaceSourceLedger = existsSync(workspaceSourcesPath) ? JSON.parse(await readFile(workspaceSourcesPath, "utf8")) : { sources: [] };
const watchlistsByWorkspace = new Map();
for (const watchlist of watchlistLedger.watchlists ?? []) watchlistsByWorkspace.set(watchlist.workspaceId, [...(watchlistsByWorkspace.get(watchlist.workspaceId) ?? []), watchlist]);
const now = new Date().toISOString();
const stopWords = new Set(["what", "will", "does", "how", "can", "the", "and", "for", "with", "that", "this", "from", "change", "changes", "which", "whether", "should", "monitored", "team", "act", "next", "shows", "evidence", "links", "link", "ai", "work", "use", "using", "system", "systems"]);
const conceptGroups = {
  control: ["control", "agency", "autonomy", "decision", "decisions", "power"],
  correction: ["correct", "correction", "review", "appeal", "remedy", "override", "fix", "error", "errors"],
  dependence: ["dependence", "dependent", "portability", "portable", "exit", "switching", "replace", "replacement"],
  adoption: ["adopt", "adoption", "deploy", "deployment", "deployed", "implementation", "implemented"],
  outcome: ["outcome", "outcomes", "productivity", "value", "benefit", "benefits", "result", "results", "impact"],
  infrastructure: ["infrastructure", "compute", "computing", "network", "networking", "cloud", "capacity"],
  economics: ["revenue", "margin", "growth", "price", "pricing", "cost", "scarcity", "demand"]
};
const conceptByTerm = new Map(Object.entries(conceptGroups).flatMap(([concept, words]) => words.map((word) => [word, concept])));

function privateRecord(source) {
  return { ...source, sourceRole: "workspace_source", sourceRepository: "customer-provided", sourceExcerpt: source.sourceExcerpt, asOf: source.submittedAt, mechanism: null, theme: null, limits: ["This is customer-provided evidence. It remains private to the workspace and has not been independently verified."] };
}

function terms(question) {
  return question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((term) => term.length > 2 && !stopWords.has(term));
}

function conceptsFor(words) {
  return new Map(words.map((word) => [word, conceptByTerm.get(word) ?? word]));
}

const evaluations = [];
for (const question of ledger.questions.filter((item) => item.state === "active")) {
  const workspace = workspaceById.get(question.workspaceId);
  const requestedIds = new Set(question.scope?.sourceIds ?? []);
  for (const watchlistId of question.scope?.watchlistIds ?? []) {
    const watchlist = (watchlistsByWorkspace.get(question.workspaceId) ?? workspace?.watchlists ?? []).find((item) => item.id === watchlistId);
    for (const sourceId of watchlist?.sourceIds ?? []) requestedIds.add(sourceId);
  }
  const words = terms(question.question);
  const questionConcepts = conceptsFor(words);
  const acceptedPrivateSources = (workspaceSourceLedger.sources ?? []).filter((source) => source.workspaceId === question.workspaceId && source.reviewState === "accepted").map(privateRecord);
  const candidates = [...packet.records, ...acceptedPrivateSources].filter((record) => !requestedIds.size || requestedIds.has(record.id));
  const matches = candidates.map((record) => {
    const textTerms = new Set(terms([record.title, record.observation, record.mechanism, record.theme, record.sourceRepository].join(" ")));
    const textConcepts = new Map([...textTerms].map((word) => [word, conceptByTerm.get(word) ?? word]));
    const matchedTerms = words.filter((word) => textTerms.has(word));
    const matchedConcepts = [...new Set(words.map((word) => questionConcepts.get(word)).filter((concept) => [...textConcepts.values()].includes(concept)))];
    const explicitScope = requestedIds.has(record.id);
    const strongMatch = matchedConcepts.length > 0;
    return { recordId: record.id, matchedTerms, matchedConcepts, matchReason: explicitScope ? "explicit source scope" : strongMatch ? "shared evidence concept" : null, score: matchedConcepts.length * 2 + matchedTerms.length + (explicitScope ? 1 : 0) };
  }).filter((match) => match.matchReason).sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId));
  evaluations.push({
    questionId: question.id,
    workspaceId: question.workspaceId,
    evaluatedAt: now,
    state: "evidence_retrieved",
    matchedRecordIds: matches.map((match) => match.recordId),
    matches,
    sourceBoundary: { sharedRecordCount: matches.filter((match) => !acceptedPrivateSources.some((source) => source.id === match.recordId)).length, acceptedPrivateSourceCount: matches.filter((match) => acceptedPrivateSources.some((source) => source.id === match.recordId)).length, excludedPrivateSourceCount: (workspaceSourceLedger.sources ?? []).filter((source) => source.workspaceId === question.workspaceId && source.reviewState !== "accepted").length },
    limitation: "Concept matches identify evidence to inspect; they do not answer the question or establish causation. Broad words such as AI and work are not treated as evidence concepts by themselves."
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
