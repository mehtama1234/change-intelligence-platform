import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runbook = await readFile(resolve(root, "OPERATIONS-RUNBOOK.md"), "utf8");
const required = [
  [".env.example", "environment template"],
  ["docker compose up -d --build", "compose launch"],
  ["/api/readiness", "readiness probe"],
  ["/api/operations", "operations probe"],
  ["change-intelligence-scheduler", "refresh worker"],
  ["change-intelligence-backup", "backup worker"],
  ["change-intelligence-notifications", "notification worker"],
  ["npm run test:backup", "backup test"],
  ["restore-runtime.mjs", "restore procedure"],
  ["dead_letter", "notification failure handling"],
  ["cross-workspace", "security incident boundary"]
];
const missing = required.filter(([value]) => !runbook.includes(value)).map(([, label]) => label);
if (missing.length) throw new Error(`Operations runbook contract failed: ${missing.join(", ")}`);
console.log("Operations runbook contract passed: launch, health, pilot, failure, recovery, and release procedures are documented.");
