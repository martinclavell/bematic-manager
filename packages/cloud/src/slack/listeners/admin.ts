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

    const { user_id, channel_id, text } = command;
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

        case 'deploy': {
          if (!ctx.deployService.isConfigured()) {
            await respond(':x: Railway API token not configured. Set `RAILWAY_API_TOKEN` env var.');
            return;
          }

          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project) {
            await respond(':x: No project configured for this channel. Use `/bm-config` first.');
            return;
          }

          if (!project.railwayServiceId) {
            await respond(':x: No Railway service linked to this project. Update project config with `/bm-config` to add Railway IDs.');
            return;
          }

          await respond(':rocket: Triggering deployment...');

          const result = await ctx.deployService.deploy(
            project.railwayServiceId,
            project.railwayEnvironmentId,
          );

          await respond(
            `:white_check_mark: *Deployment triggered!*\n` +
            `> Deployment ID: \`${result.deploymentId}\`\n` +
            `> Status: \`${result.status}\`\n` +
            (result.url ? `> URL: ${result.url}\n` : '') +
            `\nUse \`/bm-admin deploy-status\` to check progress.`,
          );

          ctx.auditLogRepo.log(
            'deploy:triggered',
            'project',
            project.id,
            user_id,
            { deploymentId: result.deploymentId, serviceId: project.railwayServiceId },
          );
          break;
        }

        case 'deploy-status': {
          if (!ctx.deployService.isConfigured()) {
            await respond(':x: Railway API token not configured.');
            return;
          }

          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project) {
            await respond(':x: No project configured for this channel.');
            return;
          }

          if (!project.railwayServiceId) {
            await respond(':x: No Railway service linked to this project.');
            return;
          }

          const deployment = await ctx.deployService.getLatestDeployment(
            project.railwayServiceId,
            project.railwayEnvironmentId,
          );

          if (!deployment) {
            await respond(':information_source: No deployments found for this service.');
            return;
          }

          const statusIcon = deployment.status === 'SUCCESS' ? ':white_check_mark:'
            : deployment.status === 'BUILDING' || deployment.status === 'DEPLOYING' ? ':hourglass_flowing_sand:'
            : deployment.status === 'FAILED' || deployment.status === 'CRASHED' ? ':x:'
            : ':grey_question:';

          await respond(
            `${statusIcon} *Latest Deployment*\n` +
            `> ID: \`${deployment.id}\`\n` +
            `> Status: \`${deployment.status}\`\n` +
            `> Created: ${deployment.createdAt}\n` +
            (deployment.staticUrl ? `> URL: ${deployment.staticUrl}\n` : ''),
          );
          break;
        }

        case 'deploy-logs': {
          if (!ctx.deployService.isConfigured()) {
            await respond(':x: Railway API token not configured.');
            return;
          }

          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project?.railwayServiceId) {
            await respond(':x: No Railway service linked to this project.');
            return;
          }

          const deployment = await ctx.deployService.getLatestDeployment(
            project.railwayServiceId,
            project.railwayEnvironmentId,
          );

          if (!deployment) {
            await respond(':information_source: No deployments found.');
            return;
          }

          const logs = await ctx.deployService.getDeploymentLogs(deployment.id);
          const truncated = logs.length > 2900 ? logs.slice(-2900) + '\n...(truncated)' : logs;

          await respond(
            `:page_facing_up: *Deploy Logs* (\`${deployment.status}\`)\n\`\`\`${truncated}\`\`\``,
          );
          break;
        }

        case 'help':
        default:
          await respond(
            '*Admin Commands:*\n' +
            '`/bm-admin restart-agent` - Restart all connected agents\n' +
            '`/bm-admin restart-agent --rebuild` - Restart with TypeScript rebuild\n' +
            '`/bm-admin agent-status` - Show connected agent status\n' +
            '`/bm-admin deploy` - Deploy project linked to this channel\n' +
            '`/bm-admin deploy-status` - Check latest deployment status\n' +
            '`/bm-admin deploy-logs` - View latest deployment logs\n',
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
