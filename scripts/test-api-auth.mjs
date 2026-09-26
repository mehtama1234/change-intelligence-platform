import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = 8791;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [resolve(root, "server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(port), AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "research-token": "demo-researcher" }) },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });

try {
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) { healthy = true; break; }
    } catch {}
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 100));
  }
  if (!healthy) throw new Error(`API did not start. ${output}`);
  const unauthenticated = await fetch(`${base}/api/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", question: "Unauthenticated question" }) });
  if (unauthenticated.status !== 401) throw new Error(`Expected 401, received ${unauthenticated.status}`);
  const idempotencyKey = `auth-smoke-${Date.now()}`;
  const request = { method: "POST", headers: { Authorization: "Bearer research-token", "Idempotency-Key": idempotencyKey, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", actorId: "demo-viewer", question: "Does token identity control this question?" }) };
  const authenticated = await fetch(`${base}/api/questions`, request);
  const result = await authenticated.json();
  if (authenticated.status !== 201 || result.createdBy !== "demo-researcher") throw new Error(`Authenticated identity was not applied: ${JSON.stringify(result)}`);
  const retry = await fetch(`${base}/api/questions`, request);
  const retryResult = await retry.json();
  if (retry.status !== 201 || retryResult.id !== result.id) throw new Error(`Idempotent retry did not replay original result: ${JSON.stringify(retryResult)}`);
  if (!authenticated.headers.get("x-request-id")) throw new Error("Write response did not include a request ID.");
  const auditResponse = await fetch(`${base}/api/audit?workspace=demo-research`);
  const audit = await auditResponse.json();
  if (!audit.some((entry) => entry.targetId === result.id && entry.actorId === "demo-researcher")) throw new Error("Question audit receipt was not written.");
  console.log("API authentication smoke test passed: unauthenticated=401, token actor=demo-researcher.");
} finally {
  child.kill("SIGTERM");
}
