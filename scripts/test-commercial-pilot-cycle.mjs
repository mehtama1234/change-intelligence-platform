import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-commercial-pilot-"));
const port = 8798;
const base = `http://127.0.0.1:${port}`;
const auth = { Authorization: "Bearer pilot-token" };
const writeJson = async (name, value) => writeFile(resolve(runtimeDir, name), `${JSON.stringify(value, null, 2)}\n`);
await mkdir(runtimeDir, { recursive: true });
await writeJson("workspace-pilot-deliveries.json", {
  schemaVersion: "workspace-pilot-delivery-ledger-v1",
  deliveries: [1, 2, 3].map((cycle) => ({
    id: `commercial-delivery-${cycle}`,
    workspaceId: "demo-research",
    generatedAt: `2026-09-${String(10 + cycle * 5).padStart(2, "0")}T12:00:00.000Z`,
    status: "prepared",
    cadence: "monthly",
    refreshRunId: `commercial-refresh-${cycle}`,
    headline: `Cycle ${cycle} source-linked intelligence handoff`,
    successMeasures: ["Useful evidence reviewed", "Decision made faster"],
    briefings: [{ id: `briefing-commercial-${cycle}`, workspaceId: "demo-research", state: "draft", evidenceDigest: `digest-${cycle}`, evidence: [] }],
    snapshot: { openAlerts: cycle, unavailableSourceIds: [] },
    evaluation: { state: "requires_partner_review" }
  }))
});
for (const [name, value] of Object.entries({
  "audit-log.json": { entries: [] },
  "idempotency-operations.json": { schemaVersion: "idempotency-ledger-v1", operations: [] },
  "workspace-pilot-profiles.json": { profiles: [] },
  "workspace-pilot-decisions.json": { decisions: [] },
  "pilot-readiness.json": { snapshots: [] },
  "workspace-delivery-notifications.json": { notifications: [] },
  "decision-outcomes.json": { outcomes: [] },
  "workspace-questions.json": { questions: [] },
  "question-evaluations.json": { evaluations: [] },
  "workspace-briefings.json": { briefings: [] },
  "briefing-publications.json": { publications: [] },
  "insight-publications.json": { publications: [] },
  "latest-refresh.json": { status: "complete", runId: "commercial-refresh-3" },
  "refresh-history.json": { runs: [] },
  "workspace-alerts.json": { alerts: [] },
  "operator-warning-events.json": { events: [] },
  "workspace-notification-preferences.json": { preferences: [] }
})) await writeJson(name, value);

const child = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "pilot-token": "demo-owner" }) }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
  await new Promise((wait) => setTimeout(wait, 100));
  if (attempt === 49) throw new Error(`API did not start. ${output}`);
}
const post = async (path, body, key) => fetch(`${base}${path}`, { method: "POST", headers: { ...auth, "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
try {
  const configure = await post("/api/workspace-pilot", { workspaceId: "demo-research", decisionQuestion: "Which source-backed changes should this team act on next?", decisionContext: "Three-cycle commercial pilot proof.", cadence: "monthly", successMeasures: ["Useful evidence reviewed", "Decision made faster"], nextReviewAt: "2026-10-31" }, "configure-commercial-pilot");
  if (configure.status !== 200) throw new Error(`Pilot configuration failed: ${configure.status}`);
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const response = await post(`/api/pilot-deliveries/commercial-delivery-${cycle}/review`, { workspaceId: "demo-research", usefulness: "useful", decisionImpact: cycle === 1 ? "informed_decision" : "changed_decision", correctionType: "none", note: `Cycle ${cycle} helped the team review the decision question.`, measureAssessments: [{ name: "Useful evidence reviewed", state: "met" }, { name: "Decision made faster", state: "met" }] }, `review-commercial-delivery-${cycle}`);
    if (response.status !== 200) throw new Error(`Cycle ${cycle} review failed: ${response.status}`);
  }
  const report = await (await fetch(`${base}/api/pilot-report?workspace=demo-research`, { headers: auth })).json();
  if (report.observation.reviewedDeliveries !== 3 || report.usefulness.rate !== 1 || report.decisionImpact.changedDecision !== 2 || report.decisionImpact.informedDecision !== 1 || report.checkpoint.state !== "enough_observations_for_checkpoint") throw new Error("Pilot report did not aggregate three reviewed cycles and decision impact.");
  const readiness = await (await fetch(`${base}/api/workspace-commercial-readiness?workspace=demo-research`, { headers: auth })).json();
  if (readiness.recommendation !== "expand" || !readiness.eligibility.enoughReviewedDeliveries || !readiness.eligibility.decisionImpactRecorded || readiness.eligibility.failedMeasures !== 0) throw new Error(`Commercial readiness did not produce the expected expand recommendation: ${JSON.stringify(readiness)}`);
  const checkpoint = await post("/api/pilot-report/decision", { workspaceId: "demo-research", decision: "expand", note: "Three reviewed cycles were useful and changed or informed decisions without a failed measure.", nextStep: "Offer the recurring intelligence subscription to the design partner." }, "commercial-pilot-checkpoint");
  if (checkpoint.status !== 201) throw new Error(`Pilot checkpoint failed: ${checkpoint.status}`);
  const finalReadiness = await (await fetch(`${base}/api/workspace-commercial-readiness?workspace=demo-research`, { headers: auth })).json();
  const finalReport = await (await fetch(`${base}/api/pilot-report?workspace=demo-research`, { headers: auth })).json();
  if (finalReadiness.latestRecordedDecision?.decision !== "expand" || !finalReport.decisionHistory?.some((decision) => decision.decision === "expand")) throw new Error("Commercial checkpoint was not retained in pilot history.");
  console.log("Commercial pilot cycle passed: configuration, three reviewed deliveries, decision impact, readiness, and human expand checkpoint are connected.");
} finally { child.kill("SIGTERM"); }
