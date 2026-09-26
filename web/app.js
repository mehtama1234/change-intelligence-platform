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

  const reportRecord = records.find((record) => record.reportWindow);
  if (reportRecord) {
    const report = reportRecord.reportWindow;
    byId("report-history").hidden = false;
    byId("report-reading").textContent = `${reportRecord.company} · ${report.annualBaseline}. ${report.reading}`;
    byId("report-table").innerHTML = `<table><caption>Issuer-reported losses; values are in $000s</caption><thead><tr><th>Period</th><th>Operating loss</th><th>Net loss</th></tr></thead><tbody>${report.quarters.map((quarter) => `<tr><th scope="row">${escapeHtml(quarter.period)}</th><td>${quarter.operatingLoss.toLocaleString()}</td><td>${quarter.netLoss.toLocaleString()}</td></tr>`).join("")}</tbody></table><p class="change-note">Magnitude change Q3 versus Q1: operating loss ${report.metrics.operatingLossMagnitudeChangeQ3vsQ1Pct}% · net loss ${report.metrics.netLossMagnitudeChangeQ3vsQ1Pct}%.</p>`;
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
