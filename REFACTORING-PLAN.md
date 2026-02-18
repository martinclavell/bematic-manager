# Code Refactoring Plan - Modularization Review

## Executive Summary

After reviewing the codebase, I identified **4 files that violate Single Responsibility Principle** and need refactoring into smaller, focused modules.

**Files to Refactor:**
1. `claude-executor.ts` (469 lines) ⚠️ **HIGHEST PRIORITY**
2. `command.service.ts` (444 lines) ⚠️ **HIGH PRIORITY**
3. `message-router.ts` (442 lines) ⚠️ **HIGH PRIORITY**
4. `admin.ts` (406 lines) ⚠️ **MEDIUM PRIORITY**

---

## 1. ClaudeExecutor (469 lines) - HIGHEST PRIORITY

### Current Problems
- **Too many responsibilities:**
  1. Task execution orchestration
  2. Message stream handling
  3. Auto-continuation logic
  4. File/command tracking
  5. Tool use description formatting
  6. Cost calculation
  7. Progress reporting

### Proposed Refactoring

```
packages/agent/src/executor/
├── claude-executor.ts (100 lines)          # Main orchestrator
├── execution-tracker.ts (80 lines)         # Files/commands tracking
├── continuation-handler.ts (100 lines)     # Auto-continuation logic
├── message-handler.ts (120 lines)          # SDK message processing
└── tool-descriptor.ts (50 lines)           # Tool use descriptions
```

#### **New Module: `execution-tracker.ts`**
```typescript
export class ExecutionTracker {
  private filesChanged = new Set<string>();
  private commandsRun = new Set<string>();
  private assistantTurnCount = 0;

  addFileChanged(file: string): void
  addCommandRun(cmd: string): void
  incrementTurnCount(): void
  getMetrics(): { files: string[]; commands: string[]; turns: number }
}
```

#### **New Module: `continuation-handler.ts`**
```typescript
export class ContinuationHandler {
  constructor(
    private readonly maxContinuations: number,
    private readonly wsClient: WSClient
  )

  async handleMaxTurns(
    task: TaskSubmitPayload,
    sessionId: string,
    currentAttempt: number
  ): Promise<{ shouldContinue: boolean; result?: InvocationResult }>
}
```

#### **New Module: `message-handler.ts`**
```typescript
export class MessageHandler {
  processMessage(msg: SDKMessage): MessageProcessingResult
  extractFileChanges(msg: SDKMessage): string[]
  extractCommandsRun(msg: SDKMessage): string[]
  shouldReportProgress(msg: SDKMessage): boolean
}
```

#### **Refactored `claude-executor.ts`**
```typescript
export class ClaudeExecutor {
  private tracker: ExecutionTracker;
  private continuationHandler: ContinuationHandler;
  private messageHandler: MessageHandler;

  async execute(task: TaskSubmitPayload): Promise<ExecutionResult> {
    // Clean orchestration only - delegates to specialized classes
  }
}
```

**Benefits:**
- ✅ Each class has one clear responsibility
- ✅ Easier to test (mock dependencies)
- ✅ Easier to maintain and extend
- ✅ Continuation logic can be reused

---

## 2. CommandService (444 lines) - HIGH PRIORITY

### Current Problems
- **Too many responsibilities:**
  1. Direct task submission
  2. Decomposition flow
  3. Subtask parsing
  4. Task resubmission
  5. Task cancellation
  6. Agent offline handling

### Proposed Refactoring

```
packages/cloud/src/services/
├── command.service.ts (150 lines)          # Main orchestrator
├── task-submitter.ts (100 lines)           # Direct submission logic
├── decomposition-handler.ts (150 lines)    # Decomposition flow
└── subtask-parser.ts (60 lines)            # JSON parsing
```

#### **New Module: `task-submitter.ts`**
```typescript
export class TaskSubmitter {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly agentManager: AgentManager,
    private readonly offlineQueue: OfflineQueue
  )

  async submit(params: SubmitTaskParams): Promise<string>
  private buildTaskPayload(params: SubmitTaskParams): TaskSubmitPayload
  private sendToAgent(agentId: string, payload: TaskSubmitPayload): boolean
}
```

#### **New Module: `decomposition-handler.ts`**
```typescript
export class DecompositionHandler {
  constructor(
    private readonly taskSubmitter: TaskSubmitter,
    private readonly subtaskParser: SubtaskParser,
    private readonly notifier: NotificationService
  )

  async submitWithDecomposition(params: SubmitParams): Promise<string>
  async handlePlanningComplete(task: TaskRow, result: string): Promise<void>
  async handleSubtasksComplete(parentTaskId: string): Promise<void>
}
```

#### **New Module: `subtask-parser.ts`**
```typescript
export class SubtaskParser {
  parse(result: string): SubtaskDefinition[]
  private extractJSON(text: string): string | null
  private validateSubtask(subtask: unknown): SubtaskDefinition
}
```

