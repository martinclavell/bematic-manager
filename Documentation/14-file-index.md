# 14 — File Index

[← Back to Index](./README.md)

---

## packages/common/src/

| File | Purpose |
|------|---------|
| `index.ts` | Barrel export |
| `constants/bots.ts` | Bot names, keywords, slash commands, default budgets |
| `constants/message-types.ts` | WebSocket message type constants |
| `constants/permissions.ts` | User roles, permissions, role-permission mapping |
| `constants/limits.ts` | System-wide limits and defaults |
| `constants/models.ts` | Model tiers, cost profiles, scoring weights for intelligent routing |
| `constants/index.ts` | Barrel export |
| `types/task.ts` | Task, TaskStatus, task-related payload types |
| `types/project.ts` | Project type |
| `types/auth.ts` | User, auth payload types |
| `types/slack.ts` | SlackContext, SlackBlock, SlackBlockMessage |
| `types/bot.ts` | BotPlugin, BotCommand, ParsedCommand, BotExecutionConfig |
| `types/messages.ts` | WSMessage, MessagePayloadMap, heartbeat/system payloads |
| `types/index.ts` | Barrel export |
| `schemas/messages.ts` | Zod schemas for WebSocket messages |
| `schemas/commands.ts` | Zod schemas for commands and project creation |
| `schemas/index.ts` | Barrel export |
| `utils/errors.ts` | BematicError hierarchy |
| `utils/ids.ts` | nanoid-based ID generators |
| `utils/logger.ts` | Pino logger factory |
| `utils/retry.ts` | Exponential backoff retry utility |
| `utils/ws-helpers.ts` | WebSocket message creation, serialization, parsing |
| `utils/message-truncation.ts` | Intelligent message truncation for Slack limits (head/tail/smart strategies) |
| `utils/index.ts` | Barrel export |

---

## packages/db/src/

| File | Purpose |
|------|---------|
| `index.ts` | Barrel export |
| `connection.ts` | SQLite connection with performance pragmas |
| `migrate.ts` | Schema push (DDL) for development |
| `schema/projects.ts` | Projects table definition |
| `schema/tasks.ts` | Tasks table definition |
| `schema/sessions.ts` | Sessions table definition |
| `schema/users.ts` | Users + user_project_permissions tables |
| `schema/audit-logs.ts` | Audit logs table definition |
| `schema/offline-queue.ts` | Offline queue table definition |
| `schema/prompt-history.ts` | Prompt history table definition |
| `schema/index.ts` | Barrel export |
| `repositories/base.repository.ts` | Abstract base with DB injection |
| `repositories/project.repository.ts` | Project CRUD + tests |
| `repositories/task.repository.ts` | Task CRUD + complete/fail helpers |
| `repositories/session.repository.ts` | Session CRUD + complete helper + cleanup |
| `repositories/user.repository.ts` | User CRUD + upsert |
| `repositories/audit-log.repository.ts` | Audit log creation + querying + cleanup |
| `repositories/offline-queue.repository.ts` | Queue operations |
| `repositories/prompt-history.repository.ts` | Prompt history CRUD + search + stats |
| `repositories/index.ts` | Barrel export |

---

## packages/bots/src/

| File | Purpose |
|------|---------|
| `index.ts` | Barrel export + registerAllBots() |
| `base/base-bot.ts` | Abstract BaseBotPlugin class |
| `base/bot-registry.ts` | Singleton bot registry |
| `base/command-parser.ts` | Text → ParsedCommand parser |
| `base/model-router.ts` | Intelligent model tier routing engine |
| `base/response-builder.ts` | Slack block formatting with smart truncation for long responses |
| `coder/coder.bot.ts` | CoderBot implementation |
| `reviewer/reviewer.bot.ts` | ReviewerBot implementation |
| `ops/ops.bot.ts` | OpsBot implementation |
| `planner/planner.bot.ts` | PlannerBot implementation |

---

## packages/cloud/src/

