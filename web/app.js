const fixtureUrl = "../api/packet";
const state = { packet: null, role: "all", theme: "all", company: "all", industry: "all", timelineType: "all", timelineQuery: "", timelineEvents: [], timelineImpact: { summary: {}, chains: [] }, insightInspections: new Map(), workspaceId: "demo-research", actorId: "demo-researcher", token: sessionStorage.getItem("change-intelligence-token") || "" };

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
}[char]));
const alertActionsMarkup = (alert) => `<div class="review-actions"><button class="acknowledge-alert" data-alert-id="${escapeHtml(alert.id)}" type="button">Acknowledge</button>${alert.kind === "source_availability" ? `<button class="remediation-alert" data-alert-id="${escapeHtml(alert.id)}" data-remediation-state="started" type="button">Mark remediation started</button><button class="remediation-alert" data-alert-id="${escapeHtml(alert.id)}" data-remediation-state="completed" type="button">Mark remediation completed</button>` : ""}<button class="resolve-alert" data-alert-id="${escapeHtml(alert.id)}" data-disposition="useful" type="button">Useful</button><button class="resolve-alert" data-alert-id="${escapeHtml(alert.id)}" data-disposition="false_positive" type="button">False positive</button><button class="resolve-alert" data-alert-id="${escapeHtml(alert.id)}" data-disposition="needs_correction" type="button">Needs correction</button></div>`;

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
  await Promise.all([loadQuestions(), loadAlerts(), loadDecisionOutcomes(), loadWatchlists(), loadComparisonViews()]);
}

