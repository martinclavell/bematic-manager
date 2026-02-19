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
                              │   → CoderBot matched via model routing
                              │   → parseCommand("fix the login bug in auth.ts")
                              │   → { command: "fix", args: "the login bug in auth.ts" }
                              │   → buildExecutionConfig(parsed, project, modelStrategy)
                              │
5. TASK CREATED:          ────►  TaskRepository.create({ status: 'pending', ... })
                              │
6. NOTIFICATION:          ────►  Post "Task started" block to Slack thread
                              │
7. WS SUBMIT:            ────►  AgentManager.sendToAgent(agentId, TASK_SUBMIT payload)
                              │   (if offline → OfflineQueue.enqueue)
                              │
8. AGENT receives:        ────►  ws-client → circuit breaker → message handler
                              │
9. QUEUE PROCESSOR:       ────►  Check concurrency limits + resource monitoring
                              │   → Send TASK_ACK { accepted: true, resourceStatus }
                              │   → (or queue if at capacity/resource constrained)
                              │
10. CLAUDE EXECUTOR:      ────►  Execute via @anthropic-ai/claude-code SDK
                              │   Working directory: project.localPath
                              │   System prompt: CoderBot.getSystemPrompt()
                              │   Allowed tools: [Read, Edit, Write, Glob, Grep, Bash]
                              │
11. STREAMING:            ────►  Agent sends TASK_PROGRESS + TASK_STREAM messages
                              │   → Cloud: stream-accumulator batches updates + caching
                              │   → Cloud: posts to Slack thread every 3s
                              │   → Cloud: collects metrics (tokens, performance)
                              │
12. COMPLETION:           ────►  Agent sends TASK_COMPLETE { result, tokens, cost, files, resourceMetrics }
                              │
13. CLOUD PROCESSES:      ────►  TaskRepository.complete(taskId, result, metrics)
                              │   SessionRepository.complete(sessionId, metrics)
                              │   AuditLogRepository.log('task.completed', ...)
                              │   RetentionService.evaluateForArchival(task)
                              │   MetricsCollector.recordTaskCompletion(metrics)
                              │   Cache.invalidate(relatedKeys)
                              │
14. SLACK RESPONSE:       ────►  Post formatted completion block with enhanced metrics
                              │   (tokens, cost, duration, files changed, resource usage)
```

---

## Error Flows

### Claude Error (Enhanced)

```
CLAUDE ERROR       → Agent sends TASK_ERROR { error, recoverable, context }
                   → Cloud: TaskRepository.fail(taskId, error, context)
                   → Cloud: MetricsCollector.recordError(error, context)
                   → Cloud: Post error block to Slack (with retry button if recoverable)
                   → Cloud: Cache.invalidate(taskRelatedKeys)
```

### Agent Disconnect (Circuit Breaker)

```
AGENT DISCONNECT   → Cloud: AgentManager detects via heartbeat timeout
                   → Cloud: Circuit breaker opens for agent
                   → Cloud: Queue pending tasks in offline_queue with priority
                   → Cloud: Post "agent offline" notification with reconnection ETA
                   → Agent: ws-client auto-reconnects with exponential backoff
                   → Agent: Circuit breaker closes after successful auth
                   → On reconnect: Cloud drains offline queue in parallel batches
```

### Budget Exceeded (Resource Monitoring)

```
BUDGET EXCEEDED    → Agent: Claude executor monitors cost + resource usage
                   → Agent sends TASK_ERROR { error: "Budget exceeded", recoverable: false, metrics }
                   → Cloud: Post budget error to Slack with usage breakdown
                   → Cloud: Update resource monitoring thresholds
```

### Rate Limit (Enhanced)

```
RATE LIMIT         → Cloud: rate-limit middleware rejects request
                   → Cloud: Cache rate limit status per user
                   → Slack: "Rate limit exceeded, try again in X minutes" with progress bar
```

### Resource Exhaustion (New)

```
RESOURCE LIMIT     → Agent: ResourceMonitor detects high memory/CPU usage
                   → Agent: Reject new tasks, send AGENT_STATUS { overloaded: true }
                   → Cloud: Route new tasks to other agents
                   → Cloud: Post resource warning to admin channels
                   → Agent: Auto-recovery when resources stabilize
```

---

## Task Cancellation Flow

```
1. USER cancellation request
   → /bm cancel task_xyz123 in Slack
   → CommandService validates user permissions + task ownership
   → Cloud sends TASK_CANCEL { taskId, reason } via WebSocket

2. AGENT receives cancellation
   → QueueProcessor removes from queue if pending
   → OR ClaudeExecutor aborts running task via AbortController
   → Agent sends TASK_CANCELLED { taskId, partialResult? }

