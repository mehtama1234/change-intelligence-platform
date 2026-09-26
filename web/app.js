const fixtureUrl = "../api/packet";
const state = { packet: null, role: "all" };

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
}[char]));

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
    byId("insight-review-actions").innerHTML = insightCandidate.status === "needs_researcher_review" ? `<button id="accept-insight" type="button">Accept for publication review</button>` : `<span>Decision recorded by ${escapeHtml(insightCandidate.decidedBy || "researcher")}.</span>`;
    byId("accept-insight")?.addEventListener("click", async () => {
      const response = await fetch(`../api/insight-candidates/${encodeURIComponent(insightCandidate.id)}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", actorId: "demo-researcher", decision: "accept", note: "Accepted for publication review after evidence inspection." }) });
      if (response.ok) byId("insight-review-actions").textContent = "Accepted for publication review.";
    });
  }

  const sourceScan = state.packet.operations?.latestSourceScan;
  if (sourceScan) {
    byId("review-queue").hidden = false;
    const queue = sourceScan.reviewWork?.candidates || sourceScan.reviewQueue || [];
    const decisions = sourceScan.reviewWork?.decisions || [];
    const versionedEvidence = sourceScan.reviewWork?.versionedEvidence;
    const decisionByCandidate = new Map(decisions.map((decision) => [decision.candidateId, decision]));
    byId("review-summary").textContent = `${sourceScan.reviewRequired} item${sourceScan.reviewRequired === 1 ? "" : "s"} needs review. ${decisions.length} decision${decisions.length === 1 ? "" : "s"} recorded. ${versionedEvidence?.activeResearchRecordCount || 0} versioned research record${versionedEvidence?.activeResearchRecordCount === 1 ? "" : "s"} active. Last scan: ${sourceScan.generatedAt}.`;
    byId("review-items").innerHTML = queue.length ? queue.map((item) => { const recorded = decisionByCandidate.get(item.id); return `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(item.state.replaceAll("_", " "))}</span><span>${escapeHtml(item.action.replaceAll("_", " "))}</span>${item.publication ? `<span>${escapeHtml(item.publication.replaceAll("_", " "))}</span>` : ""}${recorded ? `<span>${escapeHtml(recorded.resultingState.replaceAll("_", " "))}</span>` : ""}</div><h3>${escapeHtml(item.repository)} · ${escapeHtml(item.sourceId)}</h3><p>${escapeHtml(item.reason)}</p>${item.observation ? `<p>${escapeHtml(item.observation)}</p>` : ""}<details><summary>Open change details</summary><dl><dt>Source</dt><dd><code>${escapeHtml(item.sourcePath)}</code></dd><dt>Previous hash</dt><dd><code>${escapeHtml(item.previousSha256 || "none")}</code></dd><dt>Current hash</dt><dd><code>${escapeHtml(item.currentSha256 || item.sourceDigest || "missing")}</code></dd>${recorded ? `<dt>Reviewer decision</dt><dd>${escapeHtml(recorded.decision)} by ${escapeHtml(recorded.reviewer)}: ${escapeHtml(recorded.note || "No note")}</dd>` : ""}</dl></details></article>`; }).join("") : `<p class="muted">No source changes are waiting for review.</p>`;
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
  const visible = state.role === "all" ? records : records.filter((record) => record.sourceRole === state.role);
  byId("records").innerHTML = visible.map((record) => `<article class="record-card">
    <div class="record-meta"><span class="role">${escapeHtml(record.sourceRole.replaceAll("_", " "))}</span><span>${escapeHtml(record.claimState)}</span><span>${escapeHtml(record.asOf)}</span></div>
    <h3>${escapeHtml(record.title)}</h3>
    <p>${escapeHtml(record.observation)}</p>
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

byId("role-filter").addEventListener("change", (event) => {
  state.role = event.target.value;
  render();
});

async function loadQuestions() {
  const [response, evaluationsResponse, briefingsResponse] = await Promise.all([fetch("../api/questions?workspace=demo-research"), fetch("../api/question-evaluations?workspace=demo-research"), fetch("../api/briefings?workspace=demo-research")]);
  if (!response.ok || !evaluationsResponse.ok || !briefingsResponse.ok) throw new Error(`Questions unavailable (${response.status})`);
  const questions = await response.json();
  const evaluations = await evaluationsResponse.json();
  const briefings = await briefingsResponse.json();
  const evaluationByQuestion = new Map(evaluations.map((evaluation) => [evaluation.questionId, evaluation]));
  const briefingByQuestion = new Map(briefings.map((briefing) => [briefing.questionId, briefing]));
  byId("questions-summary").textContent = `${questions.length} saved question${questions.length === 1 ? "" : "s"}.`;
  byId("questions-items").innerHTML = questions.length ? questions.map((question) => { const evaluation = evaluationByQuestion.get(question.id); const briefing = briefingByQuestion.get(question.id); return `<article class="record-card"><div class="record-meta"><span class="role">${escapeHtml(question.state)}</span><span>${escapeHtml(question.createdBy)}</span>${evaluation ? `<span>${escapeHtml(evaluation.state.replaceAll("_", " "))}</span>` : ""}${briefing ? `<span>${escapeHtml(briefing.state)}</span>` : ""}</div><h3>${escapeHtml(question.question)}</h3><p class="muted">Saved ${escapeHtml(question.createdAt)} · Last evaluated: ${escapeHtml(question.lastEvaluatedAt || "not yet")} · Evidence matches: ${evaluation?.matchedRecordIds.length ?? 0}</p>${evaluation ? `<details><summary>Open evaluation boundary</summary><p>${escapeHtml(evaluation.limitation)}</p><p>Matching records: ${escapeHtml(evaluation.matchedRecordIds.join(", ") || "none")}</p>${briefing ? `<p>Briefing: ${escapeHtml(briefing.reading)}</p><p>Next test: ${escapeHtml(briefing.nextTest)}</p>${briefing.state !== "published" ? `<button class="publish-briefing" data-briefing-id="${escapeHtml(briefing.id)}">Publish draft</button>` : `<p>Published by ${escapeHtml(briefing.publishedBy || "researcher")}.</p>`}` : ""}</details>` : ""}</article>`; }).join("") : `<p class="muted">No saved questions yet.</p>`;
  document.querySelectorAll(".publish-briefing").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    const response = await fetch(`../api/briefings/${encodeURIComponent(button.dataset.briefingId)}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", actorId: "demo-researcher" }) });
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
    const response = await fetch("../api/questions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: "demo-research", actorId: "demo-researcher", question: input.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Question could not be saved.");
    input.value = "";
    status.textContent = "Saved.";
    await loadQuestions();
  } catch (error) {
    status.textContent = error.message;
  }
});

loadQuestions().catch((error) => { byId("questions-summary").textContent = error.message; });

fetch(fixtureUrl).then((response) => {
  if (!response.ok) throw new Error(`Fixture unavailable (${response.status})`);
  return response.json();
}).then((packet) => {
  state.packet = packet;
  render();
}).catch((error) => {
  byId("records").innerHTML = `<p class="error">The evidence packet could not be loaded: ${escapeHtml(error.message)}</p>`;
});
