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
| BM Command | `bm-command.ts` | `/bm [subcommand]` | Main unified command handler with admin handlers architecture |
| NetSuite Command | `netsuite-command.ts` | `/bm netsuite` | NetSuite integration commands (config, get, seo, test) |
| Actions | `actions.ts` | Button clicks | Retry/cancel task interactive actions |
| Admin (legacy) | `admin.ts` | `/bm-admin` | Legacy admin commands (kept for backwards compatibility) |
| File Utils | `file-utils.ts` | File uploads | Secure file validation and processing |

---

## Handler Architecture

The cloud package uses a modular handler pattern for extensibility:

### Admin Command Handlers

| Handler | File | Purpose |
|---------|------|----------|
| API Keys | `admin-commands/api-keys.ts` | Generate, rotate, and manage agent API keys |
| Archive | `admin-commands/archive.ts` | Data archival and retention management |
| Cache | `admin-commands/cache.ts` | Cache management and statistics |
| Metrics | `admin-commands/metrics.ts` | System metrics and performance monitoring |
| Performance | `admin-commands/performance.ts` | Performance tuning and optimization |

### Cache & Performance Handlers

New specialized handlers for cache and performance management integrate with the core caching layer to provide:

- **Cache Statistics**: Usage metrics, hit/miss ratios, memory consumption
- **Cache Operations**: Manual invalidation, warming, size management
- **Performance Metrics**: Response times, throughput, resource utilization
- **Performance Optimization**: Automatic tuning recommendations

---

## WebSocket Gateway

### `ws-server.ts`
- Upgrades HTTP requests at path `/ws/agent` to WebSocket
- **Security**: Enforces WSS (secure WebSocket) in production environments with `verifyClient` callback
- **TLS Configuration**: Configures certificate validation and security options
- **Connection Logging**: Logs connection security status and origin information
- **Metrics Integration**: Tracks connection attempts and success rates
- Delegates to `AgentManager` for connection lifecycle

### `agent-manager.ts`
- Manages connected agent pool with connection state tracking
- **Authentication**: Validates API keys via `ApiKeyService` with database verification and audit logging
- **Connection Lifecycle**: Auth timeout, bidirectional keepalive, graceful disconnection
- **Circuit Breaker**: Implements circuit breaker pattern for connection reliability
- **Message Buffering**: Buffers messages during connection instability
- Sends/receives typed WebSocket messages with validation
- Handles agent disconnect: queues pending tasks in offline queue
- **Performance Metrics**: Tracks connection health, message throughput, error rates

### `message-router.ts`
- Routes incoming agent messages to appropriate handlers with enhanced processing
- **Parallel Message Processing**: Handles multiple message types concurrently
- **Cache Integration**: Caches frequently accessed data for performance
- **Error Recovery**: Implements retry logic and graceful error handling
- Dispatches by `MessageType`:
  - `TASK_ACK` → Update task status with performance metrics
  - `TASK_PROGRESS` → Update Slack thread with progress and resource usage
  - `TASK_STREAM` → Accumulate and batch-post to Slack with rate limiting
  - `TASK_COMPLETE` → Update DB, post final result, trigger archival if needed
  - `TASK_ERROR` → Update DB, post error, log for analysis
  - `TASK_CANCELLED` → Update DB, confirm in Slack, clean up resources
  - `AGENT_STATUS` → Log agent metrics, update health dashboard
- **Metrics Collection**: Tracks message processing times and success rates

### `stream-accumulator.ts`
- Batches Claude streaming output to avoid Slack rate limits
- Update interval: `Limits.SLACK_STREAM_UPDATE_INTERVAL_MS` (3 seconds)
- Truncates at ~3900 characters for Slack message limits
- Converts markdown to Slack format

### `offline-queue.ts`
- Wraps `OfflineQueueRepository` with enhanced queuing logic
- **Parallel Processing**: Processes multiple queue entries concurrently
- Enqueues messages with TTL when agent offline
- **Priority Queuing**: Supports priority-based message ordering
- Drains queue on agent reconnection with batch processing
- **Retry Logic**: Implements exponential backoff for failed deliveries
- Periodic cleanup of expired messages
- **Queue Metrics**: Tracks queue depth, processing times, success rates

---

## /bm Slash Commands

Primary command interface for development, operations, and configuration:

