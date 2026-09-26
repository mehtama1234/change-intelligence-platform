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
  const authenticated = await fetch(`${base}/api/questions`, { method: "POST", headers: { Authorization: "Bearer research-token", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", actorId: "demo-viewer", question: "Does token identity control this question?" }) });
  const result = await authenticated.json();
  if (authenticated.status !== 201 || result.createdBy !== "demo-researcher") throw new Error(`Authenticated identity was not applied: ${JSON.stringify(result)}`);
  console.log("API authentication smoke test passed: unauthenticated=401, token actor=demo-researcher.");
} finally {
  child.kill("SIGTERM");
}
