import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = `/tmp/change-intelligence-operator-delivery-${Date.now()}`;
await mkdir(runtimeDir, { recursive: true });
const notification = { id: "operator-notification-test", warningId: "refresh-failures", channel: "operator-outbox", recipient: "ops-owner", status: "pending", subject: "Test warning", body: "Test delivery", createdBy: "test", createdAt: new Date().toISOString(), dispatchedAt: null, dispatchNote: null };
await writeFile(resolve(runtimeDir, "operator-notification-outbox.json"), `${JSON.stringify({ schemaVersion: "operator-notification-outbox-v1", notifications: [notification] }, null, 2)}\n`);
let received = 0;
const server = createServer((request, response) => { request.resume(); received += 1; response.writeHead(200); response.end("ok"); });
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
await writeFile(resolve(runtimeDir, "operator-notification-routes.json"), `${JSON.stringify({ schemaVersion: "operator-notification-route-ledger-v1", settings: [{ id: "operator-notification-routes", default: [], warningIds: {}, workspaces: {}, destinations: { "ops-owner": { id: "tenant-webhook", mode: "webhook", url: `http://127.0.0.1:${address.port}/notify` } } }] }, null, 2)}\n`);
const env = { ...process.env, RUNTIME_DATA_DIR: runtimeDir, OPERATOR_NOTIFICATION_DELIVERY_MODE: "webhook", OPERATOR_NOTIFICATION_WEBHOOK_URL: `http://127.0.0.1:${address.port}/notify`, OPERATOR_NOTIFICATION_MAX_ATTEMPTS: "2", OPERATOR_NOTIFICATION_RETRY_DELAY_MS: "0" };
try {
  await exec(process.execPath, [resolve(root, "scripts/dispatch-operator-notifications.mjs")], { cwd: root, env });
  const delivered = JSON.parse(await readFile(resolve(runtimeDir, "operator-notification-outbox.json"), "utf8"));
  const attempts = JSON.parse(await readFile(resolve(runtimeDir, "operator-notification-attempts.json"), "utf8"));
  if (received !== 1 || delivered.notifications[0].status !== "delivered" || delivered.notifications[0].attempts !== 1 || delivered.notifications[0].destinationId !== "tenant-webhook" || attempts.attempts[0].status !== "delivered") throw new Error("Webhook delivery did not record a successful tenant destination attempt.");
  delivered.notifications[0] = { ...delivered.notifications[0], status: "pending", deliveredAt: null, attempts: 0, lastError: null };
  await writeFile(resolve(runtimeDir, "operator-notification-outbox.json"), `${JSON.stringify(delivered, null, 2)}\n`);
  server.removeAllListeners("request");
  server.on("request", (request, response) => { request.resume(); response.writeHead(500); response.end("fail"); });
  await exec(process.execPath, [resolve(root, "scripts/dispatch-operator-notifications.mjs")], { cwd: root, env: { ...env, OPERATOR_NOTIFICATION_MAX_ATTEMPTS: "1" } });
  const failed = JSON.parse(await readFile(resolve(runtimeDir, "operator-notification-outbox.json"), "utf8"));
  if (failed.notifications[0].status !== "dead_letter" || failed.notifications[0].attempts !== 1) throw new Error("Failed webhook delivery did not reach the dead-letter state.");
  console.log("Operator delivery test passed: webhook success and dead-letter failure were recorded.");
} finally {
  server.close();
}
