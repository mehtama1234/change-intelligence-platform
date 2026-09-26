import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = 8798;
const base = `http://127.0.0.1:${port}`;
const runtimeDir = `/tmp/change-intelligence-workspace-sources-${Date.now()}`;
await mkdir(runtimeDir, { recursive: true });
const child = spawn(process.execPath, [resolve(root, "server.mjs")], {
  cwd: root,
  env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "owner-token": "demo-owner", "research-token": "demo-researcher", "viewer-token": "demo-viewer", "outsider-token": "outside-user" }) },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
async function healthy() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise((sleep) => setTimeout(sleep, 100));
  }
  throw new Error(`API did not start. ${output}`);
}
const owner = { Authorization: "Bearer owner-token" };
const researcher = { Authorization: "Bearer research-token" };
const viewer = { Authorization: "Bearer viewer-token" };
const outsider = { Authorization: "Bearer outsider-token" };
try {
  await healthy();
  const initial = await fetch(`${base}/api/workspace-sources?workspace=demo-research`, { headers: owner });
  const initialBody = await initial.json();
  if (initial.status !== 200 || initialBody.schemaVersion !== "workspace-source-read-model-v1" || initialBody.sources.length !== 0 || initialBody.canSubmit !== true) throw new Error("Private source read model failed.");
  const submitted = await fetch(`${base}/api/workspace-sources`, { method: "POST", headers: { ...owner, "Idempotency-Key": "private-source-submit", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", title: "Customer pilot memo", sourceRef: "customer-pilot-2026-09", sourceLocator: "page 4", excerpt: "Operators spent additional time checking and correcting automated recommendations.", observation: "The source reports added review work; it does not establish a general productivity effect.", affectedGroups: ["operators", "customers"] }) });
  const submittedBody = await submitted.json();
  if (submitted.status !== 201 || submittedBody.reviewState !== "pending_review" || !/^[a-f0-9]{64}$/.test(submittedBody.sourceDigest)) throw new Error(`Private source submission failed: ${JSON.stringify(submittedBody)}`);
  const viewerSubmit = await fetch(`${base}/api/workspace-sources`, { method: "POST", headers: { ...viewer, "Idempotency-Key": "viewer-private-source", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", title: "Viewer source", sourceRef: "viewer", excerpt: "This should not be accepted as a private source.", observation: "Viewer must not submit." }) });
  if (viewerSubmit.status !== 403) throw new Error(`Expected viewer submission to return 403, received ${viewerSubmit.status}`);
  const outsiderRead = await fetch(`${base}/api/workspace-sources?workspace=demo-research`, { headers: outsider });
  if (outsiderRead.status !== 403) throw new Error(`Expected outsider source read to return 403, received ${outsiderRead.status}`);
  const researcherRead = await fetch(`${base}/api/workspace-sources?workspace=demo-research`, { headers: researcher });
  if (researcherRead.status !== 200 || (await researcherRead.json()).sources[0].sourceExcerpt !== submittedBody.sourceExcerpt) throw new Error("Workspace member could not read the private source.");
  const review = await fetch(`${base}/api/workspace-sources/${encodeURIComponent(submittedBody.id)}/review`, { method: "POST", headers: { ...researcher, "Idempotency-Key": "private-source-review", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", reviewState: "accepted", reviewNote: "Bounded evidence; keep the outcome limitation visible." }) });
  const reviewBody = await review.json();
  if (review.status !== 200 || reviewBody.reviewState !== "accepted" || reviewBody.claimState !== "reviewed" || reviewBody.reviewedBy !== "demo-researcher") throw new Error(`Private source review failed: ${JSON.stringify(reviewBody)}`);
  const exported = await fetch(`${base}/api/workspace-export?workspace=demo-research`, { headers: owner });
  const exportedBody = await exported.json();
  if (exported.status !== 200 || exportedBody.privateSources?.length !== 1 || exportedBody.privateSources[0].id !== submittedBody.id) throw new Error("Workspace export omitted the private source.");
  const retry = await fetch(`${base}/api/workspace-sources/${encodeURIComponent(submittedBody.id)}/review`, { method: "POST", headers: { ...researcher, "Idempotency-Key": "private-source-review", "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", reviewState: "accepted" }) });
  if (retry.status !== 200 || (await retry.json()).id !== submittedBody.id) throw new Error("Private source review was not idempotent.");
  child.kill("SIGTERM");
  console.log("Workspace private-source test passed: tenant isolation, digest lineage, explicit review, idempotency, and role enforcement.");
} finally {
  child.kill("SIGTERM");
}
