import type { App } from '@slack/bolt';
import {
  Permission,
  MessageType,
  createLogger,
  createWSMessage,
  serializeMessage,
} from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('slack:agents-reset');

export function registerAgentsResetListener(app: App, ctx: AppContext) {
  app.command('/agents-reset', async ({ command, ack, respond }) => {
    await ack();

    const { user_id, text } = command;
    const args = text.trim().split(/\s+/);

    logger.info({ user: user_id, text }, 'Agents reset command received');

    try {
      await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

      const agentIds = ctx.agentManager.getConnectedAgentIds();

      if (agentIds.length === 0) {
        await respond(':warning: No agents are currently connected.');
        return;
      }

      const rebuild = args.includes('--rebuild');
      let restarted = 0;

      for (const agentId of agentIds) {
        const msg = createWSMessage(MessageType.SYSTEM_RESTART, {
          reason: `Restart requested by <@${user_id}> via /agents-reset`,
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
        { rebuild, agentCount: agentIds.length, source: '/agents-reset' },
      );
    } catch (error) {
      logger.error({ error }, 'Error handling /agents-reset command');
      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      await respond(`:x: ${message}`);
    }
  });
}
