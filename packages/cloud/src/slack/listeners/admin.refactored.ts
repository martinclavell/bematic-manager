import type { App } from '@slack/bolt';
import { Permission, createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';
import {
  AgentCommands,
  WorkerCommands,
  HealthCommands,
  RetentionCommands,
  DeployCommands,
  LogsCommands,
  UsageCommands,
} from '../admin-commands/index.js';

const logger = createLogger('slack:admin');

/**
 * Refactored admin command handler
 * Delegates to category-based command modules for better organization
 */
export function registerAdminListener(app: App, ctx: AppContext) {
  // Initialize command handlers
  const agentCommands = new AgentCommands(ctx);
  const workerCommands = new WorkerCommands(ctx);
  const healthCommands = new HealthCommands(ctx);
  const retentionCommands = new RetentionCommands(ctx);
  const deployCommands = new DeployCommands(ctx);
  const logsCommands = new LogsCommands(ctx);
  const usageCommands = new UsageCommands(ctx);

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
        // Agent commands
        case 'restart-agent':
          await agentCommands.restartAgent(args, user_id, respond);
          break;

        case 'agent-status':
          await agentCommands.agentStatus(respond);
          break;

        case 'agent-health':
          await agentCommands.agentHealth(respond);
          break;

        case 'agent-health-reset':
          await agentCommands.agentHealthReset(args, user_id, respond);
          break;

        // Worker dashboard
        case 'workers':
          await workerCommands.workers(respond);
          break;

        // Health & Metrics
        case 'health':
          await healthCommands.health(respond);
          break;

        case 'metrics':
          await healthCommands.metrics(respond);
          break;

        // Data retention
        case 'retention-stats':
          await retentionCommands.retentionStats(respond);
          break;

        case 'retention-run':
          await retentionCommands.retentionRun(user_id, respond);
          break;

        // Deployment
        case 'deploy':
          await deployCommands.deploy(channel_id, user_id, respond);
          break;

        case 'deploy-status':
          await deployCommands.deployStatus(channel_id, respond);
          break;

        case 'deploy-logs':
          await deployCommands.deployLogs(channel_id, respond);
          break;

        // Logs & History
        case 'logs':
          await logsCommands.logs(args, respond);
          break;

        // Usage & Budget
        case 'usage':
          await usageCommands.usage(args.slice(1), respond);
          break;

        // Help
        case 'help':
        default:
          await respond(
            '*Admin Commands:*\n' +
            '`/bm-admin workers` - Dashboard of all agents, projects & active tasks\n' +
            '`/bm-admin restart-agent` - Restart all connected agents\n' +
            '`/bm-admin restart-agent --rebuild` - Restart with TypeScript rebuild\n' +
            '`/bm-admin agent-status` - Show connected agent status\n' +
            '`/bm-admin health` - Show system health status\n' +
            '`/bm-admin metrics` - Show system metrics\n' +
            '`/bm-admin agent-health` - Show circuit breaker status for all agents\n' +
            '`/bm-admin agent-health-reset <agent-id>` - Reset circuit breaker for agent\n' +
            '`/bm-admin retention-stats` - Show retention cleanup statistics\n' +
            '`/bm-admin retention-run` - Manually run retention cleanup\n' +
            '`/bm-admin deploy` - Deploy project linked to this channel\n' +
            '`/bm-admin deploy-status` - Check latest deployment status\n' +
            '`/bm-admin deploy-logs` - View latest deployment logs\n' +
            '`/bm-admin logs [limit]` - View prompt history\n' +
            '`/bm-admin logs --stats` - Show prompt history statistics\n' +
            '`/bm-admin logs --category <name>` - Filter by category\n' +
            '`/bm-admin logs --status <status>` - Filter by status\n' +
            '`/bm-admin logs --tag <tag>` - Filter by tag\n' +
            '`/bm-admin usage` - Show API usage overview and budget\n' +
            '`/bm-admin usage today|week|month` - Show usage for period\n' +
            '`/bm-admin usage by-bot|by-project` - Show usage breakdown\n',
          );
          break;
      }
    } catch (error: any) {
      logger.error({ error, user: user_id, subcommand }, 'Admin command failed');

      if (error.message?.includes('Permission denied')) {
        await respond(':lock: You do not have permission to use admin commands.');
      } else {
        await respond(`:x: Error: ${error.message || 'Unknown error'}`);
      }
    }
  });
}