#### **Refactored `command.service.ts`**
```typescript
export class CommandService {
  private taskSubmitter: TaskSubmitter;
  private decompositionHandler: DecompositionHandler;

  async submit(params: SubmitParams): Promise<string> {
    if (bot.shouldDecompose(command)) {
      return this.decompositionHandler.submitWithDecomposition(params);
    }
    return this.taskSubmitter.submit(params);
  }

  async resubmit(task: TaskRow, project: ProjectRow): Promise<string>
  async cancel(taskId: string, reason: string): Promise<void>
}
```

**Benefits:**
- ✅ Decomposition logic isolated and testable
- ✅ Task submission reusable
- ✅ Parser can be tested independently
- ✅ Easier to add new submission strategies

---

## 3. MessageRouter (442 lines) - HIGH PRIORITY

### Current Problems
- **Too many responsibilities:**
  1. Message routing
  2. Task acknowledgment
  3. Progress tracking
  4. Stream handling
  5. Task completion
  6. Decomposition handling
  7. Deploy result handling
  8. Error handling
  9. Cancellation handling

### Proposed Refactoring

```
packages/cloud/src/gateway/
├── message-router.ts (150 lines)           # Main router
├── handlers/
│   ├── task-ack-handler.ts (40 lines)
│   ├── task-progress-handler.ts (60 lines)
│   ├── task-completion-handler.ts (100 lines)
│   ├── task-error-handler.ts (60 lines)
│   └── deploy-result-handler.ts (50 lines)
└── progress-tracker.ts (40 lines)
```

#### **New Module: `handlers/task-completion-handler.ts`**
```typescript
export class TaskCompletionHandler {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly notifier: NotificationService,
    private readonly streamAccumulator: StreamAccumulator
  )

  async handleCompletion(agentId: string, payload: TaskCompletePayload): Promise<void>
  private async postCompletionMessage(task: TaskRow, result: string): Promise<void>
  private formatMetrics(task: TaskRow): string
}
```

#### **New Module: `handlers/task-progress-handler.ts`**
```typescript
export class TaskProgressHandler {
  private trackers = new Map<string, ProgressTracker>();

  async handleProgress(payload: TaskProgressPayload): Promise<void>
  private getOrCreateTracker(taskId: string): ProgressTracker
  private formatProgressMessage(tracker: ProgressTracker): string
}
```

#### **New Module: `progress-tracker.ts`**
```typescript
export class ProgressTracker {
  messageTs: string | null = null;
  steps: string[] = [];

  addStep(step: string): void
  getStepsFormatted(): string
}
```

#### **Refactored `message-router.ts`**
```typescript
export class MessageRouter {
  private taskAckHandler: TaskAckHandler;
  private taskProgressHandler: TaskProgressHandler;
  private taskCompletionHandler: TaskCompletionHandler;
  private taskErrorHandler: TaskErrorHandler;
  private deployResultHandler: DeployResultHandler;

  async handleAgentMessage(agentId: string, raw: string): Promise<void> {
    const msg = parseMessage(raw);

    switch (msg.type) {
      case MessageType.TASK_ACK:
        await this.taskAckHandler.handle(msg.payload);
        break;
      case MessageType.TASK_PROGRESS:
        await this.taskProgressHandler.handle(msg.payload);
        break;
      // ... delegate to handlers
    }
  }
}
```

**Benefits:**
- ✅ Each handler is focused and testable
- ✅ Easy to add new message types
- ✅ Progress tracking logic isolated
- ✅ Easier to understand message flow

---

## 4. Admin.ts (406 lines) - MEDIUM PRIORITY

### Current Problems
- **All admin commands in one file**
- **Hard to find specific commands**
- **Difficult to test individual commands**

### Proposed Refactoring

```
packages/cloud/src/slack/listeners/
├── admin.ts (100 lines)                    # Main router
└── admin-commands/
    ├── agent-commands.ts (100 lines)       # restart-agent, agent-status, agent-health
    ├── worker-dashboard.ts (100 lines)     # workers command
    ├── deploy-commands.ts (100 lines)      # deploy, deploy-status, deploy-logs
    ├── health-commands.ts (80 lines)       # health, metrics, retention
    └── log-commands.ts (80 lines)          # logs with filters
```

#### **New Module: `admin-commands/agent-commands.ts`**
```typescript
export async function handleRestartAgent(ctx: AppContext, args: string[], respond: RespondFn): Promise<void>
export async function handleAgentStatus(ctx: AppContext, respond: RespondFn): Promise<void>
export async function handleAgentHealth(ctx: AppContext, respond: RespondFn): Promise<void>
export async function handleAgentHealthReset(ctx: AppContext, args: string[], userId: string, respond: RespondFn): Promise<void>
```

#### **New Module: `admin-commands/health-commands.ts`**
```typescript
export async function handleHealth(ctx: AppContext, respond: RespondFn): Promise<void>
export async function handleMetrics(ctx: AppContext, respond: RespondFn): Promise<void>
export async function handleRetentionStats(ctx: AppContext, respond: RespondFn): Promise<void>
export async function handleRetentionRun(ctx: AppContext, userId: string, respond: RespondFn): Promise<void>
```

