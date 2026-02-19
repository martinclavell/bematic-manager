# 10 — Database Schema Reference

[← Back to Index](./README.md)

---

For complete column-by-column schema definitions, see [04 — Package: @bematic/db](./04-package-db.md#schema).

---

## Entity Relationships

```
projects 1──┬──N tasks
             │
tasks    1──┬──N sessions
tasks    1──┬──N tasks (parent_task_id self-reference for subtasks)
             │
users    1──┬──N user_project_permissions
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
