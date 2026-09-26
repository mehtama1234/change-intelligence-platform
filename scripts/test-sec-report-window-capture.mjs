import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const outputDir = `/tmp/change-intelligence-sec-windows-${Date.now()}`;
await mkdir(outputDir, { recursive: true });
const child = spawn(process.execPath, [resolve(root, "scripts/acquire-sec-report-windows.mjs")], { cwd: root, env: { ...process.env, SEC_WINDOWS_CAPTURE_DIR: outputDir, SEC_CAPTURE_DRY_RUN: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });
const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
try {
  if (exitCode !== 0) throw new Error(stderr || stdout);
  const summary = JSON.parse(stdout);
  if (summary.companies.length !== 5 || summary.companies.some((company) => company.links < 4 || company.failed)) throw new Error("SEC report-window capture contract did not discover four or more direct links per company.");
  for (const company of summary.companies) {
    const manifest = JSON.parse(await readFile(company.manifest, "utf8"));
    if (manifest.schemaVersion !== "sec-report-window-capture-v1" || !manifest.dryRun || manifest.records.some((record) => record.status !== "dry_run")) throw new Error(`${company.company}: dry-run manifest is invalid.`);
  }
  console.log(`SEC report-window capture test passed: ${summary.companies.length} companies and ${summary.companies.reduce((total, company) => total + company.links, 0)} direct links discovered.`);
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
