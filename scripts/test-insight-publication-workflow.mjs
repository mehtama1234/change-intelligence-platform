import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRuntime = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const runtimeDir = `/tmp/change-intelligence-publication-${Date.now()}`;
const port = 8796;
const base = `http://127.0.0.1:${port}`;
await mkdir(runtimeDir, { recursive: true });
for (const name of ["audit-log.json", "idempotency-operations.json", "insight-candidates.json", "insight-decisions.json", "insight-publications.json", "review-events.json"]) {
  await copyFile(resolve(sourceRuntime, name), resolve(runtimeDir, name));
}
const candidatePath = resolve(runtimeDir, "insight-candidates.json");
const candidates = JSON.parse(await readFile(candidatePath, "utf8"));
const candidate = candidates.candidates[0];
candidate.status = "needs_researcher_review";
candidate.publication = "not_published";
for (const key of ["decisionId", "decidedBy", "decidedAt", "decisionNote", "publicationId", "publishedBy", "publishedAt"]) delete candidate[key];
await writeFile(candidatePath, `${JSON.stringify(candidates, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "insight-decisions.json"), `${JSON.stringify({ schemaVersion: "insight-decision-ledger-v1", decisions: [] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "insight-publications.json"), `${JSON.stringify({ schemaVersion: "insight-publication-ledger-v1", publications: [] }, null, 2)}\n`);

const environment = { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "research-token": "demo-researcher" }) };
const child = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
  await new Promise((wait) => setTimeout(wait, 100));
  if (attempt === 49) throw new Error(`API did not start. ${output}`);
}
const auth = { Authorization: "Bearer research-token" };
const write = (key) => ({ ...auth, "Idempotency-Key": key, "content-type": "application/json" });
try {
  const blocked = await fetch(`${base}/api/insight-candidates/${encodeURIComponent(candidate.id)}/publish`, { method: "POST", headers: write("publish-before-review"), body: JSON.stringify({ workspaceId: "demo-research", note: "Should be blocked." }) });
  if (blocked.status !== 409) throw new Error(`Unreviewed insight was publishable: ${blocked.status}`);
  const decisionResponse = await fetch(`${base}/api/insight-candidates/${encodeURIComponent(candidate.id)}/decision`, { method: "POST", headers: write("accept-insight"), body: JSON.stringify({ workspaceId: "demo-research", decision: "accept", note: "Inspected evidence, alternative explanation, limits, and falsifiers." }) });
  if (decisionResponse.status !== 200) throw new Error(`Insight acceptance failed: ${decisionResponse.status}`);
  const accepted = JSON.parse(await readFile(candidatePath, "utf8")).candidates[0];
  if (accepted.status !== "accepted_for_publication" || !accepted.decisionId || accepted.decidedBy !== "demo-researcher") throw new Error("Acceptance did not update the durable candidate read model.");
  const acceptedPacket = await (await fetch(`${base}/api/packet`)).json();
  if (acceptedPacket.operations?.insightCandidates?.candidates?.find((item) => item.id === candidate.id)?.status !== "accepted_for_publication") throw new Error("Packet read model did not expose the accepted candidate immediately.");
  const inspection = await fetch(`${base}/api/insights/${encodeURIComponent(candidate.candidateKey)}?workspace=demo-research`, { headers: auth });
  const inspectionBody = await inspection.json();
  if (inspection.status !== 200 || !inspectionBody.reviewHistory.decisions.some((item) => item.id === accepted.decisionId)) throw new Error("Insight inspection did not expose approval history.");
  const publicationResponse = await fetch(`${base}/api/insight-candidates/${encodeURIComponent(candidate.id)}/publish`, { method: "POST", headers: write("publish-after-review"), body: JSON.stringify({ workspaceId: "demo-research", note: "Published after explicit researcher review." }) });
  if (publicationResponse.status !== 200) throw new Error(`Insight publication failed: ${publicationResponse.status}`);
  const publication = await publicationResponse.json();
  const published = JSON.parse(await readFile(candidatePath, "utf8")).candidates[0];
  const publications = JSON.parse(await readFile(resolve(runtimeDir, "insight-publications.json"), "utf8"));
  if (published.status !== "published" || published.publicationId !== publication.id || !publications.publications.some((item) => item.id === publication.id)) throw new Error("Publication receipt did not persist in the candidate and publication ledgers.");
  const publishedPacket = await (await fetch(`${base}/api/packet`)).json();
  if (publishedPacket.operations?.insightCandidates?.candidates?.find((item) => item.id === candidate.id)?.status !== "published") throw new Error("Packet read model did not expose the publication immediately.");
  const timeline = await (await fetch(`${base}/api/timeline?workspace=demo-research`, { headers: auth })).json();
  if (!timeline.events.some((event) => event.eventType === "insight_publish" && event.publicationId === publication.id)) throw new Error("Insight publication was not visible in the research timeline.");
  console.log("Insight publication workflow test passed: unreviewed publication was blocked, approval was durable, history was visible, and publication receipt was recorded.");
} finally {
  child.kill("SIGTERM");
}
