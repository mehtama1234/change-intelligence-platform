import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-commercial-offer-"));
const port = 8799;
const base = `http://127.0.0.1:${port}`;
const writeJson = async (name, value) => writeFile(resolve(runtimeDir, name), `${JSON.stringify(value, null, 2)}\n`);
await mkdir(runtimeDir, { recursive: true });
await writeJson("workspace-pilot-decisions.json", { decisions: [{ id: "expand-checkpoint-1", workspaceId: "demo-research", decision: "expand", note: "Three reviewed deliveries supported a recurring test.", nextStep: "Propose the recurring service scope.", decidedBy: "demo-researcher", decidedRole: "owner", decidedAt: "2026-09-26T12:00:00.000Z" }] });
await writeJson("workspace-commercial-offers.json", { schemaVersion: "workspace-commercial-offer-ledger-v1", offers: [] });
const child = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "token", AUTH_TOKENS_JSON: JSON.stringify({ "offer-token": "demo-researcher", "outsider-token": "outsider" }) }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
  await new Promise((wait) => setTimeout(wait, 100));
  if (attempt === 49) throw new Error(`API did not start. ${output}`);
}
const auth = { Authorization: "Bearer offer-token" };
const outsider = { Authorization: "Bearer outsider-token" };
const post = (path, body, key, headers = auth) => fetch(`${base}${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ workspaceId: "demo-research", ...body }) });
try {
  const blocked = await post("/api/workspace-commercial-offer", { planName: "Should not pass", serviceScope: "This must not be proposed without a human checkpoint.", cadence: "monthly", billingInterval: "monthly", amountCents: 1000 }, "blocked-offer", outsider);
  if (blocked.status !== 403) throw new Error(`Unauthorized offer creation was not blocked: ${blocked.status}`);
  const proposed = await post("/api/workspace-commercial-offer", { planName: "AI work-control intelligence subscription", serviceScope: "Monthly source-linked briefings, change alerts, private-source review, and one decision follow-up session.", cadence: "monthly", billingInterval: "monthly", amountCents: 150000, currency: "USD", startDate: "2026-10-01", renewalDate: "2026-11-01", terms: "Either side may end the service at the next monthly renewal." }, "propose-offer");
  if (proposed.status !== 201) throw new Error(`Offer proposal failed: ${proposed.status} ${await proposed.text()}`);
  const offer = await proposed.json();
  const read = await (await fetch(`${base}/api/workspace-commercial-offer?workspace=demo-research`, { headers: auth })).json();
  if (read.current?.id !== offer.id || read.current.status !== "proposed" || read.offers.length !== 1) throw new Error("Offer read model did not preserve the proposed offer.");
  const accepted = await post(`/api/workspace-commercial-offer/${encodeURIComponent(offer.id)}/state`, { state: "accepted", note: "The partner accepted the recurring service scope." }, "accept-offer");
  if (accepted.status !== 200 || (await accepted.json()).status !== "accepted") throw new Error("Offer acceptance failed.");
  const active = await post(`/api/workspace-commercial-offer/${encodeURIComponent(offer.id)}/state`, { state: "active", note: "Service begins after the first paid cycle is confirmed outside this system." }, "activate-offer");
  if (active.status !== 200 || (await active.json()).status !== "active") throw new Error("Offer activation failed.");
  const exportResponse = await fetch(`${base}/api/workspace-export?workspace=demo-research`, { headers: auth });
  const exported = await exportResponse.json();
  if (!exportResponse.ok || exported.commercialOffers?.[0]?.status !== "active") throw new Error("Workspace export did not retain the commercial offer history.");
  const ledger = JSON.parse(await readFile(resolve(runtimeDir, "workspace-commercial-offers.json"), "utf8"));
  if (ledger.offers[0]?.history?.length !== 3) throw new Error("Offer state history was not durable.");
  console.log("Commercial offer workflow passed: expand gate, tenant-safe proposal, acceptance, activation, export, and durable history are connected.");
} finally { child.kill("SIGTERM"); }
