import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = `/tmp/change-intelligence-workspace-delivery-${Date.now()}`;
await mkdir(runtimeDir, { recursive: true });
const preference = { id: "notification-preference-demo-research", workspaceId: "demo-research", deliveryUpdates: true, delivery: "webhook", destinationId: "partner-webhook", webhookUrl: "PLACEHOLDER" };
const notification = { id: "workspace-delivery-notification-test", workspaceId: "demo-research", deliveryId: "delivery-test", channel: "webhook", destinationId: "partner-webhook", status: "pending", subject: "Refresh handoff", body: "One bounded update is ready.", createdAt: new Date().toISOString() };
await writeFile(resolve(runtimeDir, "workspace-notification-preferences.json"), `${JSON.stringify({ schemaVersion: "workspace-notification-preference-ledger-v1", preferences: [preference] }, null, 2)}\n`);
await writeFile(resolve(runtimeDir, "workspace-delivery-notifications.json"), `${JSON.stringify({ schemaVersion: "workspace-delivery-notification-ledger-v1", notifications: [notification] }, null, 2)}\n`);
let received = 0;
let body;
const server = createServer((request, response) => { let value = ""; request.on("data", (chunk) => { value += chunk; }); request.on("end", () => { received += 1; body = JSON.parse(value); response.writeHead(200); response.end("ok"); }); });
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
preference.webhookUrl = `http://127.0.0.1:${address.port}/notify`;
await writeFile(resolve(runtimeDir, "workspace-notification-preferences.json"), `${JSON.stringify({ schemaVersion: "workspace-notification-preference-ledger-v1", preferences: [preference] }, null, 2)}\n`);
const env = { ...process.env, RUNTIME_DATA_DIR: runtimeDir, WORKSPACE_NOTIFICATION_MAX_ATTEMPTS: "2", WORKSPACE_NOTIFICATION_RETRY_DELAY_MS: "0" };
try {
  await exec(process.execPath, [resolve(root, "scripts/dispatch-workspace-notifications.mjs")], { cwd: root, env });
  const delivered = JSON.parse(await readFile(resolve(runtimeDir, "workspace-delivery-notifications.json"), "utf8"));
  const attempts = JSON.parse(await readFile(resolve(runtimeDir, "workspace-delivery-notification-attempts.json"), "utf8"));
  if (received !== 1 || delivered.notifications[0].status !== "delivered" || delivered.notifications[0].attempts !== 1 || attempts.attempts[0].status !== "delivered" || body.notification.workspaceId !== "demo-research" || body.notification.deliveryId !== "delivery-test" || JSON.stringify(body).includes("webhookUrl")) throw new Error("Workspace webhook delivery did not produce a bounded tenant-safe success envelope.");
  delivered.notifications[0] = { ...delivered.notifications[0], status: "pending", deliveredAt: null, attempts: 0, lastError: null };
  await writeFile(resolve(runtimeDir, "workspace-delivery-notifications.json"), `${JSON.stringify(delivered, null, 2)}\n`);
  server.removeAllListeners("request");
  server.on("request", (request, response) => { request.resume(); response.writeHead(500); response.end("fail"); });
  await exec(process.execPath, [resolve(root, "scripts/dispatch-workspace-notifications.mjs")], { cwd: root, env: { ...env, WORKSPACE_NOTIFICATION_MAX_ATTEMPTS: "1" } });
  const failed = JSON.parse(await readFile(resolve(runtimeDir, "workspace-delivery-notifications.json"), "utf8"));
  if (failed.notifications[0].status !== "dead_letter" || failed.notifications[0].attempts !== 1) throw new Error("Failed workspace webhook delivery did not reach dead letter.");
  console.log("Workspace delivery test passed: tenant-safe webhook success and dead-letter handling were recorded.");
} finally {
  server.close();
}
