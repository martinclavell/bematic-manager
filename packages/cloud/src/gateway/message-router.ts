import {
  MessageType,
  createLogger,
  parseMessage,
  taskAckSchema,
  taskProgressSchema,
  taskStreamSchema,
  taskCompleteSchema,
  taskErrorSchema,
  type DeployResultPayload,
  type PathValidateResultPayload,
  type BotName,
  type TaskCompletePayload,
  type TaskAckData,
  type TaskProgressData,
  type TaskCompleteData,
  type TaskErrorData,
} from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import { ResponseBuilder } from '@bematic/bots';
import type { TaskRepository, AuditLogRepository, ProjectRepository, TaskRow } from '@bematic/db';
import type { StreamAccumulator } from './stream-accumulator.js';
import type { NotificationService } from '../services/notification.service.js';
import type { CommandService } from '../services/command.service.js';
import type { AgentHealthTracker } from './agent-health-tracker.js';
import type { SyncOrchestrator } from '../services/sync-orchestrator.service.js';
import { markdownToSlack } from '../utils/markdown-to-slack.js';
import { metrics, MetricNames } from '../utils/metrics.js';

const logger = createLogger('message-router');

/** Tracks the progress message per task so we update it instead of posting new ones */
interface ProgressTracker {
  messageTs: string | null;
  steps: string[];
  createdAt: number;
}

/** Tracks where to send deploy results */
interface DeployRequest {
  slackChannelId: string;
  slackThreadTs: string | null;
  requestedBy: string;
  createdAt: number;
}

/** Callback for path validation results */
type PathValidationCallback = (result: { success: boolean; exists: boolean; created: boolean; error?: string }) => void;

