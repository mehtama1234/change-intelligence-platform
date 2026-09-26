import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourceRoot = process.env.RESEARCH_ROOT ?? "/home/mehta/git-repo";
const mapPath = resolve(root, "data/source-maps/ai-work-control.sources.json");
const outputDir = resolve(root, process.env.SEC_CAPTURE_DIR ?? "data/raw/ai-work-control/c3-ai");
const manifestPath = resolve(outputDir, "manifest.json");
const map = JSON.parse(await readFile(mapPath, "utf8"));
const source = map.sources.find((item) => item.id === "atlas-c3-ai-report-window");
if (!source?.reportWindow) throw new Error("C3.ai report window is not configured");

const ledgerPath = resolve(sourceRoot, source.sourceRepository, source.sourcePath);
const ledger = await readFile(ledgerPath, "utf8");
const directRecords = [...ledger.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)]
  .map((match) => ({ label: match[1], url: match[2] }));
const safeName = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const userAgent = process.env.SEC_USER_AGENT ?? "ChangeIntelligenceResearch/0.1 contact: research@example.invalid";
const results = [];
await mkdir(outputDir, { recursive: true });

for (const [index, record] of directRecords.entries()) {
  const accession = record.url.match(/data\/\d+\/([^/]+)/)?.[1] ?? String(index + 1);
  const fileName = `${String(index + 1).padStart(2, "0")}-${safeName(record.label)}-${accession}.html`;
  const result = { ...record, fileName, retrievedAt: new Date().toISOString(), status: "not_attempted" };
  try {
    const response = await fetch(record.url, {
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(30000)
    });
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
  results.push(result);
}

const manifest = { schemaVersion: "source-capture-manifest-v1", sourceId: source.id, generatedAt: new Date().toISOString(), userAgent, records: results };
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Captured ${results.filter((item) => item.status === "retrieved").length}/${results.length} SEC records.`);
console.log(`Wrote ${manifestPath}`);
if (results.some((item) => item.status === "blocked_or_failed")) process.exitCode = 2;
