import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
await mkdir(runtimeDir, { recursive: true });
const ledgers = {
  "idempotency-operations.json": { schemaVersion: "idempotency-ledger-v1", operations: [] }
};
for (const [name, value] of Object.entries(ledgers)) {
  try { await access(resolve(runtimeDir, name)); }
  catch { await writeFile(resolve(runtimeDir, name), `${JSON.stringify(value, null, 2)}\n`); }
}
console.log(`Initialized runtime ledgers in ${runtimeDir}.`);
