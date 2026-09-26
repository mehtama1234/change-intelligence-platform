import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const rawDir = resolve(root, "data/raw/ai-work-control/c3-ai");
const manifestPath = resolve(rawDir, "manifest.json");
const outputPath = resolve(root, "data/processed/ai-work-control/c3-ai.xbrl.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

function contexts(html) {
  const result = new Map();
  for (const match of html.matchAll(/<xbrli:context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/gi)) {
    const body = match[2];
    const startDate = body.match(/<xbrli:startDate>([^<]+)</i)?.[1];
    const endDate = body.match(/<xbrli:endDate>([^<]+)</i)?.[1];
    const instant = body.match(/<xbrli:instant>([^<]+)</i)?.[1];
    result.set(match[1], { startDate, endDate, instant });
  }
  return result;
}

function valueOf(match) {
  const attributes = match[1];
  const raw = match[2].replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, "").trim().replaceAll(",", "");
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const scale = Number(attributes.match(/\bscale="(-?\d+)"/)?.[1] ?? 0);
  const sign = attributes.includes('sign="-"') ? -1 : 1;
  return sign * value * (10 ** scale);
}

const filings = [];
for (const capture of manifest.records.filter((record) => record.status === "retrieved")) {
  const html = await readFile(resolve(rawDir, capture.fileName), "utf8");
  const periodByContext = contexts(html);
  const facts = [];
  const factPattern = /<ix:nonFraction\b([^>]*\bname="(?:us-gaap:OperatingIncomeLoss|us-gaap:NetIncomeLoss)"[^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi;
  for (const match of html.matchAll(factPattern)) {
    const attributes = match[1];
    const contextRef = attributes.match(/\bcontextRef="([^"]+)"/)?.[1];
    const factName = attributes.match(/\bname="([^"]+)"/)?.[1];
    const period = periodByContext.get(contextRef);
    const value = valueOf(match);
    if (factName && period && value !== null) facts.push({ factName, contextRef, period, value, unit: "USD" });
  }
  filings.push({ label: capture.label, url: capture.url, fileName: capture.fileName, sha256: capture.sha256, facts });
}

const result = { schemaVersion: "sec-xbrl-extract-v1", generatedAt: new Date().toISOString(), filings };
await mkdir(resolve(root, "data/processed/ai-work-control"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`Extracted ${filings.reduce((total, filing) => total + filing.facts.length, 0)} XBRL facts from ${filings.length} filings.`);
console.log(`Wrote ${outputPath}`);
