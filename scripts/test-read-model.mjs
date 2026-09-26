import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = 8793;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = `/tmp/change-intelligence-read-model-${Date.now()}`;
const child = spawn(process.execPath, [resolve(root, "server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

async function request(path) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { return await fetch(`${base}${path}`); } catch { await new Promise((wait) => setTimeout(wait, 100)); }
  }
  throw new Error(`Server did not start. ${output}`);
}

try {
  const packetResponse = await request("/api/packet");
  const packet = await packetResponse.json();
  if (packetResponse.status !== 200 || packet.operations?.workspaceAlerts || packet.operations?.questionEvaluations || packet.operations?.briefings) throw new Error("Public packet exposed workspace-private operations.");
  const evidenceResponse = await request("/api/evidence/trend-hunting-ai-control");
  const evidence = await evidenceResponse.json();
  if (evidenceResponse.status !== 200 || evidence.schemaVersion !== "evidence-inspection-v1" || evidence.record.id !== "trend-hunting-ai-control" || !evidence.source.excerpt || !evidence.insightLinks.length) throw new Error("Evidence inspection contract failed.");
  const insightResponse = await request("/api/insights/insight-ai-capability-control-gap-001");
  const insight = await insightResponse.json();
  if (insightResponse.status !== 200 || insight.schemaVersion !== "insight-inspection-v1" || insight.evidence.length < 1 || !insight.boundaries.strongestAlternative) throw new Error("Insight inspection contract failed.");
  const missingResponse = await request("/api/evidence/not-a-real-record");
  if (missingResponse.status !== 404) throw new Error("Missing evidence should return 404.");
  console.log("Read-model inspection test passed: evidence and insight chains are source-linked.");
} finally {
  child.kill("SIGTERM");
}
