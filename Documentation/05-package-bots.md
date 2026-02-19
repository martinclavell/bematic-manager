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
├── PlannerBot    (/bm-plan)
└── NetSuiteBot   (/bm-netsuite)
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
| **NetSuiteBot** | `/bm-netsuite` | `audit` | Read, Write, Glob, Grep, Bash, WebFetch, WebSearch | NetSuite SEO & schema audits |

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

### NetSuiteBot Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `audit` | analyze, check, scan | Comprehensive SEO and structured data audit |
| `crawl` | spider, discover | Crawl website and analyze structure |
| `schema` | jsonld, structured-data | Analyze JSON-LD structured data |
| `competitors` | competitive-analysis, benchmark | Research and compare competitors |

**Features:**
- Auto-discovers categories from navigation patterns (e.g., `<nav class="header-menu-secondary-nav">`)
- Crawls 3 category pages and 1 product from each
- Analyzes JSON-LD Schema.org markup completeness
- Researches competitors using WebSearch
- Generates professional HTML audit reports
- Identifies missing schema fields with priority levels (P0-P3)
- Provides SERP mockups and competitive gap analysis

**Usage Example:**
```
/bm netsuite audit https://www.example.com
```

The bot will:
1. Crawl the homepage, discover categories
2. Visit 3 category pages, find products
3. Extract and analyze all JSON-LD schemas
4. Research industry competitors
5. Generate a comprehensive HTML report saved to the project directory

---

## Intelligent Model Routing

The `ModelRouter` (`base/model-router.ts`) automatically selects the optimal Claude model for each task with a simple, quality-focused strategy.

### Routing Strategy

**Simple rule:** Write operations use Opus, everything else uses Sonnet.

| Model | When Used | Commands |
|-------|-----------|----------|
| **Sonnet 4.5** (standard) | All read-only tasks, analysis, planning, and all non-CoderBot tasks | ReviewerBot (all), OpsBot (all), PlannerBot (all), CoderBot decomposition planning |
| **Opus 4** (premium) | CoderBot write commands only | `fix`, `feature`, `refactor`, `test`, `bugfix`, `debug`, `add`, `implement`, `create`, `cleanup`, `improve` |

**No Haiku** — it produces lower quality results.

### Configuration

| Env Variable | Default | Description |
|--------------|---------|-------------|
| `MODEL_ROUTING_ENABLED` | `true` | Master switch (`false` = use project default) |
| `MODEL_TIER_STANDARD` | `claude-sonnet-4-5-20250929` | Override Sonnet model |
| `MODEL_TIER_PREMIUM` | `claude-opus-4-20250514` | Override Opus model |

**Note:** `--model <id>` flag always overrides routing.

### Public API

```typescript
routeToModel(command: ParsedCommand, projectModel: string): RoutingDecision
// Returns: { tier, model, reason, overridden }
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
