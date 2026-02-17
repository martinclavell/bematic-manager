# 03 — Package: @bematic/common

[← Back to Index](./README.md)

---

**Purpose**: Shared contract layer — types, constants, validation schemas, and utilities used by all other packages.

**Dependencies**: `nanoid`, `pino`, `zod`

---

## Constants

### `constants/bots.ts`

| Export | Type | Description |
|--------|------|-------------|
| `BotName` | const object | `{ CODER: 'coder', REVIEWER: 'reviewer', OPS: 'ops', PLANNER: 'planner' }` |
| `BOT_KEYWORDS` | Record | Maps each BotName to trigger keywords (e.g., `coder → ['code', 'fix', 'implement', ...]`) |
| `BOT_SLASH_COMMANDS` | Record | Maps slash commands to BotName (e.g., `'/bm-code' → 'coder'`) |
| `BOT_DEFAULT_BUDGETS` | Record | Default cost budget per bot type in USD |

### `constants/message-types.ts`

| Export | Type | Description |
|--------|------|-------------|
| `MessageType` | const object | All WebSocket message type strings (see [09 — WebSocket Protocol](./09-websocket-protocol.md)) |

### `constants/permissions.ts`

| Export | Type | Description |
|--------|------|-------------|
| `UserRole` | const object | `{ ADMIN: 'admin', DEVELOPER: 'developer', VIEWER: 'viewer' }` |
| `Permission` | const object | Fine-grained permissions: `TASK_CREATE`, `TASK_VIEW`, `TASK_CANCEL`, `PROJECT_MANAGE`, `BOT_CONFIGURE`, `USER_MANAGE`, `AUDIT_VIEW` |
| `ROLE_PERMISSIONS` | Record | Maps each role to its allowed permissions |

### `constants/limits.ts`

| Export | Type | Description |
|--------|------|-------------|
| `Limits` | const object | System-wide limits and defaults |

### `constants/models.ts`

| Export | Type | Description |
|--------|------|-------------|
| `ModelTier` | const object | `{ LITE: 'lite', STANDARD: 'standard', PREMIUM: 'premium' }` |
| `DEFAULT_TIER_MODELS` | Record | Default Claude model ID per tier (Haiku → Sonnet → Opus) |
| `TIER_COST_PER_MILLION` | Record | Approximate cost per 1M tokens (input/output) per tier |
| `BOT_TIER_BIAS` | Record | Per-bot baseline scoring bias (-1 = lite, +1 = premium) |
| `COMMAND_TIER_WEIGHT` | Record | Per-command scoring weight (status → lite, feature → premium) |
| `PROMPT_LENGTH_THRESHOLDS` | const object | Character thresholds for prompt complexity scoring |
| `TIER_SCORE_BOUNDARIES` | const object | Score cutoffs for tier selection (liteMax, premiumMin) |

Key limits:
```
MAX_CONCURRENT_TASKS: 3
RATE_LIMIT_WINDOW_MS: 3600000 (1 hour)
RATE_LIMIT_MAX_REQUESTS: 50
WS_HEARTBEAT_INTERVAL_MS: 30000
WS_AUTH_TIMEOUT_MS: 10000
OFFLINE_QUEUE_TTL_MS: 86400000 (24 hours)
MAX_PROMPT_LENGTH: 10000
SLACK_STREAM_UPDATE_INTERVAL_MS: 3000
DEFAULT_MAX_BUDGET: 5.0
DEFAULT_MODEL: 'claude-sonnet-4-5-20250929'
```

---

## Types

### Core Entity Types

| Type | File | Key Fields |
|------|------|------------|
| `User` | `types/auth.ts` | `id`, `slackUserId`, `slackUsername`, `role`, `active`, `rateLimitOverride` |
| `Project` | `types/project.ts` | `id`, `name`, `slackChannelId`, `localPath`, `agentId`, `defaultModel`, `defaultMaxBudget`, `active` |
| `Task` | `types/task.ts` | `id`, `projectId`, `botName`, `command`, `prompt`, `status`, `result`, `slackChannelId`, `slackThreadTs`, `slackUserId`, `sessionId`, `inputTokens`, `outputTokens`, `estimatedCost`, `maxBudget`, `filesChanged`, `commandsRun` |
| `TaskStatus` | `types/task.ts` | `'pending' \| 'queued' \| 'running' \| 'completed' \| 'failed' \| 'cancelled'` |

### Bot Types

