import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packet = JSON.parse(await readFile(resolve(root, "data/processed/ai-work-control.packet.json"), "utf8"));
const golden = JSON.parse(await readFile(resolve(root, "data/evaluations/insight-quality-golden.json"), "utf8"));
const candidateSourcePath = resolve(root, "data/processed/runs/ai-work-control/insight-candidates.json");
const candidateSource = JSON.parse(await readFile(candidateSourcePath, "utf8"));
const temp = await mkdtemp(resolve(tmpdir(), "change-intelligence-quality-"));

function mutate(packetCopy, mutation) {
  const insight = packetCopy.insights[0];
  if (mutation === "overclaim") insight.plainLanguageSummary = "The evidence proves AI causes a universal productivity gain.";
  if (mutation === "single_repository") insight.recordIds = [insight.recordIds[0]];
  if (mutation === "missing_alternative") insight.strongestAlternative = "";
  if (mutation === "missing_next_test") insight.nextTest = "";
  if (mutation === "missing_falsifier") insight.whatWouldChangeOurMind = [];
}

function mutateCandidate(candidateCopy, mutation) {
  const candidate = candidateCopy.candidates[0];
  if (mutation === "candidate_digest") candidate.evidence[0].sourceDigest = "wrong-digest";
  if (mutation === "candidate_receipt") { candidate.status = "published"; delete candidate.publicationId; delete candidate.publication; }
}

for (const testCase of golden.cases) {
  const badPacketPath = resolve(temp, `${testCase.id}.json`);
  const evaluationPath = resolve(temp, `${testCase.id}-evaluation.json`);
  const badPacket = structuredClone(packet);
  mutate(badPacket, testCase.mutation);
  await writeFile(badPacketPath, `${JSON.stringify(badPacket, null, 2)}\n`);
  const candidatePath = resolve(temp, `${testCase.id}-candidates.json`);
  const candidateMutation = ["candidate_digest", "candidate_receipt"].includes(testCase.mutation);
  if (candidateMutation) {
    const badCandidates = structuredClone(candidateSource);
    mutateCandidate(badCandidates, testCase.mutation);
    await writeFile(candidatePath, `${JSON.stringify(badCandidates, null, 2)}\n`);
  }
  try {
    await exec(process.execPath, [resolve(root, "scripts/evaluate-insight-quality.mjs")], { cwd: root, env: { ...process.env, INSIGHT_PACKET_PATH: badPacketPath, INSIGHT_CANDIDATE_PATH: candidateMutation ? candidatePath : resolve(temp, "no-candidates.json"), INSIGHT_EVALUATION_PATH: evaluationPath } });
    throw new Error(`Insight evaluator accepted golden failure: ${testCase.id}`);
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message ?? ""}`;
    if (!output.includes(testCase.expectedError)) throw new Error(`${testCase.id} failed with the wrong diagnostic: ${output}`);
  }
}
console.log(`Insight quality golden tests passed: ${golden.cases.length} failure cases were rejected with the expected diagnostics.`);
