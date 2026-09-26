import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = 8793;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = `/tmp/change-intelligence-read-model-${Date.now()}`;
await mkdir(runtimeDir, { recursive: true });
const sourceMap = JSON.parse(await readFile(resolve(root, "data/source-maps/ai-work-control.sources.json"), "utf8"));
const checkedAt = new Date().toISOString();
const changedSourceId = sourceMap.sources[0].id;
const sourceSnapshot = { schemaVersion: "source-scan-receipt-v1", runId: "scan-read-model-fixture", generatedAt: checkedAt, counts: { new: 0, changed: 2, unchanged: sourceMap.sources.length - 2, missing: 0 }, sources: sourceMap.sources.map((source, index) => ({ id: source.id, repository: source.sourceRepository, path: source.sourcePath, status: index < 2 ? "changed" : "unchanged", needsReview: index < 2, reviewReason: index < 2 ? "Source bytes changed." : null, previousSha256: index < 2 ? `old-source-digest-${index}` : null, sha256: index < 2 ? `new-source-digest-${index}` : null, capturePath: index === 0 ? "raw/source-captures/test-source/new.source" : null, checkedAt })) };
await writeFile(resolve(runtimeDir, "latest-source-scan.json"), `${JSON.stringify(sourceSnapshot, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "source-scan-history.json"), `${JSON.stringify({ schemaVersion: "source-scan-history-v1", runs: [sourceSnapshot, { ...sourceSnapshot, runId: "scan-read-model-older", generatedAt: new Date(Date.parse(checkedAt) - 86400000).toISOString() }] }, null, 2)}\n`);
await mkdir(resolve(runtimeDir, "raw/source-captures/test-source"), { recursive: true });
await writeFile(resolve(runtimeDir, "raw/source-captures/test-source/old.source"), "same line\nremoved line\n");
await writeFile(resolve(runtimeDir, "raw/source-captures/test-source/new.source"), "same line\nadded line\n");
await writeFile(resolve(runtimeDir, "source-capture-ledger.json"), `${JSON.stringify({ schemaVersion: "source-capture-ledger-v1", captures: [{ id: changedSourceId, sha256: "old-source-digest-0", capturePath: "raw/source-captures/test-source/old.source" }, { id: changedSourceId, sha256: "new-source-digest-0", capturePath: "raw/source-captures/test-source/new.source" }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-watchlists.json"), `${JSON.stringify({ schemaVersion: "workspace-watchlist-ledger-v1", watchlists: [{ id: "read-model-watchlist", workspaceId: "demo-research", name: "First source only", sourceIds: [changedSourceId], repositoryIds: [], alertOn: ["changed"] }] }, null, 2)}\n`);
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
  const catalogResponse = await request("/api/catalog");
  const catalog = await catalogResponse.json();
  if (catalogResponse.status !== 200 || catalog.schemaVersion !== "catalog-read-model-v1" || catalog.repositoryCount !== 6 || !catalog.themes.length) throw new Error("Catalog read model contract failed.");
  const recordsResponse = await request("/api/records?sourceRole=company_report");
  const filteredRecords = await recordsResponse.json();
  if (recordsResponse.status !== 200 || filteredRecords.schemaVersion !== "evidence-record-read-model-v1" || !filteredRecords.records.every((record) => record.sourceRole === "company_report")) throw new Error("Filtered record read model contract failed.");
  const changesResponse = await request("/api/changes?includeUnchanged=true");
  const changes = await changesResponse.json();
  if (changesResponse.status !== 200 || changes.schemaVersion !== "source-change-feed-v1" || changes.changes.length !== sourceMap.sources.length) throw new Error("Source change feed contract failed.");
  const intelligenceResponse = await request("/api/change-intelligence?workspace=demo-research");
  const intelligence = await intelligenceResponse.json();
  if (intelligenceResponse.status !== 200 || intelligence.schemaVersion !== "change-intelligence-feed-v1" || intelligence.scope?.mode !== "watchlists" || intelligence.summary.changed !== 1 || intelligence.items.length !== 1 || intelligence.items[0].recordId !== sourceMap.sources[0].id || !intelligence.items[0].plainLanguage || !intelligence.items[0].nextAction) throw new Error("Change-intelligence feed contract failed.");
  await writeFile(resolve(runtimeDir, "workspace-watchlists.json"), `${JSON.stringify({ schemaVersion: "workspace-watchlist-ledger-v1", watchlists: [] }, null, 2)}\n`);
  const onboardingFeedResponse = await request("/api/change-intelligence?workspace=demo-research");
  const onboardingFeed = await onboardingFeedResponse.json();
  if (onboardingFeedResponse.status !== 200 || onboardingFeed.scope?.mode !== "all_sources" || onboardingFeed.items.length !== 2) throw new Error("Unconfigured workspace change feed contract failed.");
  const diffResponse = await request(`/api/change-intelligence/${encodeURIComponent(changedSourceId)}/diff?workspace=demo-research`);
  const diff = await diffResponse.json();
  if (diffResponse.status !== 200 || diff.schemaVersion !== "source-diff-v1" || !diff.captures.previous || !diff.captures.current || !diff.diff?.removedLines.includes("removed line") || !diff.diff?.addedLines.includes("added line")) throw new Error("Source difference read model contract failed.");
  const coverageResponse = await request("/api/coverage");
  const coverage = await coverageResponse.json();
  if (coverageResponse.status !== 200 || coverage.schemaVersion !== "coverage-read-model-v1" || coverage.reportWindows.length !== 5 || coverage.requirements.find((item) => item.id === "public-company-history")?.status !== "ready" || coverage.repositories.length !== 6) throw new Error("Evidence coverage contract failed.");
  const atlasResponse = await request("/api/atlas");
  const atlas = await atlasResponse.json();
  if (atlasResponse.status !== 200 || atlas.schemaVersion !== "domain-atlas-v1" || !atlas.entities.themes?.length || !atlas.entities.mechanisms?.length || !atlas.edges?.length) throw new Error("Domain atlas read model contract failed.");
  const entityResponse = await request("/api/atlas/entity?kind=companies&id=company%3Anvidia");
  const entity = await entityResponse.json();
  if (entityResponse.status !== 200 || entity.schemaVersion !== "atlas-entity-read-model-v1" || entity.entity.label !== "NVIDIA" || !entity.evidence.length || !Array.isArray(entity.related) || !entity.timeline?.reportedMovement?.length || !entity.timeline.comparisons?.length || !entity.timeline.comparisons[0].columns.length || !entity.timeline.comparisons[0].quarters.length || !Array.isArray(entity.timeline.outcomeEvidence) || !entity.timeline.boundary.includes("separate rails")) throw new Error("Atlas entity read model contract failed.");
  const comparisonResponse = await request("/api/atlas/compare?kind=companies&ids=company%3Anvidia%2Ccompany%3Amicrosoft");
  const comparison = await comparisonResponse.json();
  if (comparisonResponse.status !== 200 || comparison.schemaVersion !== "atlas-comparison-read-model-v1" || comparison.selected.length !== 2 || !Array.isArray(comparison.compatibleColumns) || !Array.isArray(comparison.incompatibilities) || !["current", "changed"].includes(comparison.freshness.status) || !Array.isArray(comparison.freshness.latestPeriods) || !comparison.limitation.includes("identically labelled")) throw new Error("Atlas comparison read model contract failed.");
  const ingestionResponse = await request("/api/ingestion");
  const ingestion = await ingestionResponse.json();
  if (ingestionResponse.status !== 200 || ingestion.schemaVersion !== "research-ingestion-ledger-v1" || ingestion.repositories.length !== 6 || ingestion.records.length !== packet.records.length) throw new Error("Research ingestion read model contract failed.");
  const timelineResponse = await request("/api/timeline");
  const timeline = await timelineResponse.json();
  if (timelineResponse.status !== 200 || timeline.schemaVersion !== "research-timeline-v1" || timeline.eventCount !== sourceMap.sources.length * 2 || !timeline.impactSummary || !Array.isArray(timeline.impactChains)) throw new Error("Research timeline contract failed.");
  const filteredTimelineResponse = await request("/api/timeline?eventType=source_scan&source=trend-hunting-ai-control");
  const filteredTimeline = await filteredTimelineResponse.json();
  if (filteredTimelineResponse.status !== 200 || !filteredTimeline.events.length || filteredTimeline.events.some((event) => event.eventType !== "source_scan" || event.sourceId !== "trend-hunting-ai-control")) throw new Error("Filtered research timeline contract failed.");
  const usageResponse = await request("/api/usage?workspace=demo-research");
  const usage = await usageResponse.json();
  if (usageResponse.status !== 200 || usage.schemaVersion !== "workspace-usage-v1" || usage.workspaceId !== "demo-research") throw new Error("Workspace usage contract failed.");
  const pilotResponse = await request("/api/pilot-metrics?workspace=demo-research");
  const pilot = await pilotResponse.json();
  if (pilotResponse.status !== 200 || pilot.schemaVersion !== "pilot-metrics-v1" || pilot.workspaceId !== "demo-research" || !Number.isInteger(pilot.measures.alertsSeen) || !pilot.interpretation.includes("do not prove")) throw new Error("Pilot metrics contract failed.");
  const updateResponse = await request("/api/workspace-update?workspace=demo-research");
  const update = await updateResponse.json();
  if (updateResponse.status !== 200 || update.schemaVersion !== "workspace-update-v1" || update.workspaceId !== "demo-research" || !update.headline || !update.freshness || !update.limitation.includes("not a claim")) throw new Error("Workspace update contract failed.");
  const profileResponse = await request("/api/workspace-pilot?workspace=demo-research");
  const profileReadModel = await profileResponse.json();
  if (profileResponse.status !== 200 || profileReadModel.schemaVersion !== "workspace-pilot-read-model-v1" || profileReadModel.workspaceId !== "demo-research") throw new Error("Workspace pilot read model contract failed.");
  const deliveriesResponse = await request("/api/pilot-deliveries?workspace=demo-research");
  const deliveries = await deliveriesResponse.json();
  if (deliveriesResponse.status !== 200 || deliveries.schemaVersion !== "workspace-pilot-delivery-read-model-v1" || !Array.isArray(deliveries.deliveries)) throw new Error("Pilot delivery read model contract failed.");
  const reportResponse = await request("/api/pilot-report?workspace=demo-research");
  const report = await reportResponse.json();
  if (reportResponse.status !== 200 || report.schemaVersion !== "pilot-learning-report-v1" || !report.observation || !Array.isArray(report.openIssues) || !Array.isArray(report.deliveryHistory) || !Array.isArray(report.decisionHistory) || !report.limitation.includes("does not establish")) throw new Error("Pilot learning report contract failed.");
  const evidenceResponse = await request("/api/evidence/trend-hunting-ai-control?workspace=demo-research");
  const evidence = await evidenceResponse.json();
  if (evidenceResponse.status !== 200 || evidence.schemaVersion !== "evidence-inspection-v1" || evidence.record.id !== "trend-hunting-ai-control" || !evidence.source.excerpt || !evidence.insightLinks.length) throw new Error("Evidence inspection contract failed.");
  const insightResponse = await request("/api/insights/insight-ai-capability-control-gap-001?workspace=demo-research");
  const insight = await insightResponse.json();
  if (insightResponse.status !== 200 || insight.schemaVersion !== "insight-inspection-v1" || insight.evidence.length < 1 || !insight.boundaries.strongestAlternative || insight.chain?.schemaVersion !== "insight-evidence-chain-v1" || !insight.chain.stages.some((stage) => stage.id === "observed_result") || !insight.chain.stages.some((stage) => stage.id === "counterexample") || !insight.chain.nextTest) throw new Error("Insight inspection contract failed.");
  const missingResponse = await request("/api/evidence/not-a-real-record");
  if (missingResponse.status !== 404) throw new Error("Missing evidence should return 404.");
  console.log("Read-model inspection test passed: evidence and insight chains are source-linked.");
} finally {
  child.kill("SIGTERM");
}
