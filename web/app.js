const fixtureUrl = "../api/packet";
const state = { packet: null, role: "all", theme: "all", company: "all", industry: "all", timelineType: "all", timelineQuery: "", timelineEvents: [], workspaceId: "demo-research", actorId: "demo-researcher", token: sessionStorage.getItem("change-intelligence-token") || "" };

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
}[char]));
const alertActionsMarkup = (alert) => `<div class="review-actions"><button class="acknowledge-alert" data-alert-id="${escapeHtml(alert.id)}" type="button">Acknowledge</button><button class="resolve-alert" data-alert-id="${escapeHtml(alert.id)}" data-disposition="useful" type="button">Useful</button><button class="resolve-alert" data-alert-id="${escapeHtml(alert.id)}" data-disposition="false_positive" type="button">False positive</button><button class="resolve-alert" data-alert-id="${escapeHtml(alert.id)}" data-disposition="needs_correction" type="button">Needs correction</button></div>`;

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  let body = options.body;
  if (body && typeof body === "object") {
    body = { ...body, workspaceId: state.workspaceId };
    if (!state.token) body.actorId = state.actorId;
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }
  if (options.method && options.method !== "GET") headers.set("Idempotency-Key", crypto.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return fetch(path, { ...options, headers, body });
}

function setWorkspaceStatus(message) { byId("workspace-status").textContent = message; }

async function loadWorkspaces() {
  const response = await apiFetch("../api/workspaces");
  if (!response.ok) throw new Error(response.status === 401 ? "Enter a token to connect to a workspace." : `Workspaces unavailable (${response.status})`);
  const workspaces = await response.json();
  if (!workspaces.length) throw new Error("This account has no workspace access.");
  const select = byId("workspace-select");
  select.innerHTML = workspaces.map((workspace) => `<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)}</option>`).join("");
  if (!workspaces.some((workspace) => workspace.id === state.workspaceId)) state.workspaceId = workspaces[0].id;
  select.value = state.workspaceId;
  setWorkspaceStatus(state.token ? "Connected." : "Demo workspace.");
  await Promise.all([loadQuestions(), loadAlerts(), loadDecisionOutcomes(), loadWatchlists()]);
}

async function loadWatchlists() {
  const response = await apiFetch(`../api/watchlists?workspace=${encodeURIComponent(state.workspaceId)}`);
  if (!response.ok) throw new Error(`Watchlists unavailable (${response.status})`);
  const watchlists = await response.json();
  byId("watchlists-summary").textContent = `${watchlists.length} watchlist${watchlists.length === 1 ? "" : "s"} in this workspace.`;
  byId("watchlists-items").innerHTML = watchlists.length ? watchlists.map((watchlist) => `<article class="record-card"><div class="record-meta"><span class="role">monitoring</span><span>${escapeHtml(watchlist.alertOn.join(", "))}</span></div><h3>${escapeHtml(watchlist.name)}</h3><p>${watchlist.sourceIds.length} source${watchlist.sourceIds.length === 1 ? "" : "s"} · created ${escapeHtml(watchlist.createdAt)}</p><details><summary>Open watchlist scope</summary><p>${watchlist.sourceIds.map((sourceId) => `<code>${escapeHtml(sourceId)}</code>`).join(" ")}</p></details></article>`).join("") : `<p class="muted">No custom watchlists yet.</p>`;
}

async function loadAlerts() {
  const response = await apiFetch(`../api/alerts?workspace=${encodeURIComponent(state.workspaceId)}`);
  if (!response.ok) throw new Error(`Alerts unavailable (${response.status})`);
  const alerts = await response.json();
  byId("workspace-alerts").hidden = false;
  const openAlerts = alerts.filter((alert) => alert.state === "open");
  byId("alerts-summary").textContent = `${openAlerts.length} open alert${openAlerts.length === 1 ? "" : "s"} in this workspace.`;
  byId("alerts-items").innerHTML = openAlerts.length ? openAlerts.map((alert) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(alert.severity)}</span><span>${escapeHtml(alert.kind.replaceAll("_", " "))}</span></div><h3>${escapeHtml(alert.watchlistName)}</h3><p>${escapeHtml(alert.reason)}</p><details><summary>Open alert source</summary><dl><dt>Repository</dt><dd>${escapeHtml(alert.repository)}</dd><dt>Source</dt><dd><code>${escapeHtml(alert.sourcePath)}</code></dd></dl></details>${alertActionsMarkup(alert)}</article>`).join("") : `<p class="muted">No open watchlist alerts.</p>`;
  document.querySelectorAll(".acknowledge-alert").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    const result = await apiFetch(`../api/alerts/${encodeURIComponent(button.dataset.alertId)}/acknowledge`, { method: "POST", body: { note: "Acknowledged from workspace reader." } });
    if (!result.ok) button.disabled = false;
    await loadAlerts();
  }));
}

async function loadChanges() {
  const response = await apiFetch("../api/changes?includeUnchanged=true");
  if (!response.ok) throw new Error(`Change feed unavailable (${response.status})`);
  const feed = await response.json();
  const reviewCount = feed.changes.filter((change) => change.needsReview).length;
  byId("change-feed-summary").textContent = `${feed.changes.length} sources checked in refresh ${feed.runId || "not yet run"}; ${reviewCount} need review.`;
  const visible = feed.changes.filter((change) => change.status !== "unchanged");
  byId("change-feed-items").innerHTML = visible.length ? visible.map((change) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(change.status)}</span><span>${change.needsReview ? "needs review" : "no review"}</span><span>${escapeHtml(change.repository)}</span></div><h3>${escapeHtml(change.sourcePath)}</h3><p>${escapeHtml(change.reason || "No source change recorded.")}</p><details><summary>Open source hashes</summary><dl><dt>Previous</dt><dd><code>${escapeHtml(change.previousSha256 || "none")}</code></dd><dt>Current</dt><dd><code>${escapeHtml(change.currentSha256 || "missing")}</code></dd><dt>Checked</dt><dd>${escapeHtml(change.checkedAt)}</dd></dl></details></article>`).join("") : `<p class="muted">No source bytes changed in the latest scan.</p>`;
}