async function loadComparisonViews() {
  const [response, preferenceResponse, notificationResponse, deliveryNotificationResponse] = await Promise.all([
    apiFetch(`../api/comparison-views?workspace=${encodeURIComponent(state.workspaceId)}`),
    apiFetch(`../api/notification-preferences?workspace=${encodeURIComponent(state.workspaceId)}`),
    apiFetch(`../api/workspace-notifications?workspace=${encodeURIComponent(state.workspaceId)}`),
    apiFetch(`../api/workspace-delivery-notifications?workspace=${encodeURIComponent(state.workspaceId)}`)
  ]);
  if (!response.ok || !preferenceResponse.ok || !notificationResponse.ok || !deliveryNotificationResponse.ok) throw new Error(`Workspace notifications unavailable (${response.status}/${preferenceResponse.status}/${notificationResponse.status}/${deliveryNotificationResponse.status})`);
  const views = await response.json();
  const preferences = await preferenceResponse.json();
  const notifications = await notificationResponse.json();
  const deliveryNotifications = await deliveryNotificationResponse.json();
  byId("atlas-saved-comparisons").innerHTML = views.length ? `<h3>Saved comparisons</h3>${views.slice().reverse().map((view) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(view.kind)}</span><span>${escapeHtml(view.freshness?.status || "not checked")}</span><span>${escapeHtml(view.createdAt)}</span></div><h3>${escapeHtml(view.name)}</h3><p>${escapeHtml(view.entityLabels.join(" · "))}</p>${view.freshness?.changedSources?.length ? `<p class="error">Refresh changed ${escapeHtml(view.freshness.changedSources.length)} source${view.freshness.changedSources.length === 1 ? "" : "s"}; review this comparison.</p>` : ""}<button class="link-button reopen-comparison" data-comparison-kind="${escapeHtml(view.kind)}" data-comparison-ids="${escapeHtml(view.entityIds.join(","))}" type="button">Reopen comparison</button></article>`).join("")}` : `<p class="muted">No saved comparisons yet.</p>`;
  byId("atlas-comparison-alerts-enabled").checked = preferences.preferences?.comparisonAlerts !== false;
  byId("atlas-delivery-updates-enabled").checked = preferences.preferences?.deliveryUpdates !== false;
  byId("atlas-comparison-alert-history").innerHTML = notifications.alerts.length ? `<h3>Saved-comparison alert history</h3>${notifications.alerts.slice().reverse().map((alert) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(alert.notificationState.replaceAll("_", " "))}</span><span>${escapeHtml(alert.severity)}</span><span>${escapeHtml(alert.createdAt)}</span></div><h3>${escapeHtml(alert.name || "Saved comparison")}</h3><p>${escapeHtml(alert.reason)}</p><p class="muted">${escapeHtml(alert.state)} · ${escapeHtml(alert.kind.replaceAll("_", " "))}</p></article>`).join("")}` : `<p class="muted">No saved-comparison alerts yet. The system will keep this history when a refresh changes the comparison evidence.</p>`;
  document.querySelectorAll(".reopen-comparison").forEach((button) => button.addEventListener("click", () => { const kind = byId("atlas-compare-kind"); const entities = byId("atlas-compare-entities"); kind.value = button.dataset.comparisonKind; kind.dispatchEvent(new Event("change")); const ids = new Set(button.dataset.comparisonIds.split(",")); [...entities.options].forEach((option) => { option.selected = ids.has(option.value); }); compareAtlasEntities(kind.value, [...ids]); }));
  byId("atlas-notification-preferences-form").onsubmit = async (event) => { event.preventDefault(); const status = byId("atlas-notification-preferences-status"); const result = await apiFetch("../api/notification-preferences", { method: "POST", body: { comparisonAlerts: byId("atlas-comparison-alerts-enabled").checked, sourceAlerts: true, deliveryUpdates: byId("atlas-delivery-updates-enabled").checked } }); status.textContent = result.ok ? "Notification preference saved." : `Could not save notification preference (${result.status}).`; if (result.ok) await loadComparisonViews(); };
  byId("atlas-delivery-notification-history").innerHTML = deliveryNotifications.notifications.length ? `<h3>Refresh handoff history</h3>${deliveryNotifications.notifications.slice().reverse().map((notification) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(notification.status.replaceAll("_", " "))}</span><span>${escapeHtml(notification.channel)}</span><span>${escapeHtml(notification.createdAt)}</span></div><h3>${escapeHtml(notification.subject)}</h3><p>${escapeHtml(notification.body)}</p><p class="muted">Delivery ${escapeHtml(notification.deliveryId)} · ${escapeHtml(notification.deliveryStatus || "status not recorded")} · ${escapeHtml(notification.insightPublicationIds?.length || 0)} insight receipt${notification.insightPublicationIds?.length === 1 ? "" : "s"}</p>${notification.unavailableSourceIds?.length ? `<p class="error">Unavailable sources: ${notification.unavailableSourceIds.map(escapeHtml).join("; ")}</p>` : ""}${notification.staleInsightTitles?.length ? `<p class="error">Stale insight evidence: ${notification.staleInsightTitles.map(escapeHtml).join("; ")}</p>` : ""}</article>`).join("")}` : `<p class="muted">No refresh handoff notifications yet.</p>`;
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
  byId("alerts-items").innerHTML = openAlerts.length ? openAlerts.map((alert) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(alert.severity)}</span><span>${escapeHtml(alert.kind.replaceAll("_", " "))}</span></div><h3>${escapeHtml(alert.watchlistName)}</h3><p>${escapeHtml(alert.reason)}</p>${alert.recommendedAction ? `<p class="error"><strong>Recommended next action:</strong> ${escapeHtml(alert.recommendedAction)}</p>` : ""}<details><summary>Open alert source</summary><dl><dt>Repository</dt><dd>${escapeHtml(alert.repository)}</dd><dt>Source</dt><dd><code>${escapeHtml(alert.sourcePath)}</code></dd></dl></details>${alertActionsMarkup(alert)}</article>`).join("") : `<p class="muted">No open watchlist alerts.</p>`;
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
  byId("change-feed-summary").textContent = `${feed.changes.length} sources represented in refresh ${feed.runId || "not yet run"}; ${reviewCount} need review; ${feed.changes.filter((change) => change.status === "deferred").length} deferred by cadence.`;
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
  const scheduler = operations.scheduler || { status: "not_started" };
  const schedulerTiming = scheduler.status === "running" ? "refresh in progress" : scheduler.nextRunAt ? `next run ${scheduler.nextRunAt}` : "next run not scheduled";
  const refreshScope = refresh.scope || { dueRepositories: [], deferredRepositories: [] };
  const sourceAvailability = operations.sourceAvailability || { counts: {} };
  byId("operations-summary").textContent = `Last run ${refresh.runId || "not recorded"} · ${refresh.status} · ${refresh.endedAt || "no completion time"}. Scope: ${refreshScope.dueRepositories.length} due · ${refreshScope.deferredRepositories.length} deferred. Source availability: ${sourceAvailability.counts.unavailable || 0} unavailable. Scheduler: ${scheduler.status} · ${schedulerTiming}.`;
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
    <tr><th scope="row">Published insight receipts used</th><td>${escapeHtml(measures.publishedInsightReceiptsUsed)} across ${escapeHtml(measures.decisionOutcomesWithInsights)} outcomes</td><td>Which recorded decisions were linked to the exact insight receipts in the briefing.</td></tr>
    <tr><th scope="row">Later result</th><td>${escapeHtml(measures.knownDecisionResults)} known · ${escapeHtml(measures.readingsHeld)} held · ${escapeHtml(measures.readingsChanged)} changed · ${escapeHtml(measures.readingsWrong)} wrong</td><td>What users later recorded about the reading.</td></tr>
  </tbody></table><p class="muted">${escapeHtml(pilot.interpretation)}</p>`;
  byId("workspace-update").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">customer handoff</span><span>${escapeHtml(update.freshness.readiness)}</span><span>${escapeHtml(update.freshness.refreshStatus)}</span></div><h3>${escapeHtml(update.headline)}</h3><p>${escapeHtml(update.limitation)}</p><h4>Next actions</h4>${update.actions.length ? `<ul>${update.actions.map((action) => `<li>${escapeHtml(action.label)} (${escapeHtml(action.count)})</li>`).join("")}</ul>` : `<p class="muted">No follow-up action is currently recorded.</p>`}<details><summary>Open current changes</summary>${update.changes.length ? `<ul>${update.changes.map((change) => `<li><strong>${escapeHtml(change.watchlistName)}</strong> — ${escapeHtml(change.reason)}</li>`).join("")}</ul>` : `<p class="muted">No open changes.</p>`}</details></article>`;
  byId("workspace-delivery-health").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">delivery health</span><span>${deliveryHealth.summary.pending} pending</span><span>${deliveryHealth.summary.deadLetters} dead letters</span></div><h3>${deliveryHealth.summary.notifications ? `${Math.round((deliveryHealth.summary.successRate ?? 0) * 100)}% delivered successfully` : "No scoped delivery records yet"}</h3><p>${escapeHtml(deliveryHealth.limitation)}</p><p class="muted">${deliveryHealth.summary.notifications} notifications · ${deliveryHealth.summary.attempts} attempts · ${deliveryHealth.summary.retries} retries · average latency ${deliveryHealth.summary.averageLatencyMs === null ? "not measured" : `${Math.round(deliveryHealth.summary.averageLatencyMs / 1000)} seconds`}.</p></article>`;
  byId("workspace-service-report").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">service level</span><span>${escapeHtml(serviceReport.status)}</span><span>${serviceReport.serviceLevel.overdue ? "cadence overdue" : "cadence current"}</span></div><h3>${serviceReport.status === "on_track" ? "Pilot delivery is on track" : serviceReport.status === "attention" ? "Pilot delivery needs attention" : serviceReport.status === "not_configured" ? "Pilot service is not configured" : "Pilot is awaiting its first delivery"}</h3><p>${escapeHtml(serviceReport.limitation)}</p><p class="muted">Cadence: ${escapeHtml(serviceReport.serviceLevel.cadence || "not configured")} · next expected: ${escapeHtml(serviceReport.serviceLevel.nextExpectedAt || "not scheduled")} · reviewed deliveries: ${escapeHtml(serviceReport.observations.reviewedDeliveries)}.</p><details><summary>Open success measures</summary>${serviceReport.observations.measures.length ? `<ul>${serviceReport.observations.measures.map((measure) => `<li><strong>${escapeHtml(measure.name)}</strong> — ${escapeHtml(measure.observations)} observations; latest ${escapeHtml(measure.latestState || "not assessed")}</li>`).join("")}</ul>` : `<p class="muted">No success measures configured.</p>`}</details></article>`;
  byId("workspace-commercial-readiness").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">commercial checkpoint</span><span>recommend: ${escapeHtml(commercialReadiness.recommendation)}</span><span>human decision required</span></div><h3>What the recorded pilot evidence supports next</h3><p>${escapeHtml(commercialReadiness.rationale)}</p><p class="muted">${escapeHtml(commercialReadiness.limitation)}</p>${commercialReadiness.history?.length ? `<details><summary>Readiness history</summary><table><thead><tr><th>Observed</th><th>Recommendation</th><th>Service</th><th>Reviewed</th><th>Useful rate</th></tr></thead><tbody>${commercialReadiness.history.map((snapshot) => `<tr><th scope="row">${escapeHtml(snapshot.observedAt)}</th><td>${escapeHtml(snapshot.recommendation)}</td><td>${escapeHtml(snapshot.serviceStatus)}</td><td>${escapeHtml(snapshot.reviewedDeliveries)}</td><td>${snapshot.usefulnessRate === null ? "not measured" : `${Math.round(snapshot.usefulnessRate * 100)}%`}</td></tr>`).join("")}</tbody></table></details>` : `<p class="muted">No previous readiness snapshots are recorded yet.</p>`}</article>`;
  const profile = pilotProfile.profile;
  byId("pilot-profile").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">pilot setup</span><span>${profile ? escapeHtml(profile.status) : "not configured"}</span></div><h3>${profile ? "What this pilot is meant to help decide" : "Set up this design-partner pilot"}</h3><p>${profile ? escapeHtml(profile.decisionQuestion) : "Record the decision, delivery rhythm, and measures that will determine whether this workspace is useful."}</p>${profile ? `<p class="muted">${escapeHtml(profile.cadence)} updates · review ${escapeHtml(profile.nextReviewAt || "not scheduled")} · measures: ${profile.successMeasures.map(escapeHtml).join("; ")}</p>` : ""}<form id="pilot-profile-form"><label>Decision question <input id="pilot-decision-question" required minlength="8" maxlength="500" value="${escapeHtml(profile?.decisionQuestion || "")}"></label><label>Context <textarea id="pilot-decision-context" maxlength="2000">${escapeHtml(profile?.decisionContext || "")}</textarea></label><label>Update rhythm <select id="pilot-cadence"><option value="weekly" ${profile?.cadence === "weekly" ? "selected" : ""}>Weekly</option><option value="monthly" ${!profile || profile.cadence === "monthly" ? "selected" : ""}>Monthly</option><option value="quarterly" ${profile?.cadence === "quarterly" ? "selected" : ""}>Quarterly</option></select></label><label>Success measures <textarea id="pilot-success-measures" required placeholder="One measure per line">${escapeHtml(profile?.successMeasures?.join("\n") || "")}</textarea></label><label>Next review date <input id="pilot-next-review" type="date" value="${escapeHtml(profile?.nextReviewAt?.slice(0, 10) || "")}"></label><button type="submit">Save pilot setup</button><span id="pilot-profile-status" class="muted" role="status"></span></form></article>`;
  const latestDelivery = deliveries.deliveries?.[0];
  const deliveryInsightMarkup = latestDelivery?.insightProvenance?.length ? `<details><summary>Open insight provenance (${latestDelivery.insightProvenance.length})</summary><div class="provenance-list">${latestDelivery.insightProvenance.map((insight) => `<article class="provenance-item"><div class="record-meta"><span class="role">${escapeHtml(insight.state)}</span><span>${escapeHtml(insight.briefingTitle || insight.briefingId)}</span><span>receipt ${escapeHtml(insight.publicationId)}</span></div><h5>${escapeHtml(insight.title)}</h5><p>${escapeHtml(insight.plainLanguageSummary)}</p><p>Source records: ${(insight.sourceRecordIds || []).map((recordId) => `<button class="link-button inspect-record" data-record-id="${escapeHtml(recordId)}" type="button">${escapeHtml(recordId)}</button>`).join(" ") || "none"}</p>${insight.staleReason ? `<p class="error">${escapeHtml(insight.staleReason)}</p><h5>What to do</h5><ul>${(insight.customerActions || []).map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</div></details>` : "";
  const assessmentFields = latestDelivery ? (latestDelivery.successMeasures ?? []).map((measure, index) => `<label>${escapeHtml(measure)} <select class="pilot-measure-assessment" data-measure-index="${index}"><option value="unknown">Not assessed</option><option value="met">Met</option><option value="partially_met">Partly met</option><option value="not_met">Not met</option></select></label>`).join("") : "";
  const deliveryReview = latestDelivery?.review ? `<p>Reviewed: ${escapeHtml(latestDelivery.review.usefulness)} · ${escapeHtml(latestDelivery.review.decisionImpact)} · correction: ${escapeHtml(latestDelivery.review.correctionType || "none")}</p>${latestDelivery.review.correctionType && latestDelivery.review.correctionType !== "none" ? `<p class="error">Correction recorded: ${escapeHtml(latestDelivery.review.correctionNote || "follow-up needed")}</p>` : ""}` : latestDelivery ? `<form id="pilot-delivery-review-form"><label>Was this delivery useful? <select id="pilot-delivery-usefulness"><option value="useful">Useful</option><option value="unclear">Unclear</option><option value="not_useful">Not useful</option></select></label><label>Decision impact <select id="pilot-delivery-impact"><option value="changed_decision">Changed a decision</option><option value="informed_decision">Informed a decision</option><option value="no_change">No change</option><option value="not_applicable">Not applicable</option></select></label><label>Was anything wrong or missing? <select id="pilot-delivery-correction"><option value="none">No correction</option><option value="inaccurate">Part of the reading was inaccurate</option><option value="missing_context">Important context was missing</option><option value="unclear">The explanation was unclear</option><option value="wrong_scope">The reading covered the wrong scope</option></select></label><label>Correction note <textarea id="pilot-delivery-correction-note" placeholder="What should the research team check or change?"></textarea></label>${assessmentFields}<label>Review note <textarea id="pilot-delivery-note" required placeholder="What did this delivery change or fail to change?"></textarea></label><button type="submit">Record delivery review</button><span id="pilot-delivery-status" class="muted" role="status"></span></form>` : "";
  const deliveryImpactMarkup = latestDelivery?.impact ? `<details open><summary>Why this delivery is ${escapeHtml(latestDelivery.status.replaceAll("_", " "))}</summary><p>${latestDelivery.impact.state === "held_for_source_availability" ? "This handoff is held because a source needed for the workspace is unavailable." : latestDelivery.impact.state === "source_availability_recovered" ? "A previously unavailable source has recovered; this handoff uses the next available refresh." : "No open source availability issue is recorded for this handoff."}</p>${latestDelivery.impact.unavailableSources?.length ? `<ul>${latestDelivery.impact.unavailableSources.map((source) => `<li><strong>${escapeHtml(source.sourceId)}</strong> — ${escapeHtml(source.reason)}<br><span class="muted">Next action: ${escapeHtml(source.recommendedAction)}</span></li>`).join("")}</ul>` : ""}${latestDelivery.impact.recoveredSources?.length ? `<p class="muted">Recovered: ${latestDelivery.impact.recoveredSources.map((source) => escapeHtml(source.sourceId)).join(", ")}.</p>` : ""}</details>` : "";
  byId("pilot-delivery").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">recurring delivery</span><span>${latestDelivery ? escapeHtml(latestDelivery.status) : "waiting"}</span></div><h3>${latestDelivery ? escapeHtml(latestDelivery.headline) : "The first delivery will appear after a refresh"}</h3><p>${latestDelivery ? `${escapeHtml(latestDelivery.cadence)} cycle · refresh ${escapeHtml(latestDelivery.refreshRunId)} · generated ${escapeHtml(latestDelivery.generatedAt)}` : "Once the pilot is configured, each completed refresh prepares a reviewable workspace handoff."}</p>${latestDelivery ? `<p class="muted">${escapeHtml(latestDelivery.evaluation.reason)}</p>${latestDelivery.insightActions?.length ? `<details open><summary>Customer actions required</summary><ul>${latestDelivery.insightActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ul></details>` : ""}${deliveryImpactMarkup}${deliveryInsightMarkup}${deliveryReview}` : ""}</article>`;
  const deliveryReviewForm = byId("pilot-delivery-review-form");
  if (deliveryReviewForm) deliveryReviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = byId("pilot-delivery-status");
    status.textContent = "Saving…";
    const measureAssessments = [...document.querySelectorAll(".pilot-measure-assessment")].map((select) => ({ name: latestDelivery.successMeasures[Number(select.dataset.measureIndex)], state: select.value }));
    const result = await apiFetch(`../api/pilot-deliveries/${encodeURIComponent(latestDelivery.id)}/review`, { method: "POST", body: { deliveryId: latestDelivery.id, usefulness: byId("pilot-delivery-usefulness").value, decisionImpact: byId("pilot-delivery-impact").value, correctionType: byId("pilot-delivery-correction").value, correctionNote: byId("pilot-delivery-correction-note").value, measureAssessments, note: byId("pilot-delivery-note").value } });
    status.textContent = result.ok ? "Delivery review saved." : "Could not save delivery review.";
    if (result.ok) await loadOperations();
  });
  const usefulnessRate = report.usefulness.rate === null ? "not enough observations" : `${Math.round(report.usefulness.rate * 100)}% useful`;
  const latestDecision = report.latestDecision;
  const insightFeedback = report.insightFeedback ?? { outcomesWithInsights: 0, receiptsReferenced: 0, publishedReceiptsReferenced: 0, byReceipt: [] };
  byId("pilot-report").innerHTML = `<article class="record-card"><div class="record-meta"><span class="role">pilot learning</span><span>${escapeHtml(report.observation.reviewedDeliveries)} reviewed</span><span>${escapeHtml(usefulnessRate)}</span></div><h3>What this partner has learned so far</h3><p>${escapeHtml(report.limitation)}</p><p>${escapeHtml(report.checkpoint.explanation)}</p><p>Decision impact: ${escapeHtml(report.decisionImpact.changedDecision)} changed · ${escapeHtml(report.decisionImpact.informedDecision)} informed · ${escapeHtml(report.decisionImpact.noChange)} unchanged.</p><h4>Insight receipts in decision feedback</h4><p>${escapeHtml(insightFeedback.publishedReceiptsReferenced)} published receipt${insightFeedback.publishedReceiptsReferenced === 1 ? "" : "s"} linked to ${escapeHtml(insightFeedback.outcomesWithInsights)} outcome${insightFeedback.outcomesWithInsights === 1 ? "" : "s"}. This records use; it does not prove that an insight caused a decision.</p>${insightFeedback.byReceipt.length ? `<ul>${insightFeedback.byReceipt.map((insight) => `<li><strong>${escapeHtml(insight.title)}</strong> — receipt ${escapeHtml(insight.publicationId || "not recorded")}; ${escapeHtml(insight.usedInDecision)} used decision${insight.usedInDecision === 1 ? "" : "s"}</li>`).join("")}</ul>` : `<p class="muted">No decision outcome is linked to an insight receipt yet.</p>`}<h4>Open issues</h4>${report.openIssues.length ? `<ul>${report.openIssues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>` : `<p class="muted">No unresolved issue is recorded.</p>`}<details><summary>Open measure observations</summary>${report.measures.length ? `<ul>${report.measures.map((measure) => `<li><strong>${escapeHtml(measure.name)}</strong> — ${escapeHtml(measure.observations)} observations; latest: ${escapeHtml(measure.latestState || "not assessed")}</li>`).join("")}</ul>` : `<p class="muted">No success measures configured.</p>`}</details>${latestDecision ? `<p><strong>Latest checkpoint:</strong> ${escapeHtml(latestDecision.decision)} — ${escapeHtml(latestDecision.nextStep)}</p>` : `<form id="pilot-decision-form"><h4>Record a pilot checkpoint</h4><label>Decision <select id="pilot-decision"><option value="improve">Improve</option><option value="continue">Continue</option><option value="expand">Expand</option><option value="stop">Stop</option></select></label><label>Why <textarea id="pilot-decision-note" required placeholder="What does the evidence support?"></textarea></label><label>Next step <textarea id="pilot-decision-next-step" required placeholder="What will happen next?"></textarea></label><button type="submit">Save checkpoint</button><span id="pilot-decision-status" class="muted" role="status"></span></form>`}</article>`;
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

async function loadOperatorOverview() {
  const response = await apiFetch("../api/operator/pilot-overview");
  if (!response.ok) {
    byId("operator-panel").hidden = true;
    return;
  }
  const overview = await response.json();
  const remediation = overview.remediation || { summary: {}, queue: [], slaMs: 0 };
  const summary = remediation.summary;
  byId("operator-panel").hidden = false;
  byId("operator-summary").textContent = `${summary.open || 0} open source issue${summary.open === 1 ? "" : "s"} · ${summary.overdue || 0} overdue · ${summary.heldDeliveries || 0} held customer deliver${summary.heldDeliveries === 1 ? "y" : "ies"}. SLA: ${Math.round((remediation.slaMs || 0) / 3600000)} hours.`;
  byId("operator-remediation-cards").innerHTML = [["Open", summary.open || 0], ["Started", summary.started || 0], ["Completed", summary.completed || 0], ["Overdue", summary.overdue || 0], ["Held deliveries", summary.heldDeliveries || 0]].map(([label, value]) => `<div class="operation-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  byId("operator-remediation-queue").innerHTML = remediation.queue?.length ? remediation.queue.map((item) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(item.remediationState.replaceAll("_", " "))}</span><span>${item.overdue ? "overdue" : "within SLA"}</span><span>${escapeHtml(item.severity)}</span></div><h3>${escapeHtml(item.repository)} · ${escapeHtml(item.sourcePath)}</h3><p>${escapeHtml(item.reason)}</p><p class="muted">Workspace ${escapeHtml(item.workspaceId)} · ${item.heldDeliveries} held deliver${item.heldDeliveries === 1 ? "y" : "ies"} · due ${escapeHtml(item.dueAt || "not recorded")}</p><p class="muted">Last remediation update: ${escapeHtml(item.remediationAt || "not started")}${item.remediationBy ? ` by ${escapeHtml(item.remediationBy)}` : ""}.</p></article>`).join("") : `<p class="muted">No open source-recovery work.</p>`;
}

async function loadDecisionOutcomes() {
  const response = await apiFetch(`../api/decision-outcomes?workspace=${encodeURIComponent(state.workspaceId)}`);
  if (!response.ok) throw new Error(`Decision feedback unavailable (${response.status})`);
  const outcomes = await response.json();
  const used = outcomes.filter((outcome) => outcome.decisionState === "used").length;
  const known = outcomes.filter((outcome) => ["held", "changed", "wrong"].includes(outcome.outcomeState)).length;
  const linkedReceipts = outcomes.reduce((total, outcome) => total + (outcome.insightProvenance?.length ?? 0), 0);
  byId("decision-feedback-summary").textContent = `${outcomes.length} feedback record${outcomes.length === 1 ? "" : "s"} · ${used} briefing${used === 1 ? "" : "s"} used in a decision · ${known} later result${known === 1 ? "" : "s"} known · ${linkedReceipts} insight receipt${linkedReceipts === 1 ? "" : "s"} linked. This is workspace experience, not a general causal estimate.`;
  byId("decision-feedback-items").innerHTML = outcomes.length ? outcomes.slice().reverse().map((outcome) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(outcome.decisionState.replaceAll("_", " "))}</span><span>${escapeHtml(outcome.outcomeState)}</span><span>${escapeHtml(outcome.recordedAt)}</span></div><h3>Briefing ${escapeHtml(outcome.briefingId)}</h3><p>${escapeHtml(outcome.decisionSummary || "No decision note recorded.")}</p>${outcome.insightProvenance?.length ? `<details><summary>Insight receipts used (${outcome.insightProvenance.length})</summary><ul>${outcome.insightProvenance.map((insight) => `<li><strong>${escapeHtml(insight.title || "Untitled insight")}</strong> — ${escapeHtml(insight.publicationId || "receipt not recorded")} (${escapeHtml(insight.state || "unknown")})</li>`).join("")}</ul></details>` : ""}${outcome.outcomeNote ? `<p class="muted">Later: ${escapeHtml(outcome.outcomeNote)}</p>` : ""}</article>`).join("") : `<p class="muted">No decision feedback recorded yet. Publish a briefing, use it in a real decision, and record what happened.</p>`;
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
  byId("atlas-entities").innerHTML = groups.map(([key, label]) => `<div class="operation-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(atlas.entities[key]?.length ?? 0)}</strong><div>${(atlas.entities[key] ?? []).slice(0, 8).map((entity) => `<button class="link-button atlas-entity" data-atlas-kind="${escapeHtml(key)}" data-atlas-id="${escapeHtml(entity.id)}" type="button">${escapeHtml(entity.label)}</button>`).join(" ")}</div></div>`).join("");
  const links = (atlas.edges ?? []).slice(0, 12);
  byId("atlas-links").innerHTML = links.length ? `<p class="muted">Examples of normalized links</p><ul>${links.map((edge) => `<li><code>${escapeHtml(edge.from)}</code> → <code>${escapeHtml(edge.to)}</code> · ${escapeHtml(edge.relation.replaceAll("_", " "))}</li>`).join("")}</ul>` : `<p class="muted">No normalized links are available yet.</p>`;
  document.querySelectorAll(".atlas-entity").forEach((button) => button.addEventListener("click", () => inspectAtlasEntity(button.dataset.atlasKind, button.dataset.atlasId)));
  const compareKind = byId("atlas-compare-kind");
  const compareEntities = byId("atlas-compare-entities");
  const populateCompareEntities = () => { const entities = atlas.entities[compareKind.value] ?? []; compareEntities.innerHTML = entities.map((entity) => `<option value="${escapeHtml(entity.id)}">${escapeHtml(entity.label)}</option>`).join(""); entities.slice(0, 2).forEach((entity) => { const option = [...compareEntities.options].find((candidate) => candidate.value === entity.id); if (option) option.selected = true; }); };
  populateCompareEntities();
  compareKind.onchange = populateCompareEntities;
  byId("atlas-compare-form").onsubmit = async (event) => { event.preventDefault(); const ids = [...compareEntities.selectedOptions].map((option) => option.value); if (ids.length < 2) { byId("atlas-compare-status").textContent = "Choose at least two entities."; return; } await compareAtlasEntities(compareKind.value, ids); };
  byId("atlas-save-comparison-form").onsubmit = async (event) => { event.preventDefault(); const ids = [...compareEntities.selectedOptions].map((option) => option.value); const status = byId("atlas-save-comparison-status"); if (ids.length < 2) { status.textContent = "Choose at least two entities before saving."; return; } const response = await apiFetch("../api/comparison-views", { method: "POST", body: { name: byId("atlas-comparison-name").value, kind: compareKind.value, entityIds: ids } }); status.textContent = response.ok ? "Comparison saved to this workspace." : `Could not save comparison (${response.status}).`; if (response.ok) { byId("atlas-comparison-name").value = ""; await loadComparisonViews(); } };
}

async function compareAtlasEntities(kind, ids) {
  const status = byId("atlas-compare-status");
  status.textContent = "Comparing only compatible columns…";
  const response = await apiFetch(`../api/atlas/compare?kind=${encodeURIComponent(kind)}&ids=${ids.map(encodeURIComponent).join(",")}`);
  if (!response.ok) { status.textContent = `Comparison unavailable (${response.status}).`; return; }
  const body = await response.json();
  status.textContent = `${body.comparable ? "All selected entities share the displayed columns." : "No ranking was produced because selected entities have incompatible or incomplete columns."} Refresh: ${body.freshness?.status || "not checked"}.`;
  const rows = body.comparisons.flatMap((comparison) => comparison.quarters.map((quarter) => `<tr><th scope="row">${escapeHtml(comparison.label)}</th><td>${escapeHtml(quarter.period)}</td>${body.compatibleColumns.map((column) => { const index = comparison.columns.indexOf(column); return `<td>${escapeHtml(index >= 0 ? quarter.values[index] ?? "not recorded" : "not comparable")}</td>`; }).join("")}</tr>`)).join("");
  byId("atlas-compare-results").innerHTML = body.compatibleColumns.length ? `<table><caption>Comparable reported measures · no ranking implied</caption><thead><tr><th>Entity</th><th>Period</th>${body.compatibleColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>${body.incompatibilities.length ? `<p class="error">Compatibility warnings: ${body.incompatibilities.map((item) => `${escapeHtml(item.entity)} — ${escapeHtml(item.reason)}`).join("; ")}</p>` : ""}<p class="muted">${escapeHtml(body.limitation)}</p>` : `<p class="error">No shared columns are safe to compare. ${escapeHtml(body.limitation)}</p>`;
}

async function inspectAtlasEntity(kind, id) {
  const detail = byId("atlas-detail");
  detail.hidden = false;
  detail.innerHTML = `<p class="muted">Loading entity…</p>`;
  const response = await apiFetch(`../api/atlas/entity?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`);
  if (!response.ok) { detail.innerHTML = `<p class="error">Entity detail unavailable (${response.status}).</p>`; return; }
  const body = await response.json();
  const reportedRows = body.timeline.reportedMovement.map((event) => `<tr><th scope="row">${escapeHtml(event.period)}</th><td>${escapeHtml(event.type.replaceAll("_", " "))}</td><td>${escapeHtml(event.sourceRole.replaceAll("_", " "))}</td><td>${escapeHtml(event.values.join(" · ") || event.reading || "Recorded movement")}</td></tr>`).join("");
  const outcomeCards = body.timeline.outcomeEvidence.map((record) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(record.sourceRole.replaceAll("_", " "))}</span><span>${escapeHtml(record.claimState)}</span><span>${escapeHtml(record.asOf)}</span></div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml(record.observation)}</p><p class="muted">Limits: ${escapeHtml((record.limits || []).join(" "))}</p></article>`).join("");
  const comparisonMarkup = body.timeline.comparisons.map((comparison) => `<section class="record-card"><h3>${escapeHtml(comparison.title)}</h3><p class="muted">${escapeHtml(comparison.annualBaseline || "Annual baseline not recorded")} · ${escapeHtml(comparison.reading || "Reported movement; downstream outcome remains open.")}</p><div class="table-wrap"><table><caption>Comparable reported periods</caption><thead><tr><th>Period</th>${comparison.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${comparison.quarters.map((quarter) => `<tr><th scope="row">${escapeHtml(quarter.period)}</th>${quarter.values.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="muted">Derived movement: ${escapeHtml(Object.entries(comparison.metrics).map(([key, value]) => `${key}=${value ?? "not measured"}`).join(" · ") || "not measured")}</p><button class="secondary-button atlas-source-inspect" data-record-id="${escapeHtml(comparison.recordId)}" type="button">Inspect source record</button></section>`).join("");
  detail.innerHTML = `<div class="section-heading"><p class="eyebrow">${escapeHtml(kind.replaceAll(/([A-Z])/g, " $1"))}</p><h2>${escapeHtml(body.entity.label)}</h2><p class="muted">${escapeHtml(body.entity.evidenceCount)} linked evidence record${body.entity.evidenceCount === 1 ? "" : "s"}. ${escapeHtml(body.limitation)}</p></div>${comparisonMarkup ? `<section aria-labelledby="comparison-title"><h3 id="comparison-title">Annual structure and quarterly movement</h3><p class="muted">These are comparable reported measures. They describe issuer movement, not customer, worker, or public outcomes.</p>${comparisonMarkup}</section>` : ""}<section aria-labelledby="reported-movement-title"><h3 id="reported-movement-title">Reported movement</h3><p class="muted">Issuer, industry, or private-company records are shown as reported movement, not as outcome proof.</p>${reportedRows ? `<div class="table-wrap"><table><thead><tr><th>Period</th><th>Type</th><th>Source role</th><th>Reading or values</th></tr></thead><tbody>${reportedRows}</tbody></table></div>` : `<p class="muted">No period-based reported movement is available.</p>`}</section><section aria-labelledby="outcome-evidence-title"><h3 id="outcome-evidence-title">Independent and outcome-related evidence</h3><p class="muted">These records test the broader condition around the entity; they do not automatically measure the entity's own result.</p><div class="record-list">${outcomeCards || `<p class="muted">No independent evidence is linked to this entity's theme yet.</p>`}</div></section>${body.timeline.nextTests.length ? `<section><h3>Next tests</h3><ul>${body.timeline.nextTests.map((test) => `<li>${escapeHtml(test.nextTest)} <span class="muted">(${escapeHtml(test.title)})</span></li>`).join("")}</ul></section>` : ""}<section><h3>Evidence records</h3><div class="record-list">${body.evidence.map((record) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(record.sourceRole.replaceAll("_", " "))}</span><span>${escapeHtml(record.claimState)}</span><span>${escapeHtml(record.asOf)}</span></div><h3>${escapeHtml(record.title)}</h3><p>${escapeHtml(record.observation)}</p><p class="muted">${escapeHtml(record.sourceRepository)} · <code>${escapeHtml(record.sourceRef)}</code>${record.reportingPeriod ? ` · ${escapeHtml(record.reportingPeriod)}` : ""}</p><button class="secondary-button atlas-source-inspect" data-record-id="${escapeHtml(record.id)}" type="button">Inspect source record</button></article>`).join("")}</div></section>${body.related.length ? `<h3>Related entities</h3><p>${body.related.map((related) => `<span class="limit">${escapeHtml(related.label)} · ${escapeHtml(related.evidenceCount)} records</span>`).join(" ")}</p>` : ""}`;
  document.querySelectorAll(".atlas-source-inspect").forEach((button) => button.addEventListener("click", () => inspectEvidence(button.dataset.recordId).catch((error) => showInspector("Inspection unavailable", error.message, ""))));
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadEvidenceHistory() {
  const workspace = encodeURIComponent(state.workspaceId);
  const [response, timelineResponse] = await Promise.all([apiFetch(`../api/evidence-history?workspace=${workspace}`), apiFetch(`../api/timeline?workspace=${workspace}`)]);
  if (!response.ok || !timelineResponse.ok) throw new Error(`Evidence history unavailable (${response.status})`);
  const history = await response.json();
  const timeline = await timelineResponse.json();
  state.timelineEvents = (timeline.events ?? []).slice().reverse();
  state.timelineImpact = { summary: timeline.impactSummary ?? {}, chains: timeline.impactChains ?? [] };
  const types = [...new Set(state.timelineEvents.map((event) => event.eventType))].sort();
  byId("timeline-type-filter").innerHTML = `<option value="all">All events</option>${types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type.replaceAll("_", " "))}</option>`).join("")}`;
  byId("timeline-type-filter").value = state.timelineType;
  byId("evidence-history-summary").textContent = `${history.activeResearchRecordCount} active reviewed record${history.activeResearchRecordCount === 1 ? "" : "s"} · ${history.decisionCount} decision${history.decisionCount === 1 ? "" : "s"} · ${timeline.eventCount} timeline event${timeline.eventCount === 1 ? "" : "s"}. Impact: ${timeline.impactSummary?.activeOutages ?? 0} active outage${timeline.impactSummary?.activeOutages === 1 ? "" : "s"}, ${timeline.impactSummary?.heldDeliveries ?? 0} held delivery${timeline.impactSummary?.heldDeliveries === 1 ? "" : "s"}, ${timeline.impactSummary?.releasedDeliveries ?? 0} released after recovery.`;
  renderTimeline();
}

function renderTimeline() {
  const query = state.timelineQuery.toLowerCase();
  const events = state.timelineEvents.filter((event) => (state.timelineType === "all" || event.eventType === state.timelineType) && (!query || [event.sourceId, event.targetId, event.candidateKey, event.workspaceId].some((value) => String(value ?? "").toLowerCase().includes(query))));
  const chainMarkup = state.timelineImpact.chains.filter((chain) => !query || chain.sourceId.toLowerCase().includes(query)).slice(0, 8).map((chain) => `<article class="record-card"><div class="record-meta"><span class="role">impact chain</span><span>${escapeHtml(chain.state)}</span><span>${escapeHtml(chain.sourceId)}</span></div><h3>${chain.state === "active" ? "Source outage is still active" : "Source outage recovered"}</h3><p>${escapeHtml(chain.affectedWorkspaces.length)} workspace${chain.affectedWorkspaces.length === 1 ? "" : "s"} affected · ${escapeHtml(chain.heldDeliveryIds.length)} delivery${chain.heldDeliveryIds.length === 1 ? "" : "ies"} held · ${escapeHtml(chain.releasedDeliveryIds.length)} released after recovery.</p><p class="muted">Outage ${escapeHtml(chain.outageAt)}${chain.recoveredAt ? ` · recovered ${escapeHtml(chain.recoveredAt)}` : ""}</p></article>`).join("");
  const eventMarkup = events.length ? events.slice(0, 20).map((event) => { const inspectKind = event.eventType.startsWith("source") ? "source" : event.eventType.startsWith("insight") ? "insight" : event.eventType.startsWith("briefing") ? "briefing" : ""; const inspectTarget = inspectKind === "insight" ? (event.candidateKey || event.targetId) : event.sourceId || event.targetId; const explanation = event.eventType === "source_availability" ? `Source availability changed from ${event.status.replaceAll("_to_", " to ")}${event.reason ? ` · ${event.reason}` : ""}` : event.eventType === "customer_delivery" ? `Customer delivery ${event.status}${event.unavailableSourceIds?.length ? ` · affected sources: ${event.unavailableSourceIds.join(", ")}` : ""}` : event.outcome || event.status || "Recorded event"; return `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(event.eventType.replaceAll("_", " "))}</span>${event.reviewType ? `<span>${escapeHtml(event.reviewType.replaceAll("_", " "))}</span>` : ""}${event.status ? `<span>${escapeHtml(event.status)}</span>` : ""}<span>${escapeHtml(event.occurredAt)}</span></div><h3>${escapeHtml(event.sourceId || event.targetId)}</h3><p>${escapeHtml(explanation)}${event.reviewer ? ` · by ${escapeHtml(event.reviewer)}` : ""}${event.previousEvidenceDigest ? ` · previous evidence ${escapeHtml(event.previousEvidenceDigest.slice(0, 12))}` : ""}</p>${inspectKind ? `<button class="secondary-button timeline-open" data-timeline-kind="${inspectKind}" data-timeline-target="${escapeHtml(inspectTarget)}" type="button">Open affected ${inspectKind}</button>` : ""}<details><summary>Open event identity</summary><dl><dt>Target</dt><dd><code>${escapeHtml(event.targetId)}</code></dd><dt>Current digest</dt><dd><code>${escapeHtml(event.currentEvidenceDigest || event.currentDigest || event.sourceDigest || "not recorded")}</code></dd><dt>Event ID</dt><dd><code>${escapeHtml(event.id || event.publicationId || "source-scan")}</code></dd></dl></article>`; }).join("") : `<p class="muted">No timeline events match these filters.</p>`;
  byId("evidence-history-items").innerHTML = chainMarkup + eventMarkup;
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
  const { insight, evidence, review, reviewHistory, boundaries, freshness, briefingLinks } = inspection;
  const decisions = reviewHistory?.decisions ?? [];
  const publications = reviewHistory?.publications ?? [];
  const events = reviewHistory?.events ?? [];
  const historyItems = [...decisions.map((item) => ({ historyType: "decision", at: item.decidedAt, by: item.reviewer, text: `${item.decision} · ${item.note || "No note"}` })), ...publications.map((item) => ({ historyType: "publication", at: item.publishedAt, by: item.publisher, text: `published · ${item.note || "No note"}` })), ...events.map((item) => ({ historyType: item.eventType?.replaceAll("_", " ") || "review event", at: item.occurredAt, by: item.reviewer, text: `${item.outcome || "recorded"}${item.previousEvidenceDigest ? ` · previous evidence ${item.previousEvidenceDigest.slice(0, 12)}` : ""}` }))].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const freshnessMessage = freshness?.state === "stale" ? `${freshness.evidenceChanged ? "Source evidence changed" : "Insight wording changed"}. Re-review is required before treating this as current.` : freshness?.state === "published" ? "Current published version matches the recorded evidence." : "This insight has not completed publication.";
  showInspector(insight.title, `${review?.status?.replaceAll("_", " ") || "not yet reviewed"} · refresh by ${insight.refreshBy || "not scheduled"}`, `
    <article class="inspection-card">
      <p>${escapeHtml(insight.plainLanguageSummary)}</p>
      ${insight.origin ? `<p class="muted">Origin: discovered opportunity${insight.promotionId ? ` · promotion ${escapeHtml(insight.promotionId)}` : ""}.</p>` : ""}
      <h3>Currentness</h3><p class="${freshness?.state === "stale" ? "error" : ""}">${escapeHtml(freshnessMessage)}</p><dl class="inspection-details"><dt>Current evidence</dt><dd><code>${escapeHtml(freshness?.currentEvidenceDigest || "not recorded")}</code></dd><dt>Published evidence</dt><dd><code>${escapeHtml(freshness?.publishedEvidenceDigest || "not recorded")}</code></dd>${freshness?.currentClaimDigest ? `<dt>Current claim version</dt><dd><code>${escapeHtml(freshness.currentClaimDigest)}</code></dd>` : ""}</dl>
      <h3>Evidence chain</h3>
      <div class="chain-list">${evidence.map((record) => `<button class="chain-item inspect-record" data-record-id="${escapeHtml(record.id)}"><strong>${escapeHtml(record.title)}</strong><span>${escapeHtml(record.sourceRepository)} · ${escapeHtml(record.claimState.replaceAll("_", " "))}</span></button>`).join("")}</div>
      <h3>Strongest alternative</h3><p>${escapeHtml(boundaries.strongestAlternative)}</p>
      <h3>What would change our mind</h3><ul>${boundaries.whatWouldChangeOurMind.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <h3>Next test</h3><p>${escapeHtml(boundaries.nextTest)}</p>
      <h3>Approval history</h3>
      ${historyItems.length ? `<ol class="review-history">${historyItems.map((item) => `<li><strong>${escapeHtml(item.historyType)}</strong> · ${escapeHtml(item.text)}<span>${escapeHtml(item.by || "researcher")} · ${escapeHtml(item.at || "time not recorded")}</span></li>`).join("")}</ol>` : `<p class="muted">No approval, revision, or publication event has been recorded.</p>`}
      <h3>Customer briefings using this insight</h3>${briefingLinks?.length ? `<ul>${briefingLinks.map((briefing) => `<li><strong>${escapeHtml(briefing.state)}</strong> · ${escapeHtml(briefing.title)} · ${escapeHtml(briefing.publication || "not published")}${briefing.staleReason ? ` — ${escapeHtml(briefing.staleReason)}` : ""}</li>`).join("")}</ul>` : `<p class="muted">No customer briefing currently uses this insight.</p>`}
    </article>`);
}

async function inspectBriefing(briefingId) {
  const [response, historyResponse] = await Promise.all([apiFetch(`../api/briefings?workspace=${encodeURIComponent(state.workspaceId)}`), apiFetch(`../api/briefings/${encodeURIComponent(briefingId)}/history?workspace=${encodeURIComponent(state.workspaceId)}`)]);
  if (!response.ok || !historyResponse.ok) throw new Error("Briefing could not be loaded.");
  const briefing = (await response.json()).find((item) => item.id === briefingId);
  const history = await historyResponse.json();
  if (!briefing) throw new Error("Briefing is not available in this workspace.");
  showInspector(briefing.title, `${briefing.state} · ${briefing.publication}`, `<article class="inspection-card"><p>${escapeHtml(briefing.reading)}</p><h3>Evidence boundary</h3><p>${escapeHtml(briefing.boundary)}</p><h3>Next test</h3><p>${escapeHtml(briefing.nextTest)}</p>${briefing.staleReason ? `<p class="error">${escapeHtml(briefing.staleReason)}</p><h3>What to do now</h3><ul>${(briefing.customerActions || []).map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ul>` : ""}<h3>Briefing versions</h3>${history.versions?.length ? `<ol class="review-history">${history.versions.map((version) => `<li><strong>${version.id === history.currentPublicationId ? "current publication" : "previous publication"}</strong> · ${escapeHtml(version.publishedAt)} · ${escapeHtml(version.publishedBy || "researcher")}<span>evidence ${escapeHtml(version.evidenceDigest?.slice(0, 12) || "not recorded")}${version.reReviewedUpdatedEvidence ? " · re-reviewed updated evidence" : ""}</span></li>`).join("")}</ol>` : `<p class="muted">No publication version has been recorded.</p>`}${history.changes?.length ? `<h3>Re-review history</h3><ul>${history.changes.map((change) => `<li>${escapeHtml(change.outcome || "re-reviewed")} · ${escapeHtml(change.occurredAt)} · ${escapeHtml(change.reviewer || "researcher")}</li>`).join("")}</ul>` : ""}<p>Evidence records: ${escapeHtml(briefing.evidence.map((item) => item.recordId).join(", ") || "none")}</p></article>`);
}

function insightDefinition(candidate) {
  return state.packet?.insights?.find((insight) => insight.id === candidate.insightId || insight.id === candidate.candidateKey);
}

function renderInsightReview() {
  const candidates = state.packet?.operations?.insightCandidates?.candidates ?? [];
  const counts = candidates.reduce((result, candidate) => { result[candidate.status] = (result[candidate.status] || 0) + 1; return result; }, {});
  byId("insight-review-summary").textContent = `${candidates.length} bounded insight${candidates.length === 1 ? "" : "s"}; ${counts.needs_researcher_review || 0} awaiting review, ${counts.accepted_for_publication || 0} accepted for publication, ${counts.published || 0} published. Publication requires an explicit human action.`;
  byId("insight-review-items").innerHTML = candidates.length ? candidates.map((candidate) => {
    const insight = insightDefinition(candidate) ?? {};
    const inspection = state.insightInspections.get(candidate.candidateKey);
    const history = inspection?.reviewHistory ?? {};
    const decisions = history.decisions ?? [];
    const publications = history.publications ?? [];
    const evidence = candidate.evidence ?? [];
    const action = ["needs_researcher_review", "stale"].includes(candidate.status) ? `<div class="review-actions"><button class="insight-decision" data-candidate-id="${escapeHtml(candidate.id)}" data-decision="accept" type="button">Accept for publication review</button><button class="insight-decision" data-candidate-id="${escapeHtml(candidate.id)}" data-decision="defer" type="button">Defer</button><button class="insight-decision" data-candidate-id="${escapeHtml(candidate.id)}" data-decision="correct" type="button">Needs correction</button></div>` : candidate.status === "accepted_for_publication" ? `<div class="publication-box"><label><input class="publication-confirm" type="checkbox"> I inspected the linked evidence, alternative explanation, limits, and falsifiers.</label><textarea class="publication-note" maxlength="2000" placeholder="Publication note (optional)"></textarea><button class="publish-insight-candidate" data-candidate-id="${escapeHtml(candidate.id)}" type="button" disabled>Publish this bounded insight</button></div>` : candidate.status === "published" ? `<p class="success">Published by ${escapeHtml(candidate.publishedBy || "researcher")} on ${escapeHtml(candidate.publishedAt || "time not recorded")}.</p>` : `<p class="muted">Decision recorded by ${escapeHtml(candidate.decidedBy || "researcher")}. ${escapeHtml(candidate.decisionNote || "")}</p>`;
    const reviseAction = candidate.origin === "discovered_opportunity" ? `<button class="revise-promoted-insight" data-promotion-id="${escapeHtml(candidate.promotionId || "")}" data-candidate-id="${escapeHtml(candidate.id)}" type="button">Revise promoted draft</button>` : "";
    const historyItems = [...decisions.map((item) => ({ kind: "decision", at: item.decidedAt, by: item.reviewer, text: `${item.decision} · ${item.note || "No note"}` })), ...publications.map((item) => ({ kind: "publication", at: item.publishedAt, by: item.publisher, text: `published · ${item.note || "No note"}` }))].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return `<article class="record-card insight-review-card"><div class="record-meta"><span class="role">${escapeHtml(candidate.status.replaceAll("_", " "))}</span><span>${escapeHtml(candidate.publication.replaceAll("_", " "))}</span><span>evidence ${escapeHtml(candidate.evidenceDigest.slice(0, 12))}</span></div><h3>${escapeHtml(candidate.title || insight.title || candidate.candidateKey)}</h3><p>${escapeHtml(candidate.plainLanguageSummary || insight.plainLanguageSummary || "No summary recorded.")}</p>${candidate.staleReason ? `<p class="error">${escapeHtml(candidate.staleReason)}</p>` : ""}<div class="insight-review-grid"><div><h4>Evidence used</h4><div class="chain-list">${evidence.map((item) => `<button class="chain-item inspect-record" data-record-id="${escapeHtml(item.recordId)}" type="button"><strong>${escapeHtml(item.recordId)}</strong><span>${escapeHtml(item.sourceRepository)} · ${escapeHtml(item.sourceRole)}</span></button>`).join("")}</div></div><div><h4>Limits and tests</h4><p><strong>Strongest alternative:</strong> ${escapeHtml(candidate.strongestAlternative || insight.strongestAlternative || "Not recorded.")}</p><p><strong>Next test:</strong> ${escapeHtml(candidate.nextTest || insight.nextTest || "Not recorded.")}</p><ul>${(candidate.whatWouldChangeOurMind || insight.whatWouldChangeOurMind || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></div><details><summary>Approval history (${historyItems.length})</summary>${historyItems.length ? `<ol class="review-history">${historyItems.map((item) => `<li><strong>${escapeHtml(item.kind)}</strong> · ${escapeHtml(item.text)}<span>${escapeHtml(item.by || "researcher")} · ${escapeHtml(item.at || "time not recorded")}</span></li>`).join("")}</ol>` : `<p class="muted">No approval or publication event has been recorded.</p>`}</details>${action}${reviseAction}<p class="insight-action-status muted" role="status"></p></article>`;
  }).join("") : `<p class="muted">No bounded insight candidates are available.</p>`;
  const opportunities = state.packet?.operations?.insightOpportunities?.opportunities ?? [];
  if (opportunities.length) byId("insight-review-items").innerHTML += `<div class="opportunity-queue"><h3>New cross-source opportunities</h3><p class="muted">These are automatically detected patterns. They are not customer insights until a researcher reviews and rewrites them as a bounded claim.</p>${opportunities.map((opportunity) => `<article class="record-card opportunity-card"><div class="record-meta"><span class="role">review-only opportunity</span><span>${escapeHtml(opportunity.concept)}</span><span>${escapeHtml(opportunity.repositories.join(" · "))}</span></div><h3>${escapeHtml(opportunity.title)}</h3><p>${escapeHtml(opportunity.plainLanguageSummary)}</p><details><summary>Open evidence and limits</summary><ul>${opportunity.evidence.map((item) => `<li><strong>${escapeHtml(item.sourceRepository)}</strong> · ${escapeHtml(item.title)} · <code>${escapeHtml(item.recordId)}</code></li>`).join("")}</ul><p><strong>Alternative:</strong> ${escapeHtml(opportunity.strongestAlternative)}</p><p><strong>Next test:</strong> ${escapeHtml(opportunity.nextTest)}</p>${opportunity.limits.map((limit) => `<p class="muted">${escapeHtml(limit)}</p>`).join("")}</details><button class="promote-opportunity" data-opportunity-id="${escapeHtml(opportunity.id)}" type="button">Promote after rewriting</button><p class="opportunity-action-status muted" role="status"></p></article>`).join("")}</div>`;
  document.querySelectorAll(".publication-confirm").forEach((checkbox) => checkbox.addEventListener("change", () => { const box = checkbox.closest(".publication-box"); box.querySelector(".publish-insight-candidate").disabled = !checkbox.checked; }));
  document.querySelectorAll(".insight-decision").forEach((button) => button.addEventListener("click", async () => {
    const decision = button.dataset.decision;
    const note = decision === "correct" ? window.prompt("What needs to be corrected before this insight can proceed?") : decision === "defer" ? window.prompt("Why should publication wait?") : "Reviewed the evidence, alternative explanation, limits, and falsifiers.";
    if (["correct", "defer"].includes(decision) && !note?.trim()) return;
    button.disabled = true;
    const status = button.closest(".insight-review-card").querySelector(".insight-action-status");
    status.textContent = "Saving review decision…";
    const response = await apiFetch(`../api/insight-candidates/${encodeURIComponent(button.dataset.candidateId)}/decision`, { method: "POST", body: { decision, note } });
    if (!response.ok) { status.textContent = `Could not save review decision (${response.status}).`; button.disabled = false; return; }
    await refreshInsightReview();
  }));
  document.querySelectorAll(".publish-insight-candidate").forEach((button) => button.addEventListener("click", async () => {
    const box = button.closest(".publication-box");
    const status = button.closest(".insight-review-card").querySelector(".insight-action-status");
    button.disabled = true;
    status.textContent = "Publishing receipt…";
    const response = await apiFetch(`../api/insight-candidates/${encodeURIComponent(button.dataset.candidateId)}/publish`, { method: "POST", body: { note: box.querySelector(".publication-note").value.trim() } });
    if (!response.ok) { status.textContent = `Could not publish this insight (${response.status}).`; button.disabled = false; return; }
    await refreshInsightReview();
  }));
  document.querySelectorAll(".revise-promoted-insight").forEach((button) => button.addEventListener("click", async () => {
    const card = button.closest(".insight-review-card");
    const status = card.querySelector(".insight-action-status");
    const current = { title: card.querySelector("h3")?.textContent || "", plainLanguageSummary: card.querySelector("p")?.textContent || "" };
    const title = window.prompt("Rewrite the bounded insight title:", current.title);
    const plainLanguageSummary = window.prompt("What does the evidence support, in plain everyday language?", current.plainLanguageSummary);
    const strongestAlternative = window.prompt("What is the strongest alternative explanation?", "");
    const nextTest = window.prompt("What is the next test?", "");
    const falsifier = window.prompt("What evidence would change your mind?", "");
    if (!title?.trim() || !plainLanguageSummary?.trim() || !strongestAlternative?.trim() || !nextTest?.trim() || !falsifier?.trim()) return;
    button.disabled = true;
    status.textContent = "Saving revision; next refresh will require re-review…";
    const response = await apiFetch(`../api/insight-promotions/${encodeURIComponent(button.dataset.promotionId)}/revise`, { method: "POST", body: { title, plainLanguageSummary, strongestAlternative, nextTest, whatWouldChangeOurMind: [falsifier], note: "Revised after researcher review." } });
    status.textContent = response.ok ? "Revision saved. The next refresh will mark the prior candidate for re-review." : `Could not revise this insight (${response.status}).`;
    if (!response.ok) button.disabled = false;
  }));
  document.querySelectorAll(".promote-opportunity").forEach((button) => button.addEventListener("click", async () => {
    const opportunity = opportunities.find((item) => item.id === button.dataset.opportunityId);
    if (!opportunity) return;
    const card = button.closest(".opportunity-card");
    const status = card.querySelector(".opportunity-action-status");
    const title = window.prompt("Rewrite the bounded insight title:", opportunity.title);
    const plainLanguageSummary = window.prompt("What does the evidence support, in plain everyday language?", opportunity.plainLanguageSummary);
    const strongestAlternative = window.prompt("What is the strongest alternative explanation?", opportunity.strongestAlternative);
    const nextTest = window.prompt("What is the next test?", opportunity.nextTest);
    const falsifier = window.prompt("What evidence would change your mind?", opportunity.whatWouldChangeOurMind?.[0] || "");
    if (!title?.trim() || !plainLanguageSummary?.trim() || !strongestAlternative?.trim() || !nextTest?.trim() || !falsifier?.trim()) return;
    button.disabled = true;
    status.textContent = "Saving the promoted draft…";
    const response = await apiFetch(`../api/insight-opportunities/${encodeURIComponent(opportunity.id)}/promote`, { method: "POST", body: { title, plainLanguageSummary, strongestAlternative, nextTest, whatWouldChangeOurMind: [falsifier], note: "Promoted after researcher rewrite of the detected pattern." } });
    status.textContent = response.ok ? "Promoted to a draft insight. The next refresh will place it in the normal review queue." : `Could not promote opportunity (${response.status}).`;
    if (!response.ok) button.disabled = false;
  }));
}

async function loadInsightReview() {
  if (!state.packet) return;
  const entries = await Promise.all((state.packet.insights ?? []).map(async (insight) => {
    const response = await apiFetch(`../api/insights/${encodeURIComponent(insight.id)}?workspace=${encodeURIComponent(state.workspaceId)}`);
    return response.ok ? [insight.id, await response.json()] : [insight.id, null];
  }));
  state.insightInspections = new Map(entries.filter(([, inspection]) => inspection));
  renderInsightReview();
}

async function refreshInsightReview() {
  const response = await apiFetch("../api/packet");
  if (response.ok) state.packet = await response.json();
  await loadInsightReview();
  render();
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
    byId("insight-review-actions").innerHTML = `<p class="muted">Detailed evidence review and publication controls are below.</p><button id="focus-insight-review" class="secondary-button" type="button">Open insight review queue</button>`;
    byId("focus-insight-review").onclick = () => byId("insight-review-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  renderInsightReview();

  byId("inspect-insight").onclick = () => inspectInsight(insight.id).catch((error) => showInspector("Inspection unavailable", error.message, ""));

  const sourceScan = state.packet.operations?.latestSourceScan;
  if (sourceScan) {
    byId("review-queue").hidden = false;
    const queue = sourceScan.reviewWork?.candidates || sourceScan.reviewQueue || [];
    const decisions = sourceScan.reviewWork?.decisions || [];
    const versionedEvidence = sourceScan.reviewWork?.versionedEvidence;
    const decisionByCandidate = new Map(decisions.map((decision) => [decision.candidateId, decision]));
    const unresolvedReviewCount = sourceScan.reviewWork?.reviewRequired ?? sourceScan.reviewRequired;
    byId("review-summary").textContent = `${unresolvedReviewCount} item${unresolvedReviewCount === 1 ? "" : "s"} needs review. ${decisions.length} decision${decisions.length === 1 ? "" : "s"} recorded. ${versionedEvidence?.activeResearchRecordCount || 0} versioned research record${versionedEvidence?.activeResearchRecordCount === 1 ? "" : "s"} active. Last scan: ${sourceScan.generatedAt}.`;
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
  const remediationButton = event.target.closest(".remediation-alert");
  if (remediationButton) {
    const note = window.prompt("What did you do or verify?");
    if (!note?.trim()) return;
    remediationButton.disabled = true;
    apiFetch(`../api/alerts/${encodeURIComponent(remediationButton.dataset.alertId)}/remediation`, { method: "POST", body: { state: remediationButton.dataset.remediationState, note } }).then((response) => { if (!response.ok) remediationButton.disabled = false; return loadAlerts(); });
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
  byId("questions-items").innerHTML = questions.length ? questions.map((question) => { const evaluation = evaluationByQuestion.get(question.id); const briefing = briefingByQuestion.get(question.id); const insightMarkup = briefing?.insightProvenance?.length ? `<h4>Bounded insight provenance</h4><div class="provenance-list">${briefing.insightProvenance.map((insight) => `<article class="provenance-item"><div class="record-meta"><span class="role">${escapeHtml(insight.state)}</span><span>published ${escapeHtml(insight.publishedAt)}</span><span>receipt ${escapeHtml(insight.publicationId)}</span></div><h5>${escapeHtml(insight.title)}</h5><p>${escapeHtml(insight.plainLanguageSummary)}</p><p>Source records: ${(insight.sourceRecordIds || []).map((recordId) => `<button class="link-button inspect-record" data-record-id="${escapeHtml(recordId)}" type="button">${escapeHtml(recordId)}</button>`).join(" ") || "none"}</p>${insight.staleReason ? `<p class="error">${escapeHtml(insight.staleReason)}</p>` : ""}</article>`).join("")}</div>` : ""; return `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(question.state)}</span><span>${escapeHtml(question.createdBy)}</span>${evaluation ? `<span>${escapeHtml(evaluation.state.replaceAll("_", " "))}</span>` : ""}${briefing ? `<span>${escapeHtml(briefing.state)}</span>` : ""}</div><h3>${escapeHtml(question.question)}</h3><p class="muted">Saved ${escapeHtml(question.createdAt)} · Last evaluated: ${escapeHtml(question.lastEvaluatedAt || "not yet")} · Evidence matches: ${evaluation?.matchedRecordIds.length ?? 0}</p>${evaluation ? `<details><summary>Open evaluation boundary</summary><p>${escapeHtml(evaluation.limitation)}</p><p>Matching records: ${escapeHtml(evaluation.matchedRecordIds.join(", ") || "none")}</p>${briefing ? `<p>Briefing: ${escapeHtml(briefing.reading)}</p><p>Next test: ${escapeHtml(briefing.nextTest)}</p>${insightMarkup}${briefing.staleReason ? `<p class="error">${escapeHtml(briefing.staleReason)}</p>` : ""}${briefing.state !== "published" ? `<button class="publish-briefing" data-briefing-id="${escapeHtml(briefing.id)}" data-stale="${briefing.state === "stale"}">${briefing.state === "stale" ? "Republish after reviewing updated evidence" : "Publish draft"}</button>` : `<p>Published by ${escapeHtml(briefing.publishedBy || "researcher")}.</p><form class="decision-outcome-form" data-briefing-id="${escapeHtml(briefing.id)}"><label>Did this briefing affect a decision? <select name="decisionState"><option value="used">Yes, it was used</option><option value="deferred">It was deferred</option><option value="not_used">No</option></select></label><label>What happened later? <select name="outcomeState"><option value="pending">Still watching</option><option value="held">The reading held</option><option value="changed">The reading changed</option><option value="wrong">The reading was wrong</option><option value="unknown">Unknown</option></select></label><label>Decision note <textarea name="decisionSummary" maxlength="2000" placeholder="What decision did it inform?"></textarea><label>Outcome note <textarea name="outcomeNote" maxlength="2000" placeholder="What happened after the decision?"></textarea><button type="submit">Record decision feedback</button><p class="muted decision-outcome-status" role="status"></p></form>`}<button class="secondary-button export-briefing" data-briefing-id="${escapeHtml(briefing.id)}" type="button">Export source-linked briefing</button>` : ""}</details>` : ""}</article>`; }).join("") : `<p class="muted">No saved questions yet.</p>`;
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
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const status = document.createElement("p");
      status.className = "error briefing-publication-error";
      status.textContent = body.error || `Could not publish briefing (${response.status}).`;
      button.closest(".record-card")?.append(status);
      button.disabled = false;
      return;
    }
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

byId("workspace-select").addEventListener("change", async (event) => { state.workspaceId = event.target.value; await Promise.all([loadQuestions(), loadAlerts(), loadDecisionOutcomes(), loadWatchlists(), loadEvidenceHistory(), loadInsightReview()]); });
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
loadOperatorOverview().catch(() => { byId("operator-panel").hidden = true; });
loadCoverage().catch((error) => { byId("coverage-summary").textContent = error.message; });
loadAtlas().catch((error) => { byId("atlas-summary").textContent = error.message; });
loadEvidenceHistory().catch((error) => { byId("evidence-history-summary").textContent = error.message; });

fetch(fixtureUrl).then((response) => {
  if (!response.ok) throw new Error(`Fixture unavailable (${response.status})`);
  return response.json();
}).then((packet) => {
  state.packet = packet;
  render();
  return loadInsightReview();
}).catch((error) => {
  byId("records").innerHTML = `<p class="error">The evidence packet could not be loaded: ${escapeHtml(error.message)}</p>`;
});
