import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const profilesPath = resolve(runtimeDir, process.env.PILOT_PROFILES_PATH ?? "workspace-pilot-profiles.json");
const outputPath = resolve(runtimeDir, process.env.PILOT_DELIVERIES_PATH ?? "workspace-pilot-deliveries.json");
const runId = process.env.REFRESH_RUN_ID ?? `manual-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17)}`;

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

const profiles = (await readJson(profilesPath, { profiles: [] })).profiles ?? [];
const existing = await readJson(outputPath, { schemaVersion: "workspace-pilot-delivery-ledger-v1", deliveries: [] });
const deliveries = [...(existing.deliveries ?? [])];
const existingIds = new Set(deliveries.map((delivery) => delivery.id));
const alerts = (await readJson(resolve(runtimeDir, "workspace-alerts.json"), { alerts: [] })).alerts ?? [];
const outcomes = (await readJson(resolve(runtimeDir, "decision-outcomes.json"), { outcomes: [] })).outcomes ?? [];
const audit = (await readJson(resolve(runtimeDir, "audit-log.json"), { entries: [] })).entries ?? [];
const briefings = (await readJson(resolve(runtimeDir, "workspace-briefings.json"), { briefings: [] })).briefings ?? [];
const refresh = await readJson(resolve(runtimeDir, "latest-refresh.json"), { status: "not_run", runId: null, endedAt: null });
const now = new Date().toISOString();
let created = 0;
for (const profile of profiles) {
  const workspaceAlerts = alerts.filter((alert) => alert.workspaceId === profile.workspaceId);
  const workspaceOutcomes = outcomes.filter((outcome) => outcome.workspaceId === profile.workspaceId);
  const workspaceAudit = audit.filter((entry) => entry.workspaceId === profile.workspaceId);
  const workspaceBriefings = briefings.filter((briefing) => briefing.workspaceId === profile.workspaceId);
  const openAlerts = workspaceAlerts.filter((alert) => alert.state === "open");
  const delivery = {
    id: `delivery-${profile.id}-${runId}`,
    workspaceId: profile.workspaceId,
    profileId: profile.id,
    generatedAt: now,
    refreshRunId: runId,
    refreshStatus: refresh.status ?? "not_run",
    status: refresh.status === "partial" ? "held_for_review" : "prepared",
    cadence: profile.cadence,
    nextReviewAt: profile.nextReviewAt ?? null,
    decisionQuestion: profile.decisionQuestion,
    headline: openAlerts.length ? `${openAlerts.length} open change alert${openAlerts.length === 1 ? "" : "s"} require review.` : "No open change alerts require review.",
    snapshot: {
      openAlerts: openAlerts.length,
      alertsSeen: workspaceAlerts.length,
      alertsResolved: workspaceAlerts.filter((alert) => alert.state === "resolved").length,
      usefulAlerts: workspaceAlerts.filter((alert) => alert.resolutionDisposition === "useful").length,
      falseAlerts: workspaceAlerts.filter((alert) => alert.resolutionDisposition === "false_positive").length,
      briefingsPublished: workspaceAudit.filter((entry) => entry.action === "publish_briefing").length,
      briefingsExported: workspaceAudit.filter((entry) => entry.action === "export_briefing").length,
      decisionsRecorded: workspaceOutcomes.length,
      decisionsUsingBriefings: workspaceOutcomes.filter((outcome) => outcome.decisionState === "used").length,
      knownResults: workspaceOutcomes.filter((outcome) => ["held", "changed", "wrong"].includes(outcome.outcomeState)).length,
      activeBriefings: workspaceBriefings.filter((briefing) => ["draft", "published", "stale"].includes(briefing.state)).length
    },
    successMeasures: profile.successMeasures,
    evaluation: { state: "requires_partner_review", reason: "The system records usage and follow-up, but does not turn free-text success measures into a claimed score automatically." },
    limitation: "This delivery is a reviewable evidence handoff. It is not a recommendation, a causal result, or proof that the pilot created business value."
  };
  if (!existingIds.has(delivery.id)) { deliveries.push(delivery); created += 1; }
}
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ schemaVersion: "workspace-pilot-delivery-ledger-v1", updatedAt: now, deliveries: deliveries.slice(-200) }, null, 2)}\n`);
console.log(JSON.stringify({ profiles: profiles.length, deliveriesCreated: created, outputPath }, null, 2));
