import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const reviewPath = resolve(root, process.env.REVIEW_WORK_PATH ?? "data/processed/runs/ai-work-control/latest-review-work.json");
const decisionsPath = resolve(root, process.env.REVIEW_DECISIONS_PATH ?? "data/processed/runs/ai-work-control/review-decisions.json");
const allowed = new Map([
  ["accept", "accepted_for_research"],
  ["reject", "rejected"],
  ["defer", "deferred"],
  ["correct", "correction_required"]
]);

function argument(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value?.slice(prefix.length);
}

const candidateId = argument("candidate");
const decision = argument("decision");
const reviewer = argument("reviewer");
const note = argument("note") ?? "";
if (!candidateId || !allowed.has(decision) || !reviewer) {
  throw new Error("Usage: --candidate=<id> --decision=<accept|reject|defer|correct> --reviewer=<id> [--note=<text>]");
}
if ((decision === "reject" || decision === "correct") && !note.trim()) {
  throw new Error(`${decision} decisions require --note=<text>`);
}

const reviewWork = JSON.parse(await readFile(reviewPath, "utf8"));
const candidate = reviewWork.candidates.find((item) => item.id === candidateId);
if (!candidate) throw new Error(`Unknown review candidate: ${candidateId}`);

const ledger = existsSync(decisionsPath) ? JSON.parse(await readFile(decisionsPath, "utf8")) : {
  schemaVersion: "review-decision-ledger-v1",
  decisions: []
};
if (ledger.schemaVersion !== "review-decision-ledger-v1" || !Array.isArray(ledger.decisions)) {
  throw new Error("Invalid review decision ledger");
}

const record = {
  id: `decision-${randomUUID()}`,
  candidateId,
  sourceId: candidate.sourceId,
  sourceDigest: candidate.sourceDigest,
  reviewer,
  decision,
  resultingState: allowed.get(decision),
  note: note.trim(),
  decidedAt: new Date().toISOString(),
  publication: "not_published"
};
ledger.decisions.push(record);
ledger.updatedAt = record.decidedAt;
await mkdir(resolve(decisionsPath, ".."), { recursive: true });
await writeFile(decisionsPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
console.log(`Wrote ${decisionsPath}`);
