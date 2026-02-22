# Bematic Manager — Documentation Index

> This folder is the comprehensive reference for any AI agent or developer working on this codebase.
> Each document covers a focused topic. Read the relevant sections before making changes.

**📋 [CHANGELOG](../CHANGELOG.md)** — Latest improvements and release notes  
**✅ Status:** Production Ready (v2.0.0 - Feb 2025)

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
| 15 | [Advanced Patterns](./15-advanced-patterns.md) | Handler patterns, circuit breakers, performance optimization, refactoring strategies |
| 16 | [Security & Compliance](./16-security-compliance.md) | Security model, authentication, file validation, audit trails, GDPR compliance |
| 17 | [Operations & Troubleshooting](./17-operations-troubleshooting.md) | Health monitoring, debugging procedures, performance tuning, incident response |
| 18 | [Extending Bematic](./18-extending-bematic.md) | Adding bots, custom integrations, database extensions, plugin development |
| 19 | [Help System Architecture](./19-help-system-architecture.md) | Command registry, auto-generated help, NetSuite integration, troubleshooting guide |

---

## Quick Start

1. **New to the project?** → Start with [01 — Project Overview](./01-project-overview.md)
2. **Adding a feature?** → Read [13 — Coding Conventions](./13-coding-conventions.md) and the relevant package doc
3. **Debugging a data flow issue?** → See [08 — Data Flow](./08-data-flow.md) and [09 — WebSocket Protocol](./09-websocket-protocol.md)
4. **Setting up locally?** → See [11 — Environment Variables](./11-environment-variables.md) and [12 — Build, Run & Deploy](./12-build-run-deploy.md)
5. **System troubleshooting?** → See [17 — Operations & Troubleshooting](./17-operations-troubleshooting.md)
6. **Extending the system?** → See [18 — Extending Bematic](./18-extending-bematic.md)
7. **Security concerns?** → See [16 — Security & Compliance](./16-security-compliance.md)
8. **Advanced architecture?** → See [15 — Advanced Patterns](./15-advanced-patterns.md)
9. **Help system or command issues?** → See [19 — Help System Architecture](./19-help-system-architecture.md)
