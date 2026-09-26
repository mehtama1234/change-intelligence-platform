import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const destination = resolve(process.env.CI_RESEARCH_ROOT ?? resolve(root, "data/ci-research-snapshot"));
const map = JSON.parse(await readFile(resolve(root, "data/source-maps/ai-work-control.sources.json"), "utf8"));
const packet = JSON.parse(await readFile(resolve(root, "data/processed/ai-work-control.packet.json"), "utf8"));
const records = new Map((packet.records ?? []).map((record) => [record.id, record]));
const write = async (repository, path, content) => { const target = resolve(destination, repository, path); await mkdir(resolve(target, ".."), { recursive: true }); await writeFile(target, `${content}\n`); };

for (const source of map.sources ?? []) {
  const record = records.get(source.id);
  if (!record) throw new Error(`No packet record exists for ${source.id}.`);
  const sourceContent = source.sourcePath.endsWith(".json")
    ? JSON.stringify(record.stageLedger ?? { records: [], observation: record.observation ?? source.observation }, null, 2)
    : record.sourceExcerpt ?? record.observation ?? source.observation;
  await write(source.sourceRepository, source.sourcePath, sourceContent);
  const reportWindow = source.reportWindow && record.reportWindow
    ? { ...source.reportWindow, ...record.reportWindow }
    : record.reportWindow ?? source.reportWindow;
  if (!reportWindow) continue;
  const directRecords = reportWindow.sourceRefs?.directRecords ?? [];
  const links = directRecords.map((entry) => `[${entry.label}](${entry.url})`).join("\n");
  await write(source.sourceRepository, reportWindow.sourceLedgerPath ?? source.sourcePath, `# Source ledger snapshot\n\n${links}`);
  const quarters = reportWindow.quarters ?? [{ period: "Q1", values: [] }, { period: "Q2", values: [] }, { period: "Q3", values: [] }];
  const rows = quarters.slice(0, 3).map((quarter, index) => {
    const values = quarter.values?.length ? quarter.values : ["bounded report record"];
    return `| ${quarter.period || `Q${index + 1}`} | ${values[0]} | ${values[1] ?? "not established"} |`;
  }).join("\n");
  await write(source.sourceRepository, reportWindow.bridgePath, `# Accounting bridge snapshot\n\n| Quarter | Reported record | Boundary |\n|---|---|---|\n${rows}\n\n${links}`);
  if (reportWindow.initialReadPath !== reportWindow.bridgePath) {
    await write(source.sourceRepository, reportWindow.initialReadPath, `# Initial evidence read snapshot\n\n${record.observation ?? source.observation}\n\nThis CI snapshot preserves the source boundary; it is not a live source capture.`);
  }
}
console.log(`Prepared CI research contract snapshot at ${destination} for ${(map.sources ?? []).length} mapped records.`);