async function loadOperations() {
  const workspace = encodeURIComponent(state.workspaceId);
  const [response, usageResponse, metricsResponse, updateResponse, deliveryHealthResponse, serviceReportResponse, readinessResponse, profileResponse, deliveryResponse, reportResponse] = await Promise.all([apiFetch("../api/operations"), apiFetch(`../api/usage?workspace=${workspace}`), apiFetch(`../api/pilot-metrics?workspace=${workspace}`), apiFetch(`../api/workspace-update?workspace=${workspace}`), apiFetch(`../api/workspace-delivery-health?workspace=${workspace}`), apiFetch(`../api/workspace-service-report?workspace=${workspace}`), apiFetch(`../api/workspace-commercial-readiness?workspace=${workspace}`), apiFetch(`../api/workspace-pilot?workspace=${workspace}`), apiFetch(`../api/pilot-deliveries?workspace=${workspace}`), apiFetch(`../api/pilot-report?workspace=${workspace}`)]);
  if (!response.ok || !usageResponse.ok || !metricsResponse.ok || !updateResponse.ok || !deliveryHealthResponse.ok || !serviceReportResponse.ok || !readinessResponse.ok || !profileResponse.ok || !deliveryResponse.ok || !reportResponse.ok) throw new Error(`Operations unavailable (${response.status})`);
  const operations = await response.json();
  const usage = await usageResponse.json();
  const pilot = await metricsResponse.json();
  const update = await updateResponse.json();
  const deliveryHealth = await deliveryHealthResponse.json();
  const serviceReport = await serviceReportResponse.json();
  const commercialReadiness = await readinessResponse.json();
  const pilotProfile = await profileResponse.json();
  const deliveries = await deliveryResponse.json();
  const report = await reportResponse.json();
  const readiness = operations.readiness;
  const refresh = operations.refresh;
  byId("operations-summary").textContent = `Last run ${refresh.runId || "not recorded"} · ${refresh.status} · ${refresh.endedAt || "no completion time"}.`;
  const checks = [
    ["Readiness", readiness.status],
    ["Refresh", readiness.checks.refresh.status],
    ["Source scan", readiness.checks.sourceScan.status],
    ["Runtime sync", readiness.checks.runtimeSync.status],
    ["Backup", readiness.checks.backup.status]
  ];
  const activity = usage.measures;
  const activityCards = [["Questions", activity.questionsSaved], ["Source reviews", activity.sourceReviews], ["Briefing exports", activity.briefingsExported], ["Decision feedback", activity.decisionOutcomesRecorded], ["Alerts resolved", activity.alertsResolved], ["False alerts", activity.falseAlerts], ["Watchlists", activity.watchlistsCreated]];
  byId("operations-cards").innerHTML = [...checks.map(([label, status]) => `<div class="operation-card"><span>${escapeHtml(label)}</span><strong class="operation-${escapeHtml(status)}">${escapeHtml(status)}</strong></div>`), ...activityCards.map(([label, value]) => `<div class="operation-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)].join("");
  const measures = pilot.measures;
  const responseTime = measures.medianAlertResponseMs === null ? "not recorded" : `${Math.round(measures.medianAlertResponseMs / 60000)} min`;
  byId("pilot-scorecard").innerHTML = `<table><caption>Pilot scorecard · recorded workspace experience</caption><thead><tr><th>Measure</th><th>Value</th><th>What it tells us</th></tr></thead><tbody>
    <tr><th scope="row">Useful alerts</th><td>${escapeHtml(measures.usefulAlerts)} / ${escapeHtml(measures.alertsResolved)} resolved</td><td>Whether people found reviewed alerts worth acting on.</td></tr>
    <tr><th scope="row">False alerts</th><td>${escapeHtml(measures.falseAlerts)}</td><td>Signals users marked as noise.</td></tr>
    <tr><th scope="row">Median alert response</th><td>${escapeHtml(responseTime)}</td><td>How quickly the workspace recorded a response.</td></tr>
    <tr><th scope="row">Briefings exported</th><td>${escapeHtml(measures.briefingsExported)}</td><td>Briefings taken out of the reader for use elsewhere.</td></tr>
    <tr><th scope="row">Decision feedback</th><td>${escapeHtml(measures.decisionFeedbackRecords)} recorded · ${escapeHtml(measures.decisionsUsingBriefings)} used</td><td>Whether a briefing entered a real decision.</td></tr>
    <tr><th scope="row">Later result</th><td>${escapeHtml(measures.knownDecisionResults)} known · ${escapeHtml(measures.readingsHeld)} held · ${escapeHtml(measures.readingsChanged)} changed · ${escapeHtml(measures.readingsWrong)} wrong</td><td>What users later recorded about the reading.</td></tr>
  </tbody></table><p class="muted">${escapeHtml(pilot.interpretation)}</p>`;
  byId("workspace-update").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">customer handoff</span><span>${escapeHtml(update.freshness.readiness)}</span><span>${escapeHtml(update.freshness.refreshStatus)}</span></div><h3>${escapeHtml(update.headline)}</h3><p>${escapeHtml(update.limitation)}</p><h4>Next actions</h4>${update.actions.length ? `<ul>${update.actions.map((action) => `<li>${escapeHtml(action.label)} (${escapeHtml(action.count)})</li>`).join("")}</ul>` : `<p class="muted">No follow-up action is currently recorded.</p>`}<details><summary>Open current changes</summary>${update.changes.length ? `<ul>${update.changes.map((change) => `<li><strong>${escapeHtml(change.watchlistName)}</strong> — ${escapeHtml(change.reason)}</li>`).join("")}</ul>` : `<p class="muted">No open changes.</p>`}</details></article>`;
  byId("workspace-delivery-health").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">delivery health</span><span>${deliveryHealth.summary.pending} pending</span><span>${deliveryHealth.summary.deadLetters} dead letters</span></div><h3>${deliveryHealth.summary.notifications ? `${Math.round((deliveryHealth.summary.successRate ?? 0) * 100)}% delivered successfully` : "No scoped delivery records yet"}</h3><p>${escapeHtml(deliveryHealth.limitation)}</p><p class="muted">${deliveryHealth.summary.notifications} notifications · ${deliveryHealth.summary.attempts} attempts · ${deliveryHealth.summary.retries} retries · average latency ${deliveryHealth.summary.averageLatencyMs === null ? "not measured" : `${Math.round(deliveryHealth.summary.averageLatencyMs / 1000)} seconds`}.</p></article>`;
  byId("workspace-service-report").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">service level</span><span>${escapeHtml(serviceReport.status)}</span><span>${serviceReport.serviceLevel.overdue ? "cadence overdue" : "cadence current"}</span></div><h3>${serviceReport.status === "on_track" ? "Pilot delivery is on track" : serviceReport.status === "attention" ? "Pilot delivery needs attention" : serviceReport.status === "not_configured" ? "Pilot service is not configured" : "Pilot is awaiting its first delivery"}</h3><p>${escapeHtml(serviceReport.limitation)}</p><p class="muted">Cadence: ${escapeHtml(serviceReport.serviceLevel.cadence || "not configured")} · next expected: ${escapeHtml(serviceReport.serviceLevel.nextExpectedAt || "not scheduled")} · reviewed deliveries: ${escapeHtml(serviceReport.observations.reviewedDeliveries)}.</p><details><summary>Open success measures</summary>${serviceReport.observations.measures.length ? `<ul>${serviceReport.observations.measures.map((measure) => `<li><strong>${escapeHtml(measure.name)}</strong> — ${escapeHtml(measure.observations)} observations; latest ${escapeHtml(measure.latestState || "not assessed")}</li>`).join("")}</ul>` : `<p class="muted">No success measures configured.</p>`}</details></article>`;
  byId("workspace-commercial-readiness").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">commercial checkpoint</span><span>recommend: ${escapeHtml(commercialReadiness.recommendation)}</span><span>human decision required</span></div><h3>What the recorded pilot evidence supports next</h3><p>${escapeHtml(commercialReadiness.rationale)}</p><p class="muted">${escapeHtml(commercialReadiness.limitation)}</p>${commercialReadiness.history?.length ? `<details><summary>Readiness history</summary><table><thead><tr><th>Observed</th><th>Recommendation</th><th>Service</th><th>Reviewed</th><th>Useful rate</th></tr></thead><tbody>${commercialReadiness.history.map((snapshot) => `<tr><th scope="row">${escapeHtml(snapshot.observedAt)}</th><td>${escapeHtml(snapshot.recommendation)}</td><td>${escapeHtml(snapshot.serviceStatus)}</td><td>${escapeHtml(snapshot.reviewedDeliveries)}</td><td>${snapshot.usefulnessRate === null ? "not measured" : `${Math.round(snapshot.usefulnessRate * 100)}%`}</td></tr>`).join("")}</tbody></table></details>` : `<p class="muted">No previous readiness snapshots are recorded yet.</p>`}</article>`;
  const profile = pilotProfile.profile;
  byId("pilot-profile").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">pilot setup</span><span>${profile ? escapeHtml(profile.status) : "not configured"}</span></div><h3>${profile ? "What this pilot is meant to help decide" : "Set up this design-partner pilot"}</h3><p>${profile ? escapeHtml(profile.decisionQuestion) : "Record the decision, delivery rhythm, and measures that will determine whether this workspace is useful."}</p>${profile ? `<p class="muted">${escapeHtml(profile.cadence)} updates · review ${escapeHtml(profile.nextReviewAt || "not scheduled")} · measures: ${profile.successMeasures.map(escapeHtml).join("; ")}</p>` : ""}<form id="pilot-profile-form"><label>Decision question <input id="pilot-decision-question" required minlength="8" maxlength="500" value="${escapeHtml(profile?.decisionQuestion || "")}"></label><label>Context <textarea id="pilot-decision-context" maxlength="2000">${escapeHtml(profile?.decisionContext || "")}</textarea></label><label>Update rhythm <select id="pilot-cadence"><option value="weekly" ${profile?.cadence === "weekly" ? "selected" : ""}>Weekly</option><option value="monthly" ${!profile || profile.cadence === "monthly" ? "selected" : ""}>Monthly</option><option value="quarterly" ${profile?.cadence === "quarterly" ? "selected" : ""}>Quarterly</option></select></label><label>Success measures <textarea id="pilot-success-measures" required placeholder="One measure per line">${escapeHtml(profile?.successMeasures?.join("\n") || "")}</textarea></label><label>Next review date <input id="pilot-next-review" type="date" value="${escapeHtml(profile?.nextReviewAt?.slice(0, 10) || "")}"></label><button type="submit">Save pilot setup</button><span id="pilot-profile-status" class="muted" role="status"></span></form></article>`;
  const latestDelivery = deliveries.deliveries?.[0];
  const assessmentFields = latestDelivery ? (latestDelivery.successMeasures ?? []).map((measure, index) => `<label>${escapeHtml(measure)} <select class="pilot-measure-assessment" data-measure-index="${index}"><option value="unknown">Not assessed</option><option value="met">Met</option><option value="partially_met">Partly met</option><option value="not_met">Not met</option></select></label>`).join("") : "";
  const deliveryReview = latestDelivery?.review ? `<p>Reviewed: ${escapeHtml(latestDelivery.review.usefulness)} · ${escapeHtml(latestDelivery.review.decisionImpact)}</p>` : latestDelivery ? `<form id="pilot-delivery-review-form"><label>Was this delivery useful? <select id="pilot-delivery-usefulness"><option value="useful">Useful</option><option value="unclear">Unclear</option><option value="not_useful">Not useful</option></select></label><label>Decision impact <select id="pilot-delivery-impact"><option value="changed_decision">Changed a decision</option><option value="informed_decision">Informed a decision</option><option value="no_change">No change</option><option value="not_applicable">Not applicable</option></select></label>${assessmentFields}<label>Review note <textarea id="pilot-delivery-note" required placeholder="What did this delivery change or fail to change?"></textarea></label><button type="submit">Record delivery review</button><span id="pilot-delivery-status" class="muted" role="status"></span></form>` : "";
  byId("pilot-delivery").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">recurring delivery</span><span>${latestDelivery ? escapeHtml(latestDelivery.status) : "waiting"}</span></div><h3>${latestDelivery ? escapeHtml(latestDelivery.headline) : "The first delivery will appear after a refresh"}</h3><p>${latestDelivery ? `${escapeHtml(latestDelivery.cadence)} cycle · refresh ${escapeHtml(latestDelivery.refreshRunId)} · generated ${escapeHtml(latestDelivery.generatedAt)}` : "Once the pilot is configured, each completed refresh prepares a reviewable workspace handoff."}</p>${latestDelivery ? `<p class="muted">${escapeHtml(latestDelivery.evaluation.reason)}</p>${deliveryReview}` : ""}</article>`;
  const deliveryReviewForm = byId("pilot-delivery-review-form");
  if (deliveryReviewForm) deliveryReviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = byId("pilot-delivery-status");
    status.textContent = "Saving…";
    const measureAssessments = [...document.querySelectorAll(".pilot-measure-assessment")].map((select) => ({ name: latestDelivery.successMeasures[Number(select.dataset.measureIndex)], state: select.value }));
    const result = await apiFetch(`../api/pilot-deliveries/${encodeURIComponent(latestDelivery.id)}/review`, { method: "POST", body: { deliveryId: latestDelivery.id, usefulness: byId("pilot-delivery-usefulness").value, decisionImpact: byId("pilot-delivery-impact").value, measureAssessments, note: byId("pilot-delivery-note").value } });
    status.textContent = result.ok ? "Delivery review saved." : "Could not save delivery review.";
    if (result.ok) await loadOperations();
  });
  const usefulnessRate = report.usefulness.rate === null ? "not enough observations" : `${Math.round(report.usefulness.rate * 100)}% useful`;
  const latestDecision = report.latestDecision;
  byId("pilot-report").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">pilot learning</span><span>${escapeHtml(report.observation.reviewedDeliveries)} reviewed</span><span>${escapeHtml(usefulnessRate)}</span></div><h3>What this partner has learned so far</h3><p>${escapeHtml(report.limitation)}</p><p>${escapeHtml(report.checkpoint.explanation)}</p><p>Decision impact: ${escapeHtml(report.decisionImpact.changedDecision)} changed · ${escapeHtml(report.decisionImpact.informedDecision)} informed · ${escapeHtml(report.decisionImpact.noChange)} unchanged.</p><h4>Open issues</h4>${report.openIssues.length ? `<ul>${report.openIssues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : `<p class="muted">No unresolved issue is recorded.</p>`}<details><summary>Open measure observations</summary>${report.measures.length ? `<ul>${report.measures.map((measure) => `<li><strong>${escapeHtml(measure.name)}</strong> — ${escapeHtml(measure.observations)} observations; latest: ${escapeHtml(measure.latestState || "not assessed")}</li>`).join("")}</ul>` : `<p class="muted">No success measures configured.</p>`}</details>${latestDecision ? `<p><strong>Latest checkpoint:</strong> ${escapeHtml(latestDecision.decision)} — ${escapeHtml(latestDecision.nextStep)}</p>` : `<form id="pilot-decision-form"><h4>Record a pilot checkpoint</h4><label>Decision <select id="pilot-decision"><option value="improve">Improve</option><option value="continue">Continue</option><option value="expand">Expand</option><option value="stop">Stop</option></select></label><label>Why <textarea id="pilot-decision-note" required placeholder="What does the evidence support?"></textarea></label><label>Next step <textarea id="pilot-decision-next-step" required placeholder="What will happen next?"></textarea></label><button type="submit">Save checkpoint</button><span id="pilot-decision-status" class="muted" role="status"></span></form>`}</article>`;
  const pilotDecisionForm = byId("pilot-decision-form");
  if (pilotDecisionForm) pilotDecisionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = byId("pilot-decision-status");
    status.textContent = "Saving…";
    const result = await apiFetch("../api/pilot-report/decision", { method: "POST", body: { decision: byId("pilot-decision").value, note: byId("pilot-decision-note").value, nextStep: byId("pilot-decision-next-step").value } });
    status.textContent = result.ok ? "Checkpoint saved." : "Could not save checkpoint.";
    if (result.ok) await loadOperations();
  });
  byId("pilot-history").innerHTML = report.deliveryHistory.length ? `<table><caption>Pilot history · one row per refresh delivery</caption><thead><tr><th>Generated</th><th>Status</th><th>Usefulness</th><th>Decision impact</th><th>Headline</th></tr></thead><tbody>${report.deliveryHistory.map((delivery) => `<tr><th scope="row">${escapeHtml(delivery.generatedAt)}</th><td>${escapeHtml(delivery.status)}</td><td>${escapeHtml(delivery.usefulness)}</td><td>${escapeHtml(delivery.decisionImpact)}</td><td>${escapeHtml(delivery.headline)}</td></tr>`).join("")}</tbody></table>${report.decisionHistory.length ? `<details><summary>Checkpoint history</summary><ul>${report.decisionHistory.map((decision) => `<li>${escapeHtml(decision.decidedAt)} — <strong>${escapeHtml(decision.decision)}</strong>: ${escapeHtml(decision.nextStep)}</li>`).join("")}</ul></details>` : ""}` : `<p class="muted">No delivery history exists yet. Complete a refresh after configuring the pilot.</p>`;
  byId("pilot-profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = byId("pilot-profile-status");
    status.textContent = "Saving…";
    const result = await apiFetch("../api/workspace-pilot", { method: "POST", body: { decisionQuestion: byId("pilot-decision-question").value, decisionContext: byId("pilot-decision-context").value, cadence: byId("pilot-cadence").value, successMeasures: byId("pilot-success-measures").value.split("\n").map((value) => value.trim()).filter(Boolean), nextReviewAt: byId("pilot-next-review").value || null } });
    status.textContent = result.ok ? "Pilot setup saved." : "Could not save pilot setup.";
    if (result.ok) await loadOperations();
  });
  const history = operations.refreshHistory ?? [];
  byId("operations-history").innerHTML = history.length ? `<table><caption>Recent refresh runs</caption><thead><tr><th>Run</th><th>Status</th><th>Steps</th><th>Ended</th></tr></thead><tbody>${history.slice().reverse().slice(0, 8).map((run) => `<tr><th scope="row"><code>${escapeHtml(run.runId)}</code></th><td>${escapeHtml(run.status)}</td><td>${run.steps.filter((step) => step.status === "complete").length}/${run.steps.length} complete</td><td>${escapeHtml(run.endedAt)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No refresh history recorded yet.</p>`;
}

async function loadDecisionOutcomes() {
  const response = await apiFetch(`../api/decision-outcomes?workspace=${encodeURIComponent(state.workspaceId)}`);
  if (!response.ok) throw new Error(`Decision feedback unavailable (${response.status})`);
  const outcomes = await response.json();
  const used = outcomes.filter((outcome) => outcome.decisionState === "used").length;
  const known = outcomes.filter((outcome) => ["held", "changed", "wrong"].includes(outcome.outcomeState)).length;
  byId("decision-feedback-summary").textContent = `${outcomes.length} feedback record${outcomes.length === 1 ? "" : "s"} · ${used} briefing${used === 1 ? "" : "s"} used in a decision · ${known} later result${known === 1 ? "" : "s"} known. This is workspace experience, not a general causal estimate.`;
  byId("decision-feedback-items").innerHTML = outcomes.length ? outcomes.slice().reverse().map((outcome) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(outcome.decisionState.replaceAll("_", " "))}</span><span>${escapeHtml(outcome.outcomeState)}</span><span>${escapeHtml(outcome.recordedAt)}</span></div><h3>Briefing ${escapeHtml(outcome.briefingId)}</h3><p>${escapeHtml(outcome.decisionSummary || "No decision note recorded.")}</p>${outcome.outcomeNote ? `<p class="muted">Later: ${escapeHtml(outcome.outcomeNote)}</p>` : ""}</article>`).join("") : `<p class="muted">No decision feedback recorded yet. Publish a briefing, use it in a real decision, and record what happened.</p>`;
}

