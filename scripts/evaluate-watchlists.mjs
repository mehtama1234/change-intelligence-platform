import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const workspaceDir = resolve(root, process.env.WORKSPACE_CONFIG_DIR ?? "data/fixtures/workspaces");
const runtimeDir = process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control";
const scanPath = resolve(root, process.env.SOURCE_SCAN_PATH ?? `${runtimeDir}/latest-source-scan.json`);
const availabilityPath = resolve(root, process.env.SOURCE_AVAILABILITY_PATH ?? `${runtimeDir}/latest-source-availability.json`);
const outputDir = resolve(root, process.env.ALERT_OUTPUT_DIR ?? runtimeDir);
const outputPath = resolve(outputDir, process.env.ALERT_OUTPUT_NAME ?? "workspace-alerts.json");
const watchlistsPath = resolve(root, process.env.WATCHLISTS_PATH ?? `${runtimeDir}/workspace-watchlists.json`);
const comparisonViewsPath = resolve(root, process.env.COMPARISON_VIEWS_PATH ?? `${runtimeDir}/workspace-comparison-views.json`);
const atlasPath = resolve(root, process.env.ATLAS_PATH ?? "data/processed/ai-work-control.atlas.json");
const packetPath = resolve(root, process.env.PACKET_PATH ?? "data/processed/ai-work-control.packet.json");
const staticPacketPath = resolve(root, "data/processed/ai-work-control.packet.json");
const scan = JSON.parse(await readFile(scanPath, "utf8"));
const availability = existsSync(availabilityPath) ? JSON.parse(await readFile(availabilityPath, "utf8")) : { sources: [] };
const files = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
const workspaces = await Promise.all(files.map(async (file) => JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"))));
const watchlistLedger = existsSync(watchlistsPath) ? JSON.parse(await readFile(watchlistsPath, "utf8")) : { watchlists: [] };
const comparisonLedger = existsSync(comparisonViewsPath) ? JSON.parse(await readFile(comparisonViewsPath, "utf8")) : { views: [] };
const atlas = existsSync(atlasPath) ? JSON.parse(await readFile(atlasPath, "utf8")) : { entities: {} };
const packet = existsSync(packetPath) ? JSON.parse(await readFile(packetPath, "utf8")) : existsSync(staticPacketPath) ? JSON.parse(await readFile(staticPacketPath, "utf8")) : { records: [] };
const watchlistsByWorkspace = new Map();
for (const watchlist of watchlistLedger.watchlists ?? []) watchlistsByWorkspace.set(watchlist.workspaceId, [...(watchlistsByWorkspace.get(watchlist.workspaceId) ?? []), watchlist]);
const existing = existsSync(outputPath) ? JSON.parse(await readFile(outputPath, "utf8")) : { schemaVersion: "workspace-alert-ledger-v1", alerts: [] };
const existingById = new Map(existing.alerts.map((alert) => [alert.id, alert]));
let alertsSeenThisRun = 0;

for (const workspace of workspaces) {
  for (const watchlist of watchlistsByWorkspace.get(workspace.id) ?? workspace.watchlists ?? []) {
    for (const source of availability.sources ?? []) {
      if (!watchlist.sourceIds.includes(source.id) && !watchlist.repositoryIds.includes(source.repository)) continue;
      const alertId = `availability-alert-${createHash("sha256").update(`${workspace.id}:${watchlist.id}:${source.id}`).digest("hex").slice(0, 20)}`;
      const prior = existingById.get(alertId);
      if (source.status === "available") {
        if (prior && prior.state !== "resolved") existingById.set(alertId, { ...prior, state: "resolved", resolvedAt: availability.checkedAt, resolutionDisposition: "source_recovered", resolutionNote: "Source became available again during an availability check.", lastSeenAt: availability.checkedAt });
        continue;
      }
      const status = source.reason === "missing" ? "missing" : "unavailable";
      if (!watchlist.alertOn.includes("missing") && !watchlist.alertOn.includes("changed")) continue;
      existingById.set(alertId, { ...prior, id: alertId, workspaceId: workspace.id, watchlistId: watchlist.id, watchlistName: watchlist.name, sourceId: source.id, repository: source.repository, sourcePath: source.sourcePath, state: prior?.state === "resolved" ? "open" : prior?.state ?? "open", severity: "high", kind: "source_availability", reason: `Source is ${status}; availability was checked at ${availability.checkedAt}.`, recommendedAction: status === "missing" ? "Restore or reconnect the source file, then run another availability check." : "Check source permissions or the repository connection, then run another availability check.", scanRunId: availability.runId, availabilityStatus: status, createdAt: prior?.createdAt ?? availability.checkedAt, lastSeenAt: availability.checkedAt });
      alertsSeenThisRun += 1;
    }
  }
}

for (const workspace of workspaces) {
  for (const watchlist of watchlistsByWorkspace.get(workspace.id) ?? workspace.watchlists ?? []) {
    for (const item of scan.reviewQueue) {
      const status = item.status ?? "changed";
      const matches = watchlist.sourceIds.includes(item.sourceId) || watchlist.repositoryIds.includes(item.repository);
      if (!matches || !watchlist.alertOn.includes(status)) continue;
      const fingerprint = item.currentSha256 ?? status;
      const id = `alert-${createHash("sha256").update(`${workspace.id}:${watchlist.id}:${item.sourceId}:${fingerprint}`).digest("hex").slice(0, 20)}`;
      const prior = existingById.get(id);
      existingById.set(id, {
        id, workspaceId: workspace.id, watchlistId: watchlist.id, watchlistName: watchlist.name,
        sourceId: item.sourceId, repository: item.repository, sourcePath: item.sourcePath,
        state: prior?.state ?? "open", severity: status === "missing" ? "high" : status === "changed" ? "medium" : "low",
        kind: "source_change", reason: item.reason, scanRunId: scan.runId,
        createdAt: prior?.createdAt ?? new Date().toISOString(), lastSeenAt: new Date().toISOString()
      });
      alertsSeenThisRun += 1;
    }
  }
  for (const view of comparisonLedger.views ?? []) {
    if (view.workspaceId !== workspace.id) continue;
    const selected = (view.entityIds ?? []).map((id) => (atlas.entities?.[view.kind] ?? []).find((entity) => entity.id === id)).filter(Boolean);
    const sourceIds = selected.flatMap((entity) => entity.evidenceIds ?? []).filter((id, index, values) => values.indexOf(id) === index);
    const changed = (scan.sources ?? []).filter((item) => sourceIds.includes(item.id) && !["unchanged", "deferred"].includes(item.status));
    const records = selected.map((entity) => (packet.records ?? []).find((record) => entity.evidenceIds?.includes(record.id) && record.reportWindow)).filter(Boolean);
    const sharedColumns = records.length ? records.reduce((shared, record) => shared.filter((column) => (record.reportWindow.columns ?? []).includes(column)), records[0].reportWindow.columns ?? []) : [];
    const incompatible = records.length !== selected.length || !sharedColumns.length;
    if (!changed.length && !incompatible) continue;
    const fingerprint = `${changed.map((item) => `${item.id}:${item.status}:${item.sha256 ?? "missing"}`).join("|")}|${records.map((record) => (record.reportWindow.columns ?? []).join(",")).join("|")}`;
    const id = `alert-${createHash("sha256").update(`${workspace.id}:comparison:${view.id}:${fingerprint}`).digest("hex").slice(0, 20)}`;
    const prior = existingById.get(id);
    existingById.set(id, { id, workspaceId: workspace.id, watchlistId: null, watchlistName: view.name, comparisonViewId: view.id, sourceId: changed[0]?.id ?? null, repository: "comparison", sourcePath: `comparison:${view.kind}`, state: prior?.state ?? "open", severity: incompatible ? "high" : "medium", kind: incompatible ? "comparison_incompatible" : "comparison_refresh", reason: incompatible ? "The saved comparison no longer has a complete shared metric set; review definitions before comparing." : "A source behind this saved comparison changed; reopen the comparison and review the new period.", scanRunId: scan.runId, createdAt: prior?.createdAt ?? new Date().toISOString(), lastSeenAt: new Date().toISOString() });
    alertsSeenThisRun += 1;
  }
}

const result = { schemaVersion: "workspace-alert-ledger-v1", generatedAt: new Date().toISOString(), workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })), alerts: [...existingById.values()] };
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ workspaces: workspaces.length, openAlerts: result.alerts.filter((alert) => alert.state === "open").length, alertsSeenThisRun }, null, 2));
console.log(`Wrote ${outputPath}`);
