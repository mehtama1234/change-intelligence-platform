import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runDir = `/tmp/change-intelligence-private-retrieval-${Date.now()}`;
await mkdir(runDir, { recursive: true });
const packetPath = resolve(runDir, "packet.json");
const questionsPath = resolve(runDir, "workspace-questions.json");
const sourcesPath = resolve(runDir, "workspace-sources.json");
await copyFile(resolve(root, "data/processed/ai-work-control.packet.json"), packetPath);
await writeFile(questionsPath, `${JSON.stringify({ schemaVersion: "workspace-question-ledger-v1", questions: [{ id: "private-retrieval-question", workspaceId: "demo-research", question: "What correction work is added by this customer workflow?", state: "active", createdBy: "demo-owner", createdRole: "owner", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), scope: { sourceIds: [], watchlistIds: [] } }] }, null, 2)}\n`);
await writeFile(sourcesPath, `${JSON.stringify({ schemaVersion: "workspace-source-ledger-v1", sources: [
  { id: "accepted-private-source", workspaceId: "demo-research", title: "Accepted customer workflow note", sourceRef: "customer-note-accepted", sourceExcerpt: "The workflow required correction review after automated recommendations.", observation: "Correction review created added work for operators.", sourceDigest: "accepted-digest", sourceLocator: "page 2", reviewState: "accepted", claimState: "reviewed", submittedAt: new Date().toISOString() },
  { id: "pending-private-source", workspaceId: "demo-research", title: "Pending customer workflow note", sourceRef: "customer-note-pending", sourceExcerpt: "This pending note also mentions correction review.", observation: "Pending evidence must not enter retrieval.", sourceDigest: "pending-digest", sourceLocator: "page 3", reviewState: "pending_review", claimState: "submitted", submittedAt: new Date().toISOString() },
  { id: "other-workspace-source", workspaceId: "other-workspace", title: "Other workspace note", sourceRef: "other-note", sourceExcerpt: "Correction review in another tenant.", observation: "This must remain private to another workspace.", sourceDigest: "other-digest", reviewState: "accepted", claimState: "reviewed", submittedAt: new Date().toISOString() }
] }, null, 2)}\n`);
const env = { ...process.env, PACKET_PATH: packetPath, PACKET_OUTPUT_PATH: packetPath, QUESTIONS_PATH: questionsPath, QUESTION_OUTPUT_DIR: runDir, QUESTION_EVALUATIONS_PATH: resolve(runDir, "question-evaluations.json"), BRIEFINGS_PATH: resolve(runDir, "workspace-briefings.json"), RUNTIME_DATA_DIR: runDir, WORKSPACE_SOURCES_PATH: sourcesPath, WATCHLISTS_PATH: resolve(runDir, "workspace-watchlists.json") };
await exec(process.execPath, [resolve(root, "scripts/evaluate-questions.mjs")], { cwd: root, env });
await exec(process.execPath, [resolve(root, "scripts/build-question-briefings.mjs")], { cwd: root, env });
const evaluation = JSON.parse(await readFile(resolve(runDir, "question-evaluations.json"), "utf8")).evaluations[0];
const briefing = JSON.parse(await readFile(resolve(runDir, "workspace-briefings.json"), "utf8")).briefings[0];
if (!evaluation.matchedRecordIds.includes("accepted-private-source") || evaluation.matchedRecordIds.includes("pending-private-source") || evaluation.matchedRecordIds.includes("other-workspace-source") || evaluation.sourceBoundary.acceptedPrivateSourceCount !== 1 || evaluation.sourceBoundary.excludedPrivateSourceCount !== 1) throw new Error(`Private source retrieval boundary failed: ${JSON.stringify(evaluation)}`);
if (!briefing.evidence.some((item) => item.recordId === "accepted-private-source" && item.private === true) || briefing.evidence.some((item) => item.recordId === "pending-private-source" || item.recordId === "other-workspace-source")) throw new Error("Private source did not enter the scoped briefing correctly.");
console.log("Private source retrieval test passed: only accepted evidence from the current workspace reached evaluation and briefing.");
