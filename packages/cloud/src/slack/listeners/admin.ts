import type { App } from '@slack/bolt';
import {
  Permission,
  MessageType,
  createLogger,
  createWSMessage,
  serializeMessage,
  generateId,
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

        case 'workers': {
          const agentIds = ctx.agentManager.getConnectedAgentIds();

          if (agentIds.length === 0) {
            await respond(':red_circle: *Workers Dashboard* — No agents connected.');
            return;
          }

          const sections: string[] = [
            `:factory: *Workers Dashboard* (${agentIds.length} agent${agentIds.length === 1 ? '' : 's'} connected)`,
          ];

          let totalRunning = 0;
          let totalQueued = 0;

          for (const agentId of agentIds) {
            const agent = ctx.agentManager.getAgent(agentId);
            if (!agent) continue;

            // Uptime formatting
            const uptimeMs = Date.now() - agent.connectedAt;
            const uptimeStr = formatDuration(uptimeMs);

            // Heartbeat ago
            const heartbeatAgoMs = Date.now() - agent.lastHeartbeat;
            const heartbeatStr = formatDuration(heartbeatAgoMs);

            // Status icon
            const statusIcon = agent.status === 'online' ? ':large_green_circle:'
              : agent.status === 'busy' ? ':large_yellow_circle:'
              : ':red_circle:';

            // Projects linked to this agent
            const agentProjects = ctx.projectRepo.findByAgentId(agentId);
            const projectNames = agentProjects.length > 0
              ? agentProjects.map((p) => p.name).join(', ')
              : '_none_';

            // Running tasks across all projects for this agent
            const runningTasks = agentProjects.flatMap((p) =>
              ctx.taskRepo.findActiveByProjectId(p.id),
            );

            // Queued/pending tasks across all projects for this agent
            const queuedTasks = agentProjects.flatMap((p) => {
              const allTasks = ctx.taskRepo.findByProjectId(p.id, 50);
              return allTasks.filter((t) => t.status === 'queued' || t.status === 'pending');
            });

            totalRunning += runningTasks.length;
            totalQueued += queuedTasks.length;

            let section =
              `\n:heavy_minus_sign::heavy_minus_sign::heavy_minus_sign: Agent \`${agentId}\` ${statusIcon} *${agent.status}* :heavy_minus_sign::heavy_minus_sign::heavy_minus_sign:\n` +
              `> :clock1: Uptime: *${uptimeStr}* | Heartbeat: ${heartbeatStr} ago\n` +
              `> :file_folder: Projects: ${projectNames}`;

            if (runningTasks.length > 0) {
              section += `\n> :wrench: *Running Tasks (${runningTasks.length}):*`;
              for (const task of runningTasks) {
                const elapsed = formatDuration(Date.now() - new Date(task.createdAt).getTime());
                const cost = task.estimatedCost > 0 ? ` | $${task.estimatedCost.toFixed(2)}` : '';
                const promptPreview = task.prompt.length > 40
                  ? task.prompt.slice(0, 40) + '...'
                  : task.prompt;
                section += `\n>    \u2022 [${task.botName}] ${task.command} — "${promptPreview}" — <@${task.slackUserId}> — ${elapsed}${cost}`;
              }
            } else {
              section += `\n> :white_check_mark: No running tasks`;
            }

            if (queuedTasks.length > 0) {
              section += `\n> :hourglass_flowing_sand: Queued: ${queuedTasks.length} task${queuedTasks.length === 1 ? '' : 's'}`;
            }

            sections.push(section);
          }

          // Summary footer
          sections.push(
            `\n:bar_chart: *Totals:* ${totalRunning} running | ${totalQueued} queued | ${agentIds.length} agent${agentIds.length === 1 ? '' : 's'}`,
          );

          await respond(sections.join('\n'));
          break;
        }

        case 'deploy': {
          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project) {
            await respond(':x: No project configured for this channel. Use `/bm-config` first.');
            return;
          }

          // Find the agent for this project
          const agentId = project.agentId;
          const agent = ctx.agentManager.getAgent(agentId);
          if (!agent) {
            await respond(`:x: Agent \`${agentId}\` is not connected. Cannot deploy.`);
            return;
          }

          const requestId = generateId('deploy');
          const msg = createWSMessage(MessageType.DEPLOY_REQUEST, {
            requestId,
            localPath: project.localPath,
            slackChannelId: channel_id,
            slackThreadTs: null,
            requestedBy: user_id,
          });

          // Register so message router knows where to post the result
          ctx.messageRouter.registerDeployRequest(requestId, channel_id, null, user_id);

          const sent = ctx.agentManager.send(agentId, serializeMessage(msg));
          if (!sent) {
            await respond(':x: Failed to send deploy request to agent.');
            return;
          }

          await respond(`:rocket: Deploy request sent to agent \`${agentId}\`. Running \`railway up\` in \`${project.localPath}\`...`);

          ctx.auditLogRepo.log(
            'deploy:requested',
            'project',
            project.id,
            user_id,
            { agentId, requestId },
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
            '`/bm-admin workers` - Dashboard of all agents, projects & active tasks\n' +
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

/** Format milliseconds into a human-readable duration (e.g. "2h 34m", "45s") */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const secs = seconds % 60;
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
}