| File | Purpose |
|------|---------|
| `index.ts` | Main entry, server bootstrap |
| `config.ts` | Environment config loading |
| `context.ts` | Application context (DI container) |
| `error-handlers.ts` | Global unhandled rejection and exception handlers |
| `shutdown.ts` | Graceful shutdown orchestration |
| **Slack Integration** | |
| `slack/middleware/auth.middleware.ts` | User auth + permission checking |
| `slack/middleware/rate-limit.middleware.ts` | Per-user rate limiting |
| `slack/middleware/project.middleware.ts` | Channel → project resolution |
| `slack/middleware/logging.middleware.ts` | Request logging |
| `slack/middleware/index.ts` | Barrel export |
| `slack/listeners/mentions.ts` | @BematicManager mention handler |
| `slack/listeners/messages.ts` | Channel message listener |
| `slack/listeners/file-utils.ts` | Slack file attachment extraction for prompts |
| `slack/listeners/commands.ts` | Slash command handlers |
| `slack/listeners/actions.ts` | Interactive action handlers (retry/cancel) |
| `slack/listeners/config.ts` | /bm-config project configuration |
| `slack/listeners/admin.ts` | /bm-admin administrative commands |
| `slack/listeners/index.ts` | Barrel export |
| **WebSocket Gateway** | |
| `gateway/ws-server.ts` | WebSocket server setup |
| `gateway/agent-manager.ts` | Agent connection pool management |
| `gateway/message-router.ts` | Incoming agent message routing |
| `gateway/stream-accumulator.ts` | Batches streaming output for Slack |
| `gateway/offline-queue.ts` | Offline message queuing |
| `gateway/circuit-breaker.ts` | Circuit breaker pattern for agent failures |
| `gateway/agent-health-tracker.ts` | Agent health monitoring with circuit breaker |
| `gateway/message-buffer.ts` | Message buffering for connection recovery |
| `gateway/index.ts` | Barrel export |
| **Services** | |
| `services/command.service.ts` | Command orchestration |
| `services/notification.service.ts` | Slack notification posting with retry logic |
| `services/project.service.ts` | Project CRUD service |
| `services/deploy.service.ts` | Railway deployment integration |
| `services/retention.service.ts` | Data retention policy enforcement |
| `services/health.service.ts` | Health check and metrics reporting |
| `services/index.ts` | Barrel export |
| **Utilities** | |
| `utils/markdown-to-slack.ts` | Markdown → Slack format conversion |
| `utils/slack-retry.ts` | Slack API retry logic with exponential backoff |
| `utils/metrics.ts` | In-memory metrics collection |

---

## packages/agent/src/

| File | Purpose |
|------|---------|
| `index.ts` | Main entry, lifecycle management |
| `config.ts` | Agent config loading |
| `logging.ts` | File + stdout logging setup |
| `error-handlers.ts` | Global unhandled rejection and exception handlers |
| `shutdown.ts` | Graceful shutdown with task cancellation |
| `connection/ws-client.ts` | WebSocket client with reconnection |
| `connection/heartbeat.ts` | Heartbeat response handler |
| `executor/queue-processor.ts` | Task concurrency + per-project queuing |
| `executor/claude-executor.ts` | Claude SDK integration |
| `security/path-validator.ts` | Project path sandboxing |

---

## Root Files

| File | Purpose |
|------|---------|
| **Configuration** | |
| `package.json` | Workspace root, scripts, dev dependencies |
| `tsconfig.json` | TypeScript project references |
| `tsconfig.base.json` | Shared compiler options |
| `vitest.config.ts` | Test framework config |
| `railway.toml` | Railway deployment config |
| `.env.example` | Environment variable template |
| `.gitignore` | Git ignore rules |
| **Code Quality** | |
| `.eslintrc.json` | ESLint configuration with strict TypeScript rules |
| `.prettierrc.json` | Prettier code formatting configuration |
| `.prettierignore` | Prettier ignore patterns |
| `.lintstagedrc.json` | Lint-staged configuration for pre-commit hooks |
| **Git Hooks** | |
| `.husky/pre-commit` | Git pre-commit hook (runs lint-staged) |
| `.husky/pre-push` | Git pre-push hook (runs typecheck + tests) |
| **Documentation** | |
| `AGENTS.md` | Quick reference for AI agents |
| `Documentation/` | Comprehensive project documentation (15 files) |
