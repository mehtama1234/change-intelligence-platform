import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runDir = await mkdtemp(resolve(tmpdir(), "change-intelligence-opportunities-"));
const packetPath = resolve(runDir, "packet.json");
const outputPath = resolve(runDir, "insight-opportunities.json");
await writeFile(packetPath, `${JSON.stringify({ records: [
  { id: "research-control", sourceRepository: "research-a", sourceRole: "research", title: "Workers can appeal decisions", observation: "People can challenge an automated decision.", mechanism: "An appeal gives people a correction route.", sourceDigest: "digest-a" },
  { id: "industry-remedy", sourceRepository: "research-b", sourceRole: "industry", title: "Review can correct an automated decision", observation: "A review process can address an error.", mechanism: "A remedy process changes who can correct the result.", sourceDigest: "digest-b" },
  { id: "unrelated", sourceRepository: "research-c", sourceRole: "company", title: "Cloud capacity grows", observation: "Compute demand is rising.", mechanism: "Infrastructure capacity follows demand.", sourceDigest: "digest-c" }
] }, null, 2)}\n`);
await exec(process.execPath, [resolve(root, "scripts/discover-insight-opportunities.mjs")], { cwd: root, env: { ...process.env, INSIGHT_PACKET_PATH: packetPath, INSIGHT_OPPORTUNITIES_PATH: outputPath } });
const result = JSON.parse(await readFile(outputPath, "utf8"));
const correction = result.opportunities.find((item) => item.concept === "correction");
if (!correction || correction.repositories.length !== 2 || correction.evidence.length !== 2 || correction.status !== "opportunity_needs_researcher_review" || !correction.nextTest || !correction.strongestAlternative) throw new Error("Cross-repository correction opportunity was not generated with review boundaries.");
if (result.opportunities.some((item) => item.concept === "work" || item.concept === "source")) throw new Error("Opportunity discovery emitted an unbounded language cluster.");
console.log("Insight opportunity test passed: shared mechanisms became review-only, source-linked opportunities.");