| Command | Permission | Purpose |
|---------|------------|---------|
| `/bm build` | TASK_CREATE | Compile/rebuild the app |
| `/bm test [args]` | TASK_CREATE | Run tests |
| `/bm status` | TASK_CREATE | Check git status & project health |
| `/bm sync` | USER_MANAGE | All-in-one: run tests → build → restart agent → deploy to Railway |
| `/bm deploy` | USER_MANAGE | Deploy to Railway |
| `/bm agents` | USER_MANAGE | Dashboard showing all agents, projects, and active tasks with IDs |
| `/bm queue` | USER_MANAGE | List all queued/pending tasks (project-specific or global) |
| `/bm cancel <task-id>` | USER_MANAGE | Cancel a specific running or queued task (stops execution on agent) |
| `/bm clear-queue` | USER_MANAGE | Clear all queued tasks for current project |
| `/bm clear-queue --all` | USER_MANAGE | Clear ALL queued tasks across ALL projects |
| `/bm restart [--rebuild]` | USER_MANAGE | Restart all connected agents (optionally rebuild TypeScript) |
| `/bm usage` | USER_MANAGE | View session usage & statistics |
| `/bm logs [limit]` | USER_MANAGE | View prompt history with optional filters |
| `/bm config` | PROJECT_MANAGE | Configure project settings via modal (name, path, agent, model, budget, auto-commit) |
| `/bm netsuite config` | PROJECT_MANAGE | Configure NetSuite credentials & endpoints (OAuth 1.0, RESTlet URL) |
| `/bm netsuite get <type> <id>` | TASK_CREATE | Fetch NetSuite record via RESTlet (e.g. `customer 1233`) |
| `/bm netsuite seo <url>` | TASK_CREATE | Generate SEO debug URL with prerender flags |
| `/bm netsuite test` | TASK_CREATE | Test NetSuite connection & authentication |

**Project Configuration**:

The `/bm config` modal allows configuring:
- **Project Name**: Display name for the project
- **Local Path**: Filesystem path on agent machine
- **Agent ID**: Which agent handles this project (auto-routing or specific agent)
- **Default Model**: Claude model to use (Sonnet 4.5, Opus 4.6, Haiku 4.5)
- **Default Max Budget**: Maximum cost per task in USD
- **Auto Commit & Push**: Whether to automatically commit and push changes after task completion
- **Railway Settings**: Optional deployment configuration

When **Auto Commit & Push** is enabled:
1. After task completion, agent stages all changed files (`git add -A`)
2. Creates a commit with task metadata (bot name, command, files changed, task ID)
3. Pushes to the current branch (`git push`)
4. Progress notifications shown in Slack
5. If commit/push fails, warning is shown but task completes successfully

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

*Sync Flow (All-in-One Deployment)*:
1. User runs `/bm sync` in project channel
2. Cloud queues test task via ops bot
3. Cloud queues build task via ops bot
4. Cloud schedules agent restart (5s delay)
5. Cloud schedules Railway deployment (10s delay)
6. Agent processes test and build tasks in order
7. Agent receives restart signal and gracefully shuts down (exit code 75)
8. Wrapper script restarts agent process
9. Agent reconnects and receives deployment request
10. Agent executes `railway up --detach` in project directory
11. Agent sends deployment result back to cloud
12. Cloud posts deployment status to Slack channel

**Note**: `/bm-admin` is kept for backwards compatibility but `/bm` is the primary interface.

---

## Services

| Service | File | Purpose |
|---------|------|---------|
| `CommandService` | `command.service.ts` | Orchestrates: bot resolution → model routing → task creation → agent submission; handles task cancellation |
| `NotificationService` | `notification.service.ts` | Slack messaging (progress, completion, errors, stream updates), emoji reactions, and file uploads |
| `ProjectService` | `project.service.ts` | CRUD operations for project configuration |
| `ApiKeyService` | `api-key.service.ts` | API key generation, validation, rotation, and management with database storage |
| `SlackUserService` | `slack-user.service.ts` | User management, profile caching, and Slack integration |
| `DeployService` | `deploy.service.ts` | Railway deployment integration |
| `RetentionService` | `retention.service.ts` | Data retention policy enforcement with archiving capabilities |
| `HealthService` | `health.service.ts` | Health check and metrics reporting with performance tracking |
| `NetSuiteService` | `netsuite.service.ts` | NetSuite integration: OAuth 1.0 authentication, RESTlet API calls, credential encryption |

---

## Security

### API Key Management

The `ApiKeyService` provides secure API key lifecycle management:

- **Database-backed Storage**: API keys stored in SQLite with metadata
- **Generation**: Creates cryptographically secure API keys (`bm_` prefix + 64 hex chars)
- **Validation**: Verifies API keys against database with revocation and expiration checks
- **Rotation**: Supports key rotation and revocation for security maintenance
- **Audit Trail**: All key operations are logged for security monitoring
- **Cleanup**: Automatic removal of expired and revoked keys

### File Validation

The `FileValidator` provides comprehensive security scanning for uploaded files:

