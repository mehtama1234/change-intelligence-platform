import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const html = await readFile(resolve(root, "web/index.html"), "utf8");
const app = await readFile(resolve(root, "web/app.js"), "utf8");
const operatorHtml = await readFile(resolve(root, "web/operator.html"), "utf8");
const operatorApp = await readFile(resolve(root, "web/operator.js"), "utf8");
const styles = await readFile(resolve(root, "web/styles.css"), "utf8");
const required = [
  [html, 'id="workspace-select"', "workspace selector"],
  [html, 'id="token-input"', "token connection"],
  [html, 'id="insight-summary"', "current reading"],
  [html, 'id="evidence-inspector"', "evidence inspector"],
  [html, 'id="change-feed-items"', "change feed"],
  [html, 'id="operations-panel"', "operations panel"],
  [html, 'id="pilot-scorecard"', "pilot scorecard"],
  [html, 'id="workspace-update"', "workspace update"],
  [html, 'id="workspace-delivery-health"', "workspace delivery health"],
  [html, 'id="workspace-service-report"', "workspace service report"],
  [html, 'id="workspace-commercial-readiness"', "workspace commercial readiness"],
  [html, 'id="pilot-profile"', "pilot profile"],
  [html, 'id="pilot-delivery"', "pilot delivery"],
  [html, 'id="pilot-report"', "pilot learning report"],
  [html, 'id="pilot-history"', "pilot history"],
  [html, 'id="coverage-panel"', "evidence coverage panel"],
  [html, 'id="atlas-panel"', "domain atlas panel"],
  [html, 'id="review-queue"', "source review queue"],
  [html, 'id="evidence-history-items"', "research timeline"],
  [html, 'id="question-form"', "saved questions"],
  [html, 'id="decision-feedback"', "decision feedback register"],
  [app, "decision-outcome-form", "decision feedback form"],
  [app, "/outcome", "decision outcome API"],
  [app, "resolve-alert", "alert disposition controls"],
  [html, 'id="report-history"', "annual quarterly report view"],
  [html, 'id="next-test"', "next-test view"],
  [html, 'aria-live="polite"', "live update announcement"],
  [app, "../api/packet", "packet read model"],
  [app, "../api/changes?includeUnchanged=true", "change feed API"],
  [app, "../api/coverage", "evidence coverage API"],
  [app, "../api/atlas", "domain atlas API"],
  [app, "../api/pilot-metrics?workspace=", "pilot metrics API"],
  [app, "../api/workspace-update?workspace=", "workspace update API"],
  [app, "../api/workspace-delivery-health?workspace=", "workspace delivery health API"],
  [app, "../api/workspace-service-report?workspace=", "workspace service report API"],
  [app, "../api/workspace-commercial-readiness?workspace=", "workspace commercial readiness API"],
  [app, "../api/workspace-pilot?workspace=", "pilot profile API"],
  [app, "../api/workspace-pilot", "pilot profile command"],
  [app, "../api/pilot-deliveries?workspace=", "pilot delivery API"],
  [app, "../api/pilot-report?workspace=", "pilot report API"],
  [app, "../api/pilot-report/decision", "pilot decision command"],
  [app, "/review", "pilot delivery review command"],
  [app, "../api/timeline?workspace=", "workspace timeline API"],
  [app, "../api/evidence/", "evidence inspection API"],
  [app, "../api/insights/", "insight inspection API"],
  [app, "../api/questions", "question workflow API"],
  [app, "../api/briefings/", "briefing export/publication API"],
  [app, "review-source", "source review action marker"],
  [app, "stale", "stale publication handling"],
  [styles, "@media (max-width: 700px)", "responsive layout"],
  [styles, ":focus", "keyboard focus styling"]
  , [operatorHtml, 'id="operator-workspaces"', "operator workspace table"]
  , [operatorHtml, 'id="operator-history"', "operator refresh history"]
  , [operatorHtml, 'id="operator-warnings"', "operator warning list"]
  , [operatorHtml, 'id="operator-notifications"', "operator notification outbox"]
  , [operatorHtml, 'id="operator-delivery-health"', "operator delivery health"]
  , [operatorHtml, 'id="operator-portfolio-readiness"', "operator portfolio readiness"]
  , [operatorHtml, 'id="operator-routing-json"', "operator routing settings"]
  , [operatorApp, "/api/operator/pilot-overview", "operator overview API"]
  , [operatorApp, "/api/operator/warnings/", "operator warning action API"]
  , [operatorApp, "/api/operator/notifications", "operator notification API"]
  , [operatorApp, "/api/operator/notification-routes", "operator routing API"]
  , [operatorApp, "deliveryHealth", "operator delivery health read model"]
  , [operatorApp, "portfolioReadiness", "operator portfolio readiness read model"]
];
const missing = required.filter(([text, value]) => !text.includes(value)).map(([, , label]) => label);
if (missing.length) throw new Error(`Frontend contract failed: ${missing.join(", ")}`);
console.log("Frontend contract passed: reader surfaces, source trace, workspace flow, stale handling, live updates, responsive layout, and focus styling are present.");
