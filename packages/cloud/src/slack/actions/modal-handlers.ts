/**
 * Slack modal (view) handlers for collecting complex input
 * Used for feedback suggestions, change requests, etc.
 */

import type { App, ViewSubmitAction, SlackViewAction } from '@slack/bolt';
import { createLogger, generateTaskId } from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('modal-handlers');

/**
 * Register all modal submission handlers
 */
export function registerModalHandlers(app: App, ctx: AppContext) {
  // Feedback suggestion modal submission
  app.view('feedback_suggestion_modal', async ({ ack, body, view }) => {
    await ack();

    try {
      const values = view.state.values;

      // Extract form values
      const category = values.category_block.category_select.selected_option?.value || 'other';
      const suggestion = values.suggestion_block.suggestion_input.value || '';
      const context = values.context_block?.context_input?.value;

      const userId = body.user.id;
      const metadata = JSON.parse(view.private_metadata || '{}');
      const taskId = metadata.taskId;

      // Get task info for additional context
      const task = taskId ? ctx.taskRepo.findById(taskId) : undefined;

      // Store the suggestion
      const suggestionId = generateTaskId();
      ctx.feedbackSuggestionRepo.create({
        id: suggestionId,
        userId,
        taskId: taskId || null,
        botName: task?.botName || null,
        category,
        suggestion,
        context: context || task?.prompt || null,
        status: 'pending',
        createdAt: Date.now(),
      });

      logger.info(
        { suggestionId, userId, taskId, category },
        'Feedback suggestion submitted via modal'
      );

      // Log to audit trail
      ctx.auditLogRepo.log('feedback:suggestion', 'feedback', suggestionId, userId, {
        taskId,
        category,
        source: 'modal',
      });

      // Post confirmation message
      if (metadata.channelId && metadata.threadTs) {
        await ctx.notifier.postMessage(
          metadata.channelId,
          ':sparkles: Thank you! Your suggestion has been recorded and will help improve future responses.',
          metadata.threadTs
        );
      }
    } catch (error) {
      logger.error({ error }, 'Failed to process feedback suggestion modal');
    }
  });

  // Plan change request modal submission
  app.view('plan_change_request_modal', async ({ ack, body, view }) => {
    await ack();

    try {
      const values = view.state.values;
      const changes = values.changes_block.changes_input.value || '';

      const userId = body.user.id;
      const metadata = JSON.parse(view.private_metadata || '{}');
      const taskId = metadata.taskId;

      if (!taskId) {
        logger.error('No task ID in modal metadata');
        return;
      }

      // Post the change request back to the thread
      if (metadata.channelId && metadata.threadTs) {
        await ctx.notifier.postMessage(
          metadata.channelId,
          `:pencil2: **Change Request for Plan**\n\n${changes}\n\n_<@${userId}> requested changes to the decomposition plan._`,
          metadata.threadTs
        );

        // Log the change request
        ctx.auditLogRepo.log('plan:change_requested', 'task', taskId, userId, {
          changes,
        });

        logger.info({ taskId, userId }, 'Plan change request submitted');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to process plan change request modal');
    }
  });
}

/**
 * Helper to open feedback suggestion modal
 */
export async function openFeedbackSuggestionModal(
  app: App,
  triggerId: string,
  metadata: { taskId?: string; channelId: string; threadTs?: string | null }
): Promise<void> {
  try {
    await app.client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'feedback_suggestion_modal',
        title: {
          type: 'plain_text',
          text: 'Suggest Improvement',
        },
        submit: {
          type: 'plain_text',
          text: 'Submit',
        },
        close: {
          type: 'plain_text',
          text: 'Cancel',
        },
        private_metadata: JSON.stringify(metadata),
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Help us improve! Share what could be better.',
            },
          },
          {
            type: 'input',
            block_id: 'category_block',
            label: {
              type: 'plain_text',
              text: 'Category',
            },
            element: {
              type: 'static_select',
              action_id: 'category_select',
              placeholder: {
                type: 'plain_text',
                text: 'Select a category',
              },
              options: [
                { text: { type: 'plain_text', text: 'Response Quality' }, value: 'response_quality' },
                { text: { type: 'plain_text', text: 'Code Quality' }, value: 'code_quality' },
                { text: { type: 'plain_text', text: 'Documentation' }, value: 'documentation' },
                { text: { type: 'plain_text', text: 'Performance' }, value: 'performance' },
                { text: { type: 'plain_text', text: 'Other' }, value: 'other' },
              ],
            },
          },
          {
            type: 'input',
            block_id: 'suggestion_block',
            label: {
              type: 'plain_text',
              text: 'Your Suggestion',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'suggestion_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'What specific improvement would you like to see?',
              },
            },
          },
          {
            type: 'input',
            block_id: 'context_block',
            optional: true,
            label: {
              type: 'plain_text',
              text: 'Additional Context (optional)',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'context_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Any other details that would help us understand your suggestion?',
              },
            },
          },
        ],
      },
    });

    logger.info({ metadata }, 'Opened feedback suggestion modal');
  } catch (error) {
    logger.error({ error }, 'Failed to open feedback suggestion modal');
    throw error;
  }
}

/**
 * Helper to open plan change request modal
 */
export async function openPlanChangeRequestModal(
  app: App,
  triggerId: string,
  metadata: { taskId: string; channelId: string; threadTs?: string | null }
): Promise<void> {
  try {
    await app.client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'plan_change_request_modal',
        title: {
          type: 'plain_text',
          text: 'Request Changes',
        },
        submit: {
          type: 'plain_text',
          text: 'Submit',
        },
        close: {
          type: 'plain_text',
          text: 'Cancel',
        },
        private_metadata: JSON.stringify(metadata),
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'Describe what changes you\'d like to the decomposition plan:',
            },
          },
          {
            type: 'input',
            block_id: 'changes_block',
            label: {
              type: 'plain_text',
              text: 'Requested Changes',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'changes_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'What would you like to change about this plan?',
              },
            },
          },
        ],
      },
    });

    logger.info({ metadata }, 'Opened plan change request modal');
  } catch (error) {
    logger.error({ error }, 'Failed to open plan change request modal');
    throw error;
  }
}
