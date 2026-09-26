import { mkdtemp, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-partner-pipeline-"));
const port = 8804;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "operator-token": "ops-user", "outsider-token": "outside-user" }), OPERATOR_ACTORS_JSON: JSON.stringify(["ops-user"]) }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
const headers = { Authorization: "Bearer operator-token" };
const post = (path, body, key, authHeaders = headers) => fetch(`${base}${path}`, { method: "POST", headers: { ...authHeaders, "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
try {
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) { healthy = true; break; } } catch {}
    await new Promise((wait) => setTimeout(wait, 100));
  }
  if (!healthy) throw new Error(`API did not start. ${output}`);
  const outsiderRead = await fetch(`${base}/api/operator/partner-pipeline`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderRead.status !== 403) throw new Error(`Non-operator pipeline read was not blocked: ${outsiderRead.status}`);
  const createdResponse = await post("/api/operator/partner-pipeline", { organizationName: "Northstar Operations", domain: "ai-work-control", contactIdentity: "northstar-owner", decisionQuestion: "Which important operating changes are we missing before they affect customer commitments?", nextAction: "Schedule a discovery call with the operations owner", nextActionAt: "2026-10-01T16:00:00.000Z" }, "partner-create");
  if (createdResponse.status !== 201) throw new Error(`Partner lead creation failed: ${createdResponse.status} ${await createdResponse.text()}`);
  const lead = await createdResponse.json();
  for (const [status, note] of [["qualified", "The decision question is owned by the operations lead."], ["contacted", "Discovery invitation sent through the normal human channel."], ["invited", "The partner agreed to review a scoped pilot invitation."]]) {
    const changed = await post(`/api/operator/partner-pipeline/${encodeURIComponent(lead.id)}/state`, { status, note }, `partner-${status}`);
    if (changed.status !== 200 || (await changed.json()).status !== status) throw new Error(`Partner transition to ${status} failed.`);
  }
  const workspaceResponse = await post("/api/operator/workspaces", { name: "Northstar Operations pilot", ownerId: "northstar-owner", partnerLeadId: lead.id }, "partner-workspace");
  const workspaceBody = await workspaceResponse.json();
  if (!workspaceResponse.ok || workspaceBody.partnerLeadId !== lead.id) throw new Error(`Provisioning did not link the invited partner lead to the new workspace: ${JSON.stringify(workspaceBody)}`);
  const pipelineResponse = await fetch(`${base}/api/operator/partner-pipeline`, { headers });
  const pipeline = await pipelineResponse.json();
  if (pipelineResponse.status !== 200 || pipeline.schemaVersion !== "partner-pipeline-read-model-v1" || pipeline.counts.onboarding !== 1 || pipeline.leads[0]?.history?.length !== 5 || pipeline.leads[0]?.workspaceId !== workspaceBody.id) throw new Error("Partner pipeline read model or workspace link failed.");
  const ledger = JSON.parse(await readFile(resolve(runtimeDir, "partner-leads.json"), "utf8"));
  if (ledger.leads[0]?.status !== "onboarding" || ledger.leads[0]?.history?.length !== 5 || ledger.leads[0]?.workspaceId !== workspaceBody.id) throw new Error("Partner lead workspace link was not durable.");
  const invalid = await post(`/api/operator/partner-pipeline/${encodeURIComponent(lead.id)}/state`, { status: "expanded", note: "Invalid jump." }, "partner-invalid");
  if (invalid.status !== 409) throw new Error(`Invalid partner transition was accepted: ${invalid.status}`);
  console.log("Partner pipeline passed: operator boundary, creation, guarded transitions, read model, and durable history are connected.");
} finally { child.kill("SIGTERM"); }