async function loadCoverage() {
  const response = await apiFetch("../api/coverage");
  if (!response.ok) throw new Error(`Evidence coverage unavailable (${response.status})`);
  const coverage = await response.json();
  byId("coverage-summary").textContent = `${coverage.summary.ready} ready · ${coverage.summary.partial} partial · ${coverage.summary.missing} missing. A missing row is a research gap, not proof that the main reading is false.`;
  byId("coverage-items").innerHTML = coverage.requirements.map((item) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(item.status)}</span><span>${escapeHtml(item.evidence)}/${escapeHtml(item.target)} records</span></div><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.meaning)}</p></article>`).join("");
  byId("coverage-reports").innerHTML = coverage.reportWindows.length ? `<table><caption>Public-company histories currently available</caption><thead><tr><th>Company</th><th>Annual baseline</th><th>Quarters</th><th>Captured sources</th><th>Status</th></tr></thead><tbody>${coverage.reportWindows.map((report) => `<tr><th scope="row">${escapeHtml(report.company || "Unnamed company")}</th><td>${escapeHtml(report.annualBaseline || "not recorded")}</td><td>${escapeHtml(report.quarterCount)}</td><td>${escapeHtml(report.sourceRefs)}</td><td>${escapeHtml(report.captureStatus)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No annual-plus-quarterly company history is available yet.</p>`;
}

async function loadAtlas() {
  const [response, ingestionResponse] = await Promise.all([apiFetch("../api/atlas"), apiFetch("../api/ingestion")]);
  if (!response.ok || !ingestionResponse.ok) throw new Error(`Domain atlas unavailable (${response.status})`);
  const atlas = await response.json();
  const ingestion = await ingestionResponse.json();
  const groups = [["themes", "Themes"], ["mechanisms", "Mechanisms"], ["companies", "Companies"], ["industries", "Industries"], ["affectedGroups", "Affected groups"], ["repositories", "Repositories"]];
  byId("atlas-summary").textContent = `${atlas.sourceRecordCount} evidence records · ${atlas.edges.length} source-to-entity links · ${ingestion.repositories.filter((repository) => repository.status === "ingested").length} repositories ingested · snapshot ${atlas.sourceSnapshotDate || "not recorded"}. Connections organize the evidence; they do not prove causation.`;
  byId("atlas-entities").innerHTML = groups.map(([key, label]) => `<div class="operation-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(atlas.entities[key]?.length ?? 0)}</strong></div>`).join("");
  const links = (atlas.edges ?? []).slice(0, 12);
  byId("atlas-links").innerHTML = links.length ? `<p class="muted">Examples of normalized links</p><ul>${links.map((edge) => `<li><code>${escapeHtml(edge.from)}</code> → <code>${escapeHtml(edge.to)}</code> · ${escapeHtml(edge.relation.replaceAll("_", " "))}</li>`).join("")}</ul>` : `<p class="muted">No normalized links are available yet.</p>`;
}

async function loadEvidenceHistory() {
  const workspace = encodeURIComponent(state.workspaceId);
  const [response, timelineResponse] = await Promise.all([apiFetch(`../api/evidence-history?workspace=${workspace}`), apiFetch(`../api/timeline?workspace=${workspace}`)]);
  if (!response.ok || !timelineResponse.ok) throw new Error(`Evidence history unavailable (${response.status})`);
  const history = await response.json();
  const timeline = await timelineResponse.json();
  state.timelineEvents = (timeline.events ?? []).slice().reverse();
  const types = [...new Set(state.timelineEvents.map((event) => event.eventType))].sort();
  byId("timeline-type-filter").innerHTML = `<option value="all">All events</option>${types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type.replaceAll("_", " "))}</option>`).join("")}`;
  byId("timeline-type-filter").value = state.timelineType;
  byId("evidence-history-summary").textContent = `${history.activeResearchRecordCount} active reviewed record${history.activeResearchRecordCount === 1 ? "" : "s"} · ${history.decisionCount} decision${history.decisionCount === 1 ? "" : "s"} · ${timeline.eventCount} timeline event${timeline.eventCount === 1 ? "" : "s"}.`;
  renderTimeline();
}

function renderTimeline() {
  const query = state.timelineQuery.toLowerCase();
  const events = state.timelineEvents.filter((event) => (state.timelineType === "all" || event.eventType === state.timelineType) && (!query || [event.sourceId, event.targetId, event.candidateKey, event.workspaceId].some((value) => String(value ?? "").toLowerCase().includes(query))));
  byId("evidence-history-items").innerHTML = events.length ? events.slice(0, 20).map((event) => { const inspectKind = event.eventType.startsWith("source") ? "source" : event.eventType.startsWith("insight") ? "insight" : event.eventType.startsWith("briefing") ? "briefing" : ""; const inspectTarget = inspectKind === "insight" ? (event.candidateKey || event.targetId) : event.sourceId || event.targetId; return `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(event.eventType.replaceAll("_", " "))}</span>${event.reviewType ? `<span>${escapeHtml(event.reviewType.replaceAll("_", " "))}</span>` : ""}${event.status ? `<span>${escapeHtml(event.status)}</span>` : ""}<span>${escapeHtml(event.occurredAt)}</span></div><h3>${escapeHtml(event.sourceId || event.targetId)}</h3><p>${escapeHtml(event.outcome || event.status || "Recorded event")}${event.reviewer ? ` · by ${escapeHtml(event.reviewer)}` : ""}${event.previousEvidenceDigest ? ` · previous evidence ${escapeHtml(event.previousEvidenceDigest.slice(0, 12))}` : ""}</p>${inspectKind ? `<button class="secondary-button timeline-open" data-timeline-kind="${inspectKind}" data-timeline-target="${escapeHtml(inspectTarget)}" type="button">Open affected ${inspectKind}</button>` : ""}<details><summary>Open event identity</summary><dl><dt>Target</dt><dd><code>${escapeHtml(event.targetId)}</code></dd><dt>Current digest</dt><dd><code>${escapeHtml(event.currentEvidenceDigest || event.currentDigest || event.sourceDigest || "not recorded")}</code></dd><dt>Event ID</dt><dd><code>${escapeHtml(event.id || event.publicationId || "source-scan")}</code></dd></dl></details></article>`; }).join("") : `<p class="muted">No timeline events match these filters.</p>`;
  document.querySelectorAll(".timeline-open").forEach((button) => button.addEventListener("click", () => {
    const target = button.dataset.timelineTarget;
    if (button.dataset.timelineKind === "source") inspectEvidence(target).catch((error) => showInspector("Inspection unavailable", error.message, ""));
    else if (button.dataset.timelineKind === "insight") inspectInsight(target).catch((error) => showInspector("Inspection unavailable", error.message, ""));
    else inspectBriefing(target).catch((error) => showInspector("Inspection unavailable", error.message, ""));
  }));
}

function showInspector(title, summary, content) {
  byId("evidence-inspector").hidden = false;
  byId("inspector-title").textContent = title;
  byId("inspector-summary").textContent = summary;
  byId("inspector-content").innerHTML = content;
  byId("evidence-inspector").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function inspectEvidence(recordId) {
  const response = await apiFetch(`../api/evidence/${encodeURIComponent(recordId)}?workspace=${encodeURIComponent(state.workspaceId)}`);
  if (!response.ok) throw new Error("Evidence could not be loaded.");
  const inspection = await response.json();
  const { record, source, relatedRecords, insightLinks, boundaries } = inspection;
  showInspector(record.title, `${record.sourceRepository} · ${record.claimState.replaceAll("_", " ")} · observed ${record.asOf}`, `
    <article class="inspection-card">
      <p>${escapeHtml(record.observation)}</p>
      <h3>Source passage</h3>
      <blockquote>${escapeHtml(source.excerpt || "No excerpt was captured.")}</blockquote>
      <dl class="inspection-details">
        <dt>Source</dt><dd><code>${escapeHtml(source.path)}</code>${source.locator ? ` · ${escapeHtml(source.locator)}` : ""}</dd>
        <dt>Digest</dt><dd><code>${escapeHtml(source.digest || "not recorded")}</code></dd>
        <dt>Mechanism</dt><dd>${escapeHtml(record.mechanism || "Not recorded")}</dd>
        <dt>Affected groups</dt><dd>${escapeHtml((record.affectedGroups || []).join(", ") || "Not recorded")}</dd>
      </dl>
      <h3>Limits of this record</h3>
      <ul>${boundaries.limits.map((limit) => `<li>${escapeHtml(limit)}</li>`).join("")}</ul>
      ${relatedRecords.length ? `<h3>Related records</h3><div class="inline-links">${relatedRecords.map((related) => `<button class="link-button inspect-record" data-record-id="${escapeHtml(related.id)}">${escapeHtml(related.title)}</button>`).join("")}</div>` : ""}
      ${insightLinks.length ? `<h3>Insights using this record</h3><div class="inline-links">${insightLinks.map((insight) => `<button class="link-button inspect-insight-link" data-insight-id="${escapeHtml(insight.id)}">${escapeHtml(insight.title)}</button>`).join("")}</div>` : ""}
    </article>`);
}

async function inspectInsight(insightId) {
  const response = await apiFetch(`../api/insights/${encodeURIComponent(insightId)}?workspace=${encodeURIComponent(state.workspaceId)}`);
  if (!response.ok) throw new Error("Insight could not be loaded.");
  const inspection = await response.json();
  const { insight, evidence, review, boundaries } = inspection;
  showInspector(insight.title, `${review?.status?.replaceAll("_", " ") || "not yet reviewed"} · refresh by ${insight.refreshBy}`, `
    <article class="inspection-card">
      <p>${escapeHtml(insight.plainLanguageSummary)}</p>
      <h3>Evidence chain</h3>
      <div class="chain-list">${evidence.map((record) => `<button class="chain-item inspect-record" data-record-id="${escapeHtml(record.id)}"><strong>${escapeHtml(record.title)}</strong><span>${escapeHtml(record.sourceRepository)} · ${escapeHtml(record.claimState.replaceAll("_", " "))}</span></button>`).join("")}</div>
      <h3>Strongest alternative</h3><p>${escapeHtml(boundaries.strongestAlternative)}</p>
      <h3>What would change our mind</h3><ul>${boundaries.whatWouldChangeOurMind.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <h3>Next test</h3><p>${escapeHtml(boundaries.nextTest)}</p>
    </article>`);
}

async function inspectBriefing(briefingId) {
  const response = await apiFetch(`../api/briefings?workspace=${encodeURIComponent(state.workspaceId)}`);
  if (!response.ok) throw new Error("Briefing could not be loaded.");
  const briefing = (await response.json()).find((item) => item.id === briefingId);
  if (!briefing) throw new Error("Briefing is not available in this workspace.");
  showInspector(briefing.title, `${briefing.state} · ${briefing.publication}`, `<article class="inspection-card"><p>${escapeHtml(briefing.reading)}</p><h3>Evidence boundary</h3><p>${escapeHtml(briefing.boundary)}</p><h3>Next test</h3><p>${escapeHtml(briefing.nextTest)}</p>${briefing.staleReason ? `<p class="error">${escapeHtml(briefing.staleReason)}</p>` : ""}<p>Evidence records: ${escapeHtml(briefing.evidence.map((item) => item.recordId).join(", ") || "none")}</p></article>`);
}

function render() {
  const { records, insights } = state.packet;
  const insight = insights[0];
  byId("insight-summary").textContent = insight.plainLanguageSummary;
  byId("insight-status").textContent = insight.status;
  byId("next-test").textContent = insight.nextTest;
  byId("falsifiers").innerHTML = insight.whatWouldChangeOurMind.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  byId("as-of").textContent = `Source snapshot ${state.packet.sourceSnapshotDate}`;
  const insightCandidate = state.packet.operations?.insightCandidates?.candidates?.[0];
  if (insightCandidate) {
    byId("insight-status").textContent = insightCandidate.status.replaceAll("_", " ");
    byId("insight-review-actions").innerHTML = ["needs_researcher_review", "stale"].includes(insightCandidate.status) ? `${insightCandidate.staleReason ? `<p class="muted">${escapeHtml(insightCandidate.staleReason)}</p>` : ""}<button id="accept-insight" type="button">${insightCandidate.status === "stale" ? "Re-review changed evidence" : "Accept for publication review"}</button>` : insightCandidate.status === "accepted_for_publication" ? `<button id="publish-insight" type="button">Publish insight</button>` : insightCandidate.status === "published" ? `<span>Published by ${escapeHtml(insightCandidate.publishedBy || "researcher")}.</span>` : `<span>Decision recorded by ${escapeHtml(insightCandidate.decidedBy || "researcher")}.</span>`;
    byId("accept-insight")?.addEventListener("click", async () => {
      const response = await apiFetch(`../api/insight-candidates/${encodeURIComponent(insightCandidate.id)}/decision`, { method: "POST", body: { decision: "accept", note: "Accepted for publication review after evidence inspection." } });
      if (response.ok) byId("insight-review-actions").textContent = "Accepted for publication review.";
    });
    byId("publish-insight")?.addEventListener("click", async () => {
      const response = await apiFetch(`../api/insight-candidates/${encodeURIComponent(insightCandidate.id)}/publish`, { method: "POST", body: { note: "Published after review." } });
      if (response.ok) byId("insight-review-actions").textContent = "Published.";
    });
  }

  byId("inspect-insight").onclick = () => inspectInsight(insight.id).catch((error) => showInspector("Inspection unavailable", error.message, ""));

  const sourceScan = state.packet.operations?.latestSourceScan;
  if (sourceScan) {
    byId("review-queue").hidden = false;
    const queue = sourceScan.reviewWork?.candidates || sourceScan.reviewQueue || [];
    const decisions = sourceScan.reviewWork?.decisions || [];
    const versionedEvidence = sourceScan.reviewWork?.versionedEvidence;
    const decisionByCandidate = new Map(decisions.map((decision) => [decision.candidateId, decision]));
    byId("review-summary").textContent = `${sourceScan.reviewRequired} item${sourceScan.reviewRequired === 1 ? "" : "s"} needs review. ${decisions.length} decision${decisions.length === 1 ? "" : "s"} recorded. ${versionedEvidence?.activeResearchRecordCount || 0} versioned research record${versionedEvidence?.activeResearchRecordCount === 1 ? "" : "s"} active. Last scan: ${sourceScan.generatedAt}.`;
    byId("review-items").innerHTML = queue.length ? queue.map((item) => { const recorded = decisionByCandidate.get(item.id); const actionable = item.state === "ready_for_researcher" && !recorded; return `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(item.state.replaceAll("_", " "))}</span><span>${escapeHtml(item.action.replaceAll("_", " "))}</span>${item.publication ? `<span>${escapeHtml(item.publication.replaceAll("_", " "))}</span>` : ""}${recorded ? `<span>${escapeHtml(recorded.resultingState.replaceAll("_", " "))}</span>` : ""}</div><h3>${escapeHtml(item.repository)} · ${escapeHtml(item.sourceId)}</h3><p>${escapeHtml(item.reason)}</p>${item.observation ? `<p>${escapeHtml(item.observation)}</p>` : ""}<details><summary>Open change details</summary><dl><dt>Source</dt><dd><code>${escapeHtml(item.sourcePath)}</code></dd><dt>Previous hash</dt><dd><code>${escapeHtml(item.previousSha256 || "none")}</code></dd><dt>Current hash</dt><dd><code>${escapeHtml(item.currentSha256 || item.sourceDigest || "missing")}</code></dd>${recorded ? `<dt>Reviewer decision</dt><dd>${escapeHtml(recorded.decision)} by ${escapeHtml(recorded.reviewer)}: ${escapeHtml(recorded.note || "No note")}</dd>` : ""}</dl></details>${actionable ? `<div class="review-actions"><button class="review-source" data-review-id="${escapeHtml(item.id)}" data-review-decision="accept" type="button">Accept for research</button><button class="review-source" data-review-id="${escapeHtml(item.id)}" data-review-decision="defer" type="button">Defer</button><button class="review-source" data-review-id="${escapeHtml(item.id)}" data-review-decision="reject" type="button">Reject</button><button class="review-source" data-review-id="${escapeHtml(item.id)}" data-review-decision="correct" type="button">Needs correction</button></div>` : ""}</article>`; }).join("") : `<p class="muted">No source changes are waiting for review.</p>`;
    document.querySelectorAll(".review-source").forEach((button) => button.addEventListener("click", async () => {
      const decision = button.dataset.reviewDecision;
      const note = ["reject", "correct"].includes(decision) ? window.prompt("Add a short reason for this decision:") : "Reviewed from the source-change queue.";
      if (["reject", "correct"].includes(decision) && !note?.trim()) return;
      button.disabled = true;
      const response = await apiFetch(`../api/source-review/${encodeURIComponent(button.dataset.reviewId)}/decision`, { method: "POST", body: { decision, note } });
      if (response.ok) {
        const recorded = await response.json();
        const reviewWork = state.packet.operations?.latestSourceScan?.reviewWork;
        if (reviewWork) reviewWork.decisions = [...(reviewWork.decisions || []).filter((item) => item.candidateId !== recorded.candidateId), recorded];
        render();
      } else button.disabled = false;
    }));
  }

  const workspaceAlerts = state.packet.operations?.workspaceAlerts;
  if (workspaceAlerts) {
    byId("workspace-alerts").hidden = false;
    const openAlerts = workspaceAlerts.alerts.filter((alert) => alert.state === "open");
    byId("alerts-summary").textContent = `${openAlerts.length} open alert${openAlerts.length === 1 ? "" : "s"} across ${workspaceAlerts.workspaces.length} workspace${workspaceAlerts.workspaces.length === 1 ? "" : "s"}.`;
    byId("alerts-items").innerHTML = openAlerts.length ? openAlerts.map((alert) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(alert.severity)}</span><span>${escapeHtml(alert.kind.replaceAll("_", " "))}</span></div><h3>${escapeHtml(alert.watchlistName)}</h3><p>${escapeHtml(alert.reason)}</p><details><summary>Open alert source</summary><dl><dt>Workspace</dt><dd>${escapeHtml(alert.workspaceId)}</dd><dt>Repository</dt><dd>${escapeHtml(alert.repository)}</dd><dt>Source</dt><dd><code>${escapeHtml(alert.sourcePath)}</code></dd></dl></details>${alertActionsMarkup(alert)}</article>`).join("") : `<p class="muted">No open watchlist alerts.</p>`;
  }

  const reportRecords = records.filter((record) => record.reportWindow);
  if (reportRecords.length) {
    byId("report-history").hidden = false;
    byId("report-reading").textContent = `${reportRecords.length} public-company histories are available. These are company-reported context, not proof of customer, worker, or public outcomes.`;
    const renderReport = (record) => {
      const report = record.reportWindow;
      const columns = report.columns?.length ? report.columns : ["Operating loss", "Net loss"];
      const cells = (quarter) => quarter.values?.length ? quarter.values : [quarter.operatingLoss, quarter.netLoss].map((value) => value === null || value === undefined ? "—" : Number(value).toLocaleString());
      const sourceLabel = report.movementSource === "sec_xbrl" ? "direct SEC filing XBRL" : "Atlas bridge file";
      return `<article class="record-card"><h3>${escapeHtml(record.company || record.title)} · ${escapeHtml(report.annualBaseline || "annual baseline")}</h3><p>${escapeHtml(report.reading || "Issuer-reported quarterly movement; the downstream outcome remains open.")}</p><table><caption>Quarterly records; movement read from ${escapeHtml(sourceLabel)}</caption><thead><tr><th>Period</th>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${report.quarters.map((quarter) => `<tr><th scope="row">${escapeHtml(quarter.period)}</th>${cells(quarter).map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></article>`;
    };
    byId("report-table").innerHTML = reportRecords.map(renderReport).join("");
    byId("report-links").innerHTML = reportRecords.map((record) => `<div><strong>${escapeHtml(record.company || record.title)}</strong>${(record.reportWindow.sourceRefs?.directRecords || []).map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>`).join("")}</div>`).join("");
  }

  const roles = [...new Set(records.map((record) => record.sourceRole))].sort();
  byId("role-filter").innerHTML = `<option value="all">All sources</option>${roles.map((role) => `<option value="${escapeHtml(role)}">${escapeHtml(role.replaceAll("_", " "))}</option>`).join("")}`;
  byId("role-filter").value = state.role;
  const options = (field, label) => {
    const values = [...new Set(records.map((record) => record[field]).filter(Boolean))].sort();
    byId(`${field}-filter`).innerHTML = `<option value="all">All ${label}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    byId(`${field}-filter`).value = state[field];
  };
  options("theme", "themes");
  options("company", "companies");
  options("industry", "industries");
  byId("watchlist-sources").innerHTML = records.map((record) => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.title)}</option>`).join("");
  const visible = records.filter((record) => (state.role === "all" || record.sourceRole === state.role) && (state.theme === "all" || record.theme === state.theme) && (state.company === "all" || record.company === state.company) && (state.industry === "all" || record.industry === state.industry));
  byId("catalog-summary").textContent = `${visible.length} of ${records.length} evidence records shown across ${new Set(visible.map((record) => record.sourceRepository)).size} repositories.`;
  byId("records").innerHTML = visible.map((record) => `<article class="record-card">
    <div class="record-meta"><span class="role">${escapeHtml(record.sourceRole.replaceAll("_", " "))}</span><span>${escapeHtml(record.claimState)}</span><span>${escapeHtml(record.asOf)}</span>${record.researchReview ? `<span>reviewed ${escapeHtml(record.researchReview.acceptedAt)}</span>` : ""}</div>
    <h3>${escapeHtml(record.title)}</h3>
    <p>${escapeHtml(record.observation)}</p>
    <button class="secondary-button inspect-record" type="button" data-record-id="${escapeHtml(record.id)}">Inspect evidence</button>
    <details><summary>Open source and limits</summary><dl>
      <dt>Repository</dt><dd>${escapeHtml(record.sourceRepository)}</dd>
      <dt>Source</dt><dd><code>${escapeHtml(record.sourceRef)}</code>${record.sourceLocator ? ` · ${escapeHtml(record.sourceLocator)}` : ""}</dd>
      ${record.company ? `<dt>Company</dt><dd>${escapeHtml(record.company)}</dd>` : ""}
      ${record.reportingPeriod ? `<dt>Report window</dt><dd>${escapeHtml(record.reportingPeriod)}</dd>` : ""}
      <dt>Mechanism</dt><dd>${escapeHtml(record.mechanism || "Not recorded")}</dd>
      <dt>Affected groups</dt><dd>${escapeHtml((record.affectedGroups || []).join(", ") || "Not recorded")}</dd>
      <dt>Limits</dt><dd>${(record.limits || []).map((limit) => `<span class="limit">${escapeHtml(limit)}</span>`).join("")}</dd>
    </dl></details>
  </article>`).join("");
}

document.addEventListener("click", (event) => {
  const resolveButton = event.target.closest(".resolve-alert");
  if (resolveButton) {
    const disposition = resolveButton.dataset.disposition;
    const note = ["false_positive", "needs_correction"].includes(disposition) ? window.prompt("Add a short explanation:") : "Alert disposition recorded from workspace reader.";
    if (["false_positive", "needs_correction"].includes(disposition) && !note?.trim()) return;
    resolveButton.disabled = true;
    apiFetch(`../api/alerts/${encodeURIComponent(resolveButton.dataset.alertId)}/resolve`, { method: "POST", body: { disposition, note } }).then((response) => { if (!response.ok) resolveButton.disabled = false; return loadAlerts(); });
  }
  const recordButton = event.target.closest(".inspect-record");
  if (recordButton) inspectEvidence(recordButton.dataset.recordId).catch((error) => showInspector("Inspection unavailable", error.message, ""));
  const insightButton = event.target.closest(".inspect-insight-link");
  if (insightButton) inspectInsight(insightButton.dataset.insightId).catch((error) => showInspector("Inspection unavailable", error.message, ""));
});

byId("role-filter").addEventListener("change", (event) => {
  state.role = event.target.value;
  render();
});

for (const field of ["theme", "company", "industry"]) byId(`${field}-filter`).addEventListener("change", (event) => { state[field] = event.target.value; render(); });
byId("timeline-type-filter").addEventListener("change", (event) => { state.timelineType = event.target.value; renderTimeline(); });
byId("timeline-query-filter").addEventListener("input", (event) => { state.timelineQuery = event.target.value; renderTimeline(); });

async function loadQuestions() {
  const workspace = encodeURIComponent(state.workspaceId);
  const [response, evaluationsResponse, briefingsResponse] = await Promise.all([apiFetch(`../api/questions?workspace=${workspace}`), apiFetch(`../api/question-evaluations?workspace=${workspace}`), apiFetch(`../api/briefings?workspace=${workspace}`)]);
  if (!response.ok || !evaluationsResponse.ok || !briefingsResponse.ok) throw new Error(`Questions unavailable (${response.status})`);
  const questions = await response.json();
  const evaluations = await evaluationsResponse.json();
  const briefings = await briefingsResponse.json();
  const evaluationByQuestion = new Map(evaluations.map((evaluation) => [evaluation.questionId, evaluation]));
  const briefingByQuestion = new Map(briefings.map((briefing) => [briefing.questionId, briefing]));
  byId("questions-summary").textContent = `${questions.length} saved question${questions.length === 1 ? "" : "s"}.`;
  byId("questions-items").innerHTML = questions.length ? questions.map((question) => { const evaluation = evaluationByQuestion.get(question.id); const briefing = briefingByQuestion.get(question.id); return `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(question.state)}</span><span>${escapeHtml(question.createdBy)}</span>${evaluation ? `<span>${escapeHtml(evaluation.state.replaceAll("_", " "))}</span>` : ""}${briefing ? `<span>${escapeHtml(briefing.state)}</span>` : ""}</div><h3>${escapeHtml(question.question)}</h3><p class="muted">Saved ${escapeHtml(question.createdAt)} · Last evaluated: ${escapeHtml(question.lastEvaluatedAt || "not yet")} · Evidence matches: ${evaluation?.matchedRecordIds.length ?? 0}</p>${evaluation ? `<details><summary>Open evaluation boundary</summary><p>${escapeHtml(evaluation.limitation)}</p><p>Matching records: ${escapeHtml(evaluation.matchedRecordIds.join(", ") || "none")}</p>${briefing ? `<p>Briefing: ${escapeHtml(briefing.reading)}</p><p>Next test: ${escapeHtml(briefing.nextTest)}</p>${briefing.staleReason ? `<p class="error">${escapeHtml(briefing.staleReason)}</p>` : ""}${briefing.state !== "published" ? `<button class="publish-briefing" data-briefing-id="${escapeHtml(briefing.id)}" data-stale="${briefing.state === "stale"}">${briefing.state === "stale" ? "Republish after reviewing updated evidence" : "Publish draft"}</button>` : `<p>Published by ${escapeHtml(briefing.publishedBy || "researcher")}.</p><form class="decision-outcome-form" data-briefing-id="${escapeHtml(briefing.id)}"><label>Did this briefing affect a decision? <select name="decisionState"><option value="used">Yes, it was used</option><option value="deferred">It was deferred</option><option value="not_used">No</option></select></label><label>What happened later? <select name="outcomeState"><option value="pending">Still watching</option><option value="held">The reading held</option><option value="changed">The reading changed</option><option value="wrong">The reading was wrong</option><option value="unknown">Unknown</option></select></label><label>Decision note <textarea name="decisionSummary" maxlength="2000" placeholder="What decision did it inform?"></textarea><label>Outcome note <textarea name="outcomeNote" maxlength="2000" placeholder="What happened after the decision?"></textarea><button type="submit">Record decision feedback</button><p class="muted decision-outcome-status" role="status"></p></form>`}<button class="secondary-button export-briefing" data-briefing-id="${escapeHtml(briefing.id)}" type="button">Export source-linked briefing</button>` : ""}</details>` : ""}</article>`; }).join("") : `<p class="muted">No saved questions yet.</p>`;
  document.querySelectorAll(".export-briefing").forEach((button) => button.addEventListener("click", async () => {
    const response = await apiFetch(`../api/briefings/${encodeURIComponent(button.dataset.briefingId)}/export?workspace=${encodeURIComponent(state.workspaceId)}`);
    if (!response.ok) return;
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${button.dataset.briefingId}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }));
  document.querySelectorAll(".publish-briefing").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    const response = await apiFetch(`../api/briefings/${encodeURIComponent(button.dataset.briefingId)}/publish`, { method: "POST", body: { confirmUpdatedEvidence: button.dataset.stale === "true", note: button.dataset.stale === "true" ? "Reviewed updated evidence before republishing." : "Published after review." } });
    if (!response.ok) button.disabled = false;
    await loadQuestions();
  }));
  document.querySelectorAll(".decision-outcome-form").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector(".decision-outcome-status");
    status.textContent = "Saving…";
    const fields = new FormData(form);
    const response = await apiFetch(`../api/briefings/${encodeURIComponent(form.dataset.briefingId)}/outcome`, { method: "POST", body: { decisionState: fields.get("decisionState"), outcomeState: fields.get("outcomeState"), decisionSummary: fields.get("decisionSummary"), outcomeNote: fields.get("outcomeNote") } });
    status.textContent = response.ok ? "Decision feedback recorded." : "Could not record feedback.";
  }));
}

