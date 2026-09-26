import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-refresh-"));
const env = { ...process.env, RUNTIME_DATA_DIR: runtimeDir, REFRESH_SKIP_SEC: "1", REFRESH_RETRIES: "0" };
await exec(process.execPath, [resolve(root, "scripts/run-refresh-cycle.mjs")], { cwd: root, env, maxBuffer: 10 * 1024 * 1024 });
const receipt = JSON.parse(await readFile(resolve(runtimeDir, "latest-refresh.json"), "utf8"));
const packet = JSON.parse(await readFile(resolve(runtimeDir, "ai-work-control.packet.json"), "utf8"));
const history = JSON.parse(await readFile(resolve(runtimeDir, "source-scan-history.json"), "utf8"));
if (receipt.status !== "complete" || !receipt.steps.every((step) => ["complete", "skipped"].includes(step.status))) throw new Error("Isolated refresh did not complete cleanly.");
if (!packet.records?.length || history.runs.length !== 1) throw new Error("Isolated refresh did not materialize packet and source history in its runtime directory.");
console.log("Refresh runtime test passed: the complete pipeline wrote its receipt, packet, source history, and store to the configured runtime directory.");
