import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-support-"));
const port = 8799;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [resolve(root, "server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "pilot-token": "demo-owner", "operator-token": "ops", "outsider-token": "other" }), OPERATOR_ACTORS_JSON: JSON.stringify(["ops"]) },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
  await new Promise((wait) => setTimeout(wait, 100));
  if (attempt === 49) throw new Error(`API did not start. ${output}`);
}
const post = (path, token, body, key) => fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
const get = (path, token) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
try {
  const created = await post("/api/support-requests", "pilot-token", { workspaceId: "demo-research", category: "delivery", severity: "urgent", summary: "The handoff needs investigation", details: "The latest delivery appears to omit an expected source passage." }, "support-create-1");
  if (created.status !== 201) throw new Error(`Support request creation failed: ${created.status}`);
  const request = await created.json();
  const customerRead = await get("/api/support-requests?workspace=demo-research", "pilot-token");
  const customerBody = await customerRead.json();
  if (customerRead.status !== 200 || customerBody.requests?.[0]?.id !== request.id || customerBody.requests[0].details !== "The latest delivery appears to omit an expected source passage.") throw new Error("Customer support read model did not preserve the workspace request.");
  const outsiderRead = await get("/api/support-requests?workspace=demo-research", "outsider-token");
  if (outsiderRead.status !== 403) throw new Error(`Outsider was able to read support request: ${outsiderRead.status}`);
  const operatorRead = await get("/api/operator/support-requests", "operator-token");
  if (operatorRead.status !== 200 || !(await operatorRead.json()).requests.some((item) => item.id === request.id)) throw new Error("Operator support queue did not expose the request.");
  const overview = await (await get("/api/operator/pilot-overview", "operator-token")).json();
  if (overview.aggregate.openSupportRequests !== 1 || overview.aggregate.urgentSupportRequests !== 1 || overview.workspaces.find((workspace) => workspace.id === "demo-research")?.openSupportRequests !== 1) throw new Error("Operator overview did not aggregate open and urgent support workload.");
  const updated = await post(`/api/operator/support-requests/${encodeURIComponent(request.id)}/state`, "operator-token", { status: "resolved", note: "The source trace was checked and the handoff was corrected for the next cycle." }, "support-resolve-1");
  if (updated.status !== 200) throw new Error(`Support request resolution failed: ${updated.status}`);
  const resolved = await (await get("/api/support-requests?workspace=demo-research", "pilot-token")).json();
  if (resolved.requests[0].status !== "resolved" || resolved.requests[0].history.length !== 2 || resolved.requests[0].operatorNote === null) throw new Error("Support resolution was not retained with its history.");
  console.log("Support workflow passed: tenant-safe request creation, operator handling, resolution history, and privacy boundaries are connected.");
} finally { child.kill("SIGTERM"); }
