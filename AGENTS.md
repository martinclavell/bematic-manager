# Bematic Manager — AI Agent Guide

> Read this file first. Full documentation lives in the `Documentation/` folder.

## Quick Reference

**What is this?** A dual-component system (Cloud + Agent) that lets dev teams interact with AI coding agents (Claude) through Slack.

**Tech**: TypeScript, Node.js 20+, npm workspaces, SQLite/Drizzle, Slack Bolt, WebSocket, Zod, Pino, Vitest

## Documentation

| Document | What's Inside |
|----------|---------------|
| [README (Index)](./Documentation/README.md) | Full index with quick-start guide |
| [01 — Project Overview](./Documentation/01-project-overview.md) | Architecture diagram, design principles, tech stack |
| [02 — Monorepo Structure](./Documentation/02-monorepo-structure.md) | Folder layout, dependency graph, build order |
| [03 — @bematic/common](./Documentation/03-package-common.md) | Constants, types, Zod schemas, utilities |
| [04 — @bematic/db](./Documentation/04-package-db.md) | SQLite schema, repositories, migrations |
| [05 — @bematic/bots](./Documentation/05-package-bots.md) | Bot plugins, commands, response builder |
| [06 — @bematic/cloud](./Documentation/06-package-cloud.md) | Slack integration, WS gateway, services |
| [07 — @bematic/agent](./Documentation/07-package-agent.md) | WS client, queue processor, Claude executor |
| [08 — Data Flow](./Documentation/08-data-flow.md) | End-to-end task lifecycle, error flows |
| [09 — WebSocket Protocol](./Documentation/09-websocket-protocol.md) | Message types, auth, heartbeat |
| [10 — Database Schema](./Documentation/10-database-schema.md) | Entity relationships, JSON columns |
| [11 — Environment Variables](./Documentation/11-environment-variables.md) | Cloud & Agent config reference |
| [12 — Build, Run & Deploy](./Documentation/12-build-run-deploy.md) | Commands, dev setup, Railway deploy |
| [13 — Coding Conventions](./Documentation/13-coding-conventions.md) | TypeScript rules, naming, patterns, how-to guides |
| [14 — File Index](./Documentation/14-file-index.md) | Complete file-by-file reference |

## Critical Rules (always apply)

1. **Agent has ZERO dependency on `db` or `bots`** — intentional security boundary
2. **One active Claude session per project directory** — prevents file conflicts
3. **Build order**: common → db → bots → cloud → agent
4. **ESM only**: Use `.js` extensions in imports, `import type` for type-only
5. **No default exports** — named exports everywhere
6. **Const objects over enums** — use `as const`
7. **Zod at boundaries** — validate all WebSocket messages and user input
