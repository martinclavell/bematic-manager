# 04 — Package: @bematic/db

[← Back to Index](./README.md)

---

**Purpose**: Database layer — SQLite schema, connection management, and repository pattern for data access.

**Dependencies**: `@bematic/common`, `better-sqlite3`, `drizzle-orm`
**Dev Dependencies**: `drizzle-kit`, `tsx`

---

## Connection (`connection.ts`)

- SQLite via `better-sqlite3`
- Path: `DATABASE_URL` env var or `./data/bematic.db`
- Performance pragmas applied on connect:
  - WAL journal mode
  - 5s busy timeout
  - 20MB cache
  - Foreign keys enabled
  - NORMAL synchronous mode

---

## Schema

All tables use TEXT primary keys (nanoid-generated) except `audit_logs`, `offline_queue`, `user_project_permissions`, and `prompt_history` which use INTEGER autoincrement.

### `projects` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | nanoid |
| `name` | TEXT NOT NULL | |
| `slack_channel_id` | TEXT NOT NULL UNIQUE | |
| `local_path` | TEXT NOT NULL | filesystem path on agent |
| `agent_id` | TEXT NOT NULL | which agent handles this project |
| `default_model` | TEXT NOT NULL | default: `claude-sonnet-4-5-20250929` |
| `default_max_budget` | REAL NOT NULL | default: 5.0 |
| `auto_commit_push` | BOOLEAN NOT NULL | default: false — auto-commit and push changes after task completion |
| `active` | BOOLEAN NOT NULL | default: true |
| `created_at` | TEXT NOT NULL | ISO string |
| `updated_at` | TEXT NOT NULL | ISO string |

### `tasks` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | nanoid |
| `project_id` | TEXT NOT NULL FK→projects | |
| `bot_name` | TEXT NOT NULL | coder/reviewer/ops/planner |
| `command` | TEXT NOT NULL | e.g., "fix", "review" |
| `prompt` | TEXT NOT NULL | user's input |
| `status` | TEXT NOT NULL | pending/queued/running/completed/failed/cancelled |
| `result` | TEXT NULL | completion result |
| `error_message` | TEXT NULL | |
| `slack_channel_id` | TEXT NOT NULL | |
| `slack_thread_ts` | TEXT NULL | |
| `slack_user_id` | TEXT NOT NULL | |
| `slack_message_ts` | TEXT NULL | User's original message ts (for emoji reactions) |
| `session_id` | TEXT NULL | |
| `input_tokens` | INTEGER NOT NULL | default: 0 |
| `output_tokens` | INTEGER NOT NULL | default: 0 |
| `estimated_cost` | REAL NOT NULL | default: 0 |
| `max_budget` | REAL NOT NULL | default: 5.0 |
| `files_changed` | TEXT NOT NULL | JSON array, default: `[]` |
| `commands_run` | TEXT NOT NULL | JSON array, default: `[]` |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |
| `completed_at` | TEXT NULL | |

### `sessions` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `task_id` | TEXT NOT NULL FK→tasks | |
| `agent_id` | TEXT NOT NULL | |
| `model` | TEXT NOT NULL | |
| `input_tokens` | INTEGER NOT NULL | default: 0 |
| `output_tokens` | INTEGER NOT NULL | default: 0 |
| `estimated_cost` | REAL NOT NULL | default: 0 |
| `duration_ms` | INTEGER NULL | |
| `status` | TEXT NOT NULL | default: 'active' |
| `created_at` | TEXT NOT NULL | |
| `completed_at` | TEXT NULL | |

### `users` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | |
| `slack_user_id` | TEXT NOT NULL UNIQUE | |
| `slack_username` | TEXT NOT NULL | |
| `role` | TEXT NOT NULL | admin/developer/viewer, default: 'developer' |
| `rate_limit_override` | INTEGER NULL | |
| `active` | BOOLEAN NOT NULL | default: true |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |

### `user_project_permissions` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTO | |
| `user_id` | TEXT NOT NULL FK→users | |
| `project_id` | TEXT NOT NULL | |
| `permissions` | TEXT NOT NULL | JSON array, default: `[]` |
| `created_at` | TEXT NOT NULL | |

