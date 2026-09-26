import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = 8794;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = `/tmp/change-intelligence-storage-${Date.now()}`;
const environment = { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "research-token": "demo-researcher" }) };

async function start() {
  const child = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return child;
    } catch {}
    await new Promise((wait) => setTimeout(wait, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`API did not start. ${output}`);
}

async function stop(child) {
  await new Promise((resolveExit) => {
    child.once("exit", resolveExit);
    child.kill("SIGTERM");
  });
}

const idempotencyKey = `storage-smoke-${Date.now()}`;
const headers = { Authorization: "Bearer research-token", "Idempotency-Key": idempotencyKey, "content-type": "application/json" };
const body = JSON.stringify({ workspaceId: "demo-research", question: "Does this question survive a restart?" });
let child = await start();
try {
  const createdResponse = await fetch(`${base}/api/questions`, { method: "POST", headers, body });
  const created = await createdResponse.json();
  if (createdResponse.status !== 201) throw new Error(`Initial question write failed: ${createdResponse.status}`);
  await stop(child);
  child = await start();
  const questionsResponse = await fetch(`${base}/api/questions?workspace=demo-research`, { headers: { Authorization: "Bearer research-token" } });
  const questions = await questionsResponse.json();
  if (!questions.some((question) => question.id === created.id)) throw new Error("Question was not durable across restart.");
  const replayResponse = await fetch(`${base}/api/questions`, { method: "POST", headers, body });
  const replay = await replayResponse.json();
  if (replayResponse.status !== 201 || replay.id !== created.id) throw new Error("Idempotency operation was not durable across restart.");
  const auditResponse = await fetch(`${base}/api/audit?workspace=demo-research`, { headers: { Authorization: "Bearer research-token" } });
  const audit = await auditResponse.json();
  if (!audit.some((entry) => entry.targetId === created.id && entry.action === "create_question")) throw new Error("Audit receipt was not durable across restart.");
  console.log("Storage persistence test passed: question, audit, and idempotency state survived restart.");
} finally {
  if (child && child.exitCode === null) await stop(child);
}
