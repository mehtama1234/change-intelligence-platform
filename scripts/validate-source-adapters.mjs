import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const registry = JSON.parse(await readFile(resolve(root, "data/source-registry.json"), "utf8"));
const map = JSON.parse(await readFile(resolve(root, "data/source-maps/ai-work-control.sources.json"), "utf8"));
const errors = [];
const repositories = registry.repositories ?? [];
const repositoryIds = new Set(repositories.map((repository) => repository.id));
const recordsByRepository = new Map(repositories.map((repository) => [repository.id, []]));
const recordIds = new Set();
const required = ["id", "sourceRole", "sourceRepository", "sourcePath", "title", "observation", "mechanism", "affectedGroups", "claimState", "asOf", "limits"];

if (registry.schemaVersion !== "source-registry-v1") errors.push("source registry has the wrong schema version");
if (repositories.length !== 6) errors.push(`expected six registered repositories, found ${repositories.length}`);
for (const repository of repositories) {
  if (!repository.id || repository.adapter !== "repository-files" || !repository.refresh || !repository.purpose) errors.push(`${repository.id ?? "unknown"}: incomplete adapter registration`);
}
for (const source of map.sources ?? []) {
  for (const field of required) if (source[field] === undefined || source[field] === "") errors.push(`${source.id ?? "unknown"}: missing adapter field ${field}`);
  if (recordIds.has(source.id)) errors.push(`duplicate adapter record: ${source.id}`);
  recordIds.add(source.id);
  if (!repositoryIds.has(source.sourceRepository)) errors.push(`${source.id}: repository is not registered`);
  if (repositoryIds.has(source.sourceRepository)) recordsByRepository.get(source.sourceRepository).push(source);
  if (!Array.isArray(source.affectedGroups) || source.affectedGroups.length === 0) errors.push(`${source.id}: affectedGroups must not be empty`);
  if (!Array.isArray(source.limits) || source.limits.length === 0) errors.push(`${source.id}: limits must not be empty`);
}
for (const [repository, sources] of recordsByRepository) if (!sources.length) errors.push(`${repository}: adapter has no source records`);

const requireFiles = process.env.REQUIRE_SOURCE_FILES === "1";
const sourceRoot = process.env.RESEARCH_ROOT ?? registry.researchRoot;
const captures = [];
for (const source of map.sources ?? []) {
  const path = resolve(sourceRoot, source.sourceRepository, source.sourcePath);
  if (!existsSync(path)) {
    if (requireFiles) errors.push(`${source.id}: source file is unavailable at ${path}`);
    captures.push({ id: source.id, status: "unavailable" });
    continue;
  }
  const raw = await readFile(path);
  captures.push({ id: source.id, status: "readable", bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") });
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const readable = captures.filter((capture) => capture.status === "readable").length;
console.log(`Validated source adapter contract: ${repositories.length} repositories, ${map.sources.length} records, ${readable} readable source files${requireFiles ? " (required)" : " (configuration mode)"}.`);
