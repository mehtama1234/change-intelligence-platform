import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packetPath = resolve(root, "data/processed/ai-work-control.packet.json");
const packet = JSON.parse(await readFile(packetPath, "utf8"));
const temp = await mkdtemp(resolve(tmpdir(), "change-intelligence-quality-"));
const badPacketPath = resolve(temp, "bad-packet.json");
const badPacket = structuredClone(packet);
badPacket.insights[0].plainLanguageSummary = "The evidence proves AI causes a universal productivity gain.";
await writeFile(badPacketPath, `${JSON.stringify(badPacket, null, 2)}\n`);
try {
  await exec(process.execPath, [resolve(root, "scripts/evaluate-insight-quality.mjs")], { cwd: root, env: { ...process.env, INSIGHT_PACKET_PATH: badPacketPath, INSIGHT_CANDIDATE_PATH: resolve(temp, "no-candidates.json"), INSIGHT_EVALUATION_PATH: resolve(temp, "bad-evaluation.json") } });
  throw new Error("Insight evaluator accepted an unsupported causal claim.");
} catch (error) {
  if (!String(error.stderr ?? error.message).includes("unsupported causal")) throw error;
}
console.log("Insight quality adversarial test passed: unsupported causal language is rejected.");
