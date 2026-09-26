import Database from "better-sqlite3";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const schemaVersion = 1;

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export function createRuntimeStore(runtimeDir) {
  const databasePath = resolve(runtimeDir, "change-intelligence.sqlite");
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      question TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      state TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_evaluated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_entries (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT NOT NULL,
      workspace_id TEXT,
      actor_id TEXT,
      actor_role TEXT,
      result TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency_operations (
      operation_key TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      status INTEGER NOT NULL,
      body_json TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runtime_records (
      record_kind TEXT NOT NULL,
      record_id TEXT NOT NULL,
      workspace_id TEXT,
      body_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (record_kind, record_id)
    );
  `);
  const migration = db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  migration.run(schemaVersion, new Date().toISOString());

  const questionRow = db.prepare(`SELECT id, workspace_id AS workspaceId, question, scope_json AS scopeJson, state, created_by AS createdBy, created_role AS createdRole, created_at AS createdAt, updated_at AS updatedAt, last_evaluated_at AS lastEvaluatedAt FROM questions ORDER BY created_at, id`);
  const insertQuestion = db.prepare(`INSERT OR IGNORE INTO questions (id, workspace_id, question, scope_json, state, created_by, created_role, created_at, updated_at, last_evaluated_at) VALUES (@id, @workspaceId, @question, @scopeJson, @state, @createdBy, @createdRole, @createdAt, @updatedAt, @lastEvaluatedAt)`);
  const insertAudit = db.prepare(`INSERT INTO audit_entries (request_id, action, target_id, workspace_id, actor_id, actor_role, result, occurred_at) VALUES (@requestId, @action, @targetId, @workspaceId, @actorId, @actorRole, @result, @occurredAt)`);
  const operationRow = db.prepare("SELECT operation_key AS key, action, status, body_json AS bodyJson, completed_at AS completedAt FROM idempotency_operations WHERE operation_key = ?");
  const insertOperation = db.prepare(`INSERT OR IGNORE INTO idempotency_operations (operation_key, action, status, body_json, completed_at) VALUES (@key, @action, @status, @bodyJson, @completedAt)`);
  const recordRow = db.prepare("SELECT body_json AS bodyJson FROM runtime_records WHERE record_kind = ? AND record_id = ?");
  const recordRows = db.prepare("SELECT body_json AS bodyJson FROM runtime_records WHERE record_kind = ? ORDER BY updated_at, record_id");
  const upsertRecord = db.prepare(`INSERT INTO runtime_records (record_kind, record_id, workspace_id, body_json, updated_at) VALUES (@kind, @id, @workspaceId, @bodyJson, @updatedAt) ON CONFLICT(record_kind, record_id) DO UPDATE SET workspace_id = excluded.workspace_id, body_json = excluded.body_json, updated_at = excluded.updated_at`);

  function questionFromRow(row) {
    if (!row) return undefined;
    const { scopeJson, ...question } = row;
    return { ...question, scope: parseJson(scopeJson, { watchlistIds: [] }) };
  }

  function questionsLedger() {
    return { schemaVersion: "workspace-question-ledger-v1", questions: questionRow.all().map(questionFromRow) };
  }

  function auditLedger() {
    return {
      schemaVersion: "audit-log-v1",
      entries: db.prepare("SELECT request_id AS requestId, action, target_id AS targetId, workspace_id AS workspaceId, actor_id AS actorId, actor_role AS actorRole, result, occurred_at AS occurredAt FROM audit_entries ORDER BY sequence").all()
    };
  }

  function operationsLedger() {
    return {
      schemaVersion: "idempotency-ledger-v1",
      operations: db.prepare("SELECT operation_key AS key, action, status, body_json AS bodyJson, completed_at AS completedAt FROM idempotency_operations ORDER BY completed_at, operation_key").all().map(operationFromRow)
    };
  }

  function operationFromRow(row) {
    if (!row) return undefined;
    const { bodyJson, ...operation } = row;
    return { ...operation, body: parseJson(bodyJson, {}) };
  }

  const importLegacy = db.transaction(({ questions, audit, operations, alerts, briefingPublications, insightDecisions, insightPublications, decisionOutcomes, watchlists, comparisonViews, notificationPreferences, pilotProfiles, pilotDeliveries, pilotDecisions, operatorWarnings, operatorNotifications, operatorRoutes, operatorAttempts, pilotReadiness, sourceScan, evidenceLedger, reviewDecisions, reviewEvents }) => {
    const shouldImportQuestions = db.prepare("SELECT COUNT(*) AS count FROM questions").get().count === 0;
    const shouldImportAudit = db.prepare("SELECT COUNT(*) AS count FROM audit_entries").get().count === 0;
    const shouldImportOperations = db.prepare("SELECT COUNT(*) AS count FROM idempotency_operations").get().count === 0;
    for (const question of shouldImportQuestions ? (questions?.questions ?? []) : []) insertQuestion.run({
      id: question.id,
      workspaceId: question.workspaceId,
      question: question.question,
      scopeJson: JSON.stringify(question.scope ?? { watchlistIds: [] }),
      state: question.state ?? "active",
      createdBy: question.createdBy,
      createdRole: question.createdRole ?? "researcher",
      createdAt: question.createdAt,
      updatedAt: question.updatedAt ?? question.createdAt,
      lastEvaluatedAt: question.lastEvaluatedAt ?? null
    });
    for (const entry of shouldImportAudit ? (audit?.entries ?? []) : []) insertAudit.run(entry);
    for (const operation of shouldImportOperations ? (operations?.operations ?? []).filter((item) => item.key) : []) insertOperation.run({
      key: operation.key,
      action: operation.action,
      status: operation.status,
      bodyJson: JSON.stringify(operation.body ?? {}),
      completedAt: operation.completedAt
    });
    const importRecords = (kind, records, idField = "id") => {
      const count = db.prepare("SELECT COUNT(*) AS count FROM runtime_records WHERE record_kind = ?").get(kind).count;
      if (count > 0) return;
      for (const record of records ?? []) upsertRecord.run({ kind, id: record[idField], workspaceId: record.workspaceId ?? null, bodyJson: JSON.stringify(record), updatedAt: record.updatedAt ?? record.checkedAt ?? record.acceptedAt ?? record.decidedAt ?? new Date().toISOString() });
    };
    importRecords("alert", alerts?.alerts);
    importRecords("briefing_publication", briefingPublications?.publications);
    importRecords("insight_decision", insightDecisions?.decisions);
    importRecords("insight_publication", insightPublications?.publications);
    importRecords("decision_outcome", decisionOutcomes?.outcomes);
    importRecords("watchlist", watchlists?.watchlists);
    importRecords("comparison_view", comparisonViews?.views);
    importRecords("notification_preference", notificationPreferences?.preferences);
    importRecords("pilot_profile", pilotProfiles?.profiles);
    importRecords("pilot_delivery", pilotDeliveries?.deliveries);
    importRecords("pilot_decision", pilotDecisions?.decisions);
    importRecords("operator_warning", operatorWarnings?.events);
    importRecords("operator_notification", operatorNotifications?.notifications);
    importRecords("operator_notification_route", operatorRoutes?.settings);
    importRecords("operator_notification_attempt", operatorAttempts?.attempts);
    importRecords("pilot_readiness", pilotReadiness?.snapshots);
    importRecords("source_scan", sourceScan?.sources);
    importRecords("evidence_version", evidenceLedger?.records, "versionId");
    importRecords("review_decision", reviewDecisions?.decisions);
    importRecords("review_event", reviewEvents?.events);
  });

  return {
    databasePath,
    health() {
      const result = db.prepare("PRAGMA integrity_check").get();
      return { databasePath, integrity: result?.integrity_check === "ok" ? "ok" : result?.integrity_check ?? "unknown" };
    },
    importLegacy,
    questionsLedger,
    operationsLedger,
    alertsLedger(workspaces = []) { return { schemaVersion: "workspace-alert-ledger-v1", workspaces, alerts: recordRows.all("alert").map((row) => parseJson(row.bodyJson, {})) }; },
    recordsLedger(kind, schemaVersion, property) { return { schemaVersion, [property]: recordRows.all(kind).map((row) => parseJson(row.bodyJson, {})) }; },
    findRecord(kind, id) { return parseJson(recordRow.get(kind, id)?.bodyJson, undefined); },
    syncRecords(kind, records, idField = "id") { db.transaction(() => { for (const record of records ?? []) upsertRecord.run({ kind, id: record[idField], workspaceId: record.workspaceId ?? null, bodyJson: JSON.stringify(record), updatedAt: record.updatedAt ?? record.generatedAt ?? record.checkedAt ?? record.publishedAt ?? record.acceptedAt ?? record.decidedAt ?? record.createdAt ?? new Date().toISOString() }); })(); },
    commitRecord({ kind, record, audit, operation }) {
      db.transaction(() => {
        upsertRecord.run({ kind, id: record.id, workspaceId: record.workspaceId ?? null, bodyJson: JSON.stringify(record), updatedAt: record.updatedAt ?? record.acknowledgedAt ?? record.publishedAt ?? record.decidedAt ?? new Date().toISOString() });
        insertAudit.run(audit);
        if (operation.key) insertOperation.run({ ...operation, bodyJson: JSON.stringify(operation.body ?? {}) });
      })();
    },
    auditLedger,
    findOperation(key) { return operationFromRow(operationRow.get(key)); },
    appendAudit(entry) { insertAudit.run(entry); },
    commitQuestion({ question, audit, operation }) {
      db.transaction(() => {
        insertQuestion.run({
          id: question.id,
          workspaceId: question.workspaceId,
          question: question.question,
          scopeJson: JSON.stringify(question.scope ?? { watchlistIds: [] }),
          state: question.state,
          createdBy: question.createdBy,
          createdRole: question.createdRole,
          createdAt: question.createdAt,
          updatedAt: question.updatedAt,
          lastEvaluatedAt: question.lastEvaluatedAt ?? null
        });
        insertAudit.run(audit);
        if (operation.key) insertOperation.run({ ...operation, bodyJson: JSON.stringify(operation.body ?? {}) });
      })();
    },
    storeOperation(operation) { if (operation.key) insertOperation.run({ ...operation, bodyJson: JSON.stringify(operation.body ?? {}) }); },
    close() { db.close(); }
  };
}

export async function importRuntimeLedgers(store, paths) {
  const read = async (path, fallback) => {
    if (!path) return fallback;
    try { return parseJson(await readFile(path, "utf8"), fallback); } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  };
  const [questions, audit, operations, alerts, briefingPublications, insightDecisions, insightPublications, decisionOutcomes, watchlists, comparisonViews, notificationPreferences, pilotProfiles, pilotDeliveries, pilotDecisions, operatorWarnings, operatorNotifications, operatorRoutes, operatorAttempts, pilotReadiness, sourceScan, evidenceLedger, reviewDecisions, reviewEvents] = await Promise.all([
    read(paths.questions, { questions: [] }),
    read(paths.audit, { entries: [] }),
    read(paths.operations, { operations: [] }),
    read(paths.alerts, { alerts: [] }),
    read(paths.briefingPublications, { publications: [] }),
    read(paths.insightDecisions, { decisions: [] }),
    read(paths.insightPublications, { publications: [] }),
    read(paths.decisionOutcomes, { outcomes: [] }),
    read(paths.watchlists, { watchlists: [] }),
    read(paths.comparisonViews, { views: [] }),
    read(paths.notificationPreferences, { preferences: [] }),
    read(paths.pilotProfiles, { profiles: [] }),
    read(paths.pilotDeliveries, { deliveries: [] }),
    read(paths.pilotDecisions, { decisions: [] }),
    read(paths.operatorWarnings, { events: [] }),
    read(paths.operatorNotifications, { notifications: [] }),
    read(paths.operatorRoutes, { settings: [] }),
    read(paths.operatorAttempts, { attempts: [] }),
    read(paths.pilotReadiness, { snapshots: [] }),
    read(paths.sourceScan, { sources: [] }),
    read(paths.evidenceLedger, { records: [] }),
    read(paths.reviewDecisions, { decisions: [] }),
    read(paths.reviewEvents, { events: [] })
  ]);
  let workspaces = alerts.workspaces ?? [];
  if (!workspaces.length && paths.workspaceDir) {
    const files = (await readdir(paths.workspaceDir)).filter((file) => file.endsWith(".json"));
    workspaces = await Promise.all(files.map(async (file) => {
      const workspace = parseJson(await readFile(resolve(paths.workspaceDir, file), "utf8"), {});
      return { id: workspace.id, name: workspace.name };
    }));
  }
  if (!watchlists.watchlists.length && workspaces.length && paths.workspaceDir) {
    const files = (await readdir(paths.workspaceDir)).filter((file) => file.endsWith(".json"));
    watchlists.watchlists = (await Promise.all(files.map(async (file) => parseJson(await readFile(resolve(paths.workspaceDir, file), "utf8"), {})))).flatMap((workspace) => (workspace.watchlists ?? []).map((watchlist) => ({ ...watchlist, workspaceId: workspace.id })));
  }
  store.importLegacy({ questions, audit, operations, alerts, briefingPublications, insightDecisions, insightPublications, decisionOutcomes, watchlists, comparisonViews, notificationPreferences, pilotProfiles, pilotDeliveries, pilotDecisions, operatorWarnings, operatorNotifications, operatorRoutes, operatorAttempts, pilotReadiness, sourceScan, evidenceLedger, reviewDecisions, reviewEvents });
  store.syncRecords("alert", alerts.alerts);
  store.syncRecords("briefing_publication", briefingPublications.publications);
  store.syncRecords("insight_decision", insightDecisions.decisions);
  store.syncRecords("insight_publication", insightPublications.publications);
  store.syncRecords("decision_outcome", decisionOutcomes.outcomes);
  store.syncRecords("watchlist", watchlists.watchlists);
  store.syncRecords("comparison_view", comparisonViews.views);
  store.syncRecords("notification_preference", notificationPreferences.preferences);
  store.syncRecords("pilot_profile", pilotProfiles.profiles);
  store.syncRecords("pilot_delivery", pilotDeliveries.deliveries);
  store.syncRecords("pilot_decision", pilotDecisions.decisions);
  store.syncRecords("operator_warning", operatorWarnings.events);
  store.syncRecords("operator_notification", operatorNotifications.notifications);
  store.syncRecords("operator_notification_route", operatorRoutes.settings);
  store.syncRecords("operator_notification_attempt", operatorAttempts.attempts);
  store.syncRecords("pilot_readiness", pilotReadiness.snapshots);
  store.syncRecords("source_scan", sourceScan.sources);
  store.syncRecords("evidence_version", evidenceLedger.records, "versionId");
  store.syncRecords("review_decision", reviewDecisions.decisions);
  store.syncRecords("review_event", reviewEvents.events);
  await mkdir(resolve(paths.runtimeDir), { recursive: true });
  await writeFile(paths.questions, `${JSON.stringify(store.questionsLedger(), null, 2)}\n`);
  await writeFile(paths.audit, `${JSON.stringify(store.auditLedger(), null, 2)}\n`);
  await writeFile(paths.alerts, `${JSON.stringify(store.alertsLedger(workspaces), null, 2)}\n`);
  await writeFile(paths.briefingPublications, `${JSON.stringify(store.recordsLedger("briefing_publication", "briefing-publication-ledger-v1", "publications"), null, 2)}\n`);
  await writeFile(paths.insightDecisions, `${JSON.stringify(store.recordsLedger("insight_decision", "insight-decision-ledger-v1", "decisions"), null, 2)}\n`);
  await writeFile(paths.insightPublications, `${JSON.stringify(store.recordsLedger("insight_publication", "insight-publication-ledger-v1", "publications"), null, 2)}\n`);
  if (paths.decisionOutcomes) await writeFile(paths.decisionOutcomes, `${JSON.stringify(store.recordsLedger("decision_outcome", "decision-outcome-ledger-v1", "outcomes"), null, 2)}\n`);
  if (paths.watchlists) await writeFile(paths.watchlists, `${JSON.stringify(store.recordsLedger("watchlist", "workspace-watchlist-ledger-v1", "watchlists"), null, 2)}\n`);
  if (paths.comparisonViews) await writeFile(paths.comparisonViews, `${JSON.stringify(store.recordsLedger("comparison_view", "workspace-comparison-view-ledger-v1", "views"), null, 2)}\n`);
  if (paths.notificationPreferences) await writeFile(paths.notificationPreferences, `${JSON.stringify(store.recordsLedger("notification_preference", "workspace-notification-preference-ledger-v1", "preferences"), null, 2)}\n`);
  if (paths.pilotProfiles) await writeFile(paths.pilotProfiles, `${JSON.stringify(store.recordsLedger("pilot_profile", "workspace-pilot-profile-ledger-v1", "profiles"), null, 2)}\n`);
  if (paths.pilotDeliveries) await writeFile(paths.pilotDeliveries, `${JSON.stringify(store.recordsLedger("pilot_delivery", "workspace-pilot-delivery-ledger-v1", "deliveries"), null, 2)}\n`);
  if (paths.pilotDecisions) await writeFile(paths.pilotDecisions, `${JSON.stringify(store.recordsLedger("pilot_decision", "workspace-pilot-decision-ledger-v1", "decisions"), null, 2)}\n`);
  if (paths.operatorWarnings) await writeFile(paths.operatorWarnings, `${JSON.stringify(store.recordsLedger("operator_warning", "operator-warning-event-ledger-v1", "events"), null, 2)}\n`);
  if (paths.operatorNotifications) await writeFile(paths.operatorNotifications, `${JSON.stringify(store.recordsLedger("operator_notification", "operator-notification-outbox-v1", "notifications"), null, 2)}\n`);
  if (paths.operatorRoutes) await writeFile(paths.operatorRoutes, `${JSON.stringify(store.recordsLedger("operator_notification_route", "operator-notification-route-ledger-v1", "settings"), null, 2)}\n`);
  if (paths.operatorAttempts) await writeFile(paths.operatorAttempts, `${JSON.stringify(store.recordsLedger("operator_notification_attempt", "operator-notification-attempt-ledger-v1", "attempts"), null, 2)}\n`);
  if (paths.pilotReadiness) await writeFile(paths.pilotReadiness, `${JSON.stringify(store.recordsLedger("pilot_readiness", "pilot-readiness-ledger-v1", "snapshots"), null, 2)}\n`);
  if (paths.reviewEvents) await writeFile(paths.reviewEvents, `${JSON.stringify(store.recordsLedger("review_event", "review-event-ledger-v1", "events"), null, 2)}\n`);
}
