import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const workspaceDir = resolve(root, process.env.WORKSPACE_CONFIG_DIR ?? "data/fixtures/workspaces");
const scanPath = resolve(root, process.env.SOURCE_SCAN_PATH ?? "data/processed/runs/ai-work-control/latest-source-scan.json");
const outputDir = resolve(root, process.env.ALERT_OUTPUT_DIR ?? "data/processed/runs/ai-work-control");
const outputPath = resolve(outputDir, process.env.ALERT_OUTPUT_NAME ?? "workspace-alerts.json");
const scan = JSON.parse(await readFile(scanPath, "utf8"));
const files = (await readdir(workspaceDir)).filter((file) => file.endsWith(".json"));
const workspaces = await Promise.all(files.map(async (file) => JSON.parse(await readFile(resolve(workspaceDir, file), "utf8"))));
const existing = existsSync(outputPath) ? JSON.parse(await readFile(outputPath, "utf8")) : { schemaVersion: "workspace-alert-ledger-v1", alerts: [] };
const existingById = new Map(existing.alerts.map((alert) => [alert.id, alert]));
let alertsSeenThisRun = 0;

for (const workspace of workspaces) {
  for (const watchlist of workspace.watchlists) {
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
}

const result = { schemaVersion: "workspace-alert-ledger-v1", generatedAt: new Date().toISOString(), workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })), alerts: [...existingById.values()] };
await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ workspaces: workspaces.length, openAlerts: result.alerts.filter((alert) => alert.state === "open").length, alertsSeenThisRun }, null, 2));
console.log(`Wrote ${outputPath}`);
