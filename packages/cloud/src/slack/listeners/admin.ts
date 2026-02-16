import type { App } from '@slack/bolt';
import {
  Permission,
  MessageType,
  createLogger,
  createWSMessage,
  serializeMessage,
} from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('slack:admin');

export function registerAdminListener(app: App, ctx: AppContext) {
  app.command('/bm-admin', async ({ command, ack, respond }) => {
    await ack();

    const { user_id, text } = command;
    const args = text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase();

    logger.info({ user: user_id, subcommand, text }, 'Admin command received');

    try {
      // Only admins can use admin commands (USER_MANAGE is admin-only)
      await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

      switch (subcommand) {
        case 'restart-agent': {
          const agentIds = ctx.agentManager.getConnectedAgentIds();

          if (agentIds.length === 0) {
            await respond(':warning: No agents are currently connected.');
            return;
          }

          const rebuild = args.includes('--rebuild');
          let restarted = 0;

          for (const agentId of agentIds) {
            const msg = createWSMessage(MessageType.SYSTEM_RESTART, {
              reason: `Restart requested by <@${user_id}> via Slack`,
              rebuild,
            });
            const sent = ctx.agentManager.send(agentId, serializeMessage(msg));
            if (sent) restarted++;
          }

          await respond(
            `:arrows_counterclockwise: Restart signal sent to ${restarted}/${agentIds.length} agent(s).${rebuild ? ' (with rebuild)' : ''} They will reconnect shortly.`,
          );

          ctx.auditLogRepo.log(
            'agent:restart',
            'agent',
            agentIds.join(','),
            user_id,
            { rebuild, agentCount: agentIds.length },
          );
          break;
        }

        case 'agent-status': {
          const agentIds = ctx.agentManager.getConnectedAgentIds();

          if (agentIds.length === 0) {
            await respond(':red_circle: No agents connected.');
            return;
          }

          const lines = agentIds.map((id) => {
            const agent = ctx.agentManager.getAgent(id);
            if (!agent) return `- \`${id}\`: unknown`;
            const uptime = Math.round((Date.now() - agent.connectedAt) / 1000);
            return `- \`${id}\`: *${agent.status}* | Active tasks: ${agent.activeTasks.length} | Connected: ${uptime}s ago`;
          });

          await respond(`:satellite: *Connected Agents (${agentIds.length}):*\n${lines.join('\n')}`);
          break;
        }

        case 'help':
        default:
          await respond(
            '*Admin Commands:*\n' +
              '`/bm-admin restart-agent` - Restart all connected agents\n' +
              '`/bm-admin restart-agent --rebuild` - Restart with TypeScript rebuild\n' +
              '`/bm-admin agent-status` - Show connected agent status\n',
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
