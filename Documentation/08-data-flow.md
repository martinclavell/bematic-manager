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
