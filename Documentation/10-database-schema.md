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
             │
users    1──┬──N user_project_permissions
             │
agents   1──┬──N offline_queue (by agent_id)
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
