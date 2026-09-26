import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-availability-"));
const sourceRoot = await mkdtemp(resolve(tmpdir(), "change-intelligence-empty-sources-"));
await exec(process.execPath, [resolve(root, "scripts/check-source-availability.mjs")], { cwd: root, env: { ...process.env, RUNTIME_DATA_DIR: runtimeDir, RESEARCH_ROOT: sourceRoot } });
const receipt = JSON.parse(await readFile(resolve(runtimeDir, "latest-source-availability.json"), "utf8"));
if (receipt.schemaVersion !== "source-availability-receipt-v1" || receipt.counts.unavailable !== receipt.sources.length || receipt.counts.unavailable !== 20 || receipt.repositories.some((repository) => repository.status !== "unavailable")) throw new Error("Source availability did not report unavailable repositories independently of the refresh scan.");
console.log("Source availability test passed: all missing source files were recorded as unavailable with repository-level summaries.");
