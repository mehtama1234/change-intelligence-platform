import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packet = JSON.parse(await readFile(resolve(root, "data/processed/ai-work-control.packet.json"), "utf8"));
const records = packet.records ?? [];
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const privateCompanies = records.filter((record) => record.sourceRole === "private_company");
const publicWindows = records.filter((record) => record.sourceRole === "company_report" && record.reportWindow);
const independentRepositories = new Set(records.filter((record) => record.sourceRole === "research").map((record) => record.sourceRepository));
const counterexamples = records.filter((record) => record.claimState === "disproved_or_weakened" || /counterexample|weaken/i.test(`${record.id} ${record.title}`));
const namedWorkflow = records.find((record) => record.stageLedger?.format === "named-workplace-system-stage-ledger-v1");
const stages = namedWorkflow?.stageLedger;
const observedResult = stages?.records?.some((record) => /reported|completed|measured|remedy|back-pay/i.test(Object.values(record).join(" ")));
const unmeasuredStages = stages?.records?.flatMap((record) => Object.entries(record).filter(([stage, value]) => ["enforcement_or_appeal", "worker_outcome", "household_outcome", "exit_or_collective_action"].includes(stage) && /not observed|not yet observed/i.test(String(value))).map(([stage]) => stage)) ?? [];

assert(packet.schemaVersion === "change-intelligence-packet-v1", "packet schema is not the shared change-intelligence contract");
assert(new Set(records.map((record) => record.sourceRepository)).size >= 6, "the first domain must cover the six connected research repositories");
assert(privateCompanies.length >= 5, `expected at least five private-company records, found ${privateCompanies.length}`);
assert(publicWindows.length >= 5, `expected at least five public-company report windows, found ${publicWindows.length}`);
assert(publicWindows.every((record) => record.reportWindow.annualBaseline && (record.reportWindow.quarters ?? []).length >= 3), "each public-company window needs an annual baseline and three later quarters");
assert(independentRepositories.size >= 3, `expected independent research from three repositories, found ${independentRepositories.size}`);
assert(counterexamples.length >= 1, "the central reading needs at least one explicit counterexample or weakening record");
assert(stages && Array.isArray(stages.requiredStageOrder) && Array.isArray(stages.records) && stages.records.length > 0, "a named workflow stage ledger is required");
assert(observedResult, "the named workflow must include at least one reported, completed, or measured result");
assert(unmeasuredStages.length >= 2, "the named workflow must keep later correction, distribution, durability, or exit stages explicitly unmeasured");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Research completeness passed: ${privateCompanies.length} private-company records, ${publicWindows.length} public report windows, ${independentRepositories.size} independent repositories, ${counterexamples.length} counterexample records, and a bounded named-workflow stage ledger.`);
