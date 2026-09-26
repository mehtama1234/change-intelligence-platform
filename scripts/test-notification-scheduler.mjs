import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore } from "../storage.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = `/tmp/change-intelligence-notification-scheduler-${Date.now()}`;
await mkdir(runtimeDir, { recursive: true });
const store = createRuntimeStore(runtimeDir);
store.close();
let received = 0;
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => { received += 1; if (!body.includes("workspace-delivery-notification-v1")) response.writeHead(400); else response.writeHead(204); response.end(); });
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
await writeFile(resolve(runtimeDir, "workspace-notification-preferences.json"), `${JSON.stringify({ schemaVersion: "workspace-notification-preference-ledger-v1", preferences: [{ id: "preference-scheduler-test", workspaceId: "workspace-scheduler-test", delivery: "webhook", webhookUrl: `http://127.0.0.1:${address.port}/notify` }] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-delivery-notifications.json"), `${JSON.stringify({ schemaVersion: "workspace-delivery-notification-ledger-v1", notifications: [{ id: "notification-scheduler-test", workspaceId: "workspace-scheduler-test", deliveryId: "delivery-scheduler-test", channel: "webhook", destinationId: "scheduler-webhook", status: "pending", subject: "Scheduled handoff", body: "A bounded update is ready.", deliveryStatus: "prepared", briefingStates: [], insightPublicationIds: [], staleInsightTitles: [], unavailableSourceIds: [], createdAt: new Date().toISOString() }] }, null, 2)}\n`);
const child = spawn(process.execPath, [resolve(root, "scripts/notification-scheduler.mjs")], { cwd: root, env: { ...process.env, RUNTIME_DATA_DIR: runtimeDir, NOTIFICATION_INTERVAL_MS: "1000", NOTIFICATION_SCHEDULER_MAX_CYCLES: "1", OPERATOR_NOTIFICATION_DELIVERY_MODE: "disabled" }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
try {
  const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
  const status = JSON.parse(await readFile(resolve(runtimeDir, "notification-scheduler-status.json"), "utf8"));
  const notifications = JSON.parse(await readFile(resolve(runtimeDir, "workspace-delivery-notifications.json"), "utf8"));
  if (exitCode !== 0 || received !== 1 || status.schemaVersion !== "notification-scheduler-status-v1" || status.status !== "stopped" || status.runCount !== 1 || status.lastRunStatus !== "complete" || notifications.notifications[0]?.status !== "delivered") throw new Error(`Notification scheduler contract failed: ${JSON.stringify({ exitCode, received, status, notifications, output })}`);
  console.log("Notification scheduler test passed: one background cycle delivered the pending workspace handoff and stopped cleanly.");
} finally {
  server.close();
}
