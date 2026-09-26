import Database from "better-sqlite3";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

const runtimeFiles = [
  "workspace-questions.json",
  "audit-log.json",
  "idempotency-operations.json",
  "workspace-alerts.json",
  "briefing-publications.json",
  "insight-decisions.json",
  "insight-publications.json",
  "latest-source-scan.json",
  "source-scan-history.json",
  "versioned-evidence-ledger.json",
  "review-decisions.json",
  "review-events.json",
  "operator-warning-events.json",
  "operator-notification-outbox.json",
  "refresh-history.json",
  "insight-evaluation.json"
];

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function existing(path) {
  try { await readFile(path); return true; } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function backupRuntime({ runtimeDir, destination }) {
  await mkdir(destination, { recursive: true });
  const databasePath = resolve(runtimeDir, "change-intelligence.sqlite");
  if (!(await existing(databasePath))) throw new Error(`Runtime database does not exist: ${databasePath}`);
  const destinationDatabase = resolve(destination, "change-intelligence.sqlite");
  const database = new Database(databasePath, { readonly: true });
  try { await database.backup(destinationDatabase); } finally { database.close(); }
  const files = [{ name: "change-intelligence.sqlite", sha256: await digest(destinationDatabase) }];
  for (const name of runtimeFiles) {
    const source = resolve(runtimeDir, name);
    if (!(await existing(source))) continue;
    const target = resolve(destination, name);
    await copyFile(source, target);
    files.push({ name, sha256: await digest(target) });
  }
  const manifest = { schemaVersion: "runtime-backup-v1", createdAt: new Date().toISOString(), files };
  await writeFile(resolve(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function restoreRuntime({ backup, destination }) {
  const manifest = JSON.parse(await readFile(resolve(backup, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== "runtime-backup-v1" || !Array.isArray(manifest.files)) throw new Error("Invalid runtime backup manifest.");
  await mkdir(destination, { recursive: true });
  for (const entry of manifest.files) {
    if (entry.name !== basename(entry.name) || entry.name === "." || entry.name === "..") throw new Error(`Unsafe backup file name: ${entry.name}`);
    const source = resolve(backup, entry.name);
    const target = resolve(destination, entry.name);
    await copyFile(source, target);
    const actual = await digest(target);
    if (actual !== entry.sha256) throw new Error(`Checksum mismatch after restoring ${entry.name}.`);
  }
  return manifest;
}
