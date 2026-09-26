import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRuntime = resolve(root, "data/processed/runs/ai-work-control");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-promotion-"));
const packetPath = resolve(runtimeDir, "packet.json");
const port = 8797;
const base = `http://127.0.0.1:${port}`;
await mkdir(runtimeDir, { recursive: true });
for (const name of ["audit-log.json", "idempotency-operations.json", "review-events.json"]) await copyFile(resolve(sourceRuntime, name), resolve(runtimeDir, name));
const opportunity = JSON.parse(await readFile(resolve(sourceRuntime, "insight-opportunities.json"), "utf8")).opportunities[0];
await writeFile(resolve(runtimeDir, "insight-opportunities.json"), `${JSON.stringify({ schemaVersion: "insight-opportunity-ledger-v1", opportunities: [opportunity] }, null, 2)}\n`);
await writeFile(packetPath, `${JSON.stringify(await JSON.parse(await readFile(resolve(root, "data/processed/ai-work-control.packet.json"), "utf8")), null, 2)}\n`);
const child = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, PACKET_PATH: packetPath, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "research-token": "demo-researcher", "outsider-token": "outside-user" }) }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
  await new Promise((wait) => setTimeout(wait, 100));
  if (attempt === 49) throw new Error(`API did not start. ${output}`);
}
const auth = { Authorization: "Bearer research-token", "content-type": "application/json", "Idempotency-Key": "promote-opportunity-test" };
try {
  const body = { workspaceId: "demo-research", title: "A recurring correction path needs a direct workflow test", plainLanguageSummary: "Several independent sources describe correction as a mechanism, but the current records do not establish that people receive the same remedy in practice.", strongestAlternative: "The sources may use correction language for different processes rather than one shared mechanism.", nextTest: "Trace one named workflow from decision to appeal, correction, and later result across two reporting periods.", whatWouldChangeOurMind: ["Source review shows the records refer to different populations or definitions."], note: "Promoted after rewriting the detected mechanism pattern." };
  const outsider = await fetch(`${base}/api/insight-opportunities/${encodeURIComponent(opportunity.id)}/promote`, { method: "POST", headers: { Authorization: "Bearer outsider-token", "content-type": "application/json", "Idempotency-Key": "outsider-promotion" }, body: JSON.stringify(body) });
  if (outsider.status !== 403) throw new Error(`Unauthorized opportunity promotion returned ${outsider.status}`);
  const response = await fetch(`${base}/api/insight-opportunities/${encodeURIComponent(opportunity.id)}/promote`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const promotion = await response.json();
  if (response.status !== 201 || promotion.opportunityId !== opportunity.id || promotion.insight.recordIds.length < 2) throw new Error("Opportunity promotion did not persist a bounded source-linked draft.");
  const ledger = JSON.parse(await readFile(resolve(runtimeDir, "insight-promotions.json"), "utf8"));
  const events = JSON.parse(await readFile(resolve(runtimeDir, "review-events.json"), "utf8"));
  if (!ledger.promotions.some((item) => item.id === promotion.id) || !events.events.some((event) => event.eventType === "insight_opportunity_promoted" && event.promotionId === promotion.id)) throw new Error("Promotion provenance was not durable.");
  await exec(process.execPath, [resolve(root, "scripts/build-ai-work-control-packet.mjs")], { cwd: root, env: { ...process.env, RUNTIME_DATA_DIR: runtimeDir, PACKET_OUTPUT_PATH: packetPath, INSIGHT_PROMOTIONS_PATH: resolve(runtimeDir, "insight-promotions.json") } });
  const packet = JSON.parse(await readFile(packetPath, "utf8"));
  if (!packet.insights.some((insight) => insight.id === promotion.insight.id && insight.origin === "discovered_opportunity" && insight.promotionId === promotion.id)) throw new Error("Promoted insight did not enter the next packet with opportunity provenance.");
  console.log("Insight promotion test passed: authorization, durable provenance, and next-refresh packet promotion are enforced.");
} finally {
  child.kill("SIGTERM");
}