| Type | File | Description |
|------|------|-------------|
| `BotPlugin` | `types/bot.ts` | Interface: `name`, `description`, `commands`, `parseCommand()`, `buildExecutionConfig()` |
| `BotCommand` | `types/bot.ts` | `name`, `description`, `aliases` |
| `ParsedCommand` | `types/bot.ts` | `botName`, `command`, `args`, `flags`, `rawText` |
| `BotExecutionConfig` | `types/bot.ts` | `systemPrompt`, `allowedTools`, `model`, `maxBudget`, `permissions` |

### WebSocket Message Types

| Type | File | Description |
|------|------|-------------|
| `WSMessage<T>` | `types/messages.ts` | Envelope: `type`, `payload`, `id`, `timestamp` |
| `MessagePayloadMap` | `types/messages.ts` | Maps every `MessageType` to its typed payload |
| `TaskSubmitPayload` | `types/task.ts` | `taskId`, `projectId`, `botName`, `command`, `prompt`, `systemPrompt`, `allowedTools`, `model`, `maxBudget`, `localPath`, `slackContext` |
| `TaskProgressPayload` | `types/task.ts` | `taskId`, `step`, `message`, `percentage?` |
| `TaskStreamPayload` | `types/task.ts` | `taskId`, `text`, `isPartial` |
| `TaskCompletePayload` | `types/task.ts` | `taskId`, `result`, `inputTokens`, `outputTokens`, `estimatedCost`, `durationMs`, `filesChanged`, `commandsRun` |
| `TaskErrorPayload` | `types/task.ts` | `taskId`, `error`, `recoverable` |

### Slack Types

| Type | File | Description |
|------|------|-------------|
| `SlackContext` | `types/slack.ts` | `channelId`, `threadTs?`, `userId` |
| `SlackBlock` | `types/slack.ts` | Union: Section, Divider, Context, Actions, Header |
| `SlackBlockMessage` | `types/slack.ts` | `text`, `blocks`, `thread_ts?` |

---

## Schemas (Zod Validation)

| Schema | File | Validates |
|--------|------|-----------|
| `wsMessageEnvelopeSchema` | `schemas/messages.ts` | WebSocket message envelope structure |
| `authRequestSchema` | `schemas/messages.ts` | Agent auth requests |
| `taskSubmitPayloadSchema` | `schemas/messages.ts` | Task submission payloads |
| `parsedCommandSchema` | `schemas/commands.ts` | Bot command structure |
| `projectCreateSchema` | `schemas/commands.ts` | Project creation (defaults: claude-sonnet-4-5-20250929, $5 budget) |

---

## Utilities

### Error Classes (`utils/errors.ts`)

| Class | HTTP Status | Description |
|-------|-------------|-------------|
| `BematicError` | varies | Base class with `statusCode`, `code`, `recoverable` |
| `AuthenticationError` | 401 | Invalid credentials |
| `AuthorizationError` | 403 | Insufficient permissions |
| `NotFoundError` | 404 | Resource not found |
| `RateLimitError` | 429 | Rate limit exceeded (includes `retryAfterMs`) |
| `ValidationError` | 400 | Invalid input |
| `AgentOfflineError` | 503 | Agent not connected |
| `BudgetExceededError` | 402 | Cost budget exceeded |

### ID Generation (`utils/ids.ts`)

| Function | Prefix | Example |
|----------|--------|---------|
| `generateTaskId()` | `task_` | `task_V1StGXR8_Z5jdHi6B-myT` |
| `generateSessionId()` | `sess_` | `sess_V1StGXR8_Z5jdHi6B-myT` |
| `generateProjectId()` | `proj_` | `proj_V1StGXR8_Z5jdHi6B-myT` |
| `generateMessageId()` | `msg_` | `msg_V1StGXR8_Z5jdHi6B-myT` |

Uses nanoid (21 chars, URL-safe).

### Logging (`utils/logger.ts`)

```typescript
createLogger(name: string): pino.Logger
// Development: pretty-printed to stdout
// Production: JSON structured logs
// Level controlled by LOG_LEVEL env var
```

### Retry (`utils/retry.ts`)

```typescript
withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>
calculateBackoff(attempt: number, baseDelay: number, maxDelay: number): number
// Defaults: 3 attempts, 1s base, 30s max, exponential backoff with jitter
```

### WebSocket Helpers (`utils/ws-helpers.ts`)

```typescript
createWSMessage<T extends MessageType>(type: T, payload: MessagePayloadMap[T]): WSMessage
serializeMessage(msg: WSMessage): string
parseMessage(raw: string): WSMessage
```
