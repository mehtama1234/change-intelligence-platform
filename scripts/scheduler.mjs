import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const intervalMs = Number(process.env.REFRESH_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
let stopping = false;

function cycle() {
  return new Promise((resolveCycle) => {
    const child = spawn(process.execPath, [resolve(root, "scripts/run-refresh-cycle.mjs")], { cwd: root, env: process.env, stdio: "inherit" });
    child.on("close", (code) => resolveCycle(code ?? 1));
  });
}

async function main() {
  console.log(`Refresh scheduler started; interval ${intervalMs}ms.`);
  while (!stopping) {
    await cycle();
    if (stopping) break;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs));
  }
  console.log("Refresh scheduler stopped.");
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
await main();
