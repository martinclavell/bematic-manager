# 10 — Database Schema Reference

[← Back to Index](./README.md)

---

For complete column-by-column schema definitions, see [04 — Package: @bematic/db](./04-package-db.md#schema).

---

## Entity Relationships

```
projects 1──┬──N tasks
            ├──N scheduled_tasks
             │
tasks    1──┬──N sessions
tasks    1──┬──N tasks (parent_task_id self-reference for subtasks)
             │
users    1──┬──N user_project_permissions
            ├──N scheduled_tasks
             │
agents   1──┬──N offline_queue (by agent_id)
agents   1──┬──N api_keys (by agent_id)
```

---

## JSON-Encoded Columns

These TEXT columns store JSON arrays/objects:

| Table | Column | Format |
|-------|--------|--------|
| `tasks` | `files_changed` | `string[]` — list of file paths |
| `tasks` | `commands_run` | `string[]` — list of shell commands |
| `user_project_permissions` | `permissions` | `string[]` — permission constants |
| `audit_logs` | `metadata` | `Record<string, any>` — arbitrary metadata |
| `prompt_history` | `tags` | `string[]` — categorization tags |
| `prompt_history` | `related_files` | `string[]` — list of file paths |
| `scheduled_tasks` | `metadata` | `Record<string, any>` — task metadata (reminderType, context, files, etc.) |

---

## New Tables

### `api_keys` table

Added for secure agent authentication and key rotation:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Unique identifier |
| `key` | TEXT NOT NULL UNIQUE | Encrypted API key value |
| `agent_id` | TEXT NOT NULL | Associated agent identifier |
| `created_at` | INTEGER NOT NULL | Creation timestamp |
| `expires_at` | INTEGER NULL | Optional expiration timestamp |
| `last_used_at` | INTEGER NULL | Last usage tracking |
| `revoked` | BOOLEAN NOT NULL | Revocation status (default: false) |

**Key Features**:
- Cryptographically secure key generation
- Optional expiration for time-limited access
- Usage tracking for security monitoring
- Soft deletion via revocation flag
- Full audit trail integration

### `scheduled_tasks` table

Added for scheduled task execution and cron job management:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Unique identifier |
| `project_id` | TEXT NOT NULL FK | Associated project |
| `user_id` | TEXT NOT NULL | Slack user who created the task |
| `task_type` | TEXT NOT NULL | Type: reminder/prompt_execution/recurring_job |
| `bot_name` | TEXT NOT NULL | Bot to execute (coder/reviewer/ops/planner) |
| `command` | TEXT NOT NULL | Command name (e.g., "fix", "review") |
| `prompt` | TEXT NOT NULL | Task prompt text |
| `scheduled_for` | TEXT NOT NULL | ISO timestamp for next execution |
| `timezone` | TEXT NOT NULL | User's timezone (e.g., 'America/New_York') |
| `cron_expression` | TEXT NULL | Cron expression for recurring tasks |
| `is_recurring` | BOOLEAN NOT NULL | Whether this is a recurring task |
| `next_execution_at` | TEXT NULL | Cached next run time (indexed) |
| `execution_count` | INTEGER NOT NULL | Number of times executed |
| `max_executions` | INTEGER NULL | Optional execution limit |
| `status` | TEXT NOT NULL | Status: pending/active/paused/completed/cancelled/failed |
| `enabled` | BOOLEAN NOT NULL | Whether task is enabled |
| `metadata` | TEXT NOT NULL | JSON metadata (default: `{}`) |
| `expires_at` | TEXT NULL | Auto-cancel after this date |

**Key Features**:
- Natural language time parsing ("tomorrow 9am", "in 2 hours")
- Full cron expression support ("0 0 * * *")
- Timezone-aware execution
- Per-user quota enforcement (50 tasks max)
- Minimum 1-hour interval for recurring tasks
- Indexed for efficient due task queries
- Comprehensive audit trail
