# 01 — Project Overview & Architecture

[← Back to Index](./README.md)

---

## Project Overview

**Bematic Manager** is a dual-component, enterprise-grade system that enables development teams to interact with AI-powered coding agents (Claude) through Slack. Users invoke specialized bot personas via Slack mentions or slash commands, and tasks are routed over WebSocket to local agents that execute Claude sessions on actual project codebases.

### Key Capabilities

- **Slack-native UX**: Users submit tasks via `@BematicManager code fix the login bug` or `/bm-code fix the login bug`
- **Specialized bot personas**: Coder, Reviewer, Ops, Planner — each with tailored system prompts and tool permissions
- **Real-time streaming**: Claude's output streams directly into Slack threads
- **Project isolation**: One active task per project directory, preventing file conflicts
- **Cost tracking**: Token usage and estimated costs tracked per task/session
- **Offline resilience**: Tasks queued in SQLite when agents disconnect
- **RBAC**: Admin / Developer / Viewer roles with fine-grained permissions
- **Full audit trail**: Every action logged for security compliance

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ES2022, Node16 modules) |
| Runtime | Node.js >= 20 |
| Monorepo | npm workspaces |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| AI SDK | @anthropic-ai/claude-code |
| Slack | @slack/bolt (Socket Mode) |
| WebSocket | ws library |
| Validation | Zod |
| Logging | Pino |
| Testing | Vitest |
| Deployment (Cloud) | Railway + Docker |
| Deployment (Agent) | Local machine, bash wrapper script |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    SLACK WORKSPACE                        │
│  User: @BematicManager code fix the login bug            │
└──────────────────────┬──────────────────────────────────┘
                       │ Socket Mode (no public URL)
                       ▼
┌─────────────────────────────────────────────────────────┐
│              CLOUD (Railway)                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │ Slack Bot │→ │ Middleware│→ │ Command Service      │   │
│  │ (Bolt)   │  │ (Auth,   │  │ (Bot Registry,       │   │
│  │          │  │  RateLimit│  │  Task Creation)      │   │
│  │          │  │  Project) │  │                      │   │
│  └──────────┘  └──────────┘  └──────────┬───────────┘   │
│                                          │               │
│  ┌──────────────────┐   ┌────────────────▼──────────┐   │
│  │ SQLite Database   │   │ WebSocket Gateway         │   │
│  │ (Drizzle ORM)    │   │ (Agent Manager,           │   │
│  │                   │   │  Message Router,          │   │
│  │ - projects        │   │  Stream Accumulator,      │   │
│  │ - tasks           │   │  Offline Queue)           │   │
│  │ - sessions        │   │                           │   │
│  │ - users           │   └────────────┬──────────────┘   │
│  │ - audit_logs      │                │                   │
│  │ - offline_queue   │                │ WSS               │
│  └──────────────────┘                │                   │
└──────────────────────────────────────┼───────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────┐
│              AGENT (Local Machine)                        │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │ WS Client    │→ │ Queue         │→ │ Claude       │  │
│  │ (Auth,       │  │ Processor     │  │ Executor     │  │
│  │  Reconnect,  │  │ (Concurrency, │  │ (SDK,        │  │
│  │  Heartbeat)  │  │  Per-project) │  │  Streaming,  │  │
│  │              │  │               │  │  Tools)      │  │
│  └──────────────┘  └───────────────┘  └──────┬───────┘  │
│                                               │          │
│  ┌──────────────┐                             ▼          │
│  │ Path         │              Local Project Filesystem  │
│  │ Validator    │                                        │
│  └──────────────┘                                        │
└─────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Cloud-Agent split**: All business logic (bots, DB, Slack) lives in cloud. Agent is a thin, isolated executor.
2. **Agent has ZERO dependency on db or bots packages** — intentional security boundary.
3. **Single Slack app, multiple bot personas** — keyword routing, not separate apps.
4. **One active Claude session per project directory** — prevents file conflicts.
5. **Type-safe WebSocket protocol** — Zod-validated discriminated union messages.
6. **Offline-first messaging** — SQLite queue with 24h TTL for disconnected agents.