3. CLOUD processes cancellation
   → TaskRepository.cancel(taskId, reason, partialResult)
   → AuditLogRepository.log('task.cancelled', user, reason)
   → Cache.invalidate(taskRelatedKeys)
   → NotificationService.postCancellation(slackThread)

4. CLEANUP
   → Resource cleanup on agent
   → Session termination if no other tasks
   → Metrics collection for cancelled task
```

---

## Archiving Flow

```
1. ARCHIVAL TRIGGER
   → Manual: /bm archive task_xyz123
   → OR Automatic: RetentionService scheduled job
   → OR Policy: Task exceeds retention period

2. PRE-ARCHIVAL VALIDATION
   → RetentionService.validateForArchival(task)
   → Check task is in terminal state (completed/failed/cancelled)
   → Verify no active references or dependencies

3. ARCHIVAL PROCESS
   → Create ArchivedTask { originalId, taskData: JSON.stringify(task), reason, metadata }
   → ArchivedTaskRepository.create(archivedTask)
   → TaskRepository.delete(originalTaskId) // Remove from main table
   → AuditLogRepository.log('task.archived', reason, metadata)

4. POST-ARCHIVAL
   → Cache.invalidate(archivedTaskKeys)
   → MetricsCollector.recordArchival(task, reason)
   → Notification to admin if manual archival
```

### Archive Restoration Flow

```
1. RESTORE REQUEST
   → /bm restore archive_abc123
   → RetentionService.restoreTask(archiveId)

2. RESTORATION PROCESS
   → ArchivedTaskRepository.findById(archiveId)
   → Parse archived task data from JSON
   → TaskRepository.create({ ...taskData, id: newUUID, restoredAt, restoredFromArchive })
   → ArchivedTaskRepository.delete(archiveId)

3. POST-RESTORATION
   → AuditLogRepository.log('task.restored', archiveId, newTaskId)
   → Cache.warm(restoredTaskKeys)
   → Notification with new task ID
```

---

## Cache Invalidation Flows

```
CACHE INVALIDATION TRIGGERS:

1. TASK LIFECYCLE EVENTS
   → Task creation: Invalidate project task lists
   → Task completion: Invalidate task details + project stats
   → Task cancellation: Invalidate task details + agent stats

2. USER/AGENT EVENTS
   → User permission changes: Invalidate user profile cache
   → Agent connection/disconnection: Invalidate agent status cache
   → Project configuration changes: Invalidate project metadata

3. SYSTEM EVENTS
   → Bot definition updates: Invalidate bot persona cache
   → API key rotation: Invalidate key validation cache
   → Metrics collection: Invalidate stale performance data

4. BATCH INVALIDATION
   → Maintenance operations: Selective cache clearing
   → Schema migrations: Full cache flush
   → System restarts: Auto cache warming on startup
```

---

## Metrics Collection Points

```
METRICS COLLECTED THROUGHOUT DATA FLOW:

1. REQUEST INGESTION
   → Slack event processing times
   → Middleware execution latency
   → Rate limiting hit rates

2. TASK PROCESSING
   → Bot resolution times
   → Model routing decisions
   → Queue wait times
   → Execution durations

3. WEBSOCKET OPERATIONS
   → Connection establishment time
   → Message round-trip latency
   → Heartbeat response times
   → Circuit breaker state changes

4. RESOURCE UTILIZATION
   → Agent CPU/memory usage
   → Database query performance
   → Cache hit/miss ratios
   → File system I/O metrics

5. BUSINESS METRICS
   → Token usage and costs
   → Task success/failure rates
   → User activity patterns
   → Project productivity stats
```

---

## Parallel Queue Processing

```
PARALLEL PROCESSING FLOW:

1. AGENT CAPACITY ASSESSMENT
   → ResourceMonitor reports available CPU/memory
   → QueueProcessor calculates optimal concurrency level
   → Dynamic adjustment based on task complexity

2. TASK ALLOCATION
   → Tasks distributed across available worker slots
   → Project-based isolation maintained
   → Priority-based scheduling (urgent tasks first)

3. PARALLEL EXECUTION
   → Multiple ClaudeExecutor instances per project
   → Independent file system isolation
   → Shared resource pool management

4. COMPLETION COORDINATION
   → Results aggregated from parallel streams
   → Final metrics combined and reported
   → Resource cleanup coordinated across workers
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

---

## Cross-References

For detailed information on related data flows, see:

- [WebSocket Protocol (Doc 09)](./09-websocket-protocol.md) - Connection lifecycle, message types
- [Security & Authentication (Doc 15)](./15-security-auth.md) - API key validation flows
- [Performance & Caching (Doc 16)](./16-performance-caching.md) - Cache invalidation strategies
- [Monitoring & Metrics (Doc 17)](./17-monitoring-metrics.md) - Metrics collection implementation
