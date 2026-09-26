import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packetPath = resolve(root, process.env.INSIGHT_PACKET_PATH ?? "data/processed/ai-work-control.packet.json");
const runtimeDir = process.env.RUNTIME_DATA_DIR ?? "data/processed/runs/ai-work-control";
const candidatePath = resolve(root, process.env.INSIGHT_CANDIDATE_PATH ?? `${runtimeDir}/insight-candidates.json`);
const outputPath = resolve(root, process.env.INSIGHT_EVALUATION_PATH ?? `${runtimeDir}/insight-evaluation.json`);
const packet = JSON.parse(await readFile(packetPath, "utf8"));
const candidates = existsSync(candidatePath) ? JSON.parse(await readFile(candidatePath, "utf8")) : { candidates: [] };
const records = new Map((packet.records ?? []).map((record) => [record.id, record]));
const candidateByInsight = new Map((candidates.candidates ?? []).map((candidate) => [candidate.insightId, candidate]));
const overclaimPatterns = [
  /\bproves?\b/i,
  /\bcauses?\b/i,
  /\bcaused by\b/i,
  /\bdefinitively\b/i,
  /\bguarantee(?:s|d)?\b/i,
  /\bwill always\b/i
];

function evaluateInsight(insight) {
  const errors = [];
  const warnings = [];
  const linked = (insight.recordIds ?? []).map((id) => records.get(id)).filter(Boolean);
  if ((insight.recordIds ?? []).length < 2) errors.push("insight must link at least two records");
  if (linked.length !== (insight.recordIds ?? []).length) errors.push("insight references a missing record");
  if (new Set(linked.map((record) => record.sourceRepository)).size < 2) errors.push("insight needs evidence from at least two repositories");
  if (!insight.strongestAlternative?.trim()) errors.push("missing strongest alternative explanation");
  if (!insight.nextTest?.trim()) errors.push("missing next test");
  if (!Array.isArray(insight.whatWouldChangeOurMind) || insight.whatWouldChangeOurMind.length === 0) errors.push("missing falsifiers");
  for (const field of ["title", "plainLanguageSummary", "strongestAlternative", "nextTest"]) {
    if (overclaimPatterns.some((pattern) => pattern.test(insight[field] ?? ""))) errors.push(`${field} contains unsupported causal or certainty language`);
  }
  const candidate = candidateByInsight.get(insight.id);
  if (candidate) {
    if (!Array.isArray(candidate.limits) || candidate.limits.length === 0) errors.push("candidate is missing limits");
    const evidenceDigest = createHash("sha256").update(JSON.stringify((candidate.evidence ?? []).map((item) => [item.recordId, item.sourceDigest]))).digest("hex");
    if (candidate.evidenceDigest !== evidenceDigest) errors.push("candidate evidence digest is not reproducible");
    for (const evidence of candidate.evidence ?? []) if (records.get(evidence.recordId)?.sourceDigest !== evidence.sourceDigest) errors.push(`candidate evidence digest mismatch: ${evidence.recordId}`);
    if (candidate.status === "published" && (!candidate.publicationId || candidate.publication !== "published")) errors.push("published candidate lacks a publication receipt");
    if (candidate.status === "published" && insight.status === "draft") warnings.push("candidate is published while source insight remains draft; confirm publication state is intentional");
  }
  return { insightId: insight.id, candidateId: candidate?.id ?? null, status: errors.length ? "fail" : "pass", errors, warnings, linkedRecordCount: linked.length, repositoryCount: new Set(linked.map((record) => record.sourceRepository)).size };
}

const evaluations = (packet.insights ?? []).map(evaluateInsight);
const result = { schemaVersion: "insight-evaluation-v1", generatedAt: new Date().toISOString(), status: evaluations.some((evaluation) => evaluation.status === "fail") ? "fail" : "pass", evaluations };
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
if (result.status === "fail") {
  console.error(evaluations.filter((evaluation) => evaluation.status === "fail").map((evaluation) => `${evaluation.insightId}: ${evaluation.errors.join("; ")}`).join("\n"));
  process.exit(1);
}
console.log(`Insight quality evaluation passed: ${evaluations.length} insight${evaluations.length === 1 ? "" : "s"}.`);
