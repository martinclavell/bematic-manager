import type { App } from '@slack/bolt';
import {
  Permission,
  createLogger,
} from '@bematic/common';
import type { AppContext } from '../../context.js';
import {
  handleRestartAgent,
  handleAgentStatus,
  handleWorkers,
  handleDeploy,
  handleDeployStatus,
  handleDeployLogs,
  handleCancelTask,
  handleLogs,
} from '../handlers/admin-handlers.js';
import {
  handleCache,
  handlePerformance,
} from '../handlers/cache-performance-handlers.js';

const logger = createLogger('slack:admin');

export function registerAdminListener(app: App, ctx: AppContext) {
  app.command('/bm-admin', async ({ command, ack, respond }) => {
    await ack();

    const { user_id, channel_id, text } = command;
    const args = text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    logger.info({ user: user_id, subcommand, text }, 'Admin command received');

    try {
      // Only admins can use admin commands (USER_MANAGE is admin-only)
      await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

      switch (subcommand) {
        case 'restart-agent': {
          await handleRestartAgent(args, user_id, channel_id, respond, ctx);
          break;
        }

        case 'agent-status': {
          await handleAgentStatus(args, user_id, channel_id, respond, ctx);
          break;
        }

        case 'workers': {
          await handleWorkers(args, user_id, channel_id, respond, ctx);
          break;
        }

        case 'deploy': {
          await handleDeploy(args, user_id, channel_id, respond, ctx);
          break;
        }

        case 'deploy-status': {
          await handleDeployStatus(args, user_id, channel_id, respond, ctx);
          break;
        }

        case 'deploy-logs': {
          await handleDeployLogs(args, user_id, channel_id, respond, ctx);
          break;
        }


        case 'cancel-task': {
          await handleCancelTask(args, user_id, channel_id, respond, ctx);
          break;
        }

        case 'api-keys': {
          const { ApiKeyCommands } = await import('../admin-commands/api-keys.js');
          const apiKeyCommands = new ApiKeyCommands(ctx);
          await apiKeyCommands.handleApiKeyCommand(args, user_id, respond);
          break;
        }

        case 'cache': {
          await handleCache(args, user_id, channel_id, respond, ctx);
          break;
        }

        case 'performance': {
          await handlePerformance(args, user_id, channel_id, respond, ctx);
          break;
        }

        case 'logs': {
          await handleLogs(args, user_id, channel_id, respond, ctx);
          break;
        }

        case 'archive': {
          const { handleArchiveCommand } = await import('../admin-commands/archive.js');
          const context = { args: args.slice(1), userId: user_id, channelId: channel_id };

          // Need to get retention service and archived task repo from context
          // This assumes they are available in ctx.services or similar
          if (!ctx.services?.retentionService || !ctx.repositories?.archivedTaskRepo) {
            await respond('❌ Archive service not available. Please check system configuration.');
            break;
          }

          const result = await handleArchiveCommand(
            context,
            ctx.services.retentionService,
            ctx.repositories.archivedTaskRepo
          );
          await respond(result);
          break;
        }

        case 'metrics': {
          const { handleMetricsCommand } = await import('../admin-commands/metrics.js');
          const { metrics } = await import('../../utils/metrics.js');
          const context = { args: args.slice(1), userId: user_id, channelId: channel_id };

          const result = await handleMetricsCommand(context, metrics);
          await respond(result);
          break;
        }

        case 'scheduled-stats':
        case 'scheduled-cleanup': {
          const { handleScheduledTasksCommand } = await import('../admin-commands/scheduled-tasks.js');
          const context = { args: [subcommand.replace('scheduled-', ''), ...args.slice(1)], userId: user_id, channelId: channel_id };

          if (!ctx.repositories?.scheduledTaskRepo) {
            await respond('❌ Scheduled tasks repository not available. Please check system configuration.');
            break;
          }

          const result = await handleScheduledTasksCommand(
            context,
            ctx.repositories.scheduledTaskRepo
          );
          await respond(result);
          break;
        }

        case 'help':
        default:
          await respond(
            '*Admin Commands:*\n' +
            '`/bm-admin workers` - Dashboard of all agents, projects & active tasks\n' +
            '`/bm-admin cancel-task <task-id>` - Cancel a running or queued task\n' +
            '`/bm-admin restart-agent` - Restart all connected agents\n' +
            '`/bm-admin restart-agent --rebuild` - Restart with TypeScript rebuild\n' +
            '`/bm-admin agent-status` - Show connected agent status\n' +
            '`/bm-admin api-keys` - Manage API keys (list, generate, revoke, cleanup)\n' +
            '`/bm-admin deploy` - Deploy project linked to this channel\n' +
            '`/bm-admin deploy-status` - Check latest deployment status\n' +
            '`/bm-admin deploy-logs` - View latest deployment logs\n' +
            '`/bm-admin logs [limit]` - View prompt history\n' +
            '`/bm-admin logs --stats` - Show prompt history statistics\n' +
            '`/bm-admin logs --category <name>` - Filter by category\n' +
            '`/bm-admin logs --status <status>` - Filter by status\n' +
            '`/bm-admin logs --tag <tag>` - Filter by tag\n' +
            '`/bm-admin cache <subcommand>` - Cache management (stats, clear, warm, invalidate)\n' +
            '`/bm-admin performance <subcommand>` - Performance monitoring (metrics, summary, events, reset)\n' +
            '`/bm-admin archive <subcommand>` - Archive management (list, restore, delete, stats)\n' +
            '`/bm-admin metrics <subcommand>` - Real-time metrics (show, summary, top, reset, export)\n' +
            '`/bm-admin scheduled-stats` - Show scheduled tasks statistics\n' +
            '`/bm-admin scheduled-cleanup` - Clean up old scheduled tasks (--dry-run, --force)\n',
          );
          break;
      }
    } catch (error) {
      logger.error({ error, subcommand }, 'Error handling admin command');
      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      await respond(`:x: ${message}`);
    }
  });
}