export class MessageRouter {
  private progressTrackers = new Map<string, ProgressTracker>();
  private deployRequests = new Map<string, DeployRequest>();
  private pathValidationCallbacks = new Map<string, PathValidationCallback>();
  private commandService: CommandService | null = null;
  private projectRepo: ProjectRepository | null = null;
  private syncOrchestrator: SyncOrchestrator | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Configuration
  private readonly maxProgressTrackers: number;
  private readonly maxDeployRequests: number;
  private readonly progressTrackerTtlMs: number;
  private readonly deployRequestTtlMs: number;
  private readonly cleanupIntervalMs: number;

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly streamAccumulator: StreamAccumulator,
    private readonly notifier: NotificationService,
    private readonly agentHealthTracker: AgentHealthTracker,
    options: {
      maxProgressTrackers?: number;
      maxDeployRequests?: number;
      progressTrackerTtlMs?: number;
      deployRequestTtlMs?: number;
      cleanupIntervalMs?: number;
    } = {}
  ) {
    this.maxProgressTrackers = options.maxProgressTrackers || 1000;
    this.maxDeployRequests = options.maxDeployRequests || 1000;
    this.progressTrackerTtlMs = options.progressTrackerTtlMs || 3600000; // 1 hour
    this.deployRequestTtlMs = options.deployRequestTtlMs || 3600000; // 1 hour
    this.cleanupIntervalMs = options.cleanupIntervalMs || 300000; // 5 minutes

    this.startMemoryCleanup();
  }

  /** Register a deploy request so we know where to post the result */
  registerDeployRequest(requestId: string, channelId: string, threadTs: string | null, userId: string): void {
    // Enforce size limit using LRU eviction
    if (this.deployRequests.size >= this.maxDeployRequests) {
      this.evictOldestDeployRequest();
    }

    this.deployRequests.set(requestId, {
      slackChannelId: channelId,
      slackThreadTs: threadTs,
      requestedBy: userId,
      createdAt: Date.now()
    });
  }

  /** Register a path validation callback */
  registerPathValidation(requestId: string, callback: PathValidationCallback): void {
    this.pathValidationCallbacks.set(requestId, callback);
  }

  /**
   * Start the memory cleanup interval
   */
  private startMemoryCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.performMemoryCleanup();
    }, this.cleanupIntervalMs);

    logger.info({
      cleanupIntervalMs: this.cleanupIntervalMs,
      maxProgressTrackers: this.maxProgressTrackers,
      maxDeployRequests: this.maxDeployRequests,
      progressTrackerTtlMs: this.progressTrackerTtlMs,
      deployRequestTtlMs: this.deployRequestTtlMs
    }, 'Started memory cleanup for message router');
  }

  /**
   * Stop the memory cleanup interval
   */
  stopMemoryCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Stopped memory cleanup for message router');
    }
  }

  /**
   * Perform memory cleanup - remove expired entries
   */
  private performMemoryCleanup(): void {
    const now = Date.now();
    let cleanedProgressTrackers = 0;
    let cleanedDeployRequests = 0;

    // Clean up expired progress trackers
    for (const [taskId, tracker] of this.progressTrackers.entries()) {
      if (now - tracker.createdAt > this.progressTrackerTtlMs) {
        this.progressTrackers.delete(taskId);
        cleanedProgressTrackers++;
      }
    }

    // Clean up expired deploy requests
    for (const [requestId, request] of this.deployRequests.entries()) {
      if (now - request.createdAt > this.deployRequestTtlMs) {
        this.deployRequests.delete(requestId);
        cleanedDeployRequests++;
      }
    }

    if (cleanedProgressTrackers > 0 || cleanedDeployRequests > 0) {
      logger.debug({
        cleanedProgressTrackers,
        cleanedDeployRequests,
        remainingProgressTrackers: this.progressTrackers.size,
        remainingDeployRequests: this.deployRequests.size
      }, 'Memory cleanup completed');
    }

    // Update metrics
    metrics.gauge('memory.progress_trackers', this.progressTrackers.size);
    metrics.gauge('memory.deploy_requests', this.deployRequests.size);
  }

  /**
   * Evict the oldest deploy request (LRU)
   */
  private evictOldestDeployRequest(): void {
    let oldestRequestId: string | null = null;
    let oldestTime = Date.now();

    for (const [requestId, request] of this.deployRequests.entries()) {
      if (request.createdAt < oldestTime) {
        oldestTime = request.createdAt;
        oldestRequestId = requestId;
      }
    }

    if (oldestRequestId) {
      this.deployRequests.delete(oldestRequestId);
      logger.warn({ evictedRequestId: oldestRequestId }, 'Evicted oldest deploy request due to size limit');
    }
  }

  /**
   * Evict the oldest progress tracker (LRU)
   */
  private evictOldestProgressTracker(): void {
    let oldestTaskId: string | null = null;
    let oldestTime = Date.now();

    for (const [taskId, tracker] of this.progressTrackers.entries()) {
      if (tracker.createdAt < oldestTime) {
        oldestTime = tracker.createdAt;
        oldestTaskId = taskId;
      }
    }

    if (oldestTaskId) {
      this.progressTrackers.delete(oldestTaskId);
      logger.warn({ evictedTaskId: oldestTaskId }, 'Evicted oldest progress tracker due to size limit');
    }
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): {
    progressTrackers: { count: number; maxSize: number };
    deployRequests: { count: number; maxSize: number };
  } {
    return {
      progressTrackers: {
        count: this.progressTrackers.size,
        maxSize: this.maxProgressTrackers
      },
      deployRequests: {
        count: this.deployRequests.size,
        maxSize: this.maxDeployRequests
      }
    };
  }

  /**
   * Inject CommandService after construction (avoids circular init order).
   * Must be called before handling any decomposition completions.
   */
  setCommandService(commandService: CommandService, projectRepo: ProjectRepository): void {
    this.commandService = commandService;
    this.projectRepo = projectRepo;
  }

  /**
   * Inject SyncOrchestrator after construction (avoids circular dependency).
   * Must be called to enable sync workflow coordination.
   */
  setSyncOrchestrator(syncOrchestrator: SyncOrchestrator): void {
    this.syncOrchestrator = syncOrchestrator;
  }

  /** Swap the hourglass reaction on the user's original message for a final status emoji */
  private async swapReaction(task: TaskRow, emoji: string): Promise<void> {
    if (!task.slackMessageTs) return;
    await this.notifier.removeReaction(task.slackChannelId, task.slackMessageTs, 'hourglass_flowing_sand');
    await this.notifier.addReaction(task.slackChannelId, task.slackMessageTs, emoji);
  }

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
      case MessageType.TASK_COMPLETE:
        await this.handleTaskComplete(agentId, msg.payload);
        break;
      case MessageType.TASK_ERROR:
        await this.handleTaskError(agentId, msg.payload);
        break;
      case MessageType.TASK_CANCELLED:
        await this.handleTaskCancelled(msg.payload);
        break;
      case MessageType.DEPLOY_RESULT:
        await this.handleDeployResult(agentId, msg.payload as DeployResultPayload);
        break;
      case MessageType.PATH_VALIDATE_RESULT:
        this.handlePathValidateResult(msg.payload as PathValidateResultPayload);
        break;
      case MessageType.AGENT_STATUS:
        logger.debug({ agentId, payload: msg.payload }, 'Agent status update');
        break;
      default:
        logger.warn({ type: msg.type, agentId }, 'Unknown message type from agent');
    }
  }

  private async handleTaskAck(payload: unknown): Promise<void> {
    const parsed = taskAckSchema.parse(payload) as TaskAckData;
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    if (parsed.accepted) {
      this.taskRepo.update(parsed.taskId, { status: 'running' });
      metrics.increment('tasks.accepted');
      metrics.gauge(MetricNames.ACTIVE_TASKS, this.taskRepo.findByStatus('running').length);
    } else {
      this.taskRepo.update(parsed.taskId, {
        status: 'failed',
        errorMessage: parsed.reason ?? 'Task rejected by agent',
      });
      metrics.increment('tasks.rejected');
      metrics.increment(MetricNames.TASKS_FAILED);
      await this.swapReaction(task, 'x');
      await this.notifier.postMessage(
        task.slackChannelId,
        `:x: Task rejected: ${parsed.reason ?? 'Unknown reason'}`,
        task.slackThreadTs,
      );
    }
  }

  private async handleTaskProgress(payload: unknown): Promise<void> {
    const parsed = taskProgressSchema.parse(payload) as TaskProgressData;
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    if (parsed.type === 'tool_use') {
      // Get or create progress tracker for this task
      let tracker = this.progressTrackers.get(parsed.taskId);
      if (!tracker) {
        // Enforce size limit using LRU eviction
        if (this.progressTrackers.size >= this.maxProgressTrackers) {
          this.evictOldestProgressTracker();
        }

        tracker = { messageTs: null, steps: [], createdAt: Date.now() };
        this.progressTrackers.set(parsed.taskId, tracker);
      }

      // Add step (keep last 8 to avoid message getting too long)
      tracker.steps.push(parsed.message);
      if (tracker.steps.length > 8) {
        tracker.steps = tracker.steps.slice(-8);
      }

      // Build consolidated progress message
      const lines = tracker.steps.map((s, i) => {
        const icon = i === tracker!.steps.length - 1 ? ':gear:' : ':white_check_mark:';
        return `${icon}  ${s}`;
      });
      const text = lines.join('\n');

      // Update or post the progress message
      if (tracker.messageTs) {
        await this.notifier.updateMessage(
          task.slackChannelId,
          text,
          tracker.messageTs,
        );
      } else {
        const ts = await this.notifier.postMessage(
          task.slackChannelId,
          text,
          task.slackThreadTs,
        );
        if (ts) tracker.messageTs = ts;
      }
    }
  }

  private handleTaskStream(payload: unknown): void {
    const parsed = taskStreamSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    this.streamAccumulator.addDelta(
      parsed.taskId,
      parsed.delta,
      task.slackChannelId,
      task.slackThreadTs,
    );
  }

  private async handleTaskComplete(agentId: string, payload: unknown): Promise<void> {
    const parsed = taskCompleteSchema.parse(payload) as TaskCompleteData;
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    // Track metrics
    metrics.increment(MetricNames.TASKS_COMPLETED);
    if (parsed.inputTokens || parsed.outputTokens) {
      metrics.histogram(MetricNames.TASK_TOKENS, (parsed.inputTokens || 0) + (parsed.outputTokens || 0));
    }
    if (parsed.estimatedCost) {
      metrics.histogram(MetricNames.TASK_COST, parsed.estimatedCost);
    }

    // Calculate task duration if we have creation time
    const taskDuration = Date.now() - new Date(task.createdAt).getTime();
    metrics.histogram(MetricNames.TASK_DURATION, taskDuration);

    // Record agent success
    this.agentHealthTracker.recordSuccess(agentId);

    // Notify sync orchestrator (if task is part of a sync workflow)
    if (this.syncOrchestrator) {
      this.syncOrchestrator.onTaskComplete(parsed.taskId, true).catch((err) => {
        logger.error({ err, taskId: parsed.taskId }, 'Error notifying sync orchestrator of task completion');
      });
    }

    // Update DB (including session ID for thread continuation)
    this.taskRepo.complete(parsed.taskId, parsed.result, {
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      estimatedCost: parsed.estimatedCost,
      filesChanged: parsed.filesChanged,
      commandsRun: parsed.commandsRun,
    });
    if (parsed.sessionId) {
      this.taskRepo.update(parsed.taskId, { sessionId: parsed.sessionId });
    }

    // Clean up stream + progress tracker
    this.streamAccumulator.removeStream(parsed.taskId);
    this.progressTrackers.delete(parsed.taskId);

    // --- Decomposition handling ---
    // If this was a planning (decompose) task, spawn the subtasks
    if (task.command === 'decompose' && this.commandService && this.projectRepo) {
      await this.handleDecompositionTaskComplete(task, parsed.result);
      return;
    }

    // If this is a subtask (has parent), check if all siblings are done
    if (task.parentTaskId && this.taskRepo.areAllSubtasksComplete(task.parentTaskId)) {
      await this.handleAllSubtasksComplete(task.parentTaskId, agentId);
      // Don't return — still post the individual subtask result below
    }

    // Convert markdown to Slack mrkdwn
    const slackResult = markdownToSlack(parsed.result);

    // Get project to access localPath for basePath stripping
    const project = this.projectRepo?.findById(task.projectId);
    const basePath = project?.localPath;

    // Format result using bot-specific formatter
    const bot = BotRegistry.get(task.botName as BotName);
    const blocks = bot
      ? bot.formatResult({ ...parsed, result: slackResult, basePath })
      : ResponseBuilder.taskCompleteBlocks(slackResult, { ...parsed, basePath });

    // Handle attachment failure notifications if present
    if (parsed.attachmentResults) {
      const failedAttachments = parsed.attachmentResults.filter(r => r.status === 'failed');
      if (failedAttachments.length > 0 && task.slackMessageTs) {
        await this.notifier.notifyAttachmentFailures(
          task.slackChannelId,
          task.slackMessageTs,
          failedAttachments.map(f => ({
            name: f.name,
            error: f.error || 'Unknown error',
            retries: f.retries || 0
          })),
          task.slackUserId,
          task.slackThreadTs
        );
      }
    }

    // Swap hourglass for success on the user's original message (only for root tasks)
    if (!task.parentTaskId) {
      await this.swapReaction(task, 'white_check_mark');
    }

    await this.notifier.postBlocks(
      task.slackChannelId,
      blocks,
      `Task completed: ${parsed.result.slice(0, 100)}`,
      task.slackThreadTs,
    );

    // Audit log with attachment failure information
    const auditMetadata: Record<string, any> = {
      agentId,
      cost: parsed.estimatedCost,
      durationMs: parsed.durationMs,
      parentTaskId: task.parentTaskId,
    };

    // Add attachment failure information to audit log
    if (parsed.attachmentResults) {
      const failedAttachments = parsed.attachmentResults.filter(r => r.status === 'failed');
      if (failedAttachments.length > 0) {
        auditMetadata.attachmentFailures = failedAttachments.map(f => ({
          name: f.name,
          error: f.error,
          retries: f.retries
        }));
        auditMetadata.attachmentFailureCount = failedAttachments.length;
      }
      auditMetadata.attachmentSuccessCount = parsed.attachmentResults.filter(r => r.status === 'success').length;
    }

    this.auditLogRepo.log('task:completed', 'task', parsed.taskId, null, auditMetadata);

    // Log specific audit entry for attachment failures if any occurred
    if (parsed.attachmentResults) {
      const failedAttachments = parsed.attachmentResults.filter(r => r.status === 'failed');
      if (failedAttachments.length > 0) {
        this.auditLogRepo.log('attachment:failed', 'task', parsed.taskId, null, {
          agentId,
          failedAttachments: failedAttachments.map(f => ({
            name: f.name,
            error: f.error,
            retries: f.retries
          })),
          failedCount: failedAttachments.length,
          totalAttachments: parsed.attachmentResults.length,
        });
      }
    }

    logger.info(
      { taskId: parsed.taskId, cost: parsed.estimatedCost, durationMs: parsed.durationMs, parentTaskId: task.parentTaskId },
      'Task completed',
    );
  }

  /** Handle completion of a decompose planning task — spawn the actual subtasks */
  private async handleDecompositionTaskComplete(task: TaskRow, planningResult: string): Promise<void> {
    if (!this.commandService || !this.projectRepo) {
      logger.error({ taskId: task.id }, 'CommandService not available for decomposition');
      return;
    }

    const project = this.projectRepo.findById(task.projectId);
    if (!project) {
      logger.error({ taskId: task.id, projectId: task.projectId }, 'Project not found for decomposition');
      return;
    }

    const bot = BotRegistry.get(task.botName as BotName);
    if (!bot) {
      logger.error({ taskId: task.id, botName: task.botName }, 'Bot not found for decomposition');
      return;
    }

    try {
      const subtaskIds = await this.commandService.handleDecompositionComplete(
        task.id,
        planningResult,
        project,
        bot,
        {
          channelId: task.slackChannelId,
          threadTs: task.slackThreadTs,
          userId: task.slackUserId,
        },
      );

      logger.info(
        { parentTaskId: task.id, subtaskIds },
        'Decomposition subtasks spawned',
      );
    } catch (error) {
      logger.error({ taskId: task.id, error }, 'Failed to spawn subtasks from decomposition');

      await this.notifier.postMessage(
        task.slackChannelId,
        `:warning: Failed to decompose task into subtasks. The planning result could not be parsed.`,
        task.slackThreadTs,
      );
    }
  }

  /** Called when all subtasks of a parent have reached a terminal state */
  private async handleAllSubtasksComplete(parentTaskId: string, _agentId: string): Promise<void> {
    const parentTask = this.taskRepo.findById(parentTaskId);
    if (!parentTask) return;

    const subtasks = this.taskRepo.findByParentTaskId(parentTaskId);
    const subtaskResults = subtasks.map((s) => ({
      taskId: s.id,
      status: s.status,
      result: s.result ?? undefined,
      durationMs: undefined, // Not stored separately
      estimatedCost: s.estimatedCost,
    }));

    const blocks = ResponseBuilder.subtaskSummaryBlocks(parentTaskId, subtaskResults);

    // Swap reaction on original message
    const allSucceeded = subtasks.every((s) => s.status === 'completed');
    await this.swapReaction(parentTask, allSucceeded ? 'white_check_mark' : 'warning');

    await this.notifier.postBlocks(
      parentTask.slackChannelId,
      blocks,
      `All subtasks finished for ${parentTaskId}`,
      parentTask.slackThreadTs,
    );

    // Mark parent task as completed with summary
    const totalCost = subtasks.reduce((sum, s) => sum + s.estimatedCost, 0);
    const completed = subtasks.filter((s) => s.status === 'completed').length;
    const failed = subtasks.filter((s) => s.status === 'failed').length;

    this.taskRepo.complete(parentTaskId, `Decomposed into ${subtasks.length} subtasks: ${completed} completed, ${failed} failed.`, {
      inputTokens: subtasks.reduce((sum, s) => sum + s.inputTokens, 0),
      outputTokens: subtasks.reduce((sum, s) => sum + s.outputTokens, 0),
      estimatedCost: totalCost,
      filesChanged: subtasks.flatMap((s) => {
        try { return JSON.parse(s.filesChanged); } catch { return []; }
      }),
      commandsRun: [],
    });

    logger.info(
      { parentTaskId, subtaskCount: subtasks.length, completed, failed, totalCost },
      'All subtasks completed — parent task finalized',
    );
  }

  private async handleDeployResult(agentId: string, payload: DeployResultPayload): Promise<void> {
    const req = this.deployRequests.get(payload.requestId);
    this.deployRequests.delete(payload.requestId);

    if (!req) {
      logger.warn({ requestId: payload.requestId }, 'Deploy result for unknown request');
      return;
    }

    if (payload.success) {
      const logsLine = payload.buildLogsUrl ? `\n> Build logs: ${payload.buildLogsUrl}` : '';
      await this.notifier.postMessage(
        req.slackChannelId,
        `:white_check_mark: *Deploy uploaded successfully!*\n\`\`\`${payload.output}\`\`\`${logsLine}`,
        req.slackThreadTs,
      );
    } else {
      await this.notifier.postMessage(
        req.slackChannelId,
        `:x: *Deploy failed:*\n\`\`\`${payload.output.slice(0, 2900)}\`\`\``,
        req.slackThreadTs,
      );
    }

    logger.info({ requestId: payload.requestId, success: payload.success, agentId }, 'Deploy result received');
  }

  private handlePathValidateResult(payload: PathValidateResultPayload): void {
    const callback = this.pathValidationCallbacks.get(payload.requestId);
    this.pathValidationCallbacks.delete(payload.requestId);

    if (!callback) {
      logger.warn({ requestId: payload.requestId }, 'Path validation result for unknown request');
      return;
    }

    callback({
      success: payload.success,
      exists: payload.exists,
      created: payload.created,
      error: payload.error,
    });

    logger.info({ requestId: payload.requestId, success: payload.success, exists: payload.exists, created: payload.created }, 'Path validation result received');
  }

  private async handleTaskError(agentId: string, payload: unknown): Promise<void> {
    const parsed = taskErrorSchema.parse(payload) as TaskErrorData;
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    // Track metrics
    metrics.increment(MetricNames.TASKS_FAILED);

    // Calculate task duration even for failures
    const taskDuration = Date.now() - new Date(task.createdAt).getTime();
    metrics.histogram(MetricNames.TASK_DURATION, taskDuration);

    // Record agent failure
    this.agentHealthTracker.recordFailure(agentId);

    // Notify sync orchestrator (if task is part of a sync workflow)
    if (this.syncOrchestrator) {
      this.syncOrchestrator.onTaskComplete(parsed.taskId, false).catch((err) => {
        logger.error({ err, taskId: parsed.taskId }, 'Error notifying sync orchestrator of task failure');
      });
    }

    this.taskRepo.fail(parsed.taskId, parsed.error);
    // Save sessionId even on failure so the session can be resumed
    if (parsed.sessionId) {
      this.taskRepo.update(parsed.taskId, { sessionId: parsed.sessionId });
    }
    this.streamAccumulator.removeStream(parsed.taskId);
    this.progressTrackers.delete(parsed.taskId);

    // If this is a subtask, check if all siblings are done
    if (task.parentTaskId && this.taskRepo.areAllSubtasksComplete(task.parentTaskId)) {
      await this.handleAllSubtasksComplete(task.parentTaskId, agentId);
    }

    const bot = BotRegistry.get(task.botName as BotName);
    const blocks = bot
      ? bot.formatError(parsed.error, parsed.taskId)
      : ResponseBuilder.taskErrorBlocks(parsed.error, parsed.recoverable, parsed.taskId);

    // Swap hourglass for error on the user's original message (only for root tasks)
    if (!task.parentTaskId) {
      await this.swapReaction(task, 'x');
    }

    await this.notifier.postBlocks(
      task.slackChannelId,
      blocks,
      `Task failed: ${parsed.error}`,
      task.slackThreadTs,
    );

    this.auditLogRepo.log('task:failed', 'task', parsed.taskId, null, {
      agentId,
      error: parsed.error,
      parentTaskId: task.parentTaskId,
    });

    logger.error({ taskId: parsed.taskId, error: parsed.error, parentTaskId: task.parentTaskId }, 'Task failed');
  }

  private async handleTaskCancelled(payload: unknown): Promise<void> {
    const parsed = (payload as { taskId: string; reason: string });
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    // Track metrics
    metrics.increment(MetricNames.TASKS_CANCELLED);

    // Calculate task duration even for cancelled tasks
    const taskDuration = Date.now() - new Date(task.createdAt).getTime();
    metrics.histogram(MetricNames.TASK_DURATION, taskDuration);

    this.taskRepo.update(parsed.taskId, { status: 'cancelled' });
    this.streamAccumulator.removeStream(parsed.taskId);
    this.progressTrackers.delete(parsed.taskId);

    // If this is a subtask, check if all siblings are done
    if (task.parentTaskId && this.taskRepo.areAllSubtasksComplete(task.parentTaskId)) {
      await this.handleAllSubtasksComplete(task.parentTaskId, 'unknown');
    }

    // Swap hourglass for cancelled on the user's original message
    if (!task.parentTaskId) {
      await this.swapReaction(task, 'no_entry_sign');
    }

    await this.notifier.postMessage(
      task.slackChannelId,
      `:no_entry_sign: Task cancelled: ${parsed.reason}`,
      task.slackThreadTs,
    );
  }
}
