import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-source-scan-"));
const env = { ...process.env, RUNTIME_DATA_DIR: runtimeDir };
await exec(process.execPath, [resolve(root, "scripts/scan-source-changes.mjs")], { cwd: root, env });
await exec(process.execPath, [resolve(root, "scripts/scan-source-changes.mjs")], { cwd: root, env });
const history = JSON.parse(await readFile(resolve(runtimeDir, "source-scan-history.json"), "utf8"));
const latest = JSON.parse(await readFile(resolve(runtimeDir, "latest-source-scan.json"), "utf8"));
if (history.runs.length !== 2 || history.runs[0].runId === history.runs[1].runId || latest.runId !== history.runs[1].runId) throw new Error("Source scanner did not honor isolated runtime history.");
console.log("Source-scan runtime test passed: repeated scans stayed in the configured runtime directory.");
