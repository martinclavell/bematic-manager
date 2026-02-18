import { createLogger, taskErrorSchema } from '@bematic/common';
import { ResponseBuilder } from '@bematic/bots';
import type { TaskRepository, AuditLogRepository, TaskRow } from '@bematic/db';
import type { NotificationService } from '../../services/notification.service.js';

const logger = createLogger('task-error-handler');

export class TaskErrorHandler {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly notifier: NotificationService,
  ) {}

  async handle(agentId: string, payload: unknown): Promise<void> {
    const parsed = taskErrorSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) {
      logger.warn({ taskId: parsed.taskId }, 'Received error for unknown task');
      return;
    }

    // Update task status in database
    this.taskRepo.fail(parsed.taskId, parsed.error);

    // Post error message to Slack
    await this.postErrorMessage(task, parsed, agentId);

    // Log to audit trail
    this.auditLogRepo.log('task:failed', 'task', parsed.taskId, null, {
      agentId,
      error: parsed.error,
      recoverable: parsed.recoverable,
    });

    logger.error(
      {
        taskId: parsed.taskId,
        error: parsed.error,
        recoverable: parsed.recoverable,
      },
      'Task failed',
    );
  }

  private async postErrorMessage(
    task: TaskRow,
    parsed: ReturnType<typeof taskErrorSchema.parse>,
    agentId: string,
  ): Promise<void> {
    // Build error message blocks
    const blocks = ResponseBuilder.taskErrorBlocks(parsed.error, parsed.recoverable, parsed.taskId);

    // Add error reaction to original message
    if (task.slackMessageTs) {
      await this.swapReaction(task, 'x');
    }

    // Post error to Slack
    await this.notifier.postBlocks(
      task.slackChannelId,
      blocks,
      `Task failed: ${parsed.error}`,
      task.slackThreadTs,
    );
  }

  private async swapReaction(task: TaskRow, emoji: string): Promise<void> {
    if (!task.slackMessageTs) return;
    await this.notifier.removeReaction(
      task.slackChannelId,
      task.slackMessageTs,
      'hourglass_flowing_sand',
    );
    await this.notifier.addReaction(task.slackChannelId, task.slackMessageTs, emoji);
  }
}
