import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const html = await readFile(resolve(root, "web/index.html"), "utf8");
const app = await readFile(resolve(root, "web/app.js"), "utf8");
const styles = await readFile(resolve(root, "web/styles.css"), "utf8");
const required = [
  [html, 'id="workspace-select"', "workspace selector"],
  [html, 'id="token-input"', "token connection"],
  [html, 'id="insight-summary"', "current reading"],
  [html, 'id="evidence-inspector"', "evidence inspector"],
  [html, 'id="change-feed-items"', "change feed"],
  [html, 'id="operations-panel"', "operations panel"],
  [html, 'id="coverage-panel"', "evidence coverage panel"],
  [html, 'id="review-queue"', "source review queue"],
  [html, 'id="evidence-history-items"', "research timeline"],
  [html, 'id="question-form"', "saved questions"],
  [app, "decision-outcome-form", "decision feedback form"],
  [app, "/outcome", "decision outcome API"],
  [html, 'id="report-history"', "annual quarterly report view"],
  [html, 'id="next-test"', "next-test view"],
  [html, 'aria-live="polite"', "live update announcement"],
  [app, "../api/packet", "packet read model"],
  [app, "../api/changes?includeUnchanged=true", "change feed API"],
  [app, "../api/coverage", "evidence coverage API"],
  [app, "../api/timeline?workspace=", "workspace timeline API"],
  [app, "../api/evidence/", "evidence inspection API"],
  [app, "../api/insights/", "insight inspection API"],
  [app, "../api/questions", "question workflow API"],
  [app, "../api/briefings/", "briefing export/publication API"],
  [app, "review-source", "source review action marker"],
  [app, "stale", "stale publication handling"],
  [styles, "@media (max-width: 700px)", "responsive layout"],
  [styles, ":focus", "keyboard focus styling"]
];
const missing = required.filter(([text, value]) => !text.includes(value)).map(([, , label]) => label);
if (missing.length) throw new Error(`Frontend contract failed: ${missing.join(", ")}`);
console.log("Frontend contract passed: reader surfaces, source trace, workspace flow, stale handling, live updates, responsive layout, and focus styling are present.");