#### **Refactored `admin.ts`**
```typescript
import * as AgentCommands from './admin-commands/agent-commands.js';
import * as HealthCommands from './admin-commands/health-commands.js';
import * as DeployCommands from './admin-commands/deploy-commands.js';
import * as WorkerCommands from './admin-commands/worker-dashboard.js';
import * as LogCommands from './admin-commands/log-commands.js';

export function registerAdminListener(app: App, ctx: AppContext) {
  app.command('/bm-admin', async ({ command, ack, respond }) => {
    await ack();
    const { user_id, text } = command;
    const args = text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    try {
      await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

      switch (subcommand) {
        case 'restart-agent':
          await AgentCommands.handleRestartAgent(ctx, args, respond);
          break;
        case 'agent-status':
          await AgentCommands.handleAgentStatus(ctx, respond);
          break;
        case 'health':
          await HealthCommands.handleHealth(ctx, respond);
          break;
        case 'metrics':
          await HealthCommands.handleMetrics(ctx, respond);
          break;
        // ... simple routing
      }
    } catch (error) {
      // ... error handling
    }
  });
}
```

**Benefits:**
- ✅ Each command module is focused
- ✅ Easy to find and modify commands
- ✅ Unit testable handlers
- ✅ Clean separation of concerns

---

## Additional Files (Acceptable As-Is)

These files are large but well-structured:

| File | Lines | Status | Reason |
|------|-------|--------|--------|
| `retention.service.ts` | 283 | ✅ OK | Single responsibility, clean methods |
| `circuit-breaker.ts` | 244 | ✅ OK | Complex algorithm, well-organized |
| `message-buffer.ts` | 221 | ✅ OK | Single data structure management |
| `health.service.ts` | 188 | ✅ OK | Clean aggregation logic |
| `metrics.ts` | 179 | ✅ OK | Single data collection class |

---

## Implementation Priority

### Phase 1: Critical (Week 1)
1. ✅ **Refactor MessageRouter** (breaks down complex routing)
   - Create handler modules
   - Extract progress tracker
   - Test each handler independently

### Phase 2: High Priority (Week 2)
2. ✅ **Refactor CommandService** (simplifies task submission)
   - Extract TaskSubmitter
   - Extract DecompositionHandler
   - Extract SubtaskParser

3. ✅ **Refactor ClaudeExecutor** (simplifies agent logic)
   - Extract ExecutionTracker
   - Extract ContinuationHandler
   - Extract MessageHandler

### Phase 3: Medium Priority (Week 3)
4. ✅ **Refactor Admin Commands** (improves maintainability)
   - Create command handler modules
   - Update main router
   - Add unit tests per command

---

## Refactoring Benefits

### Before Refactoring
- 4 files with 400+ lines each
- Multiple responsibilities per file
- Difficult to test in isolation
- Hard to navigate and understand
- Risky to modify (side effects)

### After Refactoring
- ✅ **20+ focused modules** (average 80 lines each)
- ✅ **Single responsibility** per module
- ✅ **Easy to test** (mock dependencies)
- ✅ **Easy to navigate** (clear file structure)
- ✅ **Safe to modify** (isolated changes)
- ✅ **Better code reuse** (composable modules)

---

## Estimated Effort

| Refactoring | Files Created | Effort | Priority |
|-------------|---------------|--------|----------|
| MessageRouter | 6 files | 4 hours | HIGH |
| CommandService | 4 files | 3 hours | HIGH |
| ClaudeExecutor | 5 files | 4 hours | HIGH |
| Admin Commands | 6 files | 3 hours | MEDIUM |
| **Total** | **21 files** | **14 hours** | **2 weeks** |

---

## Testing Strategy

For each refactored module:

1. **Unit Tests** - Test each handler/module independently
2. **Integration Tests** - Test composition of modules
3. **Regression Tests** - Ensure behavior unchanged
4. **Code Coverage** - Aim for 80%+ per module

---

## Recommendation

**START WITH:** MessageRouter refactoring (Phase 1)

**Why?**
- Most complex file (442 lines, 9 different message types)
- Handles critical cloud-agent communication
- Easiest to break into handlers (clear separation)
- High impact on code quality

**Then:** CommandService and ClaudeExecutor in parallel

**Finally:** Admin commands (lower priority, doesn't block functionality)

---

## Decision: Should We Refactor Now?

### ✅ Arguments FOR Immediate Refactoring:
1. Code is fresh in mind
2. No tech debt accumulation
3. Easier to test now than later
4. Improves long-term maintainability
5. Sets good patterns for future development

### ❌ Arguments AGAINST Immediate Refactoring:
1. System works as-is
2. Can wait until features stabilize
3. Might over-engineer before understanding usage patterns
4. Integration just completed

### 💡 **My Recommendation:**

**REFACTOR NOW** - but only **MessageRouter** (Phase 1)

**Reasoning:**
- MessageRouter is the most complex and critical
- Breaking it down now prevents future headaches
- Sets the pattern for other files later
- Only 4 hours of work
- Other files can wait until we have real-world usage data

---

**Would you like me to:**
1. ✅ Proceed with MessageRouter refactoring now? (4 hours)
2. ❌ Skip refactoring and leave as-is (wait for usage patterns)
3. 📋 Create refactoring tasks for future sprint