byId("question-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = byId("question-input");
  const status = byId("question-status");
  status.textContent = "Saving…";
  try {
    const response = await apiFetch("../api/questions", { method: "POST", body: { question: input.value } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Question could not be saved.");
    input.value = "";
    status.textContent = "Saved.";
    await loadQuestions();
  } catch (error) {
    status.textContent = error.message;
  }
});

byId("workspace-select").addEventListener("change", async (event) => { state.workspaceId = event.target.value; await Promise.all([loadQuestions(), loadAlerts(), loadDecisionOutcomes(), loadWatchlists(), loadEvidenceHistory()]); });
byId("watchlist-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = byId("watchlist-status");
  const selected = [...byId("watchlist-sources").selectedOptions].map((option) => option.value);
  status.textContent = "Saving…";
  const response = await apiFetch("../api/watchlists", { method: "POST", body: { name: byId("watchlist-name").value, sourceIds: selected, alertOn: ["new", "changed", "missing"] } });
  status.textContent = response.ok ? "Watchlist saved." : "Could not save watchlist.";
  if (response.ok) { byId("watchlist-name").value = ""; await loadWatchlists(); }
});
byId("save-token").addEventListener("click", async () => {
  const token = byId("token-input").value.trim();
  if (token) { state.token = token; sessionStorage.setItem("change-intelligence-token", token); } else { state.token = ""; sessionStorage.removeItem("change-intelligence-token"); }
  try { await loadWorkspaces(); } catch (error) { setWorkspaceStatus(error.message); }
});
byId("token-input").value = state.token;
loadWorkspaces().catch((error) => { setWorkspaceStatus(error.message); byId("questions-summary").textContent = error.message; });
loadChanges().catch((error) => { byId("change-feed-summary").textContent = error.message; });
loadOperations().catch((error) => { byId("operations-summary").textContent = error.message; });
loadCoverage().catch((error) => { byId("coverage-summary").textContent = error.message; });
loadAtlas().catch((error) => { byId("atlas-summary").textContent = error.message; });
loadEvidenceHistory().catch((error) => { byId("evidence-history-summary").textContent = error.message; });

fetch(fixtureUrl).then((response) => {
  if (!response.ok) throw new Error(`Fixture unavailable (${response.status})`);
  return response.json();
}).then((packet) => {
  state.packet = packet;
  render();
}).catch((error) => {
  byId("records").innerHTML = `<p class="error">The evidence packet could not be loaded: ${escapeHtml(error.message)}</p>`;
});
