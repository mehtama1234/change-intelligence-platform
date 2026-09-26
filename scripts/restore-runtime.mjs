import { resolve } from "node:path";
import { restoreRuntime } from "../runtime-backup.mjs";

const backup = process.env.BACKUP_DIR;
const destination = process.env.RUNTIME_DATA_DIR;
if (!backup || !destination) throw new Error("BACKUP_DIR and RUNTIME_DATA_DIR are required.");
const manifest = await restoreRuntime({ backup: resolve(backup), destination: resolve(destination) });
console.log(`Restored runtime backup created at ${manifest.createdAt} into ${destination}`);
