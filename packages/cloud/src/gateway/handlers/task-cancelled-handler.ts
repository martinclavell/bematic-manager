import { createLogger } from '@bematic/common';
import type { TaskRepository, AuditLogRepository } from '@bematic/db';
import type { NotificationService } from '../../services/notification.service.js';

const logger = createLogger('task-cancelled-handler');

export class TaskCancelledHandler {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly notifier: NotificationService,
  ) {}

  async handle(payload: unknown): Promise<void> {
    const { taskId, reason } = payload as { taskId: string; reason?: string };
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      logger.warn({ taskId }, 'Received cancellation for unknown task');
      return;
    }

    // Update task status
    this.taskRepo.update(taskId, { status: 'cancelled' });

    // Notify user in Slack
    const message = reason
      ? `:no_entry_sign: Task cancelled: ${reason}`
      : `:no_entry_sign: Task cancelled`;

    await this.notifier.postMessage(task.slackChannelId, message, task.slackThreadTs);

    // Add reaction to original message
    if (task.slackMessageTs) {
      await this.notifier.removeReaction(
        task.slackChannelId,
        task.slackMessageTs,
        'hourglass_flowing_sand',
      );
      await this.notifier.addReaction(task.slackChannelId, task.slackMessageTs, 'no_entry_sign');
    }

    // Log to audit trail
    this.auditLogRepo.log('task:cancelled', 'task', taskId, null, { reason });

    logger.info({ taskId, reason }, 'Task cancelled');
  }
}
