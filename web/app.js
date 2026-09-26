const fixtureUrl = "../api/packet";
const state = { packet: null, role: "all", theme: "all", company: "all", industry: "all", timelineType: "all", timelineQuery: "", timelineEvents: [], workspaceId: "demo-research", actorId: "demo-researcher", token: sessionStorage.getItem("change-intelligence-token") || "" };

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
}[char]));

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
  await Promise.all([loadQuestions(), loadAlerts()]);
}

async function loadAlerts() {
  const response = await apiFetch(`../api/alerts?workspace=${encodeURIComponent(state.workspaceId)}`);
  if (!response.ok) throw new Error(`Alerts unavailable (${response.status})`);
  const alerts = await response.json();
  byId("workspace-alerts").hidden = false;
  const openAlerts = alerts.filter((alert) => alert.state === "open");
  byId("alerts-summary").textContent = `${openAlerts.length} open alert${openAlerts.length === 1 ? "" : "s"} in this workspace.`;
  byId("alerts-items").innerHTML = openAlerts.length ? openAlerts.map((alert) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(alert.severity)}</span><span>${escapeHtml(alert.kind.replaceAll("_", " "))}</span></div><h3>${escapeHtml(alert.watchlistName)}</h3><p>${escapeHtml(alert.reason)}</p><details><summary>Open alert source</summary><dl><dt>Repository</dt><dd>${escapeHtml(alert.repository)}</dd><dt>Source</dt><dd><code>${escapeHtml(alert.sourcePath)}</code></dd></dl></details><button class="acknowledge-alert" data-alert-id="${escapeHtml(alert.id)}" type="button">Acknowledge</button></article>`).join("") : `<p class="muted">No open watchlist alerts.</p>`;
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
  const [response, usageResponse] = await Promise.all([apiFetch("../api/operations"), apiFetch(`../api/usage?workspace=${workspace}`)]);
  if (!response.ok || !usageResponse.ok) throw new Error(`Operations unavailable (${response.status})`);
  const operations = await response.json();
  const usage = await usageResponse.json();
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
  const activityCards = [["Questions", activity.questionsSaved], ["Source reviews", activity.sourceReviews], ["Briefing exports", activity.briefingsExported], ["Alerts acknowledged", activity.alertsAcknowledged]];
  byId("operations-cards").innerHTML = [...checks.map(([label, status]) => `<div class="operation-card"><span>${escapeHtml(label)}</span><strong class="operation-${escapeHtml(status)}">${escapeHtml(status)}</strong></div>`), ...activityCards.map(([label, value]) => `<div class="operation-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)].join("");
  const history = operations.refreshHistory ?? [];
  byId("operations-history").innerHTML = history.length ? `<table><caption>Recent refresh runs</caption><thead><tr><th>Run</th><th>Status</th><th>Steps</th><th>Ended</th></tr></thead><tbody>${history.slice().reverse().slice(0, 8).map((run) => `<tr><th scope="row"><code>${escapeHtml(run.runId)}</code></th><td>${escapeHtml(run.status)}</td><td>${run.steps.filter((step) => step.status === "complete").length}/${run.steps.length} complete</td><td>${escapeHtml(run.endedAt)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No refresh history recorded yet.</p>`;
}

async function loadCoverage() {
  const response = await apiFetch("../api/coverage");
  if (!response.ok) throw new Error(`Evidence coverage unavailable (${response.status})`);
  const coverage = await response.json();
  byId("coverage-summary").textContent = `${coverage.summary.ready} ready · ${coverage.summary.partial} partial · ${coverage.summary.missing} missing. A missing row is a research gap, not proof that the main reading is false.`;
  byId("coverage-items").innerHTML = coverage.requirements.map((item) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(item.status)}</span><span>${escapeHtml(item.evidence)}/${escapeHtml(item.target)} records</span></div><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.meaning)}</p></article>`).join("");
  byId("coverage-reports").innerHTML = coverage.reportWindows.length ? `<table><caption>Public-company histories currently available</caption><thead><tr><th>Company</th><th>Annual baseline</th><th>Quarters</th><th>Captured sources</th><th>Status</th></tr></thead><tbody>${coverage.reportWindows.map((report) => `<tr><th scope="row">${escapeHtml(report.company || "Unnamed company")}</th><td>${escapeHtml(report.annualBaseline || "not recorded")}</td><td>${escapeHtml(report.quarterCount)}</td><td>${escapeHtml(report.sourceRefs)}</td><td>${escapeHtml(report.captureStatus)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">No annual-plus-quarterly company history is available yet.</p>`;
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
    byId("alerts-items").innerHTML = openAlerts.length ? openAlerts.map((alert) => `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(alert.severity)}</span><span>${escapeHtml(alert.kind.replaceAll("_", " "))}</span></div><h3>${escapeHtml(alert.watchlistName)}</h3><p>${escapeHtml(alert.reason)}</p><details><summary>Open alert source</summary><dl><dt>Workspace</dt><dd>${escapeHtml(alert.workspaceId)}</dd><dt>Repository</dt><dd>${escapeHtml(alert.repository)}</dd><dt>Source</dt><dd><code>${escapeHtml(alert.sourcePath)}</code></dd></dl></details></article>`).join("") : `<p class="muted">No open watchlist alerts.</p>`;
  }

  const reportRecord = records.find((record) => record.reportWindow);
  if (reportRecord) {
    const report = reportRecord.reportWindow;
    byId("report-history").hidden = false;
    byId("report-reading").textContent = `${reportRecord.company} · ${report.annualBaseline}. ${report.reading}`;
    const sourceLabel = report.movementSource === "sec_xbrl" ? "direct SEC filing XBRL" : "Atlas bridge file";
    const captureLabel = report.sourceRefs.captureStatus === "complete" ? "4/4 filings captured" : `${report.sourceRefs.captureStatus} capture`;
    byId("report-table").innerHTML = `<table><caption>Issuer-reported losses; values are in $000s; movement read from ${sourceLabel}</caption><thead><tr><th>Period</th><th>Operating loss</th><th>Net loss</th></tr></thead><tbody>${report.quarters.map((quarter) => `<tr><th scope="row">${escapeHtml(quarter.period)}</th><td>${quarter.operatingLoss.toLocaleString()}</td><td>${quarter.netLoss.toLocaleString()}</td></tr>`).join("")}</tbody></table><p class="change-note">Magnitude change Q3 versus Q1: operating loss ${report.metrics.operatingLossMagnitudeChangeQ3vsQ1Pct}% · net loss ${report.metrics.netLossMagnitudeChangeQ3vsQ1Pct}%. Source status: ${sourceLabel}; ${captureLabel}.</p>`;
    byId("report-links").innerHTML = `<strong>Direct records in the ledger</strong>${report.sourceRefs.directRecords.map((record) => `<a href="${escapeHtml(record.url)}" target="_blank" rel="noreferrer">${escapeHtml(record.label)}</a>`).join("")}`;
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
  byId("questions-items").innerHTML = questions.length ? questions.map((question) => { const evaluation = evaluationByQuestion.get(question.id); const briefing = briefingByQuestion.get(question.id); return `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(question.state)}</span><span>${escapeHtml(question.createdBy)}</span>${evaluation ? `<span>${escapeHtml(evaluation.state.replaceAll("_", " "))}</span>` : ""}${briefing ? `<span>${escapeHtml(briefing.state)}</span>` : ""}</div><h3>${escapeHtml(question.question)}</h3><p class="muted">Saved ${escapeHtml(question.createdAt)} · Last evaluated: ${escapeHtml(question.lastEvaluatedAt || "not yet")} · Evidence matches: ${evaluation?.matchedRecordIds.length ?? 0}</p>${evaluation ? `<details><summary>Open evaluation boundary</summary><p>${escapeHtml(evaluation.limitation)}</p><p>Matching records: ${escapeHtml(evaluation.matchedRecordIds.join(", ") || "none")}</p>${briefing ? `<p>Briefing: ${escapeHtml(briefing.reading)}</p><p>Next test: ${escapeHtml(briefing.nextTest)}</p>${briefing.staleReason ? `<p class="error">${escapeHtml(briefing.staleReason)}</p>` : ""}${briefing.state !== "published" ? `<button class="publish-briefing" data-briefing-id="${escapeHtml(briefing.id)}" data-stale="${briefing.state === "stale"}">${briefing.state === "stale" ? "Republish after reviewing updated evidence" : "Publish draft"}</button>` : `<p>Published by ${escapeHtml(briefing.publishedBy || "researcher")}.</p>`}<button class="secondary-button export-briefing" data-briefing-id="${escapeHtml(briefing.id)}" type="button">Export source-linked briefing</button>` : ""}</details>` : ""}</article>`; }).join("") : `<p class="muted">No saved questions yet.</p>`;
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

byId("workspace-select").addEventListener("change", async (event) => { state.workspaceId = event.target.value; await Promise.all([loadQuestions(), loadAlerts(), loadEvidenceHistory()]); });
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
