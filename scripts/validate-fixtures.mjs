import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const path = resolve(root, "data/fixtures/ai-work-control.records.json");
const packet = JSON.parse(await readFile(path, "utf8"));
const allowedRoles = new Set([
  "trend_signal",
  "company_report", "industry", "private_company", "social_cultural",
  "institutional", "research", "geopolitical", "open_question"
]);
const allowedStates = new Set([
  "reported", "calculated", "measured", "compared", "interpreted",
  "inferred_across_sources", "open", "disproved_or_weakened"
]);
const errors = [];
const ids = new Set();

for (const record of packet.records ?? []) {
  for (const field of ["id", "sourceRole", "sourceRepository", "sourceRef", "title", "observation", "claimState", "asOf", "limits"]) {
    if (record[field] === undefined || record[field] === "") errors.push(`${record.id ?? "unknown"}: missing ${field}`);
  }
  if (ids.has(record.id)) errors.push(`duplicate record id: ${record.id}`);
  ids.add(record.id);
  if (!allowedRoles.has(record.sourceRole)) errors.push(`${record.id}: invalid sourceRole`);
  if (!allowedStates.has(record.claimState)) errors.push(`${record.id}: invalid claimState`);
  if (!Array.isArray(record.limits) || record.limits.length === 0) errors.push(`${record.id}: limits must not be empty`);
}

for (const insight of packet.insights ?? []) {
  if (!insight.id || !insight.title || !insight.plainLanguageSummary) errors.push(`${insight.id ?? "unknown"}: missing insight identity/text`);
  if (!Array.isArray(insight.recordIds) || insight.recordIds.length < 2) errors.push(`${insight.id}: needs at least two records`);
  for (const recordId of insight.recordIds ?? []) if (!ids.has(recordId)) errors.push(`${insight.id}: unknown record ${recordId}`);
  if (!Array.isArray(insight.whatWouldChangeOurMind) || insight.whatWouldChangeOurMind.length === 0) errors.push(`${insight.id}: missing falsifier`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Validated ${packet.records.length} evidence records and ${packet.insights.length} bounded insight.`);
