import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = 8791;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = `/tmp/change-intelligence-api-auth-${Date.now()}`;
await mkdir(runtimeDir, { recursive: true });
await writeFile(`${runtimeDir}/review-events.json`, `${JSON.stringify({ schemaVersion: "review-event-ledger-v1", events: [{ id: "private-event", eventType: "briefing_republish", workspaceId: "other-private-workspace", targetId: "private-briefing", occurredAt: new Date().toISOString() }] }, null, 2)}\n`);
const child = spawn(process.execPath, [resolve(root, "server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "research-token": "demo-researcher", "outsider-token": "outside-user", "operator-token": "ops-user" }), OPERATOR_ACTORS_JSON: JSON.stringify(["ops-user"]), OPERATOR_MAX_FAILED_REFRESHES: "-1" },
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
  const unauthenticatedRead = await fetch(`${base}/api/questions?workspace=demo-research`);
  if (unauthenticatedRead.status !== 401) throw new Error(`Expected unauthenticated workspace read to return 401, received ${unauthenticatedRead.status}`);
  const authHeaders = { Authorization: "Bearer research-token" };
  const visibleQuestions = await fetch(`${base}/api/questions?workspace=demo-research`, { headers: authHeaders });
  if (visibleQuestions.status !== 200) throw new Error(`Authenticated workspace read failed: ${visibleQuestions.status}`);
  const outsiderRead = await fetch(`${base}/api/questions?workspace=demo-research`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderRead.status !== 403) throw new Error(`Expected non-member workspace read to return 403, received ${outsiderRead.status}`);
  const outsiderTimeline = await fetch(`${base}/api/timeline?workspace=demo-research`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderTimeline.status !== 403) throw new Error(`Expected non-member timeline read to return 403, received ${outsiderTimeline.status}`);
  const memberTimeline = await fetch(`${base}/api/timeline?workspace=demo-research`, { headers: authHeaders });
  const memberTimelineBody = await memberTimeline.json();
  if (memberTimeline.status !== 200 || memberTimelineBody.events.some((event) => event.id === "private-event")) throw new Error("Workspace timeline leaked an event from another workspace.");
  const outsiderUsage = await fetch(`${base}/api/usage?workspace=demo-research`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderUsage.status !== 403) throw new Error(`Expected non-member usage read to return 403, received ${outsiderUsage.status}`);
  const outsiderUpdate = await fetch(`${base}/api/workspace-update?workspace=demo-research`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderUpdate.status !== 403) throw new Error(`Expected non-member workspace update read to return 403, received ${outsiderUpdate.status}`);
  const memberUpdate = await fetch(`${base}/api/workspace-update?workspace=demo-research`, { headers: authHeaders });
  if (memberUpdate.status !== 200) throw new Error(`Workspace member update read failed: ${memberUpdate.status}`);
  const outsiderPilot = await fetch(`${base}/api/workspace-pilot?workspace=demo-research`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderPilot.status !== 403) throw new Error(`Expected non-member pilot read to return 403, received ${outsiderPilot.status}`);
  const outsiderDeliveries = await fetch(`${base}/api/pilot-deliveries?workspace=demo-research`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderDeliveries.status !== 403) throw new Error(`Expected non-member pilot delivery read to return 403, received ${outsiderDeliveries.status}`);
  const outsiderReport = await fetch(`${base}/api/pilot-report?workspace=demo-research`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderReport.status !== 403) throw new Error(`Expected non-member pilot report read to return 403, received ${outsiderReport.status}`);
  const outsiderOperator = await fetch(`${base}/api/operator/pilot-overview`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderOperator.status !== 403) throw new Error(`Expected non-operator overview read to return 403, received ${outsiderOperator.status}`);
  const operatorOverview = await fetch(`${base}/api/operator/pilot-overview`, { headers: { Authorization: "Bearer operator-token" } });
  const operatorBody = await operatorOverview.json();
  if (operatorOverview.status !== 200 || operatorBody.schemaVersion !== "operator-pilot-overview-v1" || !Array.isArray(operatorBody.workspaces) || !Array.isArray(operatorBody.trend) || !Array.isArray(operatorBody.warnings) || !operatorBody.thresholds || (operatorBody.trend[0] && !Object.hasOwn(operatorBody.trend[0], "falseAlerts")) || !operatorBody.operations || !Number.isInteger(operatorBody.aggregate.openAlerts) || JSON.stringify(operatorBody).includes("private-event")) throw new Error("Operator overview contract or privacy boundary failed.");
  const warning = operatorBody.warnings[0];
  if (!warning) throw new Error("Operator warning fixture was not generated.");
  const warningAction = await fetch(`${base}/api/operator/warnings/${encodeURIComponent(warning.id)}/state`, { method: "POST", headers: { Authorization: "Bearer operator-token", "Idempotency-Key": "operator-warning-action", "content-type": "application/json" }, body: JSON.stringify({ state: "acknowledged", ownerId: "ops-owner", escalationState: "escalated", observedAt: warning.observedAt, note: "Investigating the configured test threshold." }) });
  if (warningAction.status !== 200) throw new Error(`Operator warning action failed: ${warningAction.status}`);
  const acknowledgedOverview = await (await fetch(`${base}/api/operator/pilot-overview`, { headers: { Authorization: "Bearer operator-token" } })).json();
  const acknowledgedWarning = acknowledgedOverview.warnings.find((item) => item.id === warning.id);
  if (acknowledgedWarning?.lifecycle !== "acknowledged" || acknowledgedWarning.ownerId !== "ops-owner" || acknowledgedWarning.escalationState !== "escalated" || !Number.isFinite(acknowledgedWarning.responseTimeMs)) throw new Error("Operator warning state, ownership, escalation, or response time did not persist in the overview.");
  const outsiderDecision = await fetch(`${base}/api/pilot-report/decision`, { method: "POST", headers: { Authorization: "Bearer outsider-token", "Idempotency-Key": "outsider-pilot-decision", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", decision: "continue", note: "No", nextStep: "No" }) });
  if (outsiderDecision.status !== 403) throw new Error(`Expected non-member pilot decision write to return 403, received ${outsiderDecision.status}`);
  const memberUsage = await fetch(`${base}/api/usage?workspace=demo-research`, { headers: authHeaders });
  if (memberUsage.status !== 200) throw new Error(`Workspace member usage read failed: ${memberUsage.status}`);
  const outsiderEvidence = await fetch(`${base}/api/evidence/trend-hunting-ai-control?workspace=demo-research`, { headers: { Authorization: "Bearer outsider-token" } });
  if (outsiderEvidence.status !== 403) throw new Error(`Expected non-member evidence inspection to return 403, received ${outsiderEvidence.status}`);
  const outsiderWorkspaces = await fetch(`${base}/api/workspaces`, { headers: { Authorization: "Bearer outsider-token" } });
  const outsiderWorkspaceList = await outsiderWorkspaces.json();
  if (outsiderWorkspaces.status !== 200 || outsiderWorkspaceList.length !== 0) throw new Error("Non-member should see no workspaces.");
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
  const auditResponse = await fetch(`${base}/api/audit?workspace=demo-research`, { headers: authHeaders });
  const audit = await auditResponse.json();
  if (!audit.some((entry) => entry.targetId === result.id && entry.actorId === "demo-researcher")) throw new Error("Question audit receipt was not written.");
  console.log("API authentication smoke test passed: unauthenticated=401, token actor=demo-researcher.");
} finally {
  child.kill("SIGTERM");
}
