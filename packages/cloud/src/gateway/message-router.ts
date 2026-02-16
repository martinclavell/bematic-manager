import {
  MessageType,
  createLogger,
  parseMessage,
  taskAckSchema,
  taskProgressSchema,
  taskStreamSchema,
  taskCompleteSchema,
  taskErrorSchema,
} from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import { ResponseBuilder } from '@bematic/bots';
import type { TaskRepository, AuditLogRepository } from '@bematic/db';
import type { StreamAccumulator } from './stream-accumulator.js';
import type { NotificationService } from '../services/notification.service.js';
import { markdownToSlack } from '../utils/markdown-to-slack.js';

const logger = createLogger('message-router');

/** Tracks the progress message per task so we update it instead of posting new ones */
interface ProgressTracker {
  messageTs: string | null;
  steps: string[];
}

export class MessageRouter {
  private progressTrackers = new Map<string, ProgressTracker>();

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly streamAccumulator: StreamAccumulator,
    private readonly notifier: NotificationService,
  ) {}

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
      await this.notifier.postBlocks(
        task.slackChannelId,
        ResponseBuilder.taskStartBlocks(parsed.taskId, task.botName, task.command),
        `Working on task ${parsed.taskId}...`,
        task.slackThreadTs,
      );
    } else {
      this.taskRepo.update(parsed.taskId, {
        status: 'failed',
        errorMessage: parsed.reason ?? 'Task rejected by agent',
      });
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

    // Update DB
    this.taskRepo.complete(parsed.taskId, parsed.result, {
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      estimatedCost: parsed.estimatedCost,
      filesChanged: parsed.filesChanged,
      commandsRun: parsed.commandsRun,
    });

    // Clean up stream + progress tracker
    this.streamAccumulator.removeStream(parsed.taskId);
    this.progressTrackers.delete(parsed.taskId);

    // Convert markdown to Slack mrkdwn
    const slackResult = markdownToSlack(parsed.result);

    // Format result using bot-specific formatter
    const bot = BotRegistry.get(task.botName as any);
    const blocks = bot
      ? bot.formatResult({ ...parsed, result: slackResult })
      : ResponseBuilder.taskCompleteBlocks(slackResult, parsed);

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
    });

    logger.info(
      { taskId: parsed.taskId, cost: parsed.estimatedCost, durationMs: parsed.durationMs },
      'Task completed',
    );
  }

  private async handleTaskError(agentId: string, payload: unknown): Promise<void> {
    const parsed = taskErrorSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    this.taskRepo.fail(parsed.taskId, parsed.error);
    this.streamAccumulator.removeStream(parsed.taskId);
    this.progressTrackers.delete(parsed.taskId);

    const bot = BotRegistry.get(task.botName as any);
    const blocks = bot
      ? bot.formatError(parsed.error, parsed.taskId)
      : ResponseBuilder.taskErrorBlocks(parsed.error, parsed.taskId);

    await this.notifier.postBlocks(
      task.slackChannelId,
      blocks,
      `Task failed: ${parsed.error}`,
      task.slackThreadTs,
    );

    this.auditLogRepo.log('task:failed', 'task', parsed.taskId, null, {
      agentId,
      error: parsed.error,
    });

    logger.error({ taskId: parsed.taskId, error: parsed.error }, 'Task failed');
  }

  private async handleTaskCancelled(payload: unknown): Promise<void> {
    const parsed = (payload as { taskId: string; reason: string });
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) return;

    this.taskRepo.update(parsed.taskId, { status: 'cancelled' });
    this.streamAccumulator.removeStream(parsed.taskId);
    this.progressTrackers.delete(parsed.taskId);

    await this.notifier.postMessage(
      task.slackChannelId,
      `:no_entry_sign: Task cancelled: ${parsed.reason}`,
      task.slackThreadTs,
    );
  }
}
