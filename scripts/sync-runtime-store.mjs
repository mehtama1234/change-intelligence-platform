import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeStore, importRuntimeLedgers } from "../storage.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = resolve(root, process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control");
const store = createRuntimeStore(runtimeDir);
try {
  await importRuntimeLedgers(store, {
    runtimeDir,
    questions: resolve(runtimeDir, "workspace-questions.json"),
    audit: resolve(runtimeDir, "audit-log.json"),
    operations: resolve(runtimeDir, "idempotency-operations.json"),
    alerts: resolve(runtimeDir, "workspace-alerts.json"),
    briefingPublications: resolve(runtimeDir, "briefing-publications.json"),
    insightDecisions: resolve(runtimeDir, "insight-decisions.json"),
    insightPublications: resolve(runtimeDir, "insight-publications.json"),
    workspaceDir: resolve(root, "data/fixtures/workspaces"),
    sourceScan: resolve(runtimeDir, "latest-source-scan.json"),
    evidenceLedger: resolve(runtimeDir, "versioned-evidence-ledger.json"),
    reviewDecisions: resolve(runtimeDir, "review-decisions.json")
  });
  console.log(`Synchronized runtime store: ${store.databasePath}`);
} finally {
  store.close();
}
