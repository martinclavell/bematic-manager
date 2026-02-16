# Bematic Manager — Documentation Index

> This folder is the comprehensive reference for any AI agent or developer working on this codebase.
> Each document covers a focused topic. Read the relevant sections before making changes.

---

## Documents

| # | Document | Description |
|---|----------|-------------|
| 01 | [Project Overview & Architecture](./01-project-overview.md) | What Bematic Manager is, tech stack, architecture diagram, design principles |
| 02 | [Monorepo Structure](./02-monorepo-structure.md) | Folder layout, dependency graph, build order |
| 03 | [Package: @bematic/common](./03-package-common.md) | Shared constants, types, Zod schemas, utilities |
| 04 | [Package: @bematic/db](./04-package-db.md) | Database connection, schema definitions, repositories |
| 05 | [Package: @bematic/bots](./05-package-bots.md) | Bot persona plugin system, commands, response builder |
| 06 | [Package: @bematic/cloud](./06-package-cloud.md) | Cloud service: Slack integration, WebSocket gateway, services |
| 07 | [Package: @bematic/agent](./07-package-agent.md) | Local execution agent: WS client, queue processor, Claude executor |
| 08 | [Data Flow](./08-data-flow.md) | End-to-end task lifecycle, error flows |
| 09 | [WebSocket Protocol](./09-websocket-protocol.md) | Message envelope, connection lifecycle, task & system messages |
| 10 | [Database Schema](./10-database-schema.md) | Entity relationships, JSON-encoded columns |
| 11 | [Environment Variables](./11-environment-variables.md) | Cloud and Agent configuration reference |
| 12 | [Build, Run & Deploy](./12-build-run-deploy.md) | Prerequisites, build commands, dev/test/deploy workflows |
| 13 | [Coding Conventions](./13-coding-conventions.md) | TypeScript rules, naming, patterns, how-to guides |
| 14 | [File Index](./14-file-index.md) | Complete file-by-file reference for every package |

---

## Quick Start

1. **New to the project?** → Start with [01 — Project Overview](./01-project-overview.md)
2. **Adding a feature?** → Read [13 — Coding Conventions](./13-coding-conventions.md) and the relevant package doc
3. **Debugging a data flow issue?** → See [08 — Data Flow](./08-data-flow.md) and [09 — WebSocket Protocol](./09-websocket-protocol.md)
4. **Setting up locally?** → See [11 — Environment Variables](./11-environment-variables.md) and [12 — Build, Run & Deploy](./12-build-run-deploy.md)
