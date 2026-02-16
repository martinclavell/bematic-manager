# 02 — Monorepo Structure

[← Back to Index](./README.md)

---

## Folder Layout

```
manager/
├── package.json              # Root workspace config
├── tsconfig.json             # TypeScript project references
├── tsconfig.base.json        # Shared compiler options
├── vitest.config.ts          # Test configuration
├── railway.toml              # Railway deployment config
├── .env.example              # Environment variable template
├── .gitignore
│
└── packages/
    ├── common/               # Shared types, constants, utils, schemas
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts
    │       ├── constants/    # bots, message-types, permissions, limits
    │       ├── types/        # task, project, auth, slack, bot, messages
    │       ├── schemas/      # Zod validation (messages, commands)
    │       └── utils/        # errors, ids, logger, retry, ws-helpers
    │
    ├── db/                   # Database schema, connection, repositories
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── drizzle.config.ts
    │   └── src/
    │       ├── index.ts
    │       ├── connection.ts
    │       ├── migrate.ts
    │       ├── schema/       # projects, tasks, sessions, users, audit-logs, offline-queue
    │       └── repositories/ # base, project, task, session, user, audit-log, offline-queue
    │
    ├── bots/                 # Bot persona plugins
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── src/
    │       ├── index.ts
    │       ├── base/         # base-bot, bot-registry, command-parser, response-builder
    │       ├── coder/        # coder.bot.ts
    │       ├── reviewer/     # reviewer.bot.ts
    │       ├── ops/          # ops.bot.ts
    │       └── planner/      # planner.bot.ts
    │
    ├── cloud/                # Cloud service (Slack + WebSocket gateway)
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── Dockerfile
    │   └── src/
    │       ├── index.ts      # Main entry, server bootstrap
    │       ├── config.ts     # Environment config loading
    │       ├── context.ts    # Application context (DI container)
    │       ├── slack/
    │       │   ├── middleware/  # auth, rate-limit, project, logging
    │       │   └── listeners/  # mentions, messages, commands, actions, config, admin
    │       ├── gateway/
    │       │   ├── ws-server.ts
    │       │   ├── agent-manager.ts
    │       │   ├── message-router.ts
    │       │   ├── stream-accumulator.ts
    │       │   └── offline-queue.ts
    │       ├── services/       # command, notification, project
    │       └── utils/          # markdown-to-slack
    │
    └── agent/                # Local execution agent
        ├── package.json
        ├── tsconfig.json
        ├── start-agent.sh    # Wrapper script with auto-restart
        └── src/
            ├── index.ts      # Main entry, lifecycle management
            ├── config.ts     # Agent config loading
            ├── logging.ts    # File + stdout logging setup
            ├── connection/
            │   ├── ws-client.ts    # WebSocket client with reconnection
            │   └── heartbeat.ts    # Heartbeat response handler
            ├── executor/
            │   ├── queue-processor.ts  # Concurrency and per-project queuing
            │   └── claude-executor.ts  # Claude SDK integration
            └── security/
                └── path-validator.ts   # Project path sandboxing
```

## Dependency Graph

```
common ← db ← cloud
common ← bots ← cloud
common ← agent

(agent has NO dependency on db or bots)
```

## Build Order (strict)

```
1. common
2. db       (depends on common)
3. bots     (depends on common)
4. cloud    (depends on common, db, bots)
5. agent    (depends on common only)
```