- **Magic Number Detection**: Validates file types using byte signatures (PNG, JPEG, PDF, etc.)
- **MIME Type Validation**: Cross-references file extensions with content using whitelist approach
- **Security Levels**: Categorizes files as safe, caution, or blocked
- **Executable Detection**: Blocks executable files (PE, ELF, Mach-O) via magic numbers
- **Extension Blocking**: Blocks dangerous extensions (.exe, .bat, .ps1, etc.)
- **Content Scanning**: Basic scanning for malicious patterns (SVG scripts, etc.)
- **Size Limits**: Enforces category-specific file size limits
- **Virus Scanning**: Placeholder for future antivirus integration

### Security Headers

The `SecurityHeadersMiddleware` adds essential security headers:

- **CSP**: Content Security Policy preventing XSS attacks
- **HSTS**: HTTP Strict Transport Security for HTTPS enforcement
- **Frame Options**: X-Frame-Options to prevent clickjacking
- **Content Type**: X-Content-Type-Options to prevent MIME sniffing
- **Referrer Policy**: Controls referrer information leakage

---

## Admin Commands

New `/bm` command structure provides comprehensive management:

| Command | File | Purpose |
|---------|------|---------|
| API Keys | `slack/admin-commands/api-keys.ts` | Generate, rotate, and revoke agent API keys with database integration |
| Archive Management | `slack/admin-commands/archive.ts` | Archive and restore tasks, manage retention policies |
| Cache Operations | `slack/admin-commands/cache.ts` | Cache statistics, manual invalidation, warming operations |
| Metrics Dashboard | `slack/admin-commands/metrics.ts` | Real-time system metrics, performance tracking |
| Performance Tuning | `slack/admin-commands/performance.ts` | Performance optimization recommendations |
| Agent Management | `slack/admin-commands/agent-commands.ts` | View and manage connected agents |
| Deployment | `slack/admin-commands/deploy-commands.ts` | Deploy to Railway with build status |
| Health Monitoring | `slack/admin-commands/health-commands.ts` | System health and metrics |
| Log Management | `slack/admin-commands/logs-commands.ts` | View prompt history and execution logs |
| Data Retention | `slack/admin-commands/retention-commands.ts` | Manage data retention policies |
| Worker Operations | `slack/admin-commands/worker-commands.ts` | Background worker management |

---

## Caching Integration

The cloud package implements a comprehensive caching layer:

### Cache Strategy

- **LRU Eviction**: Least Recently Used items are evicted when cache is full
- **TTL Support**: Time-to-live expiration for cache entries
- **Cache Layers**: Multiple cache instances for different data types
- **Memory Management**: Configurable memory limits and monitoring

### Cache Usage

| Data Type | TTL | Purpose |
|-----------|-----|----------|
| User Profiles | 15 minutes | Slack user information caching |
| Project Metadata | 30 minutes | Project configuration caching |
| Bot Definitions | 60 minutes | Bot persona and system prompt caching |
| API Key Validation | 5 minutes | Reduce database hits for key validation |
| Health Metrics | 1 minute | Recent system health data |

### Cache Metrics

- **Hit/Miss Ratios**: Track cache effectiveness
- **Memory Usage**: Monitor cache memory consumption
- **Eviction Rates**: Track how often items are evicted
- **Response Time**: Measure cache vs database performance

---

## Data Retention & Archival

### Retention Service

The `RetentionService` implements comprehensive data lifecycle management:

**Default Retention Policies**:
- Tasks: 30 days (completed/failed)
- Audit logs: 90 days
- Offline queue: 24 hours
- Archives: 365 days

**Archival Process**:
1. **Pre-deletion Archival**: Tasks are archived before deletion if `archiveBeforeDelete: true`
2. **Archive Storage**: Archived tasks stored in separate `archived_tasks` table with metadata
3. **Archive Retention**: Archives have separate retention period (default: 1 year)
4. **Restoration**: Archived tasks can be restored to main table with new IDs

**Archive Metadata**:
- Original task ID and creation time
- Archive timestamp and reason
- Full task data as JSON
- Project and user associations
- Task status at archive time

### Archival Triggers

- **Manual**: Via admin commands (`/bm archive`)
- **Automatic**: Via retention policies (scheduled)
- **Policy-based**: Custom rules based on task age, status, or size

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
- Environment: Production with WSS enforcement
- Security headers: Enabled via middleware

---

## Cross-References

For detailed information on related topics, see:

- [Security & Authentication (Doc 15)](./15-security-auth.md) - API key management, file validation
- [Performance & Caching (Doc 16)](./16-performance-caching.md) - Caching strategies, optimization
- [Monitoring & Metrics (Doc 17)](./17-monitoring-metrics.md) - System metrics, health monitoring
- [Testing Framework (Doc 18)](./18-testing-framework.md) - Test utilities, integration tests
