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
} from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import { ResponseBuilder } from '@bematic/bots';
import type { TaskRepository, AuditLogRepository, ProjectRepository, TaskRow } from '@bematic/db';
import type { StreamAccumulator } from './stream-accumulator.js';
import type { NotificationService } from '../services/notification.service.js';
import type { CommandService } from '../services/command.service.js';
import { markdownToSlack } from '../utils/markdown-to-slack.js';

const logger = createLogger('message-router');

/** Tracks the progress message per task so we update it instead of posting new ones */
interface ProgressTracker {
  messageTs: string | null;
  steps: string[];
}

/** Tracks where to send deploy results */
interface DeployRequest {
  slackChannelId: string;
  slackThreadTs: string | null;
  requestedBy: string;
}

export class MessageRouter {
  private progressTrackers = new Map<string, ProgressTracker>();
  private deployRequests = new Map<string, DeployRequest>();
  private commandService: CommandService | null = null;
  private projectRepo: ProjectRepository | null = null;

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly streamAccumulator: StreamAccumulator,
    private readonly notifier: NotificationService,
  ) {}

  /** Register a deploy request so we know where to post the result */
  registerDeployRequest(requestId: string, channelId: string, threadTs: string | null, userId: string): void {
    this.deployRequests.set(requestId, { slackChannelId: channelId, slackThreadTs: threadTs, requestedBy: userId });
  }

  /**
   * Inject CommandService after construction (avoids circular init order).
   * Must be called before handling any decomposition completions.
   */
  setCommandService(commandService: CommandService, projectRepo: ProjectRepository): void {
    this.commandService = commandService;
    this.projectRepo = projectRepo;
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
      case MessageType.AGENT_STATUS:
        logger.debug({ agentId, payload: msg.payload }, 'Agent status update');
        break;
      default:
        logger.warn({ type: msg.type, agentId }, 'Unknown message type from agent');
    }
  }

  private async handleTaskAck(payload: unknown): Promise<void> {
    const parsed = taskAckSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    if (parsed.accepted) {
      this.taskRepo.update(parsed.taskId, { status: 'running' });
    } else {
      this.taskRepo.update(parsed.taskId, {
        status: 'failed',
        errorMessage: parsed.reason ?? 'Task rejected by agent',
      });
      await this.swapReaction(task, 'x');
      await this.notifier.postMessage(
        task.slackChannelId,
        `:x: Task rejected: ${parsed.reason ?? 'Unknown reason'}`,
        task.slackThreadTs,
      );
    }
  }

  private async handleTaskProgress(payload: unknown): Promise<void> {
    const parsed = taskProgressSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    if (parsed.type === 'tool_use') {
      // Get or create progress tracker for this task
      let tracker = this.progressTrackers.get(parsed.taskId);
      if (!tracker) {
        tracker = { messageTs: null, steps: [] };
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
    const parsed = taskCompleteSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

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

    // Format result using bot-specific formatter
    const bot = BotRegistry.get(task.botName as any);
    const blocks = bot
      ? bot.formatResult({ ...parsed, result: slackResult })
      : ResponseBuilder.taskCompleteBlocks(slackResult, parsed);

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

    // Audit log
    this.auditLogRepo.log('task:completed', 'task', parsed.taskId, null, {
      agentId,
      cost: parsed.estimatedCost,
      durationMs: parsed.durationMs,
      parentTaskId: task.parentTaskId,
    });

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

    const bot = BotRegistry.get(task.botName as any);
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

  private async handleTaskError(agentId: string, payload: unknown): Promise<void> {
    const parsed = taskErrorSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    this.taskRepo.fail(parsed.taskId, parsed.error);
    this.streamAccumulator.removeStream(parsed.taskId);
    this.progressTrackers.delete(parsed.taskId);

    // If this is a subtask, check if all siblings are done
    if (task.parentTaskId && this.taskRepo.areAllSubtasksComplete(task.parentTaskId)) {
      await this.handleAllSubtasksComplete(task.parentTaskId, agentId);
    }

    const bot = BotRegistry.get(task.botName as any);
    const blocks = bot
      ? bot.formatError(parsed.error, parsed.taskId)
      : ResponseBuilder.taskErrorBlocks(parsed.error, parsed.taskId);

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
