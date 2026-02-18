# 06 — Package: @bematic/cloud

[← Back to Index](./README.md)

---

**Purpose**: Cloud-deployed service — Slack bot integration, WebSocket gateway for agents, HTTP health endpoint, database operations.

**Dependencies**: `@bematic/common`, `@bematic/db`, `@bematic/bots`, `@slack/bolt`, `ws`, `pino`, `dotenv`

---

## Entry Point (`index.ts`)

Bootstrap sequence:
1. Load config from environment
2. Initialize SQLite database and push schema
3. Create application context (DI container)
4. Register all bot plugins
5. Register Slack middleware chain
6. Register Slack event listeners
7. Start WebSocket server
8. Start HTTP server (health endpoint)
9. Start Slack app in Socket Mode

---

## Application Context (`context.ts`)

Central dependency injection container holding:
- Database connection
- All repositories (project, task, session, user, audit, offline queue)
- Slack `App` instance
- Agent manager reference
- Logger

---

## Slack Middleware Chain

Executed in order for every incoming Slack event:

| Middleware | File | Purpose |
|-----------|------|---------|
| Logging | `logging.middleware.ts` | Log all incoming events |
| Auth | `auth.middleware.ts` | User lookup/auto-provision, role validation, permission check |
| Rate Limit | `rate-limit.middleware.ts` | Per-user sliding window rate limiting |
| Project | `project.middleware.ts` | Channel → project mapping, injects project into context |

---

## Slack Listeners

| Listener | File | Triggers On | Description |
|----------|------|-------------|-------------|
| Mentions | `mentions.ts` | `@BematicManager ...` | Primary UX — resolve bot, parse command, create task, submit to agent |
| Messages | `messages.ts` | Channel messages | Auto-detect tasks in configured project channels |
| BM Command | `bm-command.ts` | `/bm [subcommand]` | Main unified command handler (build, test, deploy, agents, cancel, restart, config, logs, etc.) |
| Actions | `actions.ts` | Button clicks | Retry/cancel task interactive actions |
| Admin (legacy) | `admin.ts` | `/bm-admin` | Legacy admin commands (kept for backwards compatibility) |

---

## WebSocket Gateway

### `ws-server.ts`
- Upgrades HTTP requests at path `/ws/agent` to WebSocket
- Delegates to `AgentManager` for connection lifecycle

### `agent-manager.ts`
- Manages connected agent pool
- Authentication: validates API key from `AGENT_API_KEYS`
- Connection lifecycle: auth timeout, heartbeat monitoring
- Sends/receives typed WebSocket messages
- Handles agent disconnect: queues pending tasks

### `message-router.ts`
- Routes incoming agent messages to appropriate handlers
- Dispatches by `MessageType`:
  - `TASK_ACK` → Update task status
  - `TASK_PROGRESS` → Update Slack thread with progress
  - `TASK_STREAM` → Accumulate and batch-post to Slack
  - `TASK_COMPLETE` → Update DB, post final result to Slack
  - `TASK_ERROR` → Update DB, post error to Slack
  - `TASK_CANCELLED` → Update DB, confirm in Slack
  - `AGENT_STATUS` → Log agent metrics

### `stream-accumulator.ts`
- Batches Claude streaming output to avoid Slack rate limits
- Update interval: `Limits.SLACK_STREAM_UPDATE_INTERVAL_MS` (3 seconds)
- Truncates at ~3900 characters for Slack message limits
- Converts markdown to Slack format

### `offline-queue.ts`
- Wraps `OfflineQueueRepository`
- Enqueues messages with TTL when agent offline
- Drains queue on agent reconnection
- Periodic cleanup of expired messages

---

## /bm Slash Commands

Primary command interface for development, operations, and configuration:

| Command | Permission | Purpose |
|---------|------------|---------|
| `/bm build` | TASK_CREATE | Compile/rebuild the app |
| `/bm test [args]` | TASK_CREATE | Run tests |
| `/bm status` | TASK_CREATE | Check git status & project health |
| `/bm deploy` | USER_MANAGE | Deploy to Railway |
| `/bm agents` | USER_MANAGE | Dashboard showing all agents, projects, and active tasks with IDs |
| `/bm queue` | USER_MANAGE | List all queued/pending tasks (project-specific or global) |
| `/bm cancel <task-id>` | USER_MANAGE | Cancel a specific running or queued task (stops execution on agent) |
| `/bm clear-queue` | USER_MANAGE | Clear all queued tasks for current project |
| `/bm clear-queue --all` | USER_MANAGE | Clear ALL queued tasks across ALL projects |
| `/bm restart [--rebuild]` | USER_MANAGE | Restart all connected agents (optionally rebuild TypeScript) |
| `/bm usage` | USER_MANAGE | View session usage & statistics |
| `/bm logs [limit]` | USER_MANAGE | View prompt history with optional filters |
| `/bm config` | PROJECT_MANAGE | Configure project settings via modal |

**Task & Queue Management Flows**:

*Viewing Queued Tasks*:
1. User runs `/bm queue` in a project channel (shows project-specific queue)
2. OR runs `/bm queue` in any channel (shows all queued tasks across all projects)
3. Each task displays: ID, status, bot, command, prompt preview, project, user, age

*Cancelling a Task*:
1. User runs `/bm agents` or `/bm queue` to see task IDs (displayed as `` `task_xyz123` ``)
2. User runs `/bm cancel task_xyz123`
3. Cloud sends `TASK_CANCEL` message to agent via WebSocket
4. Agent aborts the task using `AbortController`
5. Agent sends `TASK_CANCELLED` confirmation back
6. Cloud updates task status to `cancelled` in database
7. Slack notification posted to task thread

*Clearing Queue*:
1. User runs `/bm clear-queue` in project channel → cancels all queued tasks for that project
2. OR runs `/bm clear-queue --all` anywhere → cancels ALL queued tasks across ALL projects (requires `--all` flag as safety)
3. Each task is cancelled individually and logged in audit trail

**Note**: `/bm-admin` is kept for backwards compatibility but `/bm` is the primary interface.

---

## Services

| Service | File | Purpose |
|---------|------|---------|
| `CommandService` | `command.service.ts` | Orchestrates: bot resolution → command parsing → task creation → agent submission; handles task cancellation |
| `NotificationService` | `notification.service.ts` | Slack messaging (progress, completion, errors, stream updates) and emoji reactions |
| `ProjectService` | `project.service.ts` | CRUD operations for project configuration |

---

## HTTP Endpoints

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/health` | `{ status: 'ok', agents: count, uptime: seconds }` |

---

## Deployment

**Dockerfile** (multi-stage):
```
Stage 1 (builder): Install deps + build all packages in order
Stage 2 (production): Copy only package.json + dist artifacts, create /app/data for SQLite
```

**Railway config** (`railway.toml`):
- Build: uses `packages/cloud/Dockerfile`
- Health check: `/health`, 30s timeout
- Restart policy: ON_FAILURE, max 5 retries
