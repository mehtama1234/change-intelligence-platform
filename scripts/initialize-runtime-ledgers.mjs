import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
await mkdir(runtimeDir, { recursive: true });
const ledgers = {
  "idempotency-operations.json": { schemaVersion: "idempotency-ledger-v1", operations: [] }
};
for (const [name, value] of Object.entries(ledgers)) {
  try { await access(resolve(runtimeDir, name)); }
  catch { await writeFile(resolve(runtimeDir, name), `${JSON.stringify(value, null, 2)}\n`); }
}
let questions = null;
try { questions = JSON.parse(await readFile(resolve(runtimeDir, "workspace-questions.json"), "utf8")); } catch {}
if (!questions?.questions?.length) {
  const packet = JSON.parse(await readFile(resolve(runtimeDir, "ai-work-control.packet.json"), "utf8"));
  const candidate = JSON.parse(await readFile(resolve(runtimeDir, "insight-candidates.json"), "utf8")).candidates?.[0];
  const matchedRecordIds = candidate?.evidence?.map((evidence) => evidence.recordId) ?? packet.records?.slice(0, 2).map((record) => record.id) ?? [];
  await writeFile(resolve(runtimeDir, "workspace-questions.json"), `${JSON.stringify({ schemaVersion: "workspace-question-ledger-v1", questions: [{ id: "ci-demo-question", workspaceId: "demo-research", state: "active", question: "What changed, what remains uncertain, and what should we test next?", createdAt: new Date().toISOString() }] }, null, 2)}\n`);
  await writeFile(resolve(runtimeDir, "question-evaluations.json"), `${JSON.stringify({ schemaVersion: "question-evaluation-ledger-v1", generatedAt: new Date().toISOString(), evaluations: [{ questionId: "ci-demo-question", workspaceId: "demo-research", state: "evidence_retrieved", matchedRecordIds, matches: [], limitation: "CI demo question uses the generated packet to exercise the briefing path." }] }, null, 2)}\n`);
}
console.log(`Initialized runtime ledgers in ${runtimeDir}.`);
