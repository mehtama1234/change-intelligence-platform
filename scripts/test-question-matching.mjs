import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-question-matching-"));
const packetPath = resolve(runDir, "packet.json");
const questionsPath = resolve(runDir, "questions.json");
const outputDir = resolve(runDir, "output");
await mkdir(outputDir, { recursive: true });
await writeFile(packetPath, `${JSON.stringify({ records: [
  { id: "remedy-record", title: "Workers can appeal an automated decision", observation: "A review path lets a person challenge an automated decision.", mechanism: "An appeal and correction process gives people a route to remedy.", theme: "algorithmic management", sourceRepository: "research", sourceRole: "research" },
  { id: "generic-record", title: "AI work is changing", observation: "AI tools are used at work.", mechanism: "Work is changing.", theme: "ai", sourceRepository: "research", sourceRole: "research" }
] }, null, 2)}\n`);
await writeFile(questionsPath, `${JSON.stringify({ questions: [
  { id: "concept-question", workspaceId: "demo-research", state: "active", question: "How can people appeal automated decisions?" },
  { id: "generic-question", workspaceId: "demo-research", state: "active", question: "Will AI change work?" }
] }, null, 2)}\n`);
await exec(process.execPath, [resolve(root, "scripts/evaluate-questions.mjs")], { cwd: root, env: { ...process.env, PACKET_PATH: packetPath, QUESTIONS_PATH: questionsPath, QUESTION_OUTPUT_DIR: outputDir, RUNTIME_DATA_DIR: runDir } });
const result = JSON.parse(await readFile(resolve(outputDir, "question-evaluations.json"), "utf8"));
const concept = result.evaluations.find((item) => item.questionId === "concept-question");
const generic = result.evaluations.find((item) => item.questionId === "generic-question");
if (!concept?.matches.some((match) => match.recordId === "remedy-record" && match.matchedConcepts.includes("correction") && match.matchReason === "shared evidence concept")) throw new Error("Concept matching did not connect an appeal question to correction evidence.");
if (generic?.matches.length) throw new Error("Broad AI/work words produced a false-positive evidence match.");
console.log("Question matching test passed: mechanism concepts matched, broad words alone did not.");
