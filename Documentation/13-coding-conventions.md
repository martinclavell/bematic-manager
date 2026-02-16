# 13 — Coding Conventions & Rules

[← Back to Index](./README.md)

---

## TypeScript

- **Target**: ES2022
- **Module**: Node16 (ESM — `"type": "module"` in package.json)
- **Strict mode**: Enabled
- **Imports**: Use `import type` for type-only imports (`verbatimModuleSyntax: true`)
- **File extensions**: `.js` in import paths (even for `.ts` files, required by Node16 module resolution)

---

## Naming

- Files: `kebab-case.ts` (e.g., `command-parser.ts`, `ws-client.ts`)
- Classes: `PascalCase` (e.g., `BaseBotPlugin`, `AgentManager`)
- Constants: `UPPER_SNAKE_CASE` for values, `PascalCase` for const objects (e.g., `BotName`, `MessageType`)
- Functions: `camelCase`
- Types/Interfaces: `PascalCase`
- Database columns: `snake_case`

---

## Patterns

- **Barrel exports**: Every directory has an `index.ts` re-exporting public API
- **Repository pattern**: All DB access through typed repository classes
- **Plugin architecture**: Bots extend `BaseBotPlugin` abstract class
- **DI container**: Cloud uses `AppContext` object for dependency injection
- **Const objects over enums**: Uses `as const` objects instead of TypeScript enums
- **Zod schemas**: Runtime validation at system boundaries (WebSocket messages, user input)
- **Error hierarchy**: Custom error classes extending `BematicError` with HTTP status codes

---

## Code Style

- No default exports (use named exports)
- Async/await over raw promises
- Early returns for error cases
- Explicit return types on public methods
- JSON serialization for complex DB columns (arrays, objects stored as TEXT)

---

## How-To: Adding a New Bot

1. Create `packages/bots/src/<name>/<name>.bot.ts`
2. Extend `BaseBotPlugin`
3. Implement `getSystemPrompt()` and `getAllowedTools()`
4. Register commands in constructor
5. Add to `BotName` constant in `packages/common/src/constants/bots.ts`
6. Add keywords to `BOT_KEYWORDS`
7. Add slash command to `BOT_SLASH_COMMANDS`
8. Register in `registerAllBots()` in `packages/bots/src/index.ts`
9. Export from `packages/bots/src/index.ts`

---

## How-To: Adding a New WebSocket Message Type

1. Add constant to `MessageType` in `packages/common/src/constants/message-types.ts`
2. Define payload type in `packages/common/src/types/messages.ts`
3. Add to `MessagePayloadMap` in `packages/common/src/types/messages.ts`
4. Add Zod schema in `packages/common/src/schemas/messages.ts` (if validated at boundary)
5. Handle in cloud `message-router.ts`
6. Handle in agent `index.ts` message handler

---

## How-To: Adding a New Database Table

1. Create schema file in `packages/db/src/schema/<name>.ts`
2. Export from `packages/db/src/schema/index.ts`
3. Create repository in `packages/db/src/repositories/<name>.repository.ts`
4. Export from `packages/db/src/repositories/index.ts`
5. Export types from `packages/db/src/index.ts`
6. Add table creation SQL to `migrate.ts` `pushSchema()`
7. Add to `AppContext` in `packages/cloud/src/context.ts`
