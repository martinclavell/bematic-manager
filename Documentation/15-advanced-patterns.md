# Advanced Patterns and Architecture

This document covers advanced architectural patterns, design strategies, and optimization techniques used in the Bematic Manager system.

## Table of Contents

- [Handler Pattern Architecture](#handler-pattern-architecture)
- [Circuit Breaker Implementation](#circuit-breaker-implementation)
- [Refactoring Patterns and Migration](#refactoring-patterns-and-migration)
- [Error Handling Hierarchy](#error-handling-hierarchy)
- [Caching Strategies](#caching-strategies)
- [Parallel Processing Patterns](#parallel-processing-patterns)
- [Type Safety Patterns](#type-safety-patterns)
- [Performance Optimization](#performance-optimization)

## Handler Pattern Architecture

The Bematic system uses a centralized handler pattern for message routing and command processing.

### Message Router Pattern

**File:** `packages/cloud/src/gateway/message-router.ts`

The MessageRouter implements a command pattern with type-safe message dispatching:

```typescript
export class MessageRouter {
  async handleAgentMessage(agentId: string, raw: string): Promise<void> {
    const msg = parseMessage(raw);

    switch (msg.type) {
      case MessageType.TASK_ACK:
        await this.handleTaskAck(msg.payload);
        break;
      case MessageType.TASK_PROGRESS:
        await this.handleTaskProgress(msg.payload);
        break;
      case MessageType.TASK_STREAM:
        this.handleTaskStream(msg.payload);
        break;
      // ... additional handlers
    }
  }
}
```

**Key Benefits:**
- Single responsibility for each message type
- Type-safe payload handling
- Centralized error handling and logging
- Easy testing and mocking

### Admin Command Pattern

**Files:** `packages/cloud/src/slack/admin-commands/`

Admin commands use a plugin-based handler pattern:

```typescript
// Example: health-commands.ts
export const healthCommands = {
  'health': async (ctx: AdminContext, args: string[]) => {
    const agents = ctx.agentHealthTracker.getAllAgentHealth();
    return formatHealthReport(agents);
  },

  'health reset': async (ctx: AdminContext, [agentId]: string[]) => {
    ctx.agentHealthTracker.resetAgent(agentId);
    return `Reset health tracking for agent: ${agentId}`;
  }
};
```

**Pattern Benefits:**
- Composable command registration
- Consistent argument parsing
- Shared context and utilities
- Easy command discovery

### Progress Tracking Pattern

The MessageRouter implements sophisticated progress tracking:

```typescript
interface ProgressTracker {
  messageTs: string | null;
  steps: string[];
}

private progressTrackers = new Map<string, ProgressTracker>();
```

This pattern provides:
- Consolidated progress updates (updates existing message vs. spam)
- Step-by-step tracking for complex operations
- Thread-aware messaging for Slack integration

## Circuit Breaker Implementation

**Files:**
- `packages/cloud/src/gateway/circuit-breaker.ts`
- `packages/cloud/src/gateway/agent-health-tracker.ts`

### Circuit Breaker States

```typescript
export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Circuit tripped, rejecting requests
  HALF_OPEN = 'half-open' // Testing recovery
}
```

### Configuration and Thresholds

```typescript
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThresholdPercentage: 50,  // 50% failure rate trips circuit
  minimumRequestCount: 10,         // Need at least 10 requests in window
  windowSizeMs: 600_000,          // 10-minute sliding window
  recoveryTimeoutMs: 60_000,      // 1-minute recovery wait
  successThresholdCount: 3,       // 3 successes to close circuit
};
```

### Usage Pattern

```typescript
// In task completion handlers
if (taskResult.success) {
  agentHealthTracker.recordSuccess(agentId);
} else {
  agentHealthTracker.recordFailure(agentId);
}

// Before dispatching new tasks
if (!agentHealthTracker.isHealthy(agentId)) {
  // Queue task or route to different agent
  return;
}
```

### Health Monitoring Integration

The circuit breaker integrates with admin commands for operational visibility:

```ascii
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Task Results  │───▶│  Circuit Breaker │───▶│  Admin Commands │
│                 │    │                  │    │                 │
│ • Success/Fail  │    │ • State Tracking │    │ • Health Reports│
│ • Timing Data   │    │ • Auto Recovery  │    │ • Manual Reset  │
│ • Agent Context │    │ • Failure Window │    │ • Agent Status  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Refactoring Patterns and Migration

### Repository Pattern Evolution

The system has evolved from simple data access to sophisticated repository patterns:

**Base Repository Pattern:**
```typescript
// packages/db/src/repositories/base.repository.ts
export abstract class BaseRepository<TSchema, TRow> {
  constructor(
    protected readonly db: Database,
    protected readonly table: PgTable<TSchema>
  ) {}

  async findById(id: string): Promise<TRow | null> {
    const [row] = await this.db
      .select()
      .from(this.table)
      .where(eq(this.table.id, id))
      .limit(1);
    return row || null;
  }
}
```

**Specialized Repositories:**
```typescript
export class TaskRepository extends BaseRepository<TaskSchema, TaskRow> {
  // Task-specific query methods
  async findActiveByAgent(agentId: string): Promise<TaskRow[]> {
    return this.db
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.agentId, agentId),
        eq(tasks.status, 'processing')
      ));
  }
}
```

### Migration Strategy

When refactoring message handling, follow this pattern:

1. **Preserve backward compatibility**
2. **Gradual migration with feature flags**
3. **Comprehensive testing of both paths**
4. **Clean removal after migration**

Example migration pattern:
```typescript
// During migration
if (config.features.useNewMessageRouter) {
  await newMessageRouter.handle(message);
} else {
  await legacyMessageRouter.handle(message);
}
```

## Error Handling Hierarchy

### Structured Error Types

```typescript
// Base error with context
export class BematicError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// Specific error types
export class TaskExecutionError extends BematicError {
  constructor(message: string, context?: { taskId?: string; agentId?: string }) {
    super(message, 'TASK_EXECUTION_ERROR', context);
  }
}

export class WebSocketError extends BematicError {
  constructor(message: string, context?: { agentId?: string; event?: string }) {
    super(message, 'WEBSOCKET_ERROR', context);
  }
}
```

### Error Recovery Patterns

**Retry with Exponential Backoff:**
```typescript
async function withRetry<T>(
  operation: () => Promise<T>,
  options: { maxAttempts: number; baseDelay: number }
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (attempt === options.maxAttempts) break;

      const delay = options.baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

**Graceful Degradation:**
```typescript
async function handleTaskWithFallback(task: Task): Promise<void> {
  try {
    await primaryHandler.handle(task);
  } catch (error) {
    logger.warn({ taskId: task.id, error }, 'Primary handler failed, using fallback');
    await fallbackHandler.handle(task);
  }
}
```

## Caching Strategies

### Multi-Level Caching

The system implements multiple caching layers:

1. **In-Memory Cache (Application Level)**
2. **Redis Cache (Distributed)**
3. **Database Query Cache**

**Application Cache Pattern:**
```typescript
export class CacheManager {
  private memoryCache = new Map<string, { value: any; expires: number }>();

  async get<T>(key: string): Promise<T | null> {
    // Check memory first
    const cached = this.memoryCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }

    // Fallback to Redis
    const redisValue = await this.redis.get(key);
    if (redisValue) {
      const parsed = JSON.parse(redisValue);
      this.memoryCache.set(key, { value: parsed, expires: Date.now() + 60000 });
      return parsed;
    }

    return null;
  }
}
```

### Cache Invalidation Patterns

**Event-Driven Invalidation:**
```typescript
// When task status changes
eventBus.emit('task:status:changed', { taskId, oldStatus, newStatus });

// Cache invalidation listener
eventBus.on('task:status:changed', ({ taskId }) => {
  cache.delete(`task:${taskId}`);
  cache.delete(`user:tasks:${task.userId}`);
});
```

## Parallel Processing Patterns

### Offline Queue Processing

**File:** `packages/cloud/src/gateway/offline-queue.ts`

```typescript
export class OfflineQueueProcessor {
  async processQueueBatch(agentId: string, batchSize: number = 10): Promise<void> {
    const tasks = await this.offlineQueueRepo.getNextBatch(agentId, batchSize);

    // Process in parallel with concurrency limit
    await Promise.allSettled(
      tasks.map(task => this.processTask(task))
    );
  }

  private async processTask(task: OfflineQueueRow): Promise<void> {
    try {
      await this.taskService.execute(task);
      await this.offlineQueueRepo.markProcessed(task.id);
    } catch (error) {
      await this.offlineQueueRepo.markFailed(task.id, error.message);
    }
  }
}
```

### Stream Processing

**Accumulator Pattern for Real-time Updates:**
```typescript
export class StreamAccumulator {
  private streams = new Map<string, string>();

  appendChunk(taskId: string, chunk: string): void {
    const existing = this.streams.get(taskId) || '';
    this.streams.set(taskId, existing + chunk);
  }

  getAccumulated(taskId: string): string {
    return this.streams.get(taskId) || '';
  }

  finalizeStream(taskId: string): string {
    const content = this.streams.get(taskId) || '';
    this.streams.delete(taskId);
    return content;
  }
}
```

## Type Safety Patterns

### Zod Schema Validation

**Message Validation:**
```typescript
import { z } from 'zod';

export const taskProgressSchema = z.object({
  taskId: z.string().uuid(),
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
  steps: z.array(z.string()).optional(),
});

export type TaskProgress = z.infer<typeof taskProgressSchema>;
```

### Type Guards

**Runtime Type Checking:**
```typescript
export function isTaskComplete(payload: unknown): payload is TaskComplete {
  try {
    taskCompleteSchema.parse(payload);
    return true;
  } catch {
    return false;
  }
}

// Usage in message router
if (isTaskComplete(msg.payload)) {
  await this.handleTaskComplete(agentId, msg.payload);
}
```

### Discriminated Unions for Message Types

```typescript
type Message =
  | { type: 'TASK_COMPLETE'; payload: TaskComplete }
  | { type: 'TASK_ERROR'; payload: TaskError }
  | { type: 'TASK_PROGRESS'; payload: TaskProgress };

function handleMessage(msg: Message) {
  switch (msg.type) {
    case 'TASK_COMPLETE':
      // msg.payload is automatically typed as TaskComplete
      return handleComplete(msg.payload);
    case 'TASK_ERROR':
      // msg.payload is automatically typed as TaskError
      return handleError(msg.payload);
    // TypeScript ensures exhaustive checking
  }
}
```

## Performance Optimization

### Connection Pooling

**Database Connection Management:**
```typescript
const db = drizzle(postgres(connectionString, {
  max: 20,              // Maximum connections
  idle_timeout: 30000,  // Idle connection timeout
  connect_timeout: 60000 // Connection timeout
}));
```

### Batch Operations

**Batch Database Writes:**
```typescript
async function batchUpdateTasks(updates: TaskUpdate[]): Promise<void> {
  const batchSize = 100;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);

    await db.transaction(async (tx) => {
      await Promise.all(
        batch.map(update =>
          tx.update(tasks)
            .set(update.data)
            .where(eq(tasks.id, update.id))
        )
      );
    });
  }
}
```

### Memory Management

**Stream Processing for Large Responses:**
```typescript
export class ResponseStream {
  private chunks: string[] = [];
  private readonly maxChunks = 1000; // Prevent memory bloat

  addChunk(chunk: string): void {
    this.chunks.push(chunk);

    // Prevent unbounded growth
    if (this.chunks.length > this.maxChunks) {
      this.chunks = this.chunks.slice(-this.maxChunks);
    }
  }

  getContent(): string {
    return this.chunks.join('');
  }
}
```

### Query Optimization

**Indexed Queries:**
```sql
-- Database indexes for common queries
CREATE INDEX CONCURRENTLY idx_tasks_agent_status
ON tasks(agent_id, status)
WHERE status IN ('pending', 'processing');

CREATE INDEX CONCURRENTLY idx_tasks_created_at_status
ON tasks(created_at, status)
WHERE status = 'completed';
```

**Efficient Pagination:**
```typescript
async function getTasksPaginated(cursor?: string, limit = 50): Promise<TaskPage> {
  const query = db
    .select()
    .from(tasks)
    .orderBy(tasks.createdAt)
    .limit(limit + 1); // +1 to check if there are more

  if (cursor) {
    query.where(gt(tasks.createdAt, new Date(cursor)));
  }

  const results = await query;
  const hasMore = results.length > limit;

  if (hasMore) results.pop();

  return {
    items: results,
    nextCursor: hasMore ? results[results.length - 1].createdAt.toISOString() : null,
    hasMore
  };
}
```

## Best Practices Summary

### Architecture Guidelines

1. **Single Responsibility**: Each handler/service has one clear purpose
2. **Dependency Injection**: Use constructor injection for testability
3. **Error Boundaries**: Implement circuit breakers for external dependencies
4. **Graceful Degradation**: Always have fallback mechanisms
5. **Type Safety**: Use Zod schemas and TypeScript strictly

### Performance Guidelines

1. **Batch Operations**: Group database operations when possible
2. **Connection Pooling**: Reuse database connections efficiently
3. **Caching Layers**: Implement multi-level caching strategies
4. **Stream Processing**: Handle large data without memory bloat
5. **Query Optimization**: Use appropriate indexes and query patterns

### Monitoring Guidelines

1. **Circuit Breaker Metrics**: Track failure rates and recovery times
2. **Performance Metrics**: Monitor response times and throughput
3. **Error Tracking**: Log structured errors with context
4. **Health Checks**: Implement comprehensive health monitoring
5. **Alerting**: Set up proactive alerts for system degradation

## Related Documentation

- [06 - Package: @bematic/cloud](./06-package-cloud.md) - Cloud service architecture
- [08 - Data Flow](./08-data-flow.md) - End-to-end data flow patterns
- [09 - WebSocket Protocol](./09-websocket-protocol.md) - Real-time communication
- [16 - Security & Compliance](./16-security-compliance.md) - Security patterns
- [17 - Operations & Troubleshooting](./17-operations-troubleshooting.md) - Operational patterns