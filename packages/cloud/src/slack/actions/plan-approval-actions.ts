import { ActionRegistry } from '../action-registry.js';
import type { AppContext } from '../../context.js';
import { createLogger, type BotName } from '@bematic/common';
import { BotRegistry } from '@bematic/bots';

const logger = createLogger('plan-approval-actions');

export function registerPlanApprovalActions(ctx: AppContext): void {
  // Approve Plan
  ActionRegistry.register({
    type: 'approve_plan',
    description: 'Approve a decomposition plan and execute subtasks',
    handler: async ({ taskId, userId, channelId, threadTs, metadata }) => {
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

      if (task.status !== 'completed' || task.command !== 'decompose') {
        return {
          success: false,
          message: ':x: This is not a valid decomposition plan',
          ephemeral: true,
        };
      }

      const project = ctx.projectRepo.findById(task.projectId);
      if (!project) {
        return {
          success: false,
          message: ':x: Project not found',
          ephemeral: true,
        };
      }

      const bot = BotRegistry.get(task.botName as BotName);
      if (!bot) {
        return {
          success: false,
          message: ':x: Bot not found for this task',
          ephemeral: true,
        };
      }

      try {
        // Execute the plan by creating subtasks
        await ctx.commandService.handleDecompositionComplete(
          task.id,
          task.result || '',
          project,
          bot,
          {
            channelId: task.slackChannelId,
            threadTs: task.slackThreadTs,
            userId: task.slackUserId,
          },
        );

        logger.info({ taskId, userId }, 'Plan approved and submitted');

        return {
          success: true,
          message: ':white_check_mark: Plan approved! Executing subtasks...',
          ephemeral: false,
        };
      } catch (error) {
        logger.error({ error, taskId }, 'Failed to execute approved plan');
        return {
          success: false,
          message: ':x: Failed to execute plan',
          ephemeral: true,
        };
      }
    },
  });

  // Request Changes
  ActionRegistry.register({
    type: 'request_changes',
    description: 'Request changes to a decomposition plan',
    handler: async ({ taskId, userId, metadata }) => {
      // This will open a modal to collect change requests
      // For now, just acknowledge
      logger.info({ taskId, userId }, 'Changes requested for plan');

      return {
        success: true,
        message: ':pencil2: Please describe the changes you\'d like in a message',
        ephemeral: true,
      };
    },
  });

  // Cancel Plan
  ActionRegistry.register({
    type: 'cancel_plan',
    description: 'Cancel a decomposition plan',
    requireConfirmation: true,
    confirmationText: 'Are you sure you want to cancel this plan?',
    handler: async ({ taskId, userId }) => {
      if (!taskId) {
        return {
          success: false,
          message: ':x: Task ID not provided',
          ephemeral: true,
        };
      }

      // Mark the decomposition task as cancelled
      ctx.taskRepo.update(taskId, { status: 'cancelled' });

      logger.info({ taskId, userId }, 'Plan cancelled');

      return {
        success: true,
        message: ':no_entry_sign: Plan cancelled',
        ephemeral: false,
      };
    },
  });
}
