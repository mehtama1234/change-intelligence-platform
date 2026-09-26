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
const sourceSnapshot = { schemaVersion: "source-scan-receipt-v1", runId: "scan-read-model-fixture", generatedAt: checkedAt, counts: { new: 0, changed: 0, unchanged: sourceMap.sources.length, missing: 0 }, sources: sourceMap.sources.map((source) => ({ id: source.id, repository: source.sourceRepository, path: source.sourcePath, status: "unchanged", needsReview: false, checkedAt })) };
await writeFile(resolve(runtimeDir, "latest-source-scan.json"), `${JSON.stringify(sourceSnapshot, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "source-scan-history.json"), `${JSON.stringify({ schemaVersion: "source-scan-history-v1", runs: [sourceSnapshot, { ...sourceSnapshot, runId: "scan-read-model-older", generatedAt: new Date(Date.parse(checkedAt) - 86400000).toISOString() }] }, null, 2)}\n`);
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
  if (changesResponse.status !== 200 || changes.schemaVersion !== "source-change-feed-v1" || changes.changes.length !== 7) throw new Error("Source change feed contract failed.");
  const timelineResponse = await request("/api/timeline");
  const timeline = await timelineResponse.json();
  if (timelineResponse.status !== 200 || timeline.schemaVersion !== "research-timeline-v1" || timeline.eventCount !== 14) throw new Error("Research timeline contract failed.");
  const usageResponse = await request("/api/usage?workspace=demo-research");
  const usage = await usageResponse.json();
  if (usageResponse.status !== 200 || usage.schemaVersion !== "workspace-usage-v1" || usage.workspaceId !== "demo-research") throw new Error("Workspace usage contract failed.");
  const evidenceResponse = await request("/api/evidence/trend-hunting-ai-control?workspace=demo-research");
  const evidence = await evidenceResponse.json();
  if (evidenceResponse.status !== 200 || evidence.schemaVersion !== "evidence-inspection-v1" || evidence.record.id !== "trend-hunting-ai-control" || !evidence.source.excerpt || !evidence.insightLinks.length) throw new Error("Evidence inspection contract failed.");
  const insightResponse = await request("/api/insights/insight-ai-capability-control-gap-001?workspace=demo-research");
  const insight = await insightResponse.json();
  if (insightResponse.status !== 200 || insight.schemaVersion !== "insight-inspection-v1" || insight.evidence.length < 1 || !insight.boundaries.strongestAlternative) throw new Error("Insight inspection contract failed.");
  const missingResponse = await request("/api/evidence/not-a-real-record");
  if (missingResponse.status !== 404) throw new Error("Missing evidence should return 404.");
  console.log("Read-model inspection test passed: evidence and insight chains are source-linked.");
} finally {
  child.kill("SIGTERM");
}
