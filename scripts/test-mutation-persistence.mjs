import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRuntime = resolve(root, "data/processed/runs/ai-work-control");
const port = 8795;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = `/tmp/change-intelligence-mutations-${Date.now()}`;
const copiedLedgers = ["workspace-alerts.json", "workspace-briefings.json", "insight-candidates.json", "briefing-publications.json", "insight-decisions.json", "insight-publications.json", "review-decisions.json"];
await mkdir(runtimeDir, { recursive: true });
for (const name of copiedLedgers) {
  try { await copyFile(resolve(sourceRuntime, name), resolve(runtimeDir, name)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
await writeFile(resolve(runtimeDir, "latest-review-work.json"), `${JSON.stringify({ schemaVersion: "source-review-work-v1", reviewRequired: 1, readyForResearcher: 1, blocked: 0, candidates: [{ id: "review-test-candidate", sourceId: "trend-hunting-workflow", repository: "trend-hunting", state: "ready_for_researcher", action: "review_changed_source", reason: "Durability test", sourcePath: "README.md", sourceDigest: "test-digest", publication: "not_published" }] }, null, 2)}\n`);

const environment = { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "research-token": "demo-researcher" }) };
async function start() {
  const child = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return child; } catch {}
    await new Promise((wait) => setTimeout(wait, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`API did not start. ${output}`);
}
async function stop(child) {
  await new Promise((resolveExit) => { child.once("exit", resolveExit); child.kill("SIGTERM"); });
}
const auth = { Authorization: "Bearer research-token" };
const write = (key) => ({ ...auth, "Idempotency-Key": key, "content-type": "application/json" });
let child = await start();
try {
  const alertsResponse = await fetch(`${base}/api/alerts?workspace=demo-research`, { headers: auth });
  const alerts = await alertsResponse.json();
  const alert = alerts[0];
  if (alertsResponse.status !== 200 || !alert) throw new Error("Mutation test has no seeded alert.");
  const acknowledgedResponse = await fetch(`${base}/api/alerts/${encodeURIComponent(alert.id)}/acknowledge`, { method: "POST", headers: write(`alert-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", note: "Durability test" }) });
  if (acknowledgedResponse.status !== 200) throw new Error(`Alert acknowledgement failed: ${acknowledgedResponse.status}`);
  const briefings = JSON.parse(await readFile(resolve(runtimeDir, "workspace-briefings.json"), "utf8"));
  const briefing = briefings.briefings[0];
  briefing.state = "stale";
  briefing.previousEvidenceDigest = "previous-durability-digest";
  await writeFile(resolve(runtimeDir, "workspace-briefings.json"), `${JSON.stringify(briefings, null, 2)}\n`);
  const staleBriefingResponse = await fetch(`${base}/api/briefings/${encodeURIComponent(briefing.id)}/publish`, { method: "POST", headers: write(`briefing-stale-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", note: "Durability test" }) });
  if (staleBriefingResponse.status !== 409) throw new Error(`Stale briefing was published without re-review confirmation: ${staleBriefingResponse.status}`);
  const briefingResponse = await fetch(`${base}/api/briefings/${encodeURIComponent(briefing.id)}/publish`, { method: "POST", headers: write(`briefing-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", confirmUpdatedEvidence: true, note: "Durability test" }) });
  if (briefingResponse.status !== 200) throw new Error(`Briefing publication failed: ${briefingResponse.status}`);
  const exportResponse = await fetch(`${base}/api/briefings/${encodeURIComponent(briefing.id)}/export?workspace=demo-research`, { headers: auth });
  const exported = await exportResponse.json();
  if (exportResponse.status !== 200 || exported.schemaVersion !== "source-linked-briefing-export-v1" || !exported.evidence.length || !exportResponse.headers.get("content-disposition")) throw new Error("Source-linked briefing export failed.");
  const candidates = JSON.parse(await readFile(resolve(runtimeDir, "insight-candidates.json"), "utf8"));
  const candidate = candidates.candidates[0];
  const decisionResponse = await fetch(`${base}/api/insight-candidates/${encodeURIComponent(candidate.id)}/decision`, { method: "POST", headers: write(`decision-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", decision: "defer", note: "Durability test" }) });
  if (decisionResponse.status !== 200) throw new Error(`Insight decision failed: ${decisionResponse.status}`);
  const reviewResponse = await fetch(`${base}/api/source-review/review-test-candidate/decision`, { method: "POST", headers: write(`review-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", decision: "accept", note: "Durability test" }) });
  if (reviewResponse.status !== 200) throw new Error(`Source review decision failed: ${reviewResponse.status}`);
  await stop(child);
  child = await start();
  const restoredAlerts = await (await fetch(`${base}/api/alerts?workspace=demo-research`, { headers: auth })).json();
  if (restoredAlerts.find((item) => item.id === alert.id)?.acknowledgmentNote !== "Durability test") throw new Error("Alert acknowledgement did not survive restart.");
  const audit = await (await fetch(`${base}/api/audit?workspace=demo-research`, { headers: auth })).json();
  const actions = new Set(audit.map((entry) => entry.action));
  if (!["acknowledge_alert", "publish_briefing", "export_briefing", "decide_insight", "review_source"].every((action) => actions.has(action))) throw new Error("Mutation and export audit records did not survive restart.");
  const history = await (await fetch(`${base}/api/evidence-history`, { headers: auth })).json();
  if (!history.decisionHistory.some((decision) => decision.candidateId === "review-test-candidate")) throw new Error("Source review decision did not survive restart.");
  const timeline = await (await fetch(`${base}/api/timeline`, { headers: auth })).json();
  if (!timeline.events.some((event) => event.eventType === "source_review") || !timeline.events.some((event) => event.eventType === "briefing_republish")) throw new Error("Review timeline events did not survive restart.");
  console.log("Mutation persistence test passed: alert, briefing, insight, source-review, and timeline state survived restart.");
} finally {
  if (child && child.exitCode === null) await stop(child);
}
