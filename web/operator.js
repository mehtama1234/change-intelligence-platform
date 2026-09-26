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
  byId("operator-warnings").innerHTML = overview.warnings.length ? overview.warnings.map((warning) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(warning.severity)}</span><span>threshold crossed</span><span>${escapeHtml(warning.lifecycle)}</span><span>${escapeHtml(warning.escalationState)}</span></div><h3>${escapeHtml(warning.message)}</h3><p>Observed: <code>${escapeHtml(JSON.stringify(warning.observed))}</code> · limit: <code>${escapeHtml(JSON.stringify(warning.threshold))}</code></p><p class="muted">Owner: ${escapeHtml(warning.ownerId || "unassigned")} · response: ${warning.responseTimeMs === null ? "not recorded" : `${Math.round(warning.responseTimeMs / 60000)} min`} · acknowledgment due: ${escapeHtml(warning.ackDeadlineAt || "not recorded")}</p><button class="operator-warning-action" data-warning-id="${escapeHtml(warning.id)}" data-warning-state="acknowledged" data-warning-observed-at="${escapeHtml(warning.observedAt || "")}" type="button">Acknowledge</button> <button class="operator-warning-action" data-warning-id="${escapeHtml(warning.id)}" data-warning-state="acknowledged" data-warning-escalation="escalated" data-warning-observed-at="${escapeHtml(warning.observedAt || "")}" type="button">Escalate</button> <button class="operator-warning-action" data-warning-id="${escapeHtml(warning.id)}" data-warning-state="resolved" data-warning-observed-at="${escapeHtml(warning.observedAt || "")}" type="button">Resolve</button>${warning.actionNote ? `<p class="muted">Last note: ${escapeHtml(warning.actionNote)}</p>` : ""}</article>`).join("") : `<p class="muted">No configured operator threshold is currently crossed.</p>`;
  const notificationResponse = await fetch("../api/operator/notifications", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const notificationBody = notificationResponse.ok ? await notificationResponse.json() : { notifications: [] };
  byId("operator-notifications").innerHTML = notificationBody.notifications?.length ? `<h2>Notification outbox</h2>${notificationBody.notifications.slice().reverse().map((notification) => `<article class="record-card"><div class="record-meta"><span>${escapeHtml(notification.status)}</span><span>${escapeHtml(notification.recipient)}</span></div><h3>${escapeHtml(notification.subject)}</h3><p class="muted">Created ${escapeHtml(notification.createdAt)} · warning ${escapeHtml(notification.warningId)}</p>${notification.status === "pending" ? `<button class="operator-notification-action" data-notification-id="${escapeHtml(notification.id)}" type="button">Mark dispatched</button>` : `<p class="muted">Dispatched ${escapeHtml(notification.dispatchedAt || "")}</p>`}</article>`).join("")}` : `<p class="muted">Notification outbox is empty.</p>`;
  const routeResponse = await fetch("../api/operator/notification-routes", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (routeResponse.ok) byId("operator-routing-json").value = JSON.stringify((await routeResponse.json()).settings, null, 2);
  document.querySelectorAll(".operator-warning-action").forEach((button) => button.addEventListener("click", async () => {
    const note = window.prompt("What action was taken?");
    if (!note?.trim()) return;
    const token = byId("operator-token").value.trim();
    const ownerId = window.prompt("Assign to operator ID (optional):", "") || "";
    const result = await fetch(`../api/operator/warnings/${encodeURIComponent(button.dataset.warningId)}/state`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID?.() || `operator-warning-${Date.now()}`, "content-type": "application/json" }, body: JSON.stringify({ state: button.dataset.warningState, escalationState: button.dataset.warningEscalation || "normal", ownerId, observedAt: button.dataset.warningObservedAt || null, note }) });
    if (result.ok) byId("load-overview").click();
  }));
  document.querySelectorAll(".operator-notification-action").forEach((button) => button.addEventListener("click", async () => {
    const note = window.prompt("What confirms dispatch?");
    if (!note?.trim()) return;
    const result = await fetch(`../api/operator/notifications/${encodeURIComponent(button.dataset.notificationId)}/dispatch`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID?.() || `operator-notification-${Date.now()}`, "content-type": "application/json" }, body: JSON.stringify({ note }) });
    if (result.ok) byId("load-overview").click();
  }));
  byId("save-operator-routing").onclick = async () => {
    const status = byId("operator-routing-status");
    try {
      const settings = JSON.parse(byId("operator-routing-json").value);
      const result = await fetch("../api/operator/notification-routes", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID?.() || `operator-route-${Date.now()}`, "content-type": "application/json" }, body: JSON.stringify(settings) });
      status.textContent = result.ok ? "Routing saved." : `Could not save routing (${result.status}).`;
    } catch { status.textContent = "Routing must be valid JSON."; }
  };
  byId("operator-workspaces").innerHTML = `<table><caption>Workspace pilot status · no private notes</caption><thead><tr><th>Workspace</th><th>Configured</th><th>Deliveries</th><th>Reviewed</th><th>Useful</th><th>Decision changes</th><th>Delivery timing</th><th>Latest checkpoint</th></tr></thead><tbody>${overview.workspaces.map((workspace) => `<tr><th scope="row">${escapeHtml(workspace.name)}</th><td>${workspace.pilotConfigured ? "yes" : "no"}</td><td>${escapeHtml(workspace.deliveries)}</td><td>${escapeHtml(workspace.reviewedDeliveries)}</td><td>${escapeHtml(workspace.usefulDeliveries)}</td><td>${escapeHtml(workspace.decisionChanges)}</td><td>${workspace.deliveryDelayed ? "delayed" : "on schedule / no data"}</td><td>${escapeHtml(workspace.latestDecision || "none")}</td></tr>`).join("")}</tbody></table>`;
  byId("operator-history").innerHTML = overview.trend.length ? `<table><caption>Refresh history · aggregate operating trend</caption><thead><tr><th>Run</th><th>Status</th><th>Failed steps</th><th>Changed sources</th><th>Missing sources</th><th>Oldest source age</th><th>Alerts useful / false / correction</th><th>Deliveries</th><th>Reviewed</th></tr></thead><tbody>${overview.trend.slice().reverse().map((run) => `<tr><th scope="row"><code>${escapeHtml(run.runId)}</code></th><td>${escapeHtml(run.status)}</td><td>${escapeHtml(run.failedSteps.join(", ") || "none")}</td><td>${escapeHtml(run.changedSources ?? "not recorded")}</td><td>${escapeHtml(run.missingSources ?? "not recorded")}</td><td>${run.oldestSourceAgeMs === null ? "not recorded" : `${Math.round(run.oldestSourceAgeMs / 86400000)} days`}</td><td>${escapeHtml(run.usefulAlerts)} / ${escapeHtml(run.falseAlerts)} / ${escapeHtml(run.correctionAlerts)}</td><td>${escapeHtml(run.deliveriesPrepared)}</td><td>${escapeHtml(run.deliveriesReviewed)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No refresh history is available yet.</p>`;
  byId("operator-limitation").textContent = overview.limitation;
});
