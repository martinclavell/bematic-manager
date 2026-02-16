import type { App } from '@slack/bolt';
import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('slack:actions');

export function registerActionListeners(app: App, ctx: AppContext) {
  // Handle retry button clicks
  app.action(/^retry_task_/, async ({ action, ack, respond }) => {
    await ack();

    if (action.type !== 'button') return;
    const taskId = action.value;
    if (!taskId) return;

    logger.info({ taskId }, 'Retry action received');

    try {
      const task = ctx.taskRepo.findById(taskId);
      if (!task) {
        await respond(':x: Task not found.');
        return;
      }

      // Re-submit the task
      const project = ctx.projectRepo.findById(task.projectId);
      if (!project) {
        await respond(':x: Project no longer exists.');
        return;
      }

      await respond(':hourglass_flowing_sand: Retrying task...');
      // Create a new task with the same parameters
      await ctx.commandService.resubmit(task, project);
    } catch (error) {
      logger.error({ error, taskId }, 'Error retrying task');
      await respond(':x: Failed to retry task.');
    }
  });

  // Handle cancel button clicks
  app.action(/^cancel_task_/, async ({ action, ack, respond }) => {
    await ack();

    if (action.type !== 'button') return;
    const taskId = action.value;
    if (!taskId) return;

    logger.info({ taskId }, 'Cancel action received');

    try {
      await ctx.commandService.cancel(taskId, 'Cancelled by user');
      await respond(':white_check_mark: Task cancellation requested.');
    } catch (error) {
      logger.error({ error, taskId }, 'Error cancelling task');
      await respond(':x: Failed to cancel task.');
    }
  });
}
