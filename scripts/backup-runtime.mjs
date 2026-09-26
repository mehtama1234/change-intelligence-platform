import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backupRuntime } from "../runtime-backup.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const destination = process.env.BACKUP_DIR ? resolve(process.env.BACKUP_DIR) : resolve(root, "data/backups/ai-work-control");
const manifest = await backupRuntime({ runtimeDir, destination });
console.log(`Created runtime backup with ${manifest.files.length} files at ${destination}`);
