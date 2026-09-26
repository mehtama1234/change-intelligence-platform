import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const kit = await readFile(resolve(root, "DESIGN-PARTNER-PILOT-KIT.md"), "utf8");
const required = [
  ["# Design-partner pilot kit", "title"],
  ["## Choose the right partner", "partner selection"],
  ["## Before the first delivery", "preflight agreement"],
  ["## The cycle for every delivery", "delivery cycle"],
  ["## Measures and their exact meaning", "measure definitions"],
  ["## Researcher and operator responsibilities", "responsibilities"],
  ["## Checkpoint after three reviewed deliveries", "human checkpoint"],
  ["## Evidence to retain", "evidence retention"],
  ["## Pilot completion gate", "completion gate"],
  ["Source-trace inspections", "source-trace measure"],
  ["Briefing reuse", "briefing-reuse measure"],
  ["False alerts", "false-alert measure"],
  ["Delivery review time", "delivery-review measure"],
  ["improve/continue/expand/stop", "human decision boundary"],
  ["private source details", "privacy boundary"]
];
const missing = required.filter(([text]) => !kit.includes(text)).map(([, label]) => label);
if (missing.length) throw new Error(`Design-partner pilot kit is missing: ${missing.join(", ")}.`);
console.log("Design-partner pilot kit contract passed: selection, delivery, measures, checkpoint, retention, privacy, and completion gate are documented.");
