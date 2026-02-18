# 08 — Data Flow: End-to-End Task Lifecycle

[← Back to Index](./README.md)

---

## Happy Path

```
1. USER types in Slack:  @BematicManager code fix the login bug in auth.ts
                              │
2. SLACK delivers event  ────►  Cloud: mentions.ts listener
                              │
3. MIDDLEWARE chain:      ────►  logging → auth → rate-limit → project
                              │
4. COMMAND SERVICE:       ────►  BotRegistry.resolveFromMention("code fix the login bug")
                              │   → CoderBot matched
                              │   → parseCommand("fix the login bug in auth.ts")
                              │   → { command: "fix", args: "the login bug in auth.ts" }
                              │   → buildExecutionConfig(parsed, project)
                              │
5. TASK CREATED:          ────►  TaskRepository.create({ status: 'pending', ... })
                              │
6. NOTIFICATION:          ────►  Post "Task started" block to Slack thread
                              │
7. WS SUBMIT:            ────►  AgentManager.sendToAgent(agentId, TASK_SUBMIT payload)
                              │   (if offline → OfflineQueue.enqueue)
                              │
8. AGENT receives:        ────►  ws-client → message handler
                              │
9. QUEUE PROCESSOR:       ────►  Check concurrency limits
                              │   → Send TASK_ACK { accepted: true }
                              │   → (or queue if at capacity)
                              │
10. CLAUDE EXECUTOR:      ────►  Execute via @anthropic-ai/claude-code SDK
                              │   Working directory: project.localPath
                              │   System prompt: CoderBot.getSystemPrompt()
                              │   Allowed tools: [Read, Edit, Write, Glob, Grep, Bash]
                              │
11. STREAMING:            ────►  Agent sends TASK_PROGRESS + TASK_STREAM messages
                              │   → Cloud: stream-accumulator batches updates
                              │   → Cloud: posts to Slack thread every 3s
                              │
12. COMPLETION:           ────►  Agent sends TASK_COMPLETE { result, tokens, cost, files }
                              │
13. CLOUD PROCESSES:      ────►  TaskRepository.complete(taskId, result, metrics)
                              │   SessionRepository.complete(sessionId, metrics)
                              │   AuditLogRepository.log('task.completed', ...)
                              │
14. SLACK RESPONSE:       ────►  Post formatted completion block with metrics
                              │   (tokens, cost, duration, files changed)
```

---

## Error Flows

### Claude Error

```
CLAUDE ERROR       → Agent sends TASK_ERROR { error, recoverable }
                   → Cloud: TaskRepository.fail(taskId, error)
                   → Cloud: Post error block to Slack (with retry button if recoverable)
```

### Agent Disconnect

```
AGENT DISCONNECT   → Cloud: AgentManager detects via heartbeat timeout
                   → Cloud: Queue pending tasks in offline_queue
                   → Cloud: Post "agent offline" notification
                   → Agent: ws-client auto-reconnects with backoff
                   → On reconnect: Cloud drains offline queue to agent
```

### Budget Exceeded

```
BUDGET EXCEEDED    → Agent: Claude executor monitors cost
                   → Agent sends TASK_ERROR { error: "Budget exceeded", recoverable: false }
                   → Cloud: Post budget error to Slack
```

### Rate Limit

```
RATE LIMIT         → Cloud: rate-limit middleware rejects request
                   → Slack: "Rate limit exceeded, try again in X minutes"
```

---

## Auto-Continuation (max_turns recovery)

```
CLAUDE HITS 200-TURN LIMIT
  → Agent detects error_max_turns in result
  → Agent sends TASK_PROGRESS "Auto-continuing (1/3)..."
  → Agent re-invokes query() with resume: sessionId
  → Repeats up to MAX_CONTINUATIONS (default: 3)
  → On success: sends TASK_COMPLETE with aggregated metrics
  → On exhaustion: sends TASK_COMPLETE with partial result + warning
```

---

## Task Decomposition (FUTURE FEATURE - NOT YET IMPLEMENTED)

> **Note:** This feature is planned but not currently implemented. The following describes the intended design.

```
1. USER submits complex feature task (long args or --decompose flag)
   → CommandService.submit() would detect bot.shouldDecompose() = true
   → Would submit lightweight planning task (read-only, command="decompose")

2. PLANNING TASK completes
   → MessageRouter would detect command="decompose"
   → Would call CommandService.handleDecompositionComplete()
   → Would parse JSON subtask list from planning result
   → Would post subtask plan to Slack

3. SUBTASKS submitted sequentially
   → Each would get its own taskId with parentTaskId = planning task ID
   → Each would execute independently (with auto-continuation enabled)

4. ALL SUBTASKS COMPLETE
   → MessageRouter would detect all siblings in terminal state
   → Would post consolidated summary to Slack
   → Would mark parent task as completed with aggregated metrics
```

**Implementation status:** Stubs exist in `MessageRouter` but core logic is not yet implemented.
