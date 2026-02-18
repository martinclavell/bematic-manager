import { createLogger, taskProgressSchema } from '@bematic/common';
import type { TaskRepository } from '@bematic/db';
import type { NotificationService } from '../../services/notification.service.js';
import { ProgressTrackerManager } from './progress-tracker.js';

const logger = createLogger('task-progress-handler');

export class TaskProgressHandler {
  private trackerManager = new ProgressTrackerManager();

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly notifier: NotificationService,
  ) {}

  async handle(payload: unknown): Promise<void> {
    const parsed = taskProgressSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) {
      logger.warn({ taskId: parsed.taskId }, 'Received progress for unknown task');
      return;
    }

    const tracker = this.trackerManager.getOrCreate(parsed.taskId);
    tracker.addStep(parsed.message);

    const progressText = this.formatProgressMessage(
      task.prompt,
      tracker.getStepsFormatted(),
      parsed.percentage,
    );

    // Post or update the progress message
    const messageTs = await this.notifier.postOrUpdate(
      task.slackChannelId,
      progressText,
      task.slackThreadTs,
      tracker.messageTs,
    );

    if (messageTs && !tracker.hasMessage()) {
      tracker.setMessageTs(messageTs);
    }

    logger.debug(
      { taskId: parsed.taskId, step: parsed.message, percentage: parsed.percentage },
      'Task progress updated',
    );
  }

  /**
   * Clean up tracker after task completion
   */
  cleanup(taskId: string): void {
    this.trackerManager.delete(taskId);
  }

  private formatProgressMessage(
    prompt: string,
    steps: string,
    percentage?: number,
  ): string {
    let message = `:hourglass_flowing_sand: *Task in progress*\n\n`;
    message += `_${prompt}_\n\n`;
    message += `*Progress:*\n${steps}`;

    if (percentage !== undefined) {
      message += `\n\n*${percentage}% complete*`;
    }

    return message;
  }
}
