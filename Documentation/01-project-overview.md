# 01 — Project Overview & Architecture

[← Back to Index](./README.md)

---

## Project Overview

**Bematic Manager** is a dual-component, enterprise-grade system that enables development teams to interact with AI-powered coding agents (Claude) through Slack. Users invoke specialized bot personas via Slack mentions or slash commands, and tasks are routed over WebSocket to local agents that execute Claude sessions on actual project codebases.

### Key Capabilities

- **Slack-native UX**: Users submit tasks via `@BematicManager code fix the login bug` or `/bm-code fix the login bug`
- **Specialized bot personas**: Coder, Reviewer, Ops, Planner — each with tailored system prompts and tool permissions
- **Intelligent model routing**: Quality-focused strategy automatically selects optimal models (Sonnet/Opus)
- **Real-time streaming**: Claude's output streams directly into Slack threads
- **Project isolation**: One active task per project directory, preventing file conflicts
- **Connection resilience**: Circuit breaker, exponential backoff, bidirectional keepalive
- **Performance optimization**: Caching layer, parallel processing, resource monitoring
- **Cost tracking**: Token usage and estimated costs tracked per task/session
- **Offline resilience**: Tasks queued in SQLite when agents disconnect
- **RBAC**: Admin / Developer / Viewer roles with fine-grained permissions
- **Security features**: File validation, secure WebSocket (WSS), API key management
- **Full audit trail**: Every action logged for security compliance
- **Data archiving**: Retention policies with configurable archival periods

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (ES2022, Node16 modules) |
| Runtime | Node.js >= 20 |
| Monorepo | npm workspaces |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Caching | In-memory LRU cache with TTL |
| AI SDK | @anthropic-ai/claude-code |
| Slack | @slack/bolt (Socket Mode) |
| WebSocket | ws library (with WSS enforcement) |
| Security | File validation, API key rotation, security headers |
| Metrics | Custom metrics collection and monitoring |
| Validation | Zod |
| Logging | Pino |
| Testing | Vitest with comprehensive test coverage |
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
│  │          │  │  RateLimit│  │  Model Routing,      │   │
│  │          │  │  Project, │  │  Task Creation)      │   │
│  │          │  │  Security)│  │                      │   │
│  └──────────┘  └──────────┘  └──────────┬───────────┘   │
│                                          │               │
│  ┌──────────────────┐   ┌────────────────▼──────────┐   │
│  │ SQLite Database   │   │ WebSocket Gateway         │   │
│  │ (Drizzle ORM)    │   │ (Agent Manager,           │   │
│  │                   │   │  Circuit Breaker,         │   │
│  │ - projects        │   │  Message Router,          │   │
│  │ - tasks           │   │  Stream Accumulator,      │   │
│  │ - sessions        │   │  Parallel Queue,          │   │
│  │ - users           │   │  Offline Queue)           │   │
│  │ - audit_logs      │   │                           │   │
│  │ - offline_queue   │   └────────────┬──────────────┘   │
│  │ - api_keys        │                │                   │
│  │ - archived_tasks  │                │ WSS + TLS         │
│  └───────┬───────────┘                │                   │
│          │                            │                   │
│  ┌───────▼───────────┐                │                   │
│  │ Services Layer    │                │                   │
│  │ - ApiKeyService   │                │                   │
│  │ - RetentionSvc    │                │                   │
│  │ - NotificationSvc │                │                   │
│  │ - FileValidator   │                │                   │
│  │ - CachingLayer    │                │                   │
│  └───────────────────┘                │                   │
└──────────────────────────────────────┼───────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────┐
│              AGENT (Local Machine)                        │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  │
│  │ WS Client    │→ │ Queue         │→ │ Claude       │  │
│  │ (Auth,       │  │ Processor     │  │ Executor     │  │
│  │  Circuit Br.,│  │ (Concurrency, │  │ (SDK,        │  │
│  │  Reconnect,  │  │  Per-project, │  │  Streaming,  │  │
│  │  Keepalive)  │  │  Parallel)    │  │  Tools)      │  │
│  └──────────────┘  └───────────────┘  └──────┬───────┘  │
│                                               │          │
│  ┌──────────────┐  ┌─────────────────┐       ▼          │
│  │ Path         │  │ Resource        │ Local Project      │
│  │ Validator    │  │ Monitor         │ Filesystem         │
│  └──────────────┘  └─────────────────┘                   │
└─────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Cloud-Agent split**: All business logic (bots, DB, Slack) lives in cloud. Agent is a thin, isolated executor.
2. **Agent has ZERO dependency on db or bots packages** — intentional security boundary.
3. **Single Slack app, multiple bot personas** — intelligent model routing, not separate apps.
4. **One active Claude session per project directory** — prevents file conflicts.
5. **Type-safe WebSocket protocol** — Zod-validated discriminated union messages.
6. **Offline-first messaging** — SQLite queue with 24h TTL for disconnected agents.
7. **Connection resilience** — Circuit breakers, exponential backoff, bidirectional keepalive.
8. **Security-first approach** — WSS enforcement, file validation, API key rotation.
9. **Performance optimization** — Caching, parallel processing, resource monitoring.
10. **Data lifecycle management** — Configurable retention with archival strategies.
