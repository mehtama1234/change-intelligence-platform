import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runtimeDir = process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control";
const packetPath = resolve(root, process.env.INSIGHT_PACKET_PATH ?? `${runtimeDir}/ai-work-control.packet.json`);
const outputPath = resolve(root, process.env.INSIGHT_OPPORTUNITIES_PATH ?? `${runtimeDir}/insight-opportunities.json`);
const packet = JSON.parse(await readFile(packetPath, "utf8"));

const stopWords = new Set(["the", "and", "for", "with", "from", "that", "this", "can", "will", "while", "remain", "stays", "move", "moving", "make", "makes", "into", "over", "under", "through"]);
const conceptGroups = {
  control: ["control", "agency", "autonomy", "decision", "decisions", "power"],
  correction: ["correct", "correction", "review", "appeal", "remedy", "override", "fix", "error", "errors"],
  dependence: ["dependence", "dependent", "portability", "portable", "exit", "switching", "replace", "replacement"],
  adoption: ["adopt", "adoption", "deploy", "deployment", "deployed", "implementation", "implemented"],
  outcome: ["outcome", "outcomes", "productivity", "value", "benefit", "benefits", "result", "results", "impact"],
  infrastructure: ["infrastructure", "compute", "computing", "network", "networking", "cloud", "capacity"],
  economics: ["revenue", "margin", "growth", "price", "pricing", "cost", "scarcity", "demand"]
};
const conceptByTerm = new Map(Object.entries(conceptGroups).flatMap(([concept, words]) => words.map((word) => [word, concept])));
const words = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 3 && !stopWords.has(word));
const conceptFor = (word) => conceptByTerm.get(word) ?? word;
const grouped = new Map();

for (const record of packet.records ?? []) {
  const sourceText = [record.title, record.observation, record.mechanism].join(" ");
  const concepts = [...new Set(words(sourceText).filter((word) => conceptByTerm.has(word)).map(conceptFor))];
  for (const concept of concepts) grouped.set(concept, [...(grouped.get(concept) ?? []), record]);
}

const labels = { control: "control and decision rights", correction: "correction and remedy", dependence: "dependence and exit", adoption: "adoption and deployment", outcome: "measured outcomes", infrastructure: "infrastructure and capacity", economics: "economics and demand" };
const opportunities = [...grouped.entries()]
  .map(([concept, records]) => {
    const repositories = [...new Set(records.map((record) => record.sourceRepository))];
    if (records.length < 2 || repositories.length < 2) return null;
    const evidence = records.map((record) => ({ recordId: record.id, sourceRepository: record.sourceRepository, sourceRole: record.sourceRole, title: record.title, sourceDigest: record.sourceDigest }));
    const evidenceDigest = createHash("sha256").update(JSON.stringify(evidence.map((item) => [item.recordId, item.sourceDigest]))).digest("hex");
    return {
      id: `opportunity-${concept}-${evidenceDigest.slice(0, 12)}`,
      concept,
      title: `Cross-source pattern: ${labels[concept] ?? concept}`,
      plainLanguageSummary: `${records.length} records from ${repositories.length} repositories use a similar ${labels[concept] ?? concept} mechanism. This is a lead for research, not a conclusion about what is happening in the world.`,
      status: "opportunity_needs_researcher_review",
      evidenceDigest,
      evidence,
      repositories,
      strongestAlternative: "The apparent pattern may reflect the source map or shared language rather than a common real-world mechanism.",
      whatWouldChangeOurMind: ["A source-level review shows the records use different definitions or populations.", "Independent evidence fails to connect the shared mechanism to the same observed consequence."],
      nextTest: `Review the ${records.length} source records side by side, record their definitions and populations, and test whether the ${labels[concept] ?? concept} mechanism recurs in a named workflow.`,
      limits: ["This opportunity is generated from shared record language and repository coverage; it is not a causal finding.", "No customer delivery or publication may use this opportunity until a researcher creates and reviews a bounded insight."]
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.repositories.length - a.repositories.length || a.concept.localeCompare(b.concept));

const result = { schemaVersion: "insight-opportunity-ledger-v1", generatedAt: new Date().toISOString(), sourcePacketDigest: createHash("sha256").update(JSON.stringify((packet.records ?? []).map((record) => [record.id, record.sourceDigest]))).digest("hex"), opportunities };
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ opportunities: opportunities.length, concepts: opportunities.map((opportunity) => opportunity.concept) }, null, 2));
