import Database from "better-sqlite3";
import { readFile, writeFile, mkdir } from "node:fs/promises";
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
  `);
  const migration = db.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)");
  migration.run(schemaVersion, new Date().toISOString());

  const questionRow = db.prepare(`SELECT id, workspace_id AS workspaceId, question, scope_json AS scopeJson, state, created_by AS createdBy, created_role AS createdRole, created_at AS createdAt, updated_at AS updatedAt, last_evaluated_at AS lastEvaluatedAt FROM questions ORDER BY created_at, id`);
  const insertQuestion = db.prepare(`INSERT OR IGNORE INTO questions (id, workspace_id, question, scope_json, state, created_by, created_role, created_at, updated_at, last_evaluated_at) VALUES (@id, @workspaceId, @question, @scopeJson, @state, @createdBy, @createdRole, @createdAt, @updatedAt, @lastEvaluatedAt)`);
  const insertAudit = db.prepare(`INSERT INTO audit_entries (request_id, action, target_id, workspace_id, actor_id, actor_role, result, occurred_at) VALUES (@requestId, @action, @targetId, @workspaceId, @actorId, @actorRole, @result, @occurredAt)`);
  const operationRow = db.prepare("SELECT operation_key AS key, action, status, body_json AS bodyJson, completed_at AS completedAt FROM idempotency_operations WHERE operation_key = ?");
  const insertOperation = db.prepare(`INSERT OR IGNORE INTO idempotency_operations (operation_key, action, status, body_json, completed_at) VALUES (@key, @action, @status, @bodyJson, @completedAt)`);

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

  const importLegacy = db.transaction(({ questions, audit, operations }) => {
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
  });

  return {
    databasePath,
    importLegacy,
    questionsLedger,
    operationsLedger,
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
    try { return parseJson(await readFile(path, "utf8"), fallback); } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw error;
    }
  };
  const [questions, audit, operations] = await Promise.all([
    read(paths.questions, { questions: [] }),
    read(paths.audit, { entries: [] }),
    read(paths.operations, { operations: [] })
  ]);
  store.importLegacy({ questions, audit, operations });
  await mkdir(resolve(paths.runtimeDir), { recursive: true });
  await writeFile(paths.questions, `${JSON.stringify(store.questionsLedger(), null, 2)}\n`);
  await writeFile(paths.audit, `${JSON.stringify(store.auditLedger(), null, 2)}\n`);
}
