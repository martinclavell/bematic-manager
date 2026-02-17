# 05 — Package: @bematic/bots

[← Back to Index](./README.md)

---

**Purpose**: Bot persona plugin system — command parsing, execution config building, and Slack response formatting.

**Dependencies**: `@bematic/common`, `zod`

---

## Plugin Architecture

```
BaseBotPlugin (abstract)
├── CoderBot      (/bm-code)
├── ReviewerBot   (/bm-review)
├── OpsBot        (/bm-ops)
└── PlannerBot    (/bm-plan)
```

### `BaseBotPlugin` (abstract class)

Provides:
- Command registration and lookup
- Default command fallback
- `parseCommand(text)` → `ParsedCommand`
- `buildExecutionConfig(parsed, project)` → `BotExecutionConfig`
- Abstract methods subclasses must implement: `getSystemPrompt()`, `getAllowedTools()`

### `BotRegistry` (singleton)

```typescript
BotRegistry.register(bot: BaseBotPlugin): void
BotRegistry.get(name: string): BaseBotPlugin | undefined
BotRegistry.resolveFromMention(text: string): { bot, remainingText } | undefined
BotRegistry.resolveFromSlashCommand(command: string): BaseBotPlugin | undefined
BotRegistry.getAll(): BaseBotPlugin[]
```

---

## Bot Specifications

| Bot | Slash Command | Default Command | Tool Access | Purpose |
|-----|--------------|-----------------|-------------|---------|
| **CoderBot** | `/bm-code` | `feature` | Read, Edit, Write, Glob, Grep, Bash, NotebookEdit | Write, fix, refactor code |
| **ReviewerBot** | `/bm-review` | `review` | Read, Glob, Grep, Bash (read-only) | Code review, security audit |
| **OpsBot** | `/bm-ops` | `status` | Read, Glob, Grep, Bash | Build, deploy, git ops |
| **PlannerBot** | `/bm-plan` | `create` | Read, Glob, Grep (read-only) | Planning, task breakdown |

### CoderBot Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `fix` | bugfix, debug | Bug fixing |
| `feature` | add, implement, create | New feature implementation |
| `refactor` | cleanup, improve | Code refactoring |
| `test` | tests | Test writing |

### ReviewerBot Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `review` | check, audit | General code review |
| `diff` | changes | Change analysis |
| `security` | sec, vuln | Security review |
| `explain` | how, why | Code explanation |

### OpsBot Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `build` | compile | Build processes |
| `deploy` | ship, release | Deployment |
| `status` | info, check | Status checks |
| `logs` | log | Log analysis |
| `git` | — | Git operations |

### PlannerBot Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `create` | plan, break, breakdown | Project planning |
| `list` | ls, show | Structure listing |
| `sprint` | iteration | Sprint planning |
| `report` | summary, recap | Report generation |

---

## Intelligent Model Routing

The `ModelRouter` (`base/model-router.ts`) automatically selects the optimal Claude model tier for each task based on rule-based scoring — no AI call needed for classification.

### Model Tiers

| Tier | Default Model | Best For |
|------|---------------|----------|
| **lite** | `claude-haiku-3-5-20241022` | Status checks, logs, simple explanations, listings |
| **standard** | `claude-sonnet-4-5-20250929` | Code fixes, reviews, diffs, tests, git ops |
| **premium** | `claude-opus-4-20250514` | Complex features, refactors, security audits |

### Scoring Signals

1. **Bot bias** — Planner/Ops lean lite; Coder leans premium
2. **Command weight** — `status`/`logs` → lite; `fix`/`test` → standard; `feature`/`refactor`/`security` → premium
3. **Prompt length** — short (<50 chars) → lite bias; long (>200) → premium bias
4. **Explicit override** — `--model <id>` flag always wins

### Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `MODEL_ROUTING_ENABLED` | `true` | Master switch (`false` = use project default) |
| `MODEL_TIER_LITE` | `claude-haiku-3-5-20241022` | Override lite tier model |
| `MODEL_TIER_STANDARD` | `claude-sonnet-4-5-20250929` | Override standard tier model |
| `MODEL_TIER_PREMIUM` | `claude-opus-4-20250514` | Override premium tier model |

### Public API

```typescript
routeToModel(command: ParsedCommand, projectModel: string): RoutingDecision
// Returns: { tier, model, score, reason, overridden }
```

---

## Command Parsing

Input: `"fix --file src/app.ts the login bug"`

Output:
```typescript
{
  botName: "coder",
  command: "fix",
  args: "the login bug",
  flags: { file: "src/app.ts" },
  rawText: "fix --file src/app.ts the login bug"
}
```

Features:
- Quoted string support
- `--flag value` and `--flag` (boolean) syntax
- Falls back to bot's default command if unrecognized
- Command alias resolution

---

## Response Builder

`ResponseBuilder` namespace provides Slack Block Kit formatting:
- `taskStarted(task)` — progress indicator
- `taskCompleted(task, metrics)` — metrics: tokens, cost, duration, files changed
- `taskError(task, error)` — error with retry action button
- `offlineQueued(task)` — agent offline notification
