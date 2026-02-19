import { ActionRegistry } from '../action-registry.js';
import type { AppContext } from '../../context.js';
import { createLogger, generateTaskId } from '@bematic/common';

const logger = createLogger('feedback-actions');

export function registerFeedbackActions(ctx: AppContext): void {
  // Positive feedback
  ActionRegistry.register({
    type: 'feedback_positive',
    description: 'User found the response helpful',
    handler: async ({ taskId, userId, metadata }) => {
      logger.info({ taskId, userId }, 'Positive feedback received');

      // Could track this for analytics
      if (taskId) {
        ctx.auditLogRepo.log('feedback:positive', 'task', taskId, userId, {
          source: 'interactive_button',
        });
      }

      return {
        success: true,
        message: ':thumbsup: Thanks for the feedback!',
        ephemeral: true,
      };
    },
  });

  // Negative feedback
  ActionRegistry.register({
    type: 'feedback_negative',
    description: 'User found the response unhelpful',
    handler: async ({ taskId, userId, metadata }) => {
      logger.info({ taskId, userId }, 'Negative feedback received');

      // Track negative feedback
      if (taskId) {
        ctx.auditLogRepo.log('feedback:negative', 'task', taskId, userId, {
          source: 'interactive_button',
        });
      }

      return {
        success: true,
        message: ':thumbsdown: Thanks for the feedback. Would you like to suggest an improvement?',
        ephemeral: true,
        // TODO: Could trigger a modal or follow-up message
      };
    },
  });

  // Suggest improvement
  ActionRegistry.register({
    type: 'feedback_suggest',
    description: 'User wants to suggest an improvement',
    handler: async ({ taskId, userId, channelId, threadTs, value }) => {
      // If value is provided, it's the suggestion text (from modal)
      if (value) {
        // Parse the suggestion data
        let suggestionData: {
          category: string;
          suggestion: string;
          context?: string;
        };

        try {
          suggestionData = JSON.parse(value);
        } catch {
          return {
            success: false,
            message: ':x: Invalid suggestion data',
            ephemeral: true,
          };
        }

        // Get task info for context
        const task = taskId ? ctx.taskRepo.findById(taskId) : undefined;

        // Store the suggestion
        const suggestionId = generateTaskId(); // Reuse ID generator
        ctx.feedbackSuggestionRepo.create({
          id: suggestionId,
          userId,
          taskId: taskId || null,
          botName: task?.botName || null,
          category: suggestionData.category,
          suggestion: suggestionData.suggestion,
          context: suggestionData.context || task?.prompt || null,
          status: 'pending',
          createdAt: Date.now(),
        });

        logger.info(
          { suggestionId, userId, taskId, category: suggestionData.category },
          'Feedback suggestion stored'
        );

        // Log to audit trail
        ctx.auditLogRepo.log('feedback:suggestion', 'feedback', suggestionId, userId, {
          taskId,
          category: suggestionData.category,
        });

        return {
          success: true,
          message: ':sparkles: Thank you! Your suggestion has been recorded and will help improve future responses.',
          ephemeral: true,
        };
      }

      // No value means this is the initial button click - we need to open a modal
      // For now, just return a message prompting for details
      return {
        success: true,
        message: `:bulb: Please share your suggestion in the thread. Include:
1. **Category**: What aspect needs improvement? (response quality, code quality, documentation, performance, other)
2. **Suggestion**: What specific improvement would you like to see?
3. **Context**: Any additional details that would help?`,
        ephemeral: true,
      };
    },
  });
}
