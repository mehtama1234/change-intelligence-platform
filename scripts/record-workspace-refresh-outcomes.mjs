import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const readJson = async (path, fallback) => { try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return fallback; throw error; } };
const runId = String(process.env.REFRESH_RUN_ID ?? "");
const status = String(process.env.REFRESH_STATUS ?? "partial");
const endedAt = process.env.REFRESH_ENDED_AT ?? new Date().toISOString();
const failedSteps = JSON.parse(process.env.REFRESH_FAILED_STEPS ?? "[]");
if (!runId) throw new Error("REFRESH_RUN_ID is required.");
const profiles = (await readJson(resolve(runtimeDir, "workspace-pilot-profiles.json"), { profiles: [] })).profiles ?? [];
const deliveries = (await readJson(resolve(runtimeDir, "workspace-pilot-deliveries.json"), { deliveries: [] })).deliveries ?? [];
const ledger = await readJson(resolve(runtimeDir, "workspace-refresh-outcomes.json"), { schemaVersion: "workspace-refresh-outcome-ledger-v1", outcomes: [] });
const outcomes = [...(ledger.outcomes ?? [])];
for (const profile of profiles) {
  const delivery = deliveries.find((candidate) => candidate.workspaceId === profile.workspaceId && candidate.refreshRunId === runId);
  const validDelivery = delivery?.status === "prepared";
  const existing = outcomes.filter((outcome) => outcome.workspaceId === profile.workspaceId).at(-1);
  if (status === "complete" && validDelivery) {
    if (existing?.status === "open" || existing?.status === "retry_requested") outcomes.push({ ...existing, status: "resolved", resolvedAt: endedAt, resolvedRunId: runId, deliveryId: delivery.id });
    continue;
  }
  if (status === "complete" && !validDelivery || status !== "complete") {
    const reason = status !== "complete" ? "refresh_failed" : delivery ? "delivery_not_prepared" : "delivery_not_created";
    if (existing?.runId === runId) continue;
    outcomes.push({ id: `workspace-refresh-outcome-${profile.workspaceId}-${runId}`, workspaceId: profile.workspaceId, profileId: profile.id, runId, status: "open", reason, failedSteps, deliveryId: delivery?.id ?? null, observedAt: endedAt, retryRequestedAt: null, retryRequestedBy: null, resolvedAt: null, resolvedRunId: null });
  }
}
await writeFile(resolve(runtimeDir, "workspace-refresh-outcomes.json"), `${JSON.stringify({ schemaVersion: "workspace-refresh-outcome-ledger-v1", updatedAt: endedAt, outcomes: outcomes.slice(-500) }, null, 2)}\n`);
console.log(JSON.stringify({ runId, status, workspaces: profiles.length, open: outcomes.filter((outcome) => outcome.status === "open" || outcome.status === "retry_requested").length }, null, 2));
