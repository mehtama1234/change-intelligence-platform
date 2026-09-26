import { cp, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRuntime = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-browser-"));
const port = 8795;
const base = `http://127.0.0.1:${port}`;
await cp(sourceRuntime, runtimeDir, { recursive: true });
await unlink(resolve(runtimeDir, "change-intelligence.sqlite")).catch(() => {});

const currentBriefing = {
  id: "briefing-browser-current",
  workspaceId: "demo-research",
  questionId: "question-browser-current",
  title: "What evidence links AI adoption to productivity and worker control?",
  state: "stale",
  publication: "needs_republish",
  reading: "Updated evidence requires review.",
  boundary: "Evidence remains bounded.",
  nextTest: "Review the changed source.",
  evidenceDigest: "current-digest",
  staleReason: "The source evidence changed after this briefing was published.",
  previousEvidenceDigest: "previous-digest",
  customerActions: ["Open the changed evidence and republish only after review."],
  insightActions: [],
  insightProvenance: [],
  evidence: []
};
const oldDelivery = { id: "delivery-browser-old", workspaceId: "demo-research", generatedAt: "2026-09-25T12:00:00.000Z", status: "prepared", cadence: "monthly", refreshRunId: "refresh-old", headline: "An older handoff is ready for review.", briefings: [{ ...currentBriefing, state: "published", publication: "published", staleReason: null, customerActions: [] }], insightProvenance: [], insightActions: [], impact: { state: "no_open_source_availability_issue", unavailableSources: [], recoveredSources: [] }, evaluation: { reason: "Older delivery." } };
const currentDelivery = { id: "delivery-browser-current", workspaceId: "demo-research", generatedAt: "2026-09-26T12:00:00.000Z", status: "held_for_review", cadence: "monthly", refreshRunId: "refresh-current", headline: "1 briefing includes changed insight evidence and requires re-review.", briefings: [currentBriefing], insightProvenance: [], insightActions: [], impact: { state: "no_open_source_availability_issue", unavailableSources: [], recoveredSources: [] }, evaluation: { reason: "This delivery is held until the updated evidence is reviewed." }, successMeasures: [] };
await writeFile(resolve(runtimeDir, "workspace-pilot-deliveries.json"), `${JSON.stringify({ schemaVersion: "workspace-pilot-delivery-ledger-v1", deliveries: [oldDelivery, currentDelivery] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-pilot-profiles.json"), `${JSON.stringify({ schemaVersion: "workspace-pilot-profile-ledger-v1", profiles: [{ id: "profile-browser-current", workspaceId: "demo-research", status: "active", decisionQuestion: currentBriefing.title, decisionContext: "Browser acceptance", cadence: "monthly", nextReviewAt: "2026-10-31", successMeasures: [] }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-briefings.json"), `${JSON.stringify({ schemaVersion: "workspace-briefing-ledger-v1", briefings: [currentBriefing] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-questions.json"), `${JSON.stringify({ schemaVersion: "workspace-question-ledger-v1", questions: [{ id: "question-browser-current", workspaceId: "demo-research", question: currentBriefing.title, state: "active", createdBy: "demo-researcher", createdAt: "2026-09-25T12:00:00.000Z", lastEvaluatedAt: "2026-09-26T12:00:00.000Z" }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "question-evaluations.json"), `${JSON.stringify({ schemaVersion: "question-evaluation-ledger-v1", evaluations: [{ questionId: "question-browser-current", workspaceId: "demo-research", state: "evidence_retrieved", matchedRecordIds: [], matches: [], limitation: "Evidence is bounded." }] }, null, 2)}\n`);

const server = spawn(process.execPath, [resolve(root, "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(port), RUNTIME_DATA_DIR: runtimeDir, AUTH_MODE: "demo" }, stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
server.stdout.on("data", (data) => { serverOutput += data; });
server.stderr.on("data", (data) => { serverOutput += data; });
async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch {}
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error(`Browser test server did not start: ${serverOutput}`);
}
await waitForServer();
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? chromium.executablePath() });
try {
  const page = await browser.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) browserErrors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${base}/web/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#pilot-delivery")?.textContent.includes("held_for_review"), null, { timeout: 30000 }).catch(async (error) => {
    const rendered = await page.locator("#pilot-delivery").innerText().catch(() => "");
    const operations = await page.locator("#operations-summary").innerText().catch(() => "");
    throw new Error(`${error.message}\nRendered delivery: ${rendered}\nOperations summary: ${operations}\nBrowser errors: ${browserErrors.join(" | ")}`);
  });
  const deliveryText = await page.locator("#pilot-delivery").innerText();
  await page.locator("#questions-items details").first().click();
  const questionText = await page.locator("#questions-items").innerText();
  const normalizedDeliveryText = deliveryText.toLowerCase();
  if (!normalizedDeliveryText.includes("held_for_review") || !deliveryText.includes("Briefings in this handoff") || !deliveryText.includes("The source evidence changed after this briefing was published.") || !deliveryText.includes("Inspect briefing evidence and history")) throw new Error(`Browser did not render the current held briefing state:\n${deliveryText}`);
  const questionHtml = await page.locator("#questions-items").innerHTML();
  if (!questionText.toLowerCase().includes("stale") || !questionHtml.includes("Republish after reviewing updated evidence")) throw new Error(`Browser did not render stale briefing recovery controls:\n${questionText}\nHTML:\n${questionHtml}`);
  await page.screenshot({ path: resolve(runtimeDir, "frontend-browser-acceptance.png"), fullPage: false });
  console.log("Frontend browser acceptance passed: Chromium rendered the current held delivery, stale briefing explanation, customer action, and recovery control.");
} finally {
  await browser.close();
  server.kill("SIGTERM");
  await new Promise((resolveExit) => server.once("exit", resolveExit));
}