### `audit_logs` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTO | |
| `action` | TEXT NOT NULL | |
| `user_id` | TEXT NULL | |
| `resource_type` | TEXT NOT NULL | |
| `resource_id` | TEXT NULL | |
| `metadata` | TEXT NOT NULL | JSON, default: `{}` |
| `timestamp` | TEXT NOT NULL | |

### `offline_queue` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTO | |
| `agent_id` | TEXT NOT NULL | |
| `message_type` | TEXT NOT NULL | |
| `payload` | TEXT NOT NULL | JSON |
| `created_at` | TEXT NOT NULL | |
| `expires_at` | TEXT NOT NULL | |
| `delivered` | BOOLEAN NOT NULL | default: false |
| `delivered_at` | TEXT NULL | |

### `api_keys` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | nanoid |
| `key` | TEXT NOT NULL UNIQUE | encrypted API key |
| `agent_id` | TEXT NOT NULL | agent identifier |
| `created_at` | INTEGER NOT NULL | timestamp |
| `expires_at` | INTEGER NULL | timestamp |
| `last_used_at` | INTEGER NULL | timestamp |
| `revoked` | BOOLEAN NOT NULL | default: false |

### `prompt_history` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | INTEGER PK AUTO | |
| `prompt` | TEXT NOT NULL | The task/prompt text |
| `category` | TEXT NULL | feature/bugfix/refactor/documentation/research |
| `tags` | TEXT NOT NULL | JSON array, default: `[]` |
| `context` | TEXT NULL | Additional context/notes |
| `related_files` | TEXT NOT NULL | JSON array of file paths, default: `[]` |
| `execution_status` | TEXT NOT NULL | pending/completed/failed/cancelled, default: 'pending' |
| `execution_notes` | TEXT NULL | What was actually done |
| `estimated_duration_minutes` | INTEGER NULL | |
| `actual_duration_minutes` | INTEGER NULL | |
| `timestamp` | TEXT NOT NULL | ISO string |
| `completed_at` | TEXT NULL | ISO string |

### `netsuite_configs` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | nanoid |
| `project_id` | TEXT NOT NULL UNIQUE | FK to `projects.id`, CASCADE on delete |
| `account_number` | TEXT NOT NULL | NetSuite account number |
| `production_url` | TEXT NOT NULL | Production NetSuite URL |
| `sandbox_url` | TEXT NULL | Optional sandbox URL |
| `restlet_url` | TEXT NOT NULL | RESTlet endpoint URL |
| `consumer_key` | TEXT NOT NULL | Encrypted OAuth consumer key |
| `consumer_secret` | TEXT NOT NULL | Encrypted OAuth consumer secret |
| `token_id` | TEXT NOT NULL | Encrypted OAuth token ID |
| `token_secret` | TEXT NOT NULL | Encrypted OAuth token secret |
| `created_at` | TEXT NOT NULL | ISO string |
| `updated_at` | TEXT NOT NULL | ISO string |

### `scheduled_tasks` table

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | nanoid |
| `project_id` | TEXT NOT NULL FK→projects | |
| `user_id` | TEXT NOT NULL | Slack user ID |
| `task_type` | TEXT NOT NULL | reminder/prompt_execution/recurring_job |
| `bot_name` | TEXT NOT NULL | coder/reviewer/ops/planner |
| `command` | TEXT NOT NULL | e.g., "fix", "review" |
| `prompt` | TEXT NOT NULL | Task prompt |
| `scheduled_for` | TEXT NOT NULL | ISO timestamp for next execution |
| `timezone` | TEXT NOT NULL | e.g., 'America/New_York' |
| `cron_expression` | TEXT NULL | For recurring tasks (e.g., '0 0 * * *') |
| `is_recurring` | BOOLEAN NOT NULL | default: false |
| `last_executed_at` | TEXT NULL | ISO string |
| `next_execution_at` | TEXT NULL | Cached next run time |
| `execution_count` | INTEGER NOT NULL | default: 0 |
| `max_executions` | INTEGER NULL | Limit for recurring tasks |
| `status` | TEXT NOT NULL | pending/active/paused/completed/cancelled/failed, default: 'pending' |
| `enabled` | BOOLEAN NOT NULL | default: true |
| `slack_channel_id` | TEXT NOT NULL | |
| `slack_thread_ts` | TEXT NULL | Original thread context |
| `metadata` | TEXT NOT NULL | JSON, default: `{}` |
| `created_at` | TEXT NOT NULL | ISO string |
| `updated_at` | TEXT NOT NULL | ISO string |
| `last_triggered_at` | TEXT NULL | ISO string |
| `expires_at` | TEXT NULL | Auto-cancel after this date |

