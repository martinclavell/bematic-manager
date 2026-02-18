# 07 — Package: @bematic/agent

[← Back to Index](./README.md)

---

**Purpose**: Local execution agent — connects to cloud via WebSocket, receives tasks, executes Claude sessions on local filesystems.

**Dependencies**: `@bematic/common`, `@anthropic-ai/claude-code`, `ws`, `pino`, `dotenv`

**CRITICAL**: This package has NO dependency on `@bematic/db` or `@bematic/bots`. It is intentionally isolated.

---

## Entry Point (`index.ts`)

Startup sequence:
1. Load config from environment
2. Set up file logging
3. Initialize path validator
4. Create WebSocket client
5. Create queue processor
6. Create Claude executor
7. Wire message handlers
8. Connect to cloud
9. Handle graceful shutdown (SIGTERM, SIGINT)
10. Support restart via exit code 75

---

## WebSocket Client (`connection/ws-client.ts`)

- Connects to `CLOUD_WS_URL`
- Authenticates with `AGENT_ID` + `AGENT_API_KEY`
- **Bidirectional keepalive**: Sends periodic pings every 20s (`AGENT_KEEPALIVE_INTERVAL_MS`) to detect dead connections
- Exponential backoff reconnection with jitter
- **Circuit breaker**: After 10 consecutive failures, switches to 5-minute backoff to prevent resource exhaustion
- Configurable delays: `WS_RECONNECT_BASE_DELAY_MS`, `WS_RECONNECT_MAX_DELAY_MS`
- Forwards received messages to registered handlers
- Sends typed messages to cloud

**Resilience features**:
- Proactive connection health monitoring via keepalive pings
- Automatic recovery from transient network failures
- Long backoff for persistent failures to reduce resource usage

---

## Heartbeat Handler (`connection/heartbeat.ts`)

Responds to `HEARTBEAT_PING` with `HEARTBEAT_PONG` including:
- CPU usage percentage
- Memory usage percentage
- Active task count
- Agent version

---

## Queue Processor (`executor/queue-processor.ts`)

Concurrency rules:
- **Global limit**: `MAX_CONCURRENT_TASKS` (default: 3)
- **Per-project limit**: **1** (prevents file conflicts)
- FIFO queue per project
- Tasks exceeding limits are queued with `TASK_ACK { accepted: true, queued: true }`
- Automatically processes next queued task when a slot frees up

Key methods:
```typescript
submit(task: TaskSubmitPayload): Promise<void>
cancel(taskId: string): boolean
getActiveCount(): number
getQueuedCount(): number
```

---

## Claude Executor (`executor/claude-executor.ts`)

Wraps `@anthropic-ai/claude-code` SDK:

```typescript
execute(task: TaskSubmitPayload, callbacks: ExecutionCallbacks): Promise<ExecutionResult>
```

Features:
- Streaming execution with progress callbacks
- Custom system prompt injection
- Tool filtering (restricts which tools Claude can use)
- Abort controller for task cancellation
- **API timeout protection**: 5-minute global timeout (`CLAUDE_API_TIMEOUT_MS`) prevents indefinite hangs
- File change tracking
- Command execution tracking
- Token usage and cost estimation

**Authentication**: Uses `ANTHROPIC_API_KEY` env var. Falls back to Claude subscription auth if not set.

**Resilience**: If Anthropic API becomes unresponsive, the timeout automatically aborts the request after 5 minutes to prevent blocking the agent indefinitely.

**Callbacks**:
```typescript
{
  onProgress(step: string, message: string): void
  onStream(text: string, isPartial: boolean): void
  onToolUse(tool: string, description: string): void
}
```

**Result**:
```typescript
{
  result: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  durationMs: number
  filesChanged: string[]
  commandsRun: string[]
}
```

---

## Path Validator (`security/path-validator.ts`)

Security boundary for local file access:

```typescript
registerProjectPath(projectId: string, path: string): void
validatePath(path: string): boolean   // checks against registered paths
resolvePath(projectId: string, relativePath: string): string  // resolve + validate
```

- Only registered project directories are accessible
- Path traversal attacks prevented by strict normalization
- Throws `ValidationError` for unauthorized paths

---

## Logging (`logging.ts`)

- Dual output: stdout + file (`logs/agent.log`)
- JSON structured format via Pino
- Clean shutdown: flushes and closes log stream on exit

---

## Auto-Restart Script (`start-agent.sh`)

```bash
# Loop: build TypeScript → run agent → restart if exit code 75
while true; do
  npx tsc
  node dist/index.js
  if [ $EXIT_CODE -eq 75 ]; then  # restart requested
    sleep 2 && continue
  else
    exit $EXIT_CODE
  fi
done
```
