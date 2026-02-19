import type { App } from '@slack/bolt';
import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';
import { ActionRegistry } from '../action-registry.js';
import { registerRetryAction } from '../actions/retry-action.js';
import { registerCancelAction } from '../actions/cancel-action.js';
import { registerPlanApprovalActions } from '../actions/plan-approval-actions.js';
import { registerFeedbackActions } from '../actions/feedback-actions.js';
import { registerModalHandlers } from '../actions/modal-handlers.js';

const logger = createLogger('slack:actions');

/**
 * Parse action ID to extract type and associated data
 * Format: {action_type}_{entity_id}
 */
function parseActionId(actionId: string): { type: string; entityId?: string } {
  const parts = actionId.split('_');
  if (parts.length < 2) {
    return { type: actionId };
  }

  // Get the last part as entity ID, rest as type
  const entityId = parts[parts.length - 1];
  const type = parts.slice(0, -1).join('_');

  return { type, entityId };
}

export function registerActionListeners(app: App, ctx: AppContext) {
  // Register all action handlers
  registerRetryAction(ctx);
  registerCancelAction(ctx);
  registerPlanApprovalActions(ctx);
  registerFeedbackActions(ctx);

  // Register modal handlers
  registerModalHandlers(app, ctx);

  // Universal action handler using the registry
  app.action(/.+/, async ({ action, ack, respond, body }) => {
    await ack();

    if (action.type !== 'button') return;

    const { type, entityId } = parseActionId(action.action_id);

    logger.info({ actionId: action.action_id, type, entityId }, 'Action received');

    // Check if this action type is registered
    if (!ActionRegistry.has(type as any)) {
      logger.warn({ type }, 'Unknown action type');
      return;
    }

    try {
      // Get metadata from the action
      const userId = body.user.id;
      const channelId = body.channel?.id || '';
      const messageTs = (body as any).message?.ts;
      const threadTs = (body as any).message?.thread_ts;

      // Execute the action
      const result = await ActionRegistry.execute(type as any, {
        actionId: action.action_id,
        userId,
        channelId,
        threadTs,
        messageTs,
        taskId: entityId || action.value,
        value: action.value,
      });

      // Respond based on result
      if (result.message) {
        if (result.ephemeral) {
          // For ephemeral, we'd need to use postEphemeral via the client
          // For now, just use respond
          await respond({
            text: result.message,
            replace_original: false,
          });
        } else {
          await respond({
            text: result.message,
            replace_original: result.updateOriginal || false,
          });
        }
      }

      if (result.newBlocks) {
        await respond({
          blocks: result.newBlocks,
          text: result.message || 'Updated',
          replace_original: true,
        });
      }
    } catch (error) {
      logger.error({ error, actionId: action.action_id }, 'Error handling action');
      await respond(':x: Failed to process action.');
    }
  });
}
