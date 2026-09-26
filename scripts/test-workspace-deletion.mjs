import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = 8797;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = `/tmp/change-intelligence-workspace-deletion-${Date.now()}`;
await mkdir(runtimeDir, { recursive: true });
const now = new Date().toISOString();
await writeFile(`${runtimeDir}/workspace-questions.json`, JSON.stringify({ schemaVersion: "workspace-question-ledger-v1", questions: [
  { id: "delete-question", workspaceId: "demo-research", question: "Delete this private question", scope: { watchlistIds: [] }, state: "active", createdBy: "demo-owner", createdRole: "owner", createdAt: now, updatedAt: now },
  { id: "keep-question", workspaceId: "other-workspace", question: "Keep this other workspace question", scope: { watchlistIds: [] }, state: "active", createdBy: "other-owner", createdRole: "owner", createdAt: now, updatedAt: now }
] }, null, 2));
await writeFile(`${runtimeDir}/workspace-watchlists.json`, JSON.stringify({ schemaVersion: "workspace-watchlist-ledger-v1", watchlists: [
  { id: "delete-watchlist", workspaceId: "demo-research", name: "Delete this watchlist", sourceIds: [], repositoryIds: [], alertOn: ["changed"] },
  { id: "keep-watchlist", workspaceId: "other-workspace", name: "Keep this watchlist", sourceIds: [], repositoryIds: [], alertOn: ["changed"] }
] }, null, 2));

function start() {
  const child = spawn(process.execPath, [resolve(root, "server.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "owner-token": "demo-owner", "research-token": "demo-researcher", "outsider-token": "outside-user" }) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  return { child, getOutput: () => output };
}

async function waitUntilHealthy(output) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((sleep) => setTimeout(sleep, 100));
  }
  throw new Error(`API did not start. ${output()}`);
}

const ownerHeaders = { Authorization: "Bearer owner-token" };
const researcherHeaders = { Authorization: "Bearer research-token" };
const outsiderHeaders = { Authorization: "Bearer outsider-token" };
let server = start();
try {
  await waitUntilHealthy(server.getOutput);
  const retention = await fetch(`${base}/api/workspace-retention?workspace=demo-research`, { headers: ownerHeaders });
  const retentionBody = await retention.json();
  if (retention.status !== 200 || retentionBody.canDelete !== true || retentionBody.counts.questions !== 1 || retentionBody.counts.watchlist !== 1 || retentionBody.confirmation !== "DELETE demo-research") throw new Error(`Retention preview failed: ${JSON.stringify(retentionBody)}`);
  const researcherRetention = await fetch(`${base}/api/workspace-retention?workspace=demo-research`, { headers: researcherHeaders });
  const researcherRetentionBody = await researcherRetention.json();
  if (researcherRetention.status !== 200 || researcherRetentionBody.canDelete !== false) throw new Error("Non-owner received deletion permission.");
  const outsiderRetention = await fetch(`${base}/api/workspace-retention?workspace=demo-research`, { headers: outsiderHeaders });
  if (outsiderRetention.status !== 403) throw new Error(`Expected outsider retention preview to return 403, received ${outsiderRetention.status}`);
  const wrongConfirmation = await fetch(`${base}/api/workspace-deletion`, { method: "POST", headers: { ...ownerHeaders, "Idempotency-Key": "delete-wrong", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", confirmation: "DELETE wrong" }) });
  if (wrongConfirmation.status !== 400) throw new Error(`Expected wrong deletion confirmation to return 400, received ${wrongConfirmation.status}`);
  const researcherDeletion = await fetch(`${base}/api/workspace-deletion`, { method: "POST", headers: { ...researcherHeaders, "Idempotency-Key": "delete-researcher", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", confirmation: "DELETE demo-research" }) });
  if (researcherDeletion.status !== 403) throw new Error(`Expected non-owner deletion to return 403, received ${researcherDeletion.status}`);
  const deletion = await fetch(`${base}/api/workspace-deletion`, { method: "POST", headers: { ...ownerHeaders, "Idempotency-Key": "delete-demo-research", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", confirmation: "DELETE demo-research" }) });
  const deletionBody = await deletion.json();
  if (deletion.status !== 200 || deletionBody.deleted.questions !== 1 || deletionBody.deleted.watchlist !== 1 || !deletionBody.preserved.includes("shared research evidence")) throw new Error(`Workspace deletion failed: ${JSON.stringify(deletionBody)}`);
  const retry = await fetch(`${base}/api/workspace-deletion`, { method: "POST", headers: { ...ownerHeaders, "Idempotency-Key": "delete-demo-research", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", confirmation: "DELETE demo-research" }) });
  if (retry.status !== 200 || JSON.stringify(await retry.json()) !== JSON.stringify(deletionBody)) throw new Error("Deletion idempotency did not replay the original result.");
  const deletedQuestions = await fetch(`${base}/api/questions?workspace=demo-research`, { headers: ownerHeaders });
  const deletedQuestionsBody = await deletedQuestions.json();
  if (deletedQuestions.status !== 200 || deletedQuestionsBody.length !== 0) throw new Error("Workspace question isolation after deletion failed.");
  const remainingQuestions = await fetch(`${base}/api/questions?workspace=demo-research`, { headers: ownerHeaders });
  if (remainingQuestions.status !== 200) throw new Error("Workspace read model became unavailable after deletion.");
  const questionLedger = JSON.parse(await readFile(`${runtimeDir}/workspace-questions.json`, "utf8"));
  const watchlistLedger = JSON.parse(await readFile(`${runtimeDir}/workspace-watchlists.json`, "utf8"));
  if (!questionLedger.questions.some((question) => question.id === "keep-question") || !watchlistLedger.watchlists.some((watchlist) => watchlist.id === "keep-watchlist") || questionLedger.questions.some((question) => question.id === "delete-question")) throw new Error("Another workspace's records were not preserved while deleted records remained.");
  const packet = await fetch(`${base}/api/packet`, { headers: ownerHeaders });
  if (packet.status !== 200 || !(await packet.text()).includes("trend-hunting-ai-control")) throw new Error("Shared research evidence was removed with workspace data.");
  server.child.kill("SIGTERM");
  server = start();
  await waitUntilHealthy(server.getOutput);
  const afterRestart = await fetch(`${base}/api/questions?workspace=demo-research`, { headers: ownerHeaders });
  const afterRestartBody = await afterRestart.json();
  if (afterRestart.status !== 200 || afterRestartBody.length !== 0) throw new Error("Deleted workspace records reappeared after restart.");
  console.log("Workspace deletion test passed: owner confirmation, isolation, idempotency, compatibility rewrite, and restart persistence.");
} finally {
  server.child.kill("SIGTERM");
}
