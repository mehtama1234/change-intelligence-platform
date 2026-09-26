const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
byId("export-cohort").addEventListener("click", async () => {
  const status = byId("operator-status");
  const token = byId("operator-token").value.trim();
  status.textContent = "Preparing cohort report…";
  const response = await fetch("../api/operator/pilot-cohort", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) { status.textContent = response.status === 403 ? "Operator access denied." : `Could not export cohort report (${response.status}).`; return; }
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "pilot-cohort-report.json";
  link.click();
  URL.revokeObjectURL(link.href);
  status.textContent = "Cohort report downloaded.";
});
byId("load-overview").addEventListener("click", async () => {
  const status = byId("operator-status");
  const token = byId("operator-token").value.trim();
  status.textContent = "Loading…";
  const response = await fetch("../api/operator/pilot-overview", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) { status.textContent = response.status === 403 ? "Operator access denied." : `Could not load overview (${response.status}).`; return; }
  const overview = await response.json();
  status.textContent = "Loaded.";
  byId("operator-summary").textContent = `${overview.scope.workspaceCount} workspaces · ${overview.scope.deliveries} deliveries · ${overview.scope.reviewedDeliveries} reviewed.`;
  const pipelineResponse = await fetch("../api/operator/partner-pipeline", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const pipeline = pipelineResponse.ok ? await pipelineResponse.json() : { leads: [], counts: {} };
  const pipelineStatuses = pipeline.statuses || ["identified", "qualified", "contacted", "invited", "onboarding", "pilot", "expanded", "paused", "declined"];
  byId("operator-partner-pipeline").innerHTML = `<h2>Prospective partners</h2><p class="muted">${pipelineStatuses.map((pipelineStatus) => `${escapeHtml(pipelineStatus)}: ${escapeHtml(pipeline.counts?.[pipelineStatus] || 0)}`).join(" · ")}</p>${pipeline.leads?.length ? `<table><caption>Operator-only commercial follow-up</caption><thead><tr><th>Organization</th><th>Lead ID</th><th>Status</th><th>Decision question</th><th>Next action</th><th>Workspace</th><th>Pilot signal</th><th>Updated</th><th>Change</th></tr></thead><tbody>${pipeline.leads.map((lead) => { const workspace = lead.workspaceSummary; const signal = workspace ? `${workspace.pilotConfigured ? "configured" : "not configured"} · ${workspace.reviewedDeliveries}/${workspace.deliveries} reviewed · ${workspace.decisionImpact} decision impact · ${workspace.commercialOfferStatus}` : "not linked"; return `<tr><th scope="row">${escapeHtml(lead.organizationName)}${lead.contactIdentity ? `<br><span class="muted">${escapeHtml(lead.contactIdentity)}</span>` : ""}</th><td><code>${escapeHtml(lead.id)}</code></td><td>${escapeHtml(lead.status)}</td><td>${escapeHtml(lead.decisionQuestion)}</td><td>${escapeHtml(lead.nextAction)}${lead.nextActionAt ? `<br><span class="muted">${escapeHtml(lead.nextActionAt)}</span>` : ""}</td><td>${escapeHtml(lead.workspaceId || "not provisioned")}</td><td>${escapeHtml(signal)}</td><td>${escapeHtml(lead.updatedAt)}</td><td><button class="partner-lead-action" data-lead-id="${escapeHtml(lead.id)}" data-lead-status="${escapeHtml(lead.status)}" type="button">Advance or pause</button></td></tr>`; }).join("")}</tbody></table>` : `<p class="muted">No prospective partners are recorded yet.</p>`}${pipeline.limitation ? `<p class="muted">${escapeHtml(pipeline.limitation)}</p>` : ""}`;
  const offerCounts = overview.aggregate.commercialOfferCounts || {};
  const cards = [["Configured pilots", overview.scope.configuredPilots], ["Useful deliveries", overview.aggregate.usefulDeliveries], ["Decision changes", overview.aggregate.decisionChanges], ["Offers proposed", offerCounts.proposed || 0], ["Offers accepted", offerCounts.accepted || 0], ["Offers active", offerCounts.active || 0], ["Open alerts", overview.aggregate.openAlerts], ["False alerts", overview.aggregate.falseAlerts], ["Open support", overview.aggregate.openSupportRequests], ["Urgent support", overview.aggregate.urgentSupportRequests], ["Overdue support", overview.aggregate.overdueSupportRequests], ["Failed refreshes", overview.operations.failedRefreshRuns], ["Refresh worker", overview.operations.refreshSchedulerStatus], ["Notification worker", overview.operations.notificationSchedulerStatus], ["Backup worker", overview.operations.backupSchedulerStatus], ["Stale sources", overview.operations.staleSources], ["Delayed deliveries", overview.operations.delayedDeliveries]];
  byId("operator-cards").innerHTML = cards.map(([label, value]) => `<div class="operation-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  byId("operator-warnings").innerHTML = overview.warnings.length ? overview.warnings.map((warning) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(warning.severity)}</span><span>threshold crossed</span><span>${escapeHtml(warning.lifecycle)}</span><span>${escapeHtml(warning.escalationState)}</span></div><h3>${escapeHtml(warning.message)}</h3><p>Observed: <code>${escapeHtml(JSON.stringify(warning.observed))}</code> · limit: <code>${escapeHtml(JSON.stringify(warning.threshold))}</code></p><p class="muted">Owner: ${escapeHtml(warning.ownerId || "unassigned")} · response: ${warning.responseTimeMs === null ? "not recorded" : `${Math.round(warning.responseTimeMs / 60000)} min`} · acknowledgment due: ${escapeHtml(warning.ackDeadlineAt || "not recorded")}</p><button class="operator-warning-action" data-warning-id="${escapeHtml(warning.id)}" data-warning-state="acknowledged" data-warning-observed-at="${escapeHtml(warning.observedAt || "")}" type="button">Acknowledge</button> <button class="operator-warning-action" data-warning-id="${escapeHtml(warning.id)}" data-warning-state="acknowledged" data-warning-escalation="escalated" data-warning-observed-at="${escapeHtml(warning.observedAt || "")}" type="button">Escalate</button> <button class="operator-warning-action" data-warning-id="${escapeHtml(warning.id)}" data-warning-state="resolved" data-warning-observed-at="${escapeHtml(warning.observedAt || "")}" type="button">Resolve</button>${warning.actionNote ? `<p class="muted">Last note: ${escapeHtml(warning.actionNote)}</p>` : ""}</article>`).join("") : `<p class="muted">No configured operator threshold is currently crossed.</p>`;
  const notificationResponse = await fetch("../api/operator/notifications", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const notificationBody = notificationResponse.ok ? await notificationResponse.json() : { notifications: [] };
  byId("operator-notifications").innerHTML = notificationBody.notifications?.length ? `<h2>Notification outbox</h2>${notificationBody.notifications.slice().reverse().map((notification) => `<article class="record-card"><div class="record-meta"><span>${escapeHtml(notification.status)}</span><span>${escapeHtml(notification.recipient)}</span><span>${escapeHtml(notification.destinationId || "default destination")}</span></div><h3>${escapeHtml(notification.subject)}</h3><p class="muted">Created ${escapeHtml(notification.createdAt)} · warning ${escapeHtml(notification.warningId)} · attempts ${escapeHtml(notification.attemptHistory?.length ?? 0)}</p>${notification.attemptHistory?.length ? `<details><summary>Attempt history</summary><ul>${notification.attemptHistory.map((attempt) => `<li>${escapeHtml(attempt.status)} · ${escapeHtml(attempt.attemptedAt)}${attempt.error ? ` · ${escapeHtml(attempt.error)}` : ""}</li>`).join("")}</ul></details>` : ""}${notification.status === "pending" ? `<button class="operator-notification-action" data-notification-id="${escapeHtml(notification.id)}" type="button">Mark dispatched</button>` : `<p class="muted">Dispatched ${escapeHtml(notification.dispatchedAt || notification.deliveredAt || "")}</p>`}</article>`).join("")}` : `<p class="muted">Notification outbox is empty.</p>`;
  const invitationResponse = await fetch("../api/operator/workspace-invitations", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const invitationBody = invitationResponse.ok ? await invitationResponse.json() : { invitations: [] };
  byId("operator-invitations").innerHTML = `<h2>Workspace invitation outbox</h2>${invitationBody.invitations?.length ? `<table><caption>Provider-neutral identity invitations</caption><thead><tr><th>Workspace</th><th>Identity</th><th>Role</th><th>Status</th><th>Created</th></tr></thead><tbody>${invitationBody.invitations.slice().reverse().map((invitation) => `<tr><th scope="row"><code>${escapeHtml(invitation.workspaceId)}</code></th><td>${escapeHtml(invitation.identityId)}</td><td>${escapeHtml(invitation.role)}</td><td>${escapeHtml(invitation.status)}</td><td>${escapeHtml(invitation.createdAt)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No workspace invitations are waiting for an identity-provider adapter.</p>`}`;
  const supportResponse = await fetch("../api/operator/support-requests", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const supportBody = supportResponse.ok ? await supportResponse.json() : { requests: [] };
  byId("operator-support-requests").innerHTML = `<h2>Customer support queue</h2>${supportBody.requests?.length ? supportBody.requests.map((supportRequest) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(supportRequest.status.replaceAll("_", " "))}</span><span>${escapeHtml(supportRequest.severity)}</span><span>${escapeHtml(supportRequest.category)}</span><span>${escapeHtml(supportRequest.updatedAt)}</span></div><h3>${escapeHtml(supportRequest.summary)}</h3><p>${escapeHtml(supportRequest.details)}</p><p class="muted">Workspace ${escapeHtml(supportRequest.workspaceId)} · opened by ${escapeHtml(supportRequest.createdBy)}</p>${supportRequest.operatorNote ? `<p>Last service note: ${escapeHtml(supportRequest.operatorNote)}</p>` : ""}<div class="review-actions">${["acknowledged", "in_progress", "resolved", "closed"].map((status) => `<button class="operator-support-action" data-request-id="${escapeHtml(supportRequest.id)}" data-support-state="${status}" type="button">${status.replaceAll("_", " ")}</button>`).join(" ")}</div></article>`).join("") : `<h2>Customer support queue</h2><p class="muted">No customer support requests are waiting.</p>`}`;
  const failureResponse = await fetch("../api/operator/workspace-refresh-failures", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const failureBody = failureResponse.ok ? await failureResponse.json() : { outcomes: [] };
  byId("operator-refresh-failures").innerHTML = `<h2>Workspace refresh failures</h2>${failureBody.outcomes?.length ? failureBody.outcomes.map((failure) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(failure.status)}</span><span>${escapeHtml(failure.reason)}</span><span>${escapeHtml(failure.observedAt)}</span></div><h3>${escapeHtml(failure.workspaceId)}</h3><p>Run ${escapeHtml(failure.runId)} · failed steps: ${escapeHtml(failure.failedSteps?.join(", ") || "delivery creation")}</p>${failure.status !== "resolved" ? `<button class="workspace-refresh-retry" data-failure-id="${escapeHtml(failure.id)}" type="button">Request retry on next refresh</button>` : `<p class="muted">Resolved by run ${escapeHtml(failure.resolvedRunId || "not recorded")}</p>`}</article>`).join("") : `<p class="muted">No workspace-specific refresh failures are recorded.</p>`}`;
  const health = overview.deliveryHealth;
  byId("operator-delivery-health").innerHTML = health ? `<table><caption>Delivery health</caption><thead><tr><th>Scope</th><th>Notifications</th><th>Attempts</th><th>Delivered</th><th>Dead letters</th><th>Pending</th><th>Success rate</th></tr></thead><tbody>${health.byRecipient.map((row) => `<tr><th scope="row">${escapeHtml(row.recipient)}</th><td>${escapeHtml(row.notifications)}</td><td>${escapeHtml(row.attempts)}</td><td>${escapeHtml(row.delivered)}</td><td>${escapeHtml(row.deadLetters)}</td><td>${escapeHtml(row.pending)}</td><td>${row.successRate === null ? "not measured" : `${Math.round(row.successRate * 100)}%`}</td></tr>`).join("")}</tbody></table><p class="muted">Total: ${escapeHtml(health.summary.notifications)} notifications · ${escapeHtml(health.summary.attempts)} attempts · ${escapeHtml(health.summary.retries)} retries · ${escapeHtml(health.summary.deadLetters)} dead letters · average latency ${health.summary.averageLatencyMs === null ? "not measured" : `${Math.round(health.summary.averageLatencyMs / 1000)} sec`}.</p>` : "";
  const readiness = overview.portfolioReadiness;
  byId("operator-portfolio-readiness").innerHTML = readiness ? `<table><caption>Commercial readiness across workspaces · aggregate signals</caption><thead><tr><th>Workspace</th><th>Recommendation</th><th>Offer</th><th>Service</th><th>Reviewed</th><th>Useful rate</th><th>Decision impact</th><th>Failed measures</th><th>Observed</th></tr></thead><tbody>${readiness.workspaces.map((workspace) => { const offer = overview.workspaces.find((candidate) => candidate.id === workspace.id)?.commercialOfferStatus || "not proposed"; return `<tr><th scope="row">${escapeHtml(workspace.name)}</th><td>${escapeHtml(workspace.recommendation)}</td><td>${escapeHtml(offer)}</td><td>${escapeHtml(workspace.serviceStatus)}</td><td>${escapeHtml(workspace.reviewedDeliveries)}</td><td>${workspace.usefulnessRate === null ? "not measured" : `${Math.round(workspace.usefulnessRate * 100)}%`}</td><td>${escapeHtml(workspace.decisionImpact)}</td><td>${escapeHtml(workspace.failedMeasures)}</td><td>${escapeHtml(workspace.observedAt || "not available")}</td></tr>`; }).join("")}</tbody></table><p class="muted">Offers: ${offerCounts.proposed || 0} proposed · ${offerCounts.accepted || 0} accepted · ${offerCounts.active || 0} active · ${offerCounts.declined || 0} declined · ${offerCounts.ended || 0} ended. Readiness is a human checkpoint, not an automated commercial decision.</p>` : "";
  byId("create-partner-lead").onclick = async () => {
    const partnerStatus = byId("operator-partner-status");
    const organizationName = byId("operator-partner-organization").value.trim();
    const decisionQuestion = byId("operator-partner-question").value.trim();
    const nextAction = byId("operator-partner-next-action").value.trim();
    if (!organizationName || decisionQuestion.length < 20 || nextAction.length < 8) { partnerStatus.textContent = "Organization, a real decision question, and a concrete next action are required."; return; }
    const result = await fetch("../api/operator/partner-pipeline", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID?.() || `partner-lead-${Date.now()}`, "content-type": "application/json" }, body: JSON.stringify({ organizationName, domain: byId("operator-partner-domain").value.trim(), contactIdentity: byId("operator-partner-contact").value.trim(), decisionQuestion, nextAction, nextActionAt: byId("operator-partner-next-action-at").value || null }) });
    const body = await result.json().catch(() => ({}));
    partnerStatus.textContent = result.ok ? "Prospective partner added." : (body.error || `Could not add partner (${result.status}).`);
    if (result.ok) { byId("operator-partner-organization").value = ""; byId("operator-partner-contact").value = ""; byId("operator-partner-question").value = ""; byId("operator-partner-next-action").value = ""; byId("operator-partner-next-action-at").value = ""; byId("load-overview").click(); }
  };
  document.querySelectorAll(".partner-lead-action").forEach((button) => button.addEventListener("click", async () => {
    const nextStatus = window.prompt(`Next status for ${button.dataset.leadStatus} (qualified/contacted/invited/onboarding/pilot/expanded/paused/declined):`, "");
    if (!nextStatus?.trim()) return;
    const note = window.prompt("What happened or what will happen next?");
    if (!note?.trim()) return;
    const result = await fetch(`../api/operator/partner-pipeline/${encodeURIComponent(button.dataset.leadId)}/state`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID?.() || `partner-state-${Date.now()}`, "content-type": "application/json" }, body: JSON.stringify({ status: nextStatus.trim(), note }) });
    if (result.ok) byId("load-overview").click(); else byId("operator-partner-status").textContent = (await result.json().catch(() => ({}))).error || `Could not update partner (${result.status}).`;
  }));
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
  document.querySelectorAll(".workspace-refresh-retry").forEach((button) => button.addEventListener("click", async () => {
    const result = await fetch(`../api/operator/workspace-refresh-failures/${encodeURIComponent(button.dataset.failureId)}/retry`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID?.() || `workspace-retry-${Date.now()}` } });
    if (result.ok) byId("load-overview").click();
  }));
  document.querySelectorAll(".operator-support-action").forEach((button) => button.addEventListener("click", async () => {
    const note = window.prompt("What was checked or changed?");
    if (!note?.trim()) return;
    const result = await fetch(`../api/operator/support-requests/${encodeURIComponent(button.dataset.requestId)}/state`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID?.() || `support-${Date.now()}`, "content-type": "application/json" }, body: JSON.stringify({ status: button.dataset.supportState, note }) });
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
  byId("provision-workspace").onclick = async () => {
    const status = byId("operator-provision-status");
    const name = byId("operator-workspace-name").value.trim();
    const ownerId = byId("operator-workspace-owner").value.trim();
    if (!name || !ownerId) { status.textContent = "Workspace name and owner identity ID are required."; return; }
    status.textContent = "Provisioning…";
    const result = await fetch("../api/operator/workspaces", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID?.() || `workspace-${Date.now()}`, "content-type": "application/json" }, body: JSON.stringify({ name, ownerId, partnerLeadId: byId("operator-workspace-partner-lead").value.trim() || null }) });
    const body = await result.json().catch(() => ({}));
    status.textContent = result.ok ? `Provisioned ${body.id}.` : (body.error || `Could not provision workspace (${result.status}).`);
    if (result.ok) { byId("operator-workspace-name").value = ""; byId("operator-workspace-owner").value = ""; byId("operator-workspace-partner-lead").value = ""; }
    if (result.ok) byId("load-overview").click();
  };
  const manageMember = async (activate) => {
    const status = byId("operator-member-status");
    const workspaceId = byId("operator-member-workspace").value.trim();
    const identityId = byId("operator-member-identity").value.trim();
    if (!workspaceId || !identityId) { status.textContent = "Workspace ID and member identity ID are required."; return; }
    const path = activate ? `../api/operator/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(identityId)}/activate` : `../api/operator/workspaces/${encodeURIComponent(workspaceId)}/members`;
    const body = activate ? {} : { identityId, role: byId("operator-member-role").value };
    const result = await fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": crypto.randomUUID?.() || `member-${Date.now()}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const responseBody = await result.json().catch(() => ({}));
    status.textContent = result.ok ? (activate ? "Member activated." : "Invitation recorded.") : (responseBody.error || `Could not update membership (${result.status}).`);
    if (result.ok) byId("load-overview").click();
  };
  byId("invite-workspace-member").onclick = () => manageMember(false);
  byId("activate-workspace-member").onclick = () => manageMember(true);
  byId("operator-workspaces").innerHTML = `<table><caption>Workspace pilot status · no private notes</caption><thead><tr><th>Workspace</th><th>Onboarding</th><th>Schedule</th><th>Missing setup</th><th>Configured</th><th>Deliveries</th><th>Reviewed</th><th>Useful</th><th>Decision changes</th><th>Open support</th><th>Urgent support</th><th>Overdue support</th><th>Trace opens</th><th>Briefing reuse</th><th>False alerts</th><th>Correction response</th><th>Time to answer</th><th>Missed changes</th><th>Delivery timing</th><th>Latest checkpoint</th><th>Packets</th></tr></thead><tbody>${overview.workspaces.map((workspace) => { const measures = workspace.pilotMeasures || {}; const correctionResponse = measures.medianCorrectionResponseMs === null || measures.medianCorrectionResponseMs === undefined ? "not recorded" : `${Math.round(measures.medianCorrectionResponseMs / 60000)} min`; const answerTime = measures.medianAnswerTimeMinutes === null || measures.medianAnswerTimeMinutes === undefined ? "not measured" : `${measures.medianAnswerTimeMinutes} min`; const reuse = measures.briefingReuseRate === null || measures.briefingReuseRate === undefined ? `${measures.briefingReuseCount ?? 0} · not measured` : `${measures.briefingReuseCount} · ${Math.round(measures.briefingReuseRate * 100)}%`; return `<tr><th scope="row">${escapeHtml(workspace.name)}</th><td>${escapeHtml(workspace.onboarding?.status || "not recorded")}</td><td>${escapeHtml(workspace.schedule?.status || "not recorded")}</td><td>${escapeHtml(workspace.onboarding?.missingSteps?.join(", ") || "none")}</td><td>${workspace.pilotConfigured ? "yes" : "no"}</td><td>${escapeHtml(workspace.deliveries)}</td><td>${escapeHtml(workspace.reviewedDeliveries)}</td><td>${escapeHtml(workspace.usefulDeliveries)}</td><td>${escapeHtml(workspace.decisionChanges)}</td><td>${escapeHtml(workspace.openSupportRequests ?? 0)}</td><td>${escapeHtml(workspace.urgentSupportRequests ?? 0)}</td><td>${escapeHtml(workspace.overdueSupportRequests ?? 0)}</td><td>${escapeHtml(measures.sourceTraceInspections ?? 0)}</td><td>${escapeHtml(reuse)}</td><td>${escapeHtml(measures.falseAlerts ?? 0)}</td><td>${escapeHtml(correctionResponse)}</td><td>${escapeHtml(answerTime)} (${escapeHtml(measures.answerTimeObservations ?? 0)})</td><td>${escapeHtml(measures.missedImportantChanges ?? 0)} / ${escapeHtml(measures.missedChangeObservations ?? 0)}</td><td>${workspace.deliveryDelayed ? "delayed" : "on schedule / no data"}</td><td>${escapeHtml(workspace.latestDecision || "none")}</td><td><button class="operator-kickoff-export" data-workspace-id="${escapeHtml(workspace.id)}" type="button">Kickoff</button> <button class="operator-closeout-export" data-workspace-id="${escapeHtml(workspace.id)}" type="button">Closeout</button></td></tr>`; }).join("")}</tbody></table>`;
  document.querySelectorAll(".operator-kickoff-export").forEach((button) => button.addEventListener("click", async () => {
    const status = byId("operator-kickoff-status");
    status.textContent = "Preparing launch packet…";
    const result = await fetch(`../api/operator/pilot-kickoff?workspace=${encodeURIComponent(button.dataset.workspaceId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!result.ok) { status.textContent = `Could not prepare launch packet (${result.status}).`; return; }
    const blob = await result.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${button.dataset.workspaceId}-pilot-kickoff.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    status.textContent = "Launch packet downloaded.";
  }));
  document.querySelectorAll(".operator-closeout-export").forEach((button) => button.addEventListener("click", async () => {
    const status = byId("operator-kickoff-status");
    status.textContent = "Preparing closeout packet…";
    const result = await fetch(`../api/operator/pilot-closeout?workspace=${encodeURIComponent(button.dataset.workspaceId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!result.ok) { status.textContent = `Could not prepare closeout packet (${result.status}).`; return; }
    const blob = await result.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${button.dataset.workspaceId}-pilot-closeout.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    status.textContent = "Closeout packet downloaded.";
  }));
  byId("operator-history").innerHTML = overview.trend.length ? `<table><caption>Refresh history · aggregate operating trend</caption><thead><tr><th>Run</th><th>Status</th><th>Failed steps</th><th>Changed sources</th><th>Missing sources</th><th>Oldest source age</th><th>Alerts useful / false / correction</th><th>Deliveries</th><th>Reviewed</th></tr></thead><tbody>${overview.trend.slice().reverse().map((run) => `<tr><th scope="row"><code>${escapeHtml(run.runId)}</code></th><td>${escapeHtml(run.status)}</td><td>${escapeHtml(run.failedSteps.join(", ") || "none")}</td><td>${escapeHtml(run.changedSources ?? "not recorded")}</td><td>${escapeHtml(run.missingSources ?? "not recorded")}</td><td>${run.oldestSourceAgeMs === null ? "not recorded" : `${Math.round(run.oldestSourceAgeMs / 86400000)} days`}</td><td>${escapeHtml(run.usefulAlerts)} / ${escapeHtml(run.falseAlerts)} / ${escapeHtml(run.correctionAlerts)}</td><td>${escapeHtml(run.deliveriesPrepared)}</td><td>${escapeHtml(run.deliveriesReviewed)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No refresh history is available yet.</p>`;
  byId("operator-limitation").textContent = overview.limitation;
});
