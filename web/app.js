const fixtureUrl = "../data/processed/ai-work-control.packet.json";
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

fetch(fixtureUrl).then((response) => {
  if (!response.ok) throw new Error(`Fixture unavailable (${response.status})`);
  return response.json();
}).then((packet) => {
  state.packet = packet;
  render();
}).catch((error) => {
  byId("records").innerHTML = `<p class="error">The evidence packet could not be loaded: ${escapeHtml(error.message)}</p>`;
});
