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
                section += `\n>    \u2022 \`${task.id}\` [${task.botName}] ${task.command} — "${promptPreview}" — <@${task.slackUserId}> — ${elapsed}${cost}`;
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


        case 'cancel-task': {
          const taskId = args[1];
          if (!taskId) {
            await respond(':x: Usage: `/bm-admin cancel-task <task-id>`\n\nYou can find task IDs in the `/bm-admin workers` dashboard.');
            return;
          }

          const task = ctx.taskRepo.findById(taskId);
          if (!task) {
            await respond(`:x: Task not found: \`${taskId}\``);
            return;
          }

          if (task.status !== 'running' && task.status !== 'queued' && task.status !== 'pending') {
            await respond(`:x: Task \`${taskId}\` is already ${task.status} and cannot be cancelled.`);
            return;
          }

          // Cancel the task
          await ctx.commandService.cancel(taskId, `Cancelled by admin <@${user_id}>`);

          await respond(`:octagonal_sign: Task \`${taskId}\` has been cancelled.`);

          // Log audit trail
          ctx.auditLogRepo.log('task:cancel-admin', 'task', taskId, user_id, {
            previousStatus: task.status,
            botName: task.botName,
            projectId: task.projectId,
          });

          logger.info({ taskId, userId: user_id }, 'Task cancelled by admin');
          break;
        }

        case 'logs': {
          const limit = parseInt(args[1] || '20', 10);
          const category = args.find((a, i) => args[i - 1] === '--category');
          const status = args.find((a, i) => args[i - 1] === '--status');
          const tag = args.find((a, i) => args[i - 1] === '--tag');
          const searchText = args.find((a, i) => args[i - 1] === '--search');

          // Show stats if requested
          if (args.includes('--stats')) {
            const stats = ctx.promptHistoryRepo.getStats();
            await respond(
              ':bar_chart: *Prompt History Statistics*\n' +
              `> Total: ${stats.total}\n` +
              `> :white_check_mark: Completed: ${stats.completed}\n` +
              `> :hourglass_flowing_sand: Pending: ${stats.pending}\n` +
              `> :x: Failed: ${stats.failed}\n` +
              `> :no_entry_sign: Cancelled: ${stats.cancelled}\n` +
              (stats.averageDuration ? `> :stopwatch: Avg Duration: ${stats.averageDuration}m` : ''),
            );
            return;
          }

          // Fetch prompts
          const prompts = ctx.promptHistoryRepo.findAll({
            category,
            status,
            tag,
            searchText,
            limit: Math.min(limit, 100),
          });

          if (prompts.length === 0) {
            await respond(':inbox_tray: No prompts found matching your criteria.');
            return;
          }

          // Format prompts
          const lines: string[] = [`:notebook: *Prompt History* (${prompts.length} results)`];

          for (const prompt of prompts.slice(0, 20)) {
            const statusIcon = prompt.executionStatus === 'completed' ? ':white_check_mark:'
              : prompt.executionStatus === 'pending' ? ':hourglass_flowing_sand:'
              : prompt.executionStatus === 'failed' ? ':x:'
              : ':no_entry_sign:';

            const tags = JSON.parse(prompt.tags) as string[];
            const files = JSON.parse(prompt.relatedFiles) as string[];

            const timestamp = new Date(prompt.timestamp);
            const ago = formatDuration(Date.now() - timestamp.getTime());

            let line = `\n${statusIcon} *#${prompt.id}* | ${ago} ago`;
            if (prompt.category) line += ` | :file_folder: ${prompt.category}`;
            line += `\n> ${prompt.prompt.length > 100 ? prompt.prompt.slice(0, 100) + '...' : prompt.prompt}`;

            if (tags.length > 0) line += `\n> :label: ${tags.join(', ')}`;
            if (prompt.executionNotes) line += `\n> :memo: ${prompt.executionNotes.length > 80 ? prompt.executionNotes.slice(0, 80) + '...' : prompt.executionNotes}`;
            if (files.length > 0) line += `\n> :page_facing_up: ${files.length} file(s)`;
            if (prompt.actualDurationMinutes) line += ` | :stopwatch: ${prompt.actualDurationMinutes}m`;

            lines.push(line);
          }

          if (prompts.length > 20) {
            lines.push(`\n_Showing first 20 of ${prompts.length} results_`);
          }

          await respond(lines.join('\n'));
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
            '`/bm-admin deploy` - Deploy project linked to this channel\n' +
            '`/bm-admin deploy-status` - Check latest deployment status\n' +
            '`/bm-admin deploy-logs` - View latest deployment logs\n' +
            '`/bm-admin logs [limit]` - View prompt history\n' +
            '`/bm-admin logs --stats` - Show prompt history statistics\n' +
            '`/bm-admin logs --category <name>` - Filter by category\n' +
            '`/bm-admin logs --status <status>` - Filter by status\n' +
            '`/bm-admin logs --tag <tag>` - Filter by tag\n',
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
