import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const exec = promisify(execFile);
const sourceRuntime = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const port = 8795;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = `/tmp/change-intelligence-mutations-${Date.now()}`;
const copiedLedgers = ["workspace-alerts.json", "workspace-briefings.json", "insight-candidates.json", "briefing-publications.json", "insight-decisions.json", "insight-publications.json", "decision-outcomes.json", "workspace-watchlists.json", "review-decisions.json"];
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
  const watchlistResponse = await fetch(`${base}/api/watchlists`, { method: "POST", headers: write(`watchlist-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", name: "Durability watchlist", sourceIds: ["trend-hunting-ai-control"], alertOn: ["changed", "missing"] }) });
  if (watchlistResponse.status !== 201) throw new Error(`Watchlist creation failed: ${watchlistResponse.status}`);
  const comparisonResponse = await fetch(`${base}/api/comparison-views`, { method: "POST", headers: write(`comparison-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", name: "AI platform comparison", kind: "companies", entityIds: ["company:nvidia", "company:microsoft"] }) });
  if (comparisonResponse.status !== 201) throw new Error(`Comparison view creation failed: ${comparisonResponse.status}`);
  const preferenceResponse = await fetch(`${base}/api/notification-preferences`, { method: "POST", headers: write(`notification-preference-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", comparisonAlerts: false, sourceAlerts: true, deliveryUpdates: false }) });
  if (preferenceResponse.status !== 200) throw new Error(`Notification preference update failed: ${preferenceResponse.status}`);
  const profileResponse = await fetch(`${base}/api/workspace-pilot`, { method: "POST", headers: write(`pilot-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", decisionQuestion: "Which control changes should this team act on next?", decisionContext: "Pilot setup durability test.", cadence: "monthly", successMeasures: ["Time to answer the question", "Useful alerts reviewed"], nextReviewAt: "2026-10-31" }) });
  if (profileResponse.status !== 200) throw new Error(`Pilot profile creation failed: ${profileResponse.status}`);
  await exec(process.execPath, [resolve(root, "scripts/build-pilot-deliveries.mjs")], { cwd: root, env: { ...environment, REFRESH_RUN_ID: "mutation-delivery" } });
  await exec(process.execPath, [resolve(root, "scripts/sync-runtime-store.mjs")], { cwd: root, env: environment });
  const deliveries = await (await fetch(`${base}/api/pilot-deliveries?workspace=demo-research`, { headers: auth })).json();
  const delivery = deliveries.deliveries[0];
  if (!delivery) throw new Error("Pilot delivery was not generated.");
  const deliveryReviewResponse = await fetch(`${base}/api/pilot-deliveries/${encodeURIComponent(delivery.id)}/review`, { method: "POST", headers: write(`delivery-review-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", usefulness: "useful", decisionImpact: "informed_decision", correctionType: "missing_context", correctionNote: "The handoff needs the affected worker group named explicitly.", measureAssessments: [{ name: "Time to answer the question", state: "partially_met" }, { name: "Useful alerts reviewed", state: "met" }], note: "The delivery gave the team a clear next check." }) });
  if (deliveryReviewResponse.status !== 200) throw new Error(`Pilot delivery review failed: ${deliveryReviewResponse.status}`);
  const pilotDecisionResponse = await fetch(`${base}/api/pilot-report/decision`, { method: "POST", headers: write(`pilot-decision-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", decision: "continue", note: "The first delivery was useful, but more observations are needed.", nextStep: "Run two more monthly refresh cycles." }) });
  if (pilotDecisionResponse.status !== 201) throw new Error(`Pilot checkpoint failed: ${pilotDecisionResponse.status}`);
  const acknowledgedResponse = await fetch(`${base}/api/alerts/${encodeURIComponent(alert.id)}/acknowledge`, { method: "POST", headers: write(`alert-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", note: "Durability test" }) });
  if (acknowledgedResponse.status !== 200) throw new Error(`Alert acknowledgement failed: ${acknowledgedResponse.status}`);
  const resolvedResponse = await fetch(`${base}/api/alerts/${encodeURIComponent(alert.id)}/resolve`, { method: "POST", headers: write(`resolve-alert-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", disposition: "useful", note: "Durability test" }) });
  if (resolvedResponse.status !== 200) throw new Error(`Alert resolution failed: ${resolvedResponse.status}`);
  const briefings = JSON.parse(await readFile(resolve(runtimeDir, "workspace-briefings.json"), "utf8"));
  const briefing = briefings.briefings[0];
  briefing.state = "stale";
  briefing.previousEvidenceDigest = "previous-durability-digest";
  if (briefing.insightProvenance?.some((insight) => insight.state === "stale")) {
    const staleInsightBriefingResponse = await fetch(`${base}/api/briefings/${encodeURIComponent(briefing.id)}/publish`, { method: "POST", headers: write(`briefing-stale-insight-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", confirmUpdatedEvidence: true, note: "Must re-review linked insight first." }) });
    if (staleInsightBriefingResponse.status !== 409) throw new Error(`Briefing with stale insight was republished: ${staleInsightBriefingResponse.status}`);
  }
  delete briefing.insightProvenance;
  await writeFile(resolve(runtimeDir, "workspace-briefings.json"), `${JSON.stringify(briefings, null, 2)}\n`);
  const staleBriefingResponse = await fetch(`${base}/api/briefings/${encodeURIComponent(briefing.id)}/publish`, { method: "POST", headers: write(`briefing-stale-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", note: "Durability test" }) });
  if (staleBriefingResponse.status !== 409) throw new Error(`Stale briefing was published without re-review confirmation: ${staleBriefingResponse.status}`);
  const briefingResponse = await fetch(`${base}/api/briefings/${encodeURIComponent(briefing.id)}/publish`, { method: "POST", headers: write(`briefing-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", confirmUpdatedEvidence: true, note: "Durability test" }) });
  if (briefingResponse.status !== 200) throw new Error(`Briefing publication failed: ${briefingResponse.status}`);
  const exportResponse = await fetch(`${base}/api/briefings/${encodeURIComponent(briefing.id)}/export?workspace=demo-research`, { headers: auth });
  const exported = await exportResponse.json();
  if (exportResponse.status !== 200 || exported.schemaVersion !== "source-linked-briefing-export-v1" || !exported.evidence.length || !exportResponse.headers.get("content-disposition")) throw new Error("Source-linked briefing export failed.");
  const outcomeResponse = await fetch(`${base}/api/briefings/${encodeURIComponent(briefing.id)}/outcome`, { method: "POST", headers: write(`outcome-${Date.now()}`), body: JSON.stringify({ workspaceId: "demo-research", decisionState: "used", outcomeState: "held", decisionSummary: "Used to prioritize a source review.", outcomeNote: "The next refresh is still being monitored." }) });
  if (outcomeResponse.status !== 201) throw new Error(`Decision outcome recording failed: ${outcomeResponse.status}`);
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
  if (!["acknowledge_alert", "resolve_alert", "create_watchlist", "configure_pilot", "review_pilot_delivery", "decide_pilot", "publish_briefing", "export_briefing", "record_decision_outcome", "decide_insight", "review_source"].every((action) => actions.has(action))) throw new Error("Mutation and export audit records did not survive restart.");
  const history = await (await fetch(`${base}/api/evidence-history`, { headers: auth })).json();
  if (!history.decisionHistory.some((decision) => decision.candidateId === "review-test-candidate")) throw new Error("Source review decision did not survive restart.");
  const traceEvidence = await fetch(`${base}/api/evidence/trend-hunting-ai-control?workspace=demo-research`, { headers: auth });
  const traceInsight = await fetch(`${base}/api/insights/insight-ai-capability-control-gap-001?workspace=demo-research`, { headers: auth });
  if (traceEvidence.status !== 200 || traceInsight.status !== 200) throw new Error("Authenticated source-trace inspections failed.");
  const usage = await (await fetch(`${base}/api/usage?workspace=demo-research`, { headers: auth })).json();
  if (usage.measures.evidenceInspections < 1 || usage.measures.insightInspections < 1 || usage.measures.briefingsExported < 1 || usage.measures.decisionOutcomesRecorded < 1 || usage.measures.watchlistsCreated < 1 || usage.measures.alertsResolved < 1) throw new Error("Workspace usage did not count source tracing, export, decision feedback, watchlist, and alert actions.");
  const pilot = await (await fetch(`${base}/api/pilot-metrics?workspace=demo-research`, { headers: auth })).json();
  if (pilot.measures.alertsResolved < 1 || pilot.measures.usefulAlerts < 1 || pilot.measures.decisionFeedbackRecords < 1 || pilot.measures.decisionsUsingBriefings < 1 || pilot.measures.readingsHeld < 1) throw new Error("Pilot metrics did not aggregate durable alert and decision outcomes.");
  const watchlists = await (await fetch(`${base}/api/watchlists?workspace=demo-research`, { headers: auth })).json();
  if (!watchlists.some((watchlist) => watchlist.name === "Durability watchlist")) throw new Error("Watchlist did not survive restart.");
  const comparisonViewsResponse = await fetch(`${base}/api/comparison-views?workspace=demo-research`, { headers: auth });
  const comparisonViews = await comparisonViewsResponse.json();
  if (comparisonViewsResponse.status !== 200 || !comparisonViews.some((view) => view.name === "AI platform comparison" && view.entityIds.length === 2 && ["current", "changed"].includes(view.freshness.status))) throw new Error("Comparison view did not survive restart or refresh status was missing.");
  const preferencesResponse = await fetch(`${base}/api/notification-preferences?workspace=demo-research`, { headers: auth });
  const preferences = await preferencesResponse.json();
  if (preferencesResponse.status !== 200 || preferences.schemaVersion !== "workspace-notification-preference-read-model-v1" || preferences.preferences.comparisonAlerts !== false || preferences.preferences.deliveryUpdates !== false) throw new Error("Notification preferences did not survive restart.");
  const notificationHistoryResponse = await fetch(`${base}/api/workspace-notifications?workspace=demo-research`, { headers: auth });
  const notificationHistory = await notificationHistoryResponse.json();
  if (notificationHistoryResponse.status !== 200 || notificationHistory.schemaVersion !== "workspace-notification-read-model-v1" || !Array.isArray(notificationHistory.alerts) || notificationHistory.preferences.comparisonAlerts !== false) throw new Error("Workspace notification history read model failed after restart.");
  const deliveryNotificationResponse = await fetch(`${base}/api/workspace-delivery-notifications?workspace=demo-research`, { headers: auth });
  const deliveryNotifications = await deliveryNotificationResponse.json();
  if (deliveryNotificationResponse.status !== 200 || deliveryNotifications.schemaVersion !== "workspace-delivery-notification-read-model-v1" || !deliveryNotifications.notifications.some((notification) => notification.deliveryId === delivery.id && notification.status === "suppressed")) throw new Error("Customer delivery notification did not survive restart or respect the workspace preference.");
  const pilotProfile = await (await fetch(`${base}/api/workspace-pilot?workspace=demo-research`, { headers: auth })).json();
  if (pilotProfile.profile?.decisionQuestion !== "Which control changes should this team act on next?" || pilotProfile.profile?.cadence !== "monthly") throw new Error("Pilot profile did not survive restart.");
  const restoredDeliveries = await (await fetch(`${base}/api/pilot-deliveries?workspace=demo-research`, { headers: auth })).json();
  if (restoredDeliveries.deliveries.find((item) => item.id === delivery.id)?.review?.usefulness !== "useful") throw new Error("Pilot delivery review did not survive restart.");
  const learningReport = await (await fetch(`${base}/api/pilot-report?workspace=demo-research`, { headers: auth })).json();
  if (learningReport.observation.reviewedDeliveries < 1 || learningReport.usefulness.useful < 1 || learningReport.decisionImpact.informedDecision < 1 || learningReport.corrections?.missingContext !== 1 || learningReport.latestDecision?.decision !== "continue" || !learningReport.measures.some((measure) => measure.latestState === "met")) throw new Error("Pilot learning report did not aggregate the reviewed delivery, correction, and checkpoint.");
  const outcomes = await (await fetch(`${base}/api/decision-outcomes?workspace=demo-research`, { headers: auth })).json();
  if (!outcomes.some((outcome) => outcome.briefingId === briefing.id && outcome.outcomeState === "held")) throw new Error("Decision outcome did not survive restart.");
  const timeline = await (await fetch(`${base}/api/timeline`, { headers: auth })).json();
  if (!timeline.events.some((event) => event.eventType === "source_review") || !timeline.events.some((event) => event.eventType === "briefing_republish") || !timeline.events.some((event) => event.eventType === "decision_outcome") || !timeline.events.some((event) => event.eventType === "alert_resolution") || !timeline.events.some((event) => event.eventType === "pilot_delivery_review") || !timeline.events.some((event) => event.eventType === "pilot_decision")) throw new Error("Review, decision, alert, and pilot delivery timeline events did not survive restart.");
  console.log("Mutation persistence test passed: alert, briefing, insight, source-review, and timeline state survived restart.");
} finally {
  if (child && child.exitCode === null) await stop(child);
}
