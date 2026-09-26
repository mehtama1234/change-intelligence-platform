import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRoot = process.env.RESEARCH_ROOT ?? "/home/mehta/git-repo";
const mapPath = resolve(root, process.env.SOURCE_MAP_PATH ?? "data/source-maps/ai-work-control.sources.json");
const outputRoot = resolve(root, process.env.SEC_WINDOWS_CAPTURE_DIR ?? "data/raw/ai-work-control/sec-report-windows");
const userAgent = process.env.SEC_USER_AGENT ?? "ChangeIntelligenceResearch/0.1 contact: research@example.invalid";
const dryRun = process.env.SEC_CAPTURE_DRY_RUN === "1";
const map = JSON.parse(await readFile(mapPath, "utf8"));

function directLinks(markdown) {
  return [
    ...[...markdown.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)].map((match) => ({ label: match[1], url: match[2] })),
    ...[...markdown.matchAll(/-\s*([^:\n]+):\s*<(https?:\/\/[^>]+)>/g)].map((match) => ({ label: match[1].trim(), url: match[2] }))
  ].filter((record) => record.url.includes("sec.gov/"));
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const sources = (map.sources ?? []).filter((source) => source.reportWindow);
if (!sources.length) throw new Error("No company report windows are configured.");
const summaries = [];
for (const source of sources) {
  const window = source.reportWindow;
  const paths = [window.sourceLedgerPath ?? source.sourcePath, window.bridgePath].filter(Boolean);
  const texts = [];
  for (const path of paths) {
    const fullPath = resolve(sourceRoot, source.sourceRepository, path);
    if (existsSync(fullPath)) texts.push(await readFile(fullPath, "utf8"));
  }
  const links = [...new Map(texts.flatMap(directLinks).map((record) => [record.url, record])).values()];
  const outputDir = resolve(outputRoot, safeName(source.company ?? source.id));
  await mkdir(outputDir, { recursive: true });
  const records = [];
  for (const [index, link] of links.entries()) {
    const accession = link.url.match(/data\/\d+\/([^/]+)/)?.[1] ?? String(index + 1);
    const fileName = `${String(index + 1).padStart(2, "0")}-${safeName(link.label)}-${accession}.html`;
    const result = { ...link, fileName, retrievedAt: new Date().toISOString(), status: dryRun ? "dry_run" : "not_attempted" };
    if (!dryRun) {
      try {
        const response = await fetch(link.url, { headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(30000) });
        result.httpStatus = response.status;
        result.contentType = response.headers.get("content-type");
        if (!response.ok) {
          result.status = "blocked_or_failed";
          result.error = `HTTP ${response.status}`;
        } else {
          const body = Buffer.from(await response.arrayBuffer());
          await writeFile(resolve(outputDir, fileName), body);
          result.status = "retrieved";
          result.bytes = body.length;
          result.sha256 = createHash("sha256").update(body).digest("hex");
        }
      } catch (error) {
        result.status = "blocked_or_failed";
        result.error = error instanceof Error ? error.message : String(error);
      }
    }
    records.push(result);
  }
  const manifest = { schemaVersion: "sec-report-window-capture-v1", sourceId: source.id, company: source.company, generatedAt: new Date().toISOString(), userAgent, dryRun, records };
  await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  summaries.push({ sourceId: source.id, company: source.company, links: links.length, retrieved: records.filter((record) => record.status === "retrieved").length, failed: records.filter((record) => record.status === "blocked_or_failed").length, manifest: resolve(outputDir, "manifest.json") });
}

console.log(JSON.stringify({ schemaVersion: "sec-report-window-capture-summary-v1", dryRun, companies: summaries }, null, 2));
if (summaries.some((summary) => summary.failed)) process.exitCode = 2;
