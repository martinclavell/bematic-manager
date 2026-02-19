import { ActionRegistry } from '../action-registry.js';
import type { AppContext } from '../../context.js';

export function registerCancelAction(ctx: AppContext): void {
  ActionRegistry.register({
    type: 'cancel_task',
    description: 'Cancel a running or pending task',
    requireConfirmation: true,
    confirmationText: 'Are you sure you want to cancel this task?',
    handler: async ({ taskId }) => {
      if (!taskId) {
        return {
          success: false,
          message: ':x: Task ID not provided',
          ephemeral: true,
        };
      }

      await ctx.commandService.cancel(taskId, 'Cancelled by user');

      return {
        success: true,
        message: ':white_check_mark: Task cancellation requested',
        ephemeral: false,
      };
    },
  });
}