**Indexes**: `next_execution_at`, `status+enabled`, `project_id`, `user_id`

---

## Repositories

All repositories extend `BaseRepository` which receives a DB instance via constructor injection.

| Repository | Key Methods |
|-----------|-------------|
| `ProjectRepository` | `create`, `findById`, `findByChannelId`, `findByAgentId`, `findAll`, `update`, `delete` |
| `TaskRepository` | `create`, `findById`, `findByProjectId(id, limit?)`, `findByStatus`, `findActiveByProjectId`, `update`, `complete(id, result, metrics)`, `fail(id, errorMessage)` |
| `SessionRepository` | `create`, `findById`, `findByTaskId`, `complete(id, metrics)` |
| `UserRepository` | `create`, `findById`, `findBySlackUserId`, `upsert`, `updateRole`, `findAll` |
| `AuditLogRepository` | `create`, `log(action, resourceType, resourceId?, userId?, metadata?)`, `findRecent(limit?)` |
| `OfflineQueueRepository` | `enqueue`, `findPendingByAgentId`, `markDelivered`, `cleanExpired` |
| `NetSuiteConfigRepository` | `create`, `findById`, `findByProjectId`, `findAll`, `update`, `upsertByProjectId`, `delete`, `deleteByProjectId` |
| `ApiKeyRepository` | `create`, `findById`, `findByKey`, `findByAgentId`, `updateLastUsed`, `revoke`, `findActive`, `cleanup` |
| `PromptHistoryRepository` | `create`, `log(prompt, options?)`, `findById`, `findAll(options?)`, `findRecent(limit?)`, `update`, `complete`, `fail`, `cancel`, `getStats`, `getCategories`, `getTags`, `delete` |
| `ScheduledTaskRepository` | `create`, `findById`, `findAll(options?)`, `findByProjectId`, `findByUserId`, `findDue`, `findUpcoming(limit)`, `findActive`, `findByStatus`, `update`, `pause`, `resume`, `cancel`, `markExecuted`, `delete`, `countByUser` |

---

## CLI Tools

### Prompt History Viewer

```bash
# View recent 20 prompts
npm run history

# View all prompts
npm run history -- --all

# View last 50 prompts
npm run history -- --limit 50

# Search prompts
npm run history -- --search "authentication"

# Filter by category
npm run history -- --category bugfix

# Filter by status
npm run history -- --status completed

# Filter by tag
npm run history -- --tag security

# Show statistics
npm run history -- --stats

# List categories
npm run history -- --categories

# List tags
npm run history -- --tags
```

### Prompt Logger

```bash
# Log a prompt
npm run log-prompt -- "Add user authentication"

# With category
npm run log-prompt -- "Fix login bug" --category bugfix

# With tags
npm run log-prompt -- "Refactor API" --category refactor --tag api --tag performance

# With context and files
npm run log-prompt -- "Update docs" --category documentation --context "API reference" --file README.md
```

---

## Migrations

- **Development**: `pushSchema()` in `migrate.ts` — creates tables with raw SQL DDL
- **Production**: `drizzle-kit generate` + `drizzle-kit migrate`
- **Config**: `drizzle.config.ts` — points to schema files, SQLite dialect

---

## Exported Types

```typescript
// Row types (select)
ProjectRow, TaskRow, SessionRow, UserRow, UserProjectPermissionRow, AuditLogRow, OfflineQueueRow, ApiKeyRow, PromptHistoryRow, ScheduledTaskRow

// Insert types
ProjectInsert, TaskInsert, SessionInsert, UserInsert, AuditLogInsert, OfflineQueueInsert, ApiKeyInsert, PromptHistoryInsert, ScheduledTaskInsert

// Database connection type
DB
```
