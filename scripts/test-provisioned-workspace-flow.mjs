import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = 8792;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = `/tmp/change-intelligence-provisioned-flow-${Date.now()}`;
const auth = { Authorization: "Bearer owner-token" };
const operatorAuth = { Authorization: "Bearer operator-token" };

await mkdir(runtimeDir, { recursive: true });

function startServer() {
  const child = spawn(process.execPath, [resolve(root, "server.mjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "owner-token": "flow-owner", "operator-token": "flow-operator" }), OPERATOR_ACTORS_JSON: JSON.stringify(["flow-operator"]) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  return { child, getOutput: () => output };
}

async function waitForHealth(server) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error(`API did not start. ${server.getOutput()}`);
}

async function stopServer(server) {
  server.child.kill("SIGTERM");
  await new Promise((resolveExit) => server.child.once("exit", resolveExit));
}

async function post(path, headers, body, key) {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { ...headers, "Idempotency-Key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(result)}`);
  return result;
}

let server = startServer();
try {
  await waitForHealth(server);
  const workspace = await post("/api/operator/workspaces", operatorAuth, { name: "Provisioned lifecycle partner", ownerId: "flow-owner" }, "flow-provision");
  const workspaceId = workspace.id;
  const profile = await post("/api/workspace-pilot", auth, { workspaceId, decisionQuestion: "What evidence links AI adoption to productivity and worker control?", decisionContext: "First lifecycle handoff test.", cadence: "monthly", successMeasures: ["Useful evidence reviewed"], nextReviewAt: "2026-10-31" }, "flow-profile");
  if (profile.workspaceId !== workspaceId) throw new Error("Pilot profile was not assigned to the provisioned workspace.");
  const watchlist = await post("/api/watchlists", auth, { workspaceId, name: "AI work evidence", repositoryIds: ["cultural-geopolitical-theme-mining"] }, "flow-watchlist");
  const question = await post("/api/questions", auth, { workspaceId, question: "What evidence links AI adoption to productivity and worker control?", scope: { watchlistIds: [watchlist.id] } }, "flow-question");
  if (question.workspaceId !== workspaceId) throw new Error("Question was not assigned to the provisioned workspace.");
  const before = await (await fetch(`${base}/api/workspace-onboarding?workspace=${encodeURIComponent(workspaceId)}`, { headers: auth })).json();
  if (before.status !== "ready_for_first_delivery") throw new Error(`Expected readiness for first delivery, received ${before.status}.`);
  const queuedSchedule = await (await fetch(`${base}/api/workspace-schedule?workspace=${encodeURIComponent(workspaceId)}`, { headers: auth })).json();
  if (queuedSchedule.status !== "queued_for_first_refresh" || queuedSchedule.eligible !== true) throw new Error(`Configured workspace did not enter the next-refresh queue: ${JSON.stringify(queuedSchedule)}`);
  await stopServer(server);
  server = null;

  await exec(process.execPath, [resolve(root, "scripts/run-refresh-cycle.mjs")], { cwd: root, env: { ...process.env, RUNTIME_DATA_DIR: runtimeDir, REFRESH_RUN_ID: "provisioned-flow-refresh", REFRESH_SKIP_SEC: "1" }, maxBuffer: 20 * 1024 * 1024 });

  server = startServer();
  await waitForHealth(server);
  const deliveriesResponse = await fetch(`${base}/api/pilot-deliveries?workspace=${encodeURIComponent(workspaceId)}`, { headers: auth });
  const deliveries = await deliveriesResponse.json();
  if (deliveriesResponse.status !== 200 || deliveries.deliveries.length !== 1 || deliveries.deliveries[0].workspaceId !== workspaceId || deliveries.deliveries[0].status !== "prepared") throw new Error(`First provisioned handoff was not available as a prepared delivery: ${JSON.stringify(deliveries)}`);
  const delivery = deliveries.deliveries[0];
  if (delivery.briefings?.length !== 1 || delivery.briefings[0].state !== "draft" || !delivery.briefings[0].evidenceDigest) throw new Error(`First handoff did not carry a reviewable briefing: ${JSON.stringify(delivery.briefings)}`);
  const evaluations = JSON.parse(await readFile(`${runtimeDir}/question-evaluations.json`, "utf8"));
  const evaluation = evaluations.evaluations.find((item) => item.questionId === question.id);
  if (evaluation?.state !== "evidence_retrieved" || evaluation.matchedRecordIds.length < 2 || !evaluation.matches.some((match) => match.matchedConcepts.includes("outcome")) || !evaluation.matches.some((match) => match.matchedConcepts.includes("control"))) throw new Error(`Question did not retrieve bounded productivity/control evidence: ${JSON.stringify(evaluation)}`);
  const refreshReceipt = JSON.parse(await readFile(`${runtimeDir}/latest-refresh.json`, "utf8"));
  if (refreshReceipt.status !== "complete" || deliveries.deliveries[0].refreshRunId !== "provisioned-flow-refresh") throw new Error(`The actual refresh cycle did not complete for the provisioned workspace: ${JSON.stringify(refreshReceipt)}`);
  const refreshOutcomes = JSON.parse(await readFile(`${runtimeDir}/workspace-refresh-outcomes.json`, "utf8"));
  if (!Array.isArray(refreshOutcomes.outcomes) || refreshOutcomes.outcomes.find((outcome) => outcome.workspaceId === workspaceId)?.reason !== "notification_pending") throw new Error(`Workspace refresh outcome ledger did not wait for customer acceptance: ${JSON.stringify(refreshOutcomes)}`);
  const handoffNotifications = await (await fetch(`${base}/api/workspace-delivery-notifications?workspace=${encodeURIComponent(workspaceId)}`, { headers: auth })).json();
  if (!handoffNotifications.notifications.some((notification) => notification.type === "pilot_delivery" && notification.deliveryId === deliveries.deliveries[0].id && notification.status === "pending")) throw new Error("The actual refresh cycle did not create the first handoff notification.");
  const handoffNotification = handoffNotifications.notifications.find((notification) => notification.type === "pilot_delivery" && notification.deliveryId === deliveries.deliveries[0].id);
  const acknowledged = await post(`/api/workspace-delivery-notifications/${encodeURIComponent(handoffNotification.id)}/acknowledge`, auth, { workspaceId }, "flow-handoff-ack");
  if (acknowledged.status !== "acknowledged" || acknowledged.acknowledgedBy !== "flow-owner") throw new Error("Customer acknowledgment did not persist for the prepared handoff.");
  const acknowledgedOutcomes = JSON.parse(await readFile(`${runtimeDir}/workspace-refresh-outcomes.json`, "utf8"));
  const resolvedOutcome = acknowledgedOutcomes.outcomes.find((outcome) => outcome.workspaceId === workspaceId);
  if (resolvedOutcome?.status !== "resolved" || resolvedOutcome.resolution !== "customer_acknowledged" || !Number.isFinite(resolvedOutcome.timeToResolutionMs)) throw new Error(`Customer acknowledgment did not close the workspace outcome with timing: ${JSON.stringify(acknowledgedOutcomes)}`);
  const afterResponse = await fetch(`${base}/api/workspace-onboarding?workspace=${encodeURIComponent(workspaceId)}`, { headers: auth });
  const after = await afterResponse.json();
  if (after.status !== "active" || after.steps.find((step) => step.id === "first_delivery")?.status !== "ready") throw new Error(`Onboarding did not become active after the first handoff: ${JSON.stringify(after)}`);
  const deliveredSchedule = await (await fetch(`${base}/api/workspace-schedule?workspace=${encodeURIComponent(workspaceId)}`, { headers: auth })).json();
  if (deliveredSchedule.status !== "first_delivery_ready" || deliveredSchedule.latestDeliveryId !== deliveries.deliveries[0].id) throw new Error(`Workspace schedule did not record the first handoff: ${JSON.stringify(deliveredSchedule)}`);
  const operatorOverview = await (await fetch(`${base}/api/operator/pilot-overview`, { headers: operatorAuth })).json();
  const operatorWorkspace = operatorOverview.workspaces.find((candidate) => candidate.id === workspaceId);
  if (!operatorWorkspace || operatorWorkspace.onboarding?.status !== "active" || operatorWorkspace.deliveries !== 1 || operatorWorkspace.schedule?.status !== "first_delivery_ready") throw new Error("Operator overview did not include the provisioned workspace's first handoff schedule.");
  const registry = JSON.parse(await readFile(`${runtimeDir}/workspace-registry.json`, "utf8"));
  if (!registry.workspaces.some((candidate) => candidate.id === workspaceId)) throw new Error("Provisioned workspace registry entry was lost.");
  console.log("Provisioned workspace flow passed: runtime tenant, pilot configuration, first handoff, restart recovery, and operator visibility are connected.");
} finally {
  if (server) await stopServer(server);
}
