import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRoot = process.env.RESEARCH_ROOT ?? "/home/mehta/git-repo";
const mapPath = resolve(root, process.env.SOURCE_MAP_PATH ?? "data/source-maps/ai-work-control.sources.json");
const map = JSON.parse(await readFile(mapPath, "utf8"));
const errors = [];
const windows = (map.sources ?? []).filter((source) => source.reportWindow);
const requiredCompanies = Number(process.env.REQUIRED_COMPANY_REPORT_WINDOWS ?? 5);

function linksIn(text) {
  return [
    ...[...text.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)].map((match) => match[1]),
    ...[...text.matchAll(/<(https?:\/\/[^>]+)>/g)].map((match) => match[1])
  ];
}

for (const source of windows) {
  const window = source.reportWindow;
  const bridgePath = window.bridgePath;
  const initialReadPath = window.initialReadPath;
  if (!source.company) errors.push(`${source.id}: report window must name a company`);
  if (!window.annualBaseline) errors.push(`${source.id}: annual baseline is missing`);
  if (!bridgePath || !existsSync(resolve(sourceRoot, source.sourceRepository, bridgePath))) errors.push(`${source.id}: accounting bridge is unavailable`);
  if (!initialReadPath || !existsSync(resolve(sourceRoot, source.sourceRepository, initialReadPath))) errors.push(`${source.id}: initial evidence read is unavailable`);
  if (bridgePath && existsSync(resolve(sourceRoot, source.sourceRepository, bridgePath))) {
    const bridge = await readFile(resolve(sourceRoot, source.sourceRepository, bridgePath), "utf8");
    const quarterRows = bridge.split("\n").filter((line) => /^\|\s*(?:Q\d|FY\d|Reporting window)/.test(line) && !/^\|\s*Reporting window/.test(line));
    if (quarterRows.length < 3) errors.push(`${source.id}: bridge must contain at least three quarterly records`);
  }
  const sourceLedgerPath = window.sourceLedgerPath ?? source.sourcePath;
  const sourceFile = resolve(sourceRoot, source.sourceRepository, sourceLedgerPath);
  if (!existsSync(sourceFile)) errors.push(`${source.id}: source ledger is unavailable`);
  else {
    const links = linksIn(await readFile(sourceFile, "utf8"));
    const bridgeFile = bridgePath ? resolve(sourceRoot, source.sourceRepository, bridgePath) : null;
    const bridgeLinks = bridgeFile && existsSync(bridgeFile) ? linksIn(await readFile(bridgeFile, "utf8")) : [];
    const secLinks = [...links, ...bridgeLinks].filter((url) => url.includes("sec.gov/"));
    if (new Set(secLinks).size < 4) errors.push(`${source.id}: expected annual plus three direct SEC links, found ${new Set(secLinks).size}`);
  }
}

const companies = new Set(windows.map((source) => source.company).filter(Boolean));
if (windows.length < requiredCompanies) errors.push(`expected at least ${requiredCompanies} report windows, found ${windows.length}`);
if (companies.size < requiredCompanies) errors.push(`expected at least ${requiredCompanies} distinct companies, found ${companies.size}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Validated ${windows.length} annual-plus-quarterly company report windows across ${companies.size} companies.`);
