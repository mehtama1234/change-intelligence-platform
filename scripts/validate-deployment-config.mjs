import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const dockerfile = await readFile(resolve(root, "Dockerfile"), "utf8");
const compose = await readFile(resolve(root, "docker-compose.yml"), "utf8");
const scheduler = await readFile(resolve(root, "scripts/scheduler.mjs"), "utf8");
const refreshCycle = await readFile(resolve(root, "scripts/run-refresh-cycle.mjs"), "utf8");
const topologyTest = await readFile(resolve(root, "scripts/test-production-topology.mjs"), "utf8");
const required = [
  [dockerfile, "ENV RUNTIME_DATA_DIR=/app/runtime", "Dockerfile runtime path"],
  [dockerfile, "ENV PACKET_PATH=/app/runtime/ai-work-control.packet.json", "Dockerfile packet path"],
  [dockerfile, "HEALTHCHECK", "Dockerfile health check"],
  [compose, "change-intelligence-scheduler:", "scheduler service"],
  [compose, "change-intelligence-backup:", "backup service"],
  [compose, "command: [\"node\", \"scripts/backup-scheduler.mjs\"]", "backup scheduler command"],
  [compose, "BACKUP_INTERVAL_MS", "backup cadence configuration"],
  [compose, "change-intelligence-backups:/app/backups", "shared backup volume"],
  [compose, "change-intelligence-notifications:", "notification service"],
  [compose, "command: [\"node\", \"scripts/notification-scheduler.mjs\"]", "notification scheduler command"],
  [compose, "NOTIFICATION_INTERVAL_MS", "notification cadence configuration"],
  [compose, "REQUIRE_WORKER_HEALTH: \"1\"", "production worker readiness"],
  [compose, "WORKER_STATUS_MAX_AGE_MS", "worker heartbeat age configuration"],
  [compose, "command: [\"node\", \"scripts/scheduler.mjs\"]", "scheduler command"],
  [compose, "change-intelligence-runtime:/app/runtime", "shared runtime volume"],
  [compose, "${RESEARCH_ROOT:?Set RESEARCH_ROOT}:/app/research:ro", "research source mount"],
  [compose, "restart: unless-stopped", "restart policy"],
  [scheduler, "process.on(\"SIGTERM\"", "scheduler termination handling"],
  [scheduler, "run-refresh-cycle.mjs", "scheduler refresh invocation"]
  , [scheduler, "scheduler-status.json", "scheduler status receipt"]
  , [scheduler, "SCHEDULER_MAX_CYCLES", "scheduler test-cycle control"]
  , [refreshCycle, "plan-refresh-scope.mjs", "cadence planner invocation"]
  , [refreshCycle, "check-source-availability.mjs", "source availability invocation"]
  , [compose, "OPERATOR_NOTIFICATION_DELIVERY_MODE", "notification delivery mode"]
  , [compose, "OPERATOR_NOTIFICATION_WEBHOOK_URL", "notification webhook configuration"]
  , [topologyTest, "REQUIRE_WORKER_HEALTH", "topology worker health assertion"]
  , [topologyTest, "change-intelligence-production-topology", "topology isolated runtime test"]
];
const missing = required.filter(([text, value]) => !text.includes(value)).map(([, , label]) => label);
if (missing.length) throw new Error(`Deployment contract failed: ${missing.join(", ")}`);
console.log("Deployment configuration contract passed: server, scheduler, runtime, source mount, health check, and restart wiring are present.");
