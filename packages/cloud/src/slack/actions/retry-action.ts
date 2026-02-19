import { ActionRegistry } from '../action-registry.js';
import type { AppContext } from '../../context.js';

export function registerRetryAction(ctx: AppContext): void {
  ActionRegistry.register({
    type: 'retry_task',
    description: 'Retry a failed task',
    handler: async ({ taskId, userId, channelId, threadTs }) => {
      if (!taskId) {
        return {
          success: false,
          message: ':x: Task ID not provided',
          ephemeral: true,
        };
      }

      const task = ctx.taskRepo.findById(taskId);
      if (!task) {
        return {
          success: false,
          message: ':x: Task not found',
          ephemeral: true,
        };
      }

      const project = ctx.projectRepo.findById(task.projectId);
      if (!project) {
        return {
          success: false,
          message: ':x: Project no longer exists',
          ephemeral: true,
        };
      }

      // Re-submit the task
      await ctx.commandService.resubmit(task, project);

      return {
        success: true,
        message: ':hourglass_flowing_sand: Retrying task...',
        ephemeral: false,
      };
    },
  });
}
