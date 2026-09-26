import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const packetPath = resolve(root, process.env.PACKET_PATH ?? "data/processed/ai-work-control.packet.json");
const outputPath = resolve(root, process.env.ATLAS_OUTPUT_PATH ?? "data/processed/ai-work-control.atlas.json");
const packet = JSON.parse(await readFile(packetPath, "utf8"));
const slug = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const entityMaps = Object.fromEntries(["themes", "mechanisms", "companies", "industries", "affectedGroups", "repositories"].map((kind) => [kind, new Map()]));
const edges = [];
const addEntity = (kind, label, record) => {
  if (!label) return null;
  const id = `${kind.slice(0, -1)}:${slug(label)}`;
  const map = entityMaps[kind];
  const entity = map.get(id) ?? { id, label, evidenceIds: [] };
  if (!entity.evidenceIds.includes(record.id)) entity.evidenceIds.push(record.id);
  map.set(id, entity);
  edges.push({ from: record.id, to: id, relation: kind === "mechanisms" ? "explains" : kind === "affectedGroups" ? "affects" : `classified_as_${kind.slice(0, -1)}` });
  return id;
};
for (const record of packet.records ?? []) {
  addEntity("themes", record.theme, record);
  addEntity("mechanisms", record.mechanism, record);
  addEntity("companies", record.company, record);
  addEntity("industries", record.industry, record);
  for (const group of record.affectedGroups ?? []) addEntity("affectedGroups", group, record);
  addEntity("repositories", record.sourceRepository, record);
}
const entities = Object.fromEntries(Object.entries(entityMaps).map(([kind, map]) => [kind, [...map.values()].sort((a, b) => a.label.localeCompare(b.label))]));
const atlas = {
  schemaVersion: "domain-atlas-v1",
  generatedAt: new Date().toISOString(),
  domain: packet.domain ?? null,
  sourceSnapshotDate: packet.sourceSnapshotDate ?? null,
  sourceRecordCount: (packet.records ?? []).length,
  entities,
  edges,
  limitation: "The atlas normalizes labels and source links; a relationship is a research connection, not proof of causation."
};
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(atlas, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, records: atlas.sourceRecordCount, entities: Object.fromEntries(Object.entries(entities).map(([kind, values]) => [kind, values.length])), edges: edges.length }, null, 2));
