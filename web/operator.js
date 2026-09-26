const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
byId("load-overview").addEventListener("click", async () => {
  const status = byId("operator-status");
  const token = byId("operator-token").value.trim();
  status.textContent = "Loading…";
  const response = await fetch("../api/operator/pilot-overview", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) { status.textContent = response.status === 403 ? "Operator access denied." : `Could not load overview (${response.status}).`; return; }
  const overview = await response.json();
  status.textContent = "Loaded.";
  byId("operator-summary").textContent = `${overview.scope.workspaceCount} workspaces · ${overview.scope.deliveries} deliveries · ${overview.scope.reviewedDeliveries} reviewed.`;
  const cards = [["Configured pilots", overview.scope.configuredPilots], ["Useful deliveries", overview.aggregate.usefulDeliveries], ["Decision changes", overview.aggregate.decisionChanges], ["Open alerts", overview.aggregate.openAlerts], ["False alerts", overview.aggregate.falseAlerts], ["Failed refreshes", overview.operations.failedRefreshRuns], ["Stale sources", overview.operations.staleSources], ["Delayed deliveries", overview.operations.delayedDeliveries]];
  byId("operator-cards").innerHTML = cards.map(([label, value]) => `<div class="operation-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  byId("operator-workspaces").innerHTML = `<table><caption>Workspace pilot status · no private notes</caption><thead><tr><th>Workspace</th><th>Configured</th><th>Deliveries</th><th>Reviewed</th><th>Useful</th><th>Decision changes</th><th>Delivery timing</th><th>Latest checkpoint</th></tr></thead><tbody>${overview.workspaces.map((workspace) => `<tr><th scope="row">${escapeHtml(workspace.name)}</th><td>${workspace.pilotConfigured ? "yes" : "no"}</td><td>${escapeHtml(workspace.deliveries)}</td><td>${escapeHtml(workspace.reviewedDeliveries)}</td><td>${escapeHtml(workspace.usefulDeliveries)}</td><td>${escapeHtml(workspace.decisionChanges)}</td><td>${workspace.deliveryDelayed ? "delayed" : "on schedule / no data"}</td><td>${escapeHtml(workspace.latestDecision || "none")}</td></tr>`).join("")}</tbody></table>`;
  byId("operator-history").innerHTML = overview.trend.length ? `<table><caption>Refresh history · aggregate operating trend</caption><thead><tr><th>Run</th><th>Status</th><th>Failed steps</th><th>Changed sources</th><th>Missing sources</th><th>Deliveries</th><th>Reviewed</th></tr></thead><tbody>${overview.trend.slice().reverse().map((run) => `<tr><th scope="row"><code>${escapeHtml(run.runId)}</code></th><td>${escapeHtml(run.status)}</td><td>${escapeHtml(run.failedSteps.join(", ") || "none")}</td><td>${escapeHtml(run.staleSources ?? "not recorded")}</td><td>${escapeHtml(run.missingSources ?? "not recorded")}</td><td>${escapeHtml(run.deliveriesPrepared)}</td><td>${escapeHtml(run.deliveriesReviewed)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No refresh history is available yet.</p>`;
  byId("operator-limitation").textContent = overview.limitation;
});
