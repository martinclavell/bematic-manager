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
| Commands | `commands.ts` | `/bm-code`, `/bm-review`, `/bm-ops`, `/bm-plan` | Slash command handling |
| Actions | `actions.ts` | Button clicks | Retry/cancel task interactive actions |
| Config | `config.ts` | `/bm-config` | Project configuration modal (admin) |
| Admin | `admin.ts` | `/bm-admin` | Agent restart, status commands |

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

## Services

| Service | File | Purpose |
|---------|------|---------|
| `CommandService` | `command.service.ts` | Orchestrates: bot resolution → command parsing → task creation → agent submission |
| `NotificationService` | `notification.service.ts` | Slack thread posting: progress, completion, errors, stream updates |
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
