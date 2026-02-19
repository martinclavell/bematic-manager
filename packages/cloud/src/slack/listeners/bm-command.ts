import type { App } from '@slack/bolt';
import {
  Permission,
  createLogger,
  generateId,
  MAIN_SLASH_COMMAND,
} from '@bematic/common';
import type { AppContext } from '../../context.js';
import { BotRegistry } from '@bematic/bots';
import {
  handleRemindCommand,
  handleScheduleCommand,
  handleCronCreateCommand,
  handleScheduledListCommand,
  handleScheduledShowCommand,
  handleScheduledPauseCommand,
  handleScheduledResumeCommand,
  handleScheduledCancelCommand,
} from '../commands/scheduled-commands.js';

const logger = createLogger('slack:bm-command');

/**
 * Unified /bm command handler
 * Routes to specific subcommands for build, deploy, test, agents, usage, config, etc.
 */
export function registerBmCommandListener(app: App, ctx: AppContext) {
  app.command(MAIN_SLASH_COMMAND, async ({ command, ack, respond, client }) => {
    await ack();

    const { user_id, channel_id, text, trigger_id } = command;
    const args = text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() || 'help';
    const subArgs = args.slice(1);

    logger.info({ user: user_id, subcommand, text }, '/bm command received');

    try {
      switch (subcommand) {
        // ===== BUILD =====
        case 'build':
        case 'compile': {
          await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);
          const dbUser = ctx.userRepo.findBySlackUserId(user_id);
          ctx.rateLimiter.check(user_id, dbUser?.rateLimitOverride);

          const project = ctx.projectResolver.resolve(channel_id);
          const opsBot = BotRegistry.get('ops');
          if (!opsBot) {
            await respond(':x: Ops bot not available');
            return;
          }

          const buildCommand = opsBot.parseCommand(`build ${subArgs.join(' ')}`);
          await ctx.commandService.submit({
            bot: opsBot,
            command: buildCommand,
            project,
            slackContext: { channelId: channel_id, threadTs: null, userId: user_id },
          });

          await respond(':hourglass_flowing_sand: Build started. I\'ll post results in the channel.');
          break;
        }

        // ===== DEPLOY =====
        case 'deploy':
        case 'ship': {
          await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project) {
            await respond(':x: No project configured for this channel. Use `/bm config` first.');
            return;
          }

          const resolvedAgentId = ctx.agentManager.resolveAgent(project.agentId);
          if (!resolvedAgentId) {
            await respond(':x: No agents are connected. Cannot deploy.');
            return;
          }

          const { requestId, sent } = ctx.opsService.sendDeploy({
            project,
            agentId: resolvedAgentId,
            slackChannelId: channel_id,
            slackThreadTs: null,
            requestedBy: user_id,
          });

          if (!sent) {
            await respond(':x: Failed to send deploy request to agent.');
            return;
          }

          await respond(`:rocket: Deploy request sent to agent \`${resolvedAgentId}\`. Running \`railway up\` in \`${project.localPath}\`...`);

          ctx.auditLogRepo.log(
            'deploy:requested',
            'project',
            project.id,
            user_id,
            { agentId: resolvedAgentId, requestId },
          );
          break;
        }

        // ===== TEST =====
        case 'test':
        case 'tests': {
          await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);
          const dbUser = ctx.userRepo.findBySlackUserId(user_id);
          ctx.rateLimiter.check(user_id, dbUser?.rateLimitOverride);

          const project = ctx.projectResolver.resolve(channel_id);
          const coderBot = BotRegistry.get('coder');
          if (!coderBot) {
            await respond(':x: Coder bot not available');
            return;
          }

          const testCommand = coderBot.parseCommand(`test ${subArgs.join(' ')}`);
          await ctx.commandService.submit({
            bot: coderBot,
            command: testCommand,
            project,
            slackContext: { channelId: channel_id, threadTs: null, userId: user_id },
          });

          await respond(':hourglass_flowing_sand: Test task submitted. I\'ll post results in the channel.');
          break;
        }

        // ===== AGENTS =====
        case 'agents':
        case 'workers': {
          await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

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

            const uptimeMs = Date.now() - agent.connectedAt;
            const uptimeStr = formatDuration(uptimeMs);

            const heartbeatAgoMs = Date.now() - agent.lastHeartbeat;
            const heartbeatStr = formatDuration(heartbeatAgoMs);

            const statusIcon = agent.status === 'online' ? ':large_green_circle:'
              : agent.status === 'busy' ? ':large_yellow_circle:'
              : ':red_circle:';

            // Show projects pinned to this agent + auto-routed projects
            const pinnedProjects = ctx.projectRepo.findByAgentId(agentId);
            const autoProjects = ctx.projectRepo.findByAgentId('auto');
            const agentProjects = [...pinnedProjects, ...autoProjects];
            const projectNames = agentProjects.length > 0
              ? agentProjects.map((p) => `${p.name}${p.agentId === 'auto' ? ' (auto)' : ''}`).join(', ')
              : '_none_';

            const runningTasks = agentProjects.flatMap((p) =>
              ctx.taskRepo.findActiveByProjectId(p.id),
            );

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
                section += `\n>    • \`${task.id}\` [${task.botName}] ${task.command} — "${promptPreview}" — <@${task.slackUserId}> — ${elapsed}${cost}`;
              }
            } else {
              section += `\n> :white_check_mark: No running tasks`;
            }

            if (queuedTasks.length > 0) {
              section += `\n> :hourglass_flowing_sand: Queued: ${queuedTasks.length} task${queuedTasks.length === 1 ? '' : 's'}`;
            }

            sections.push(section);
          }

          sections.push(
            `\n:bar_chart: *Totals:* ${totalRunning} running | ${totalQueued} queued | ${agentIds.length} agent${agentIds.length === 1 ? '' : 's'}`,
          );

          await respond(sections.join('\n'));
          break;
        }

        // ===== USAGE =====
        case 'usage':
        case 'sessions':
        case 'stats': {
          await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

          const stats = ctx.promptHistoryRepo.getStats();
          await respond(
            ':bar_chart: *Session Usage & Statistics*\n' +
            `> Total Sessions: ${stats.total}\n` +
            `> :white_check_mark: Completed: ${stats.completed}\n` +
            `> :hourglass_flowing_sand: Pending: ${stats.pending}\n` +
            `> :x: Failed: ${stats.failed}\n` +
            `> :no_entry_sign: Cancelled: ${stats.cancelled}\n` +
            (stats.averageDuration ? `> :stopwatch: Avg Duration: ${stats.averageDuration}m` : ''),
          );
          break;
        }

        // ===== CONFIG =====
        case 'config':
        case 'configure':
        case 'setup': {
          await ctx.authChecker.checkPermission(user_id, Permission.PROJECT_MANAGE);

          const existing = ctx.projectResolver.tryResolve(channel_id);

          // Build agent dropdown: "Auto" first, then specific connected agents
          const connectedAgentIds = ctx.agentManager.getConnectedAgentIds();
          const existingAgentId = existing?.agentId ?? 'auto';

          const agentOptions: Array<{ text: { type: 'plain_text'; text: string }; value: string }> = [
            { text: { type: 'plain_text' as const, text: 'Auto (any available)' }, value: 'auto' },
          ];

          for (const id of connectedAgentIds) {
            agentOptions.push({
              text: { type: 'plain_text' as const, text: `${id} (online)` },
              value: id,
            });
          }

          // Include existing pinned agent if it's not "auto" and not currently connected
          if (existingAgentId !== 'auto' && !connectedAgentIds.includes(existingAgentId)) {
            agentOptions.push({
              text: { type: 'plain_text' as const, text: `${existingAgentId} (offline)` },
              value: existingAgentId,
            });
          }

          const initialAgent = agentOptions.find((o) => o.value === existingAgentId) ?? agentOptions[0]!;

          const agentStatusText = connectedAgentIds.length > 0
            ? `:large_green_circle: ${connectedAgentIds.length} agent(s) online: ${connectedAgentIds.join(', ')}`
            : ':red_circle: No agents currently connected';

          await client.views.open({
            trigger_id,
            view: {
              type: 'modal',
              callback_id: 'project_config_modal',
              title: { type: 'plain_text', text: 'Project Config' },
              submit: { type: 'plain_text', text: existing ? 'Update' : 'Create' },
              private_metadata: JSON.stringify({ channelId: channel_id }),
              blocks: [
                {
                  type: 'input',
                  block_id: 'project_name',
                  label: { type: 'plain_text', text: 'Project Name' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existing?.name ?? '',
                    placeholder: { type: 'plain_text', text: 'e.g. chinoapp' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'local_path',
                  label: { type: 'plain_text', text: 'Local Path (on agent machine)' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existing?.localPath ?? '',
                    placeholder: { type: 'plain_text', text: 'e.g. F:/Work/Projects/chinoapp' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'agent_id',
                  label: { type: 'plain_text', text: 'Agent ID' },
                  element: {
                    type: 'static_select',
                    action_id: 'value',
                    initial_option: initialAgent,
                    options: agentOptions,
                  },
                },
                {
                  type: 'context',
                  elements: [
                    { type: 'mrkdwn', text: agentStatusText },
                  ],
                },
                {
                  type: 'input',
                  block_id: 'default_model',
                  label: { type: 'plain_text', text: 'Default Model' },
                  element: {
                    type: 'static_select',
                    action_id: 'value',
                    initial_option: {
                      text: { type: 'plain_text', text: existing?.defaultModel === 'claude-opus-4-6' ? 'Claude Opus 4.6' : 'Claude Sonnet 4.5' },
                      value: existing?.defaultModel ?? 'claude-sonnet-4-5-20250929',
                    },
                    options: [
                      { text: { type: 'plain_text', text: 'Claude Sonnet 4.5' }, value: 'claude-sonnet-4-5-20250929' },
                      { text: { type: 'plain_text', text: 'Claude Opus 4.6' }, value: 'claude-opus-4-6' },
                      { text: { type: 'plain_text', text: 'Claude Haiku 4.5' }, value: 'claude-haiku-4-5-20251001' },
                    ],
                  },
                },
                {
                  type: 'input',
                  block_id: 'max_budget',
                  label: { type: 'plain_text', text: 'Default Max Budget (USD)' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existing?.defaultMaxBudget?.toString() ?? '5.00',
                    placeholder: { type: 'plain_text', text: '5.00' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'auto_commit_push',
                  label: { type: 'plain_text', text: 'Auto Commit & Push Changes' },
                  element: {
                    type: 'static_select',
                    action_id: 'value',
                    initial_option: {
                      text: { type: 'plain_text', text: existing?.autoCommitPush ? 'Yes' : 'No' },
                      value: existing?.autoCommitPush ? 'true' : 'false',
                    },
                    options: [
                      { text: { type: 'plain_text', text: 'Yes' }, value: 'true' },
                      { text: { type: 'plain_text', text: 'No' }, value: 'false' },
                    ],
                  },
                },
                { type: 'divider' },
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: '*Railway Deployment (optional)*\nLink a Railway service for `/bm deploy`' },
                },
                {
                  type: 'input',
                  block_id: 'railway_project_id',
                  optional: true,
                  label: { type: 'plain_text', text: 'Railway Project ID' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existing?.railwayProjectId ?? '',
                    placeholder: { type: 'plain_text', text: 'UUID from Railway dashboard' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'railway_service_id',
                  optional: true,
                  label: { type: 'plain_text', text: 'Railway Service ID' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existing?.railwayServiceId ?? '',
                    placeholder: { type: 'plain_text', text: 'UUID from Railway dashboard' },
                  },
                },
                {
                  type: 'input',
                  block_id: 'railway_environment_id',
                  optional: true,
                  label: { type: 'plain_text', text: 'Railway Environment ID' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    initial_value: existing?.railwayEnvironmentId ?? '',
                    placeholder: { type: 'plain_text', text: 'Optional - defaults to production' },
                  },
                },
              ],
            },
          });
          break;
        }

        // ===== LOGS =====
        case 'logs':
        case 'log': {
          await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

          const limit = parseInt(subArgs[0] || '20', 10);
          const category = subArgs.find((a, i) => subArgs[i - 1] === '--category');
          const status = subArgs.find((a, i) => subArgs[i - 1] === '--status');
          const tag = subArgs.find((a, i) => subArgs[i - 1] === '--tag');
          const searchText = subArgs.find((a, i) => subArgs[i - 1] === '--search');

          if (subArgs.includes('--stats')) {
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

        // ===== QUEUE =====
        case 'queue':
        case 'queued': {
          await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

          const project = ctx.projectResolver.tryResolve(channel_id);
          let queuedTasks: any[] = [];

          if (project) {
            // Show queued tasks for this project
            const allTasks = ctx.taskRepo.findByProjectId(project.id, 100);
            queuedTasks = allTasks.filter((t) => t.status === 'queued' || t.status === 'pending');
          } else {
            // Show all queued tasks across all projects
            const allProjects = ctx.projectRepo.findAll();
            queuedTasks = allProjects.flatMap((p) => {
              const tasks = ctx.taskRepo.findByProjectId(p.id, 100);
              return tasks.filter((t) => t.status === 'queued' || t.status === 'pending');
            });
          }

          if (queuedTasks.length === 0) {
            await respond(':white_check_mark: No tasks in queue.');
            return;
          }

          const lines: string[] = [`:inbox_tray: *Queued Tasks* (${queuedTasks.length})`];

          for (const task of queuedTasks.slice(0, 20)) {
            const elapsed = formatDuration(Date.now() - new Date(task.createdAt).getTime());
            const promptPreview = task.prompt.length > 60
              ? task.prompt.slice(0, 60) + '...'
              : task.prompt;
            const proj = ctx.projectRepo.findById(task.projectId);
            lines.push(
              `\n\`${task.id}\` | ${task.status.toUpperCase()}\n` +
              `> [${task.botName}] ${task.command} — "${promptPreview}"\n` +
              `> Project: ${proj?.name || 'Unknown'} | User: <@${task.slackUserId}> | Age: ${elapsed}`
            );
          }

          if (queuedTasks.length > 20) {
            lines.push(`\n_Showing first 20 of ${queuedTasks.length} queued tasks_`);
          }

          await respond(lines.join('\n'));
          break;
        }

        // ===== CANCEL TASK =====
        case 'cancel':
        case 'cancel-task':
        case 'stop': {
          await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

          const taskId = subArgs[0];
          if (!taskId) {
            await respond(':x: Usage: `/bm cancel <task-id>`\n\nYou can find task IDs in the `/bm agents` or `/bm queue` dashboard.');
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
          await ctx.commandService.cancel(taskId, `Cancelled by <@${user_id}>`);

          await respond(`:octagonal_sign: Task \`${taskId}\` has been cancelled.`);

          // Log audit trail
          ctx.auditLogRepo.log('task:cancel-user', 'task', taskId, user_id, {
            previousStatus: task.status,
            botName: task.botName,
            projectId: task.projectId,
          });

          logger.info({ taskId, userId: user_id }, 'Task cancelled by user');
          break;
        }

        // ===== CLEAR QUEUE =====
        case 'clear-queue':
        case 'purge-queue': {
          await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

          const project = ctx.projectResolver.tryResolve(channel_id);
          let queuedTasks: any[] = [];

          if (project) {
            // Clear queue for this project only
            const allTasks = ctx.taskRepo.findByProjectId(project.id, 100);
            queuedTasks = allTasks.filter((t) => t.status === 'queued' || t.status === 'pending');
          } else {
            // Clear all queues (requires explicit confirmation)
            if (!subArgs.includes('--all')) {
              await respond(':warning: To clear ALL queued tasks across ALL projects, use `/bm clear-queue --all`\n\nTo clear queue for a specific project, run this command in that project\'s channel.');
              return;
            }

            const allProjects = ctx.projectRepo.findAll();
            queuedTasks = allProjects.flatMap((p) => {
              const tasks = ctx.taskRepo.findByProjectId(p.id, 100);
              return tasks.filter((t) => t.status === 'queued' || t.status === 'pending');
            });
          }

          if (queuedTasks.length === 0) {
            await respond(':white_check_mark: Queue is already empty.');
            return;
          }

          // Cancel all queued tasks
          let cancelled = 0;
          for (const task of queuedTasks) {
            await ctx.commandService.cancel(task.id, `Queue cleared by <@${user_id}>`);
            cancelled++;
          }

          const scope = project ? `for project *${project.name}*` : 'across *all projects*';
          await respond(`:broom: Cleared ${cancelled} queued task${cancelled === 1 ? '' : 's'} ${scope}.`);

          ctx.auditLogRepo.log('queue:cleared', 'system', 'queue', user_id, {
            count: cancelled,
            projectId: project?.id || 'all',
          });

          logger.info({ userId: user_id, count: cancelled, projectId: project?.id }, 'Queue cleared');
          break;
        }

        // ===== RESTART =====
        case 'restart':
        case 'restart-agent':
        case 'restart-agents': {
          await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

          const agentIds = ctx.agentManager.getConnectedAgentIds();

          if (agentIds.length === 0) {
            await respond(':warning: No agents are currently connected.');
            return;
          }

          const rebuild = subArgs.includes('--rebuild');
          const { restarted } = ctx.opsService.sendRestart({
            agentIds,
            reason: `Restart requested by <@${user_id}> via Slack`,
            rebuild,
          });

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

        // ===== STATUS =====
        case 'status':
        case 'info': {
          await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);

          const project = ctx.projectResolver.resolve(channel_id);
          const opsBot = BotRegistry.get('ops');
          if (!opsBot) {
            await respond(':x: Ops bot not available');
            return;
          }

          const dbUser = ctx.userRepo.findBySlackUserId(user_id);
          ctx.rateLimiter.check(user_id, dbUser?.rateLimitOverride);

          const statusCommand = opsBot.parseCommand(`status ${subArgs.join(' ')}`);
          await ctx.commandService.submit({
            bot: opsBot,
            command: statusCommand,
            project,
            slackContext: { channelId: channel_id, threadTs: null, userId: user_id },
          });

          await respond(':hourglass_flowing_sand: Checking status. I\'ll post results in the channel.');
          break;
        }

        // ===== SYNC (test + build + restart + deploy) =====
        case 'sync': {
          await ctx.authChecker.checkPermission(user_id, Permission.USER_MANAGE);

          const project = ctx.projectResolver.tryResolve(channel_id);
          if (!project) {
            await respond(':x: No project configured for this channel. Use `/bm config` first.');
            return;
          }

          const resolvedAgentId = ctx.agentManager.resolveAgent(project.agentId);
          if (!resolvedAgentId) {
            await respond(':x: No agents are connected. Cannot sync.');
            return;
          }

          const opsBot = BotRegistry.get('ops');
          if (!opsBot) {
            await respond(':x: Ops bot not available');
            return;
          }

          // Ack the command silently — we'll post the real message via notifier
          await respond(':arrows_counterclockwise: Starting sync workflow...');

          // Post the summary to the channel to get a thread parent ts
          const threadTs = await ctx.notifier.postMessage(
            channel_id,
            `:arrows_counterclockwise: *Sync workflow started* for *${project.name}* by <@${user_id}>\n` +
            `> 1. :hourglass_flowing_sand: Run tests\n` +
            `> 2. :hourglass_flowing_sand: Build project\n` +
            `> 3. :clock1: Restart agent\n` +
            `> 4. :clock1: Deploy to Railway\n\n` +
            `_Progress updates in thread below._`,
          );

          // Start orchestrated sync workflow (all updates go into the thread)
          const workflowId = await ctx.syncOrchestrator.startSync(
            project.id,
            resolvedAgentId,
            channel_id,
            threadTs ?? null,
            user_id,
          );

          // Submit test task (runs in the thread)
          const testCommand = opsBot.parseCommand('test');
          const testTaskId = await ctx.commandService.submit({
            bot: opsBot,
            command: testCommand,
            project,
            slackContext: { channelId: channel_id, threadTs: threadTs ?? null, userId: user_id },
          });
          ctx.syncOrchestrator.registerTestTask(workflowId, testTaskId);

          // Submit build task (runs in the thread)
          const buildCommand = opsBot.parseCommand('build');
          const buildTaskId = await ctx.commandService.submit({
            bot: opsBot,
            command: buildCommand,
            project,
            slackContext: { channelId: channel_id, threadTs: threadTs ?? null, userId: user_id },
          });
          ctx.syncOrchestrator.registerBuildTask(workflowId, buildTaskId);

          // Post task IDs into the thread
          await ctx.notifier.postMessage(
            channel_id,
            `:clipboard: Test task: \`${testTaskId}\`\n:clipboard: Build task: \`${buildTaskId}\`\n:label: Workflow: \`${workflowId}\``,
            threadTs,
          );

          break;
        }

        // ===== SCHEDULED TASKS & CRON JOBS =====
        case 'remind':
        case 'reminder': {
          await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);
          await handleRemindCommand(command, respond, client, ctx, subArgs);
          break;
        }

        case 'schedule': {
          await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);
          await handleScheduleCommand(command, respond, client, ctx, subArgs);
          break;
        }

        case 'cron': {
          if (subArgs[0] === 'create') {
            await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);
            await handleCronCreateCommand(command, respond, client, ctx, subArgs.slice(1));
          } else {
            await respond(':x: Usage: `/bm cron create "<expression>" <bot> <command> <prompt>`');
          }
          break;
        }

        case 'scheduled': {
          const scheduledSubcmd = subArgs[0]?.toLowerCase();
          switch (scheduledSubcmd) {
            case 'list':
              await handleScheduledListCommand(command, respond, ctx, subArgs.slice(1));
              break;
            case 'show':
              await handleScheduledShowCommand(command, respond, ctx, subArgs.slice(1));
              break;
            case 'pause':
              await handleScheduledPauseCommand(command, respond, ctx, subArgs.slice(1));
              break;
            case 'resume':
              await handleScheduledResumeCommand(command, respond, ctx, subArgs.slice(1));
              break;
            case 'cancel':
              await handleScheduledCancelCommand(command, respond, ctx, subArgs.slice(1));
              break;
            default:
              await respond(
                '*Scheduled Tasks Commands:*\n' +
                '• `/bm scheduled list` - List all scheduled tasks\n' +
                '• `/bm scheduled show <id>` - Show task details\n' +
                '• `/bm scheduled pause <id>` - Pause a task\n' +
                '• `/bm scheduled resume <id>` - Resume a task\n' +
                '• `/bm scheduled cancel <id>` - Cancel a task'
              );
          }
          break;
        }

        // ===== HELP =====
        case 'help':
        case '?':
        default:
          await respond(
            '*Bematic Manager - /bm Commands Reference*\n\n' +
            '*Development:*\n' +
            '`/bm build` or `/bm compile` - Compile/rebuild the app\n' +
            '`/bm test [args]` or `/bm tests [args]` - Run tests with optional arguments\n' +
            '`/bm status` or `/bm info` - Check git status & project health\n' +
            '`/bm sync` - All-in-one: test → build → restart agent → deploy\n\n' +
            '*Deployment:*\n' +
            '`/bm deploy` or `/bm ship` - Deploy to Railway\n\n' +
            '*Monitoring & Queue:*\n' +
            '`/bm agents` or `/bm workers` - Monitor agent status & running tasks\n' +
            '`/bm queue` or `/bm queued` - List all queued/pending tasks\n' +
            '`/bm cancel <task-id>` or `/bm stop <task-id>` - Cancel a specific task\n' +
            '`/bm clear-queue` - Clear all queued tasks (project-specific)\n' +
            '`/bm clear-queue --all` or `/bm purge-queue --all` - Clear ALL queued tasks (all projects)\n\n' +
            '*Logs & Statistics:*\n' +
            '`/bm usage` or `/bm sessions` or `/bm stats` - View session usage & statistics\n' +
            '`/bm logs [limit]` or `/bm log [limit]` - View prompt history (default: 20)\n' +
            '`/bm logs --stats` - View detailed prompt history statistics\n' +
            '`/bm logs [limit] --category <cat>` - Filter logs by category\n' +
            '`/bm logs [limit] --status <status>` - Filter logs by status\n' +
            '`/bm logs [limit] --tag <tag>` - Filter logs by tag\n' +
            '`/bm logs [limit] --search <text>` - Search logs by text\n\n' +
            '*Agent Management:*\n' +
            '`/bm restart` or `/bm restart-agent` - Restart all connected agents\n' +
            '`/bm restart --rebuild` - Restart agents with rebuild\n\n' +
            '*Scheduled Tasks & Cron Jobs:*\n' +
            '`/bm schedule "<time>" <bot> <command> <prompt>` - Schedule a one-time task\n' +
            '`/bm cron create "<expression>" <bot> <command> <prompt>` - Create recurring cron job\n' +
            '`/bm scheduled list` - List all scheduled tasks\n' +
            '`/bm scheduled show <id>` - Show task details\n' +
            '`/bm scheduled pause|resume|cancel <id>` - Manage scheduled tasks\n\n' +
            '*Configuration:*\n' +
            '`/bm config` or `/bm configure` or `/bm setup` - Configure project settings\n\n' +
            '*NetSuite Integration:*\n' +
            '`/bm netsuite config` - Configure NetSuite credentials & endpoints\n' +
            '`/bm netsuite get <type> <id>` - Fetch NetSuite record (e.g. `customer 1233`)\n' +
            '`/bm netsuite seo <url>` - Generate SEO debug URL with prerender flags\n' +
            '`/bm netsuite test` - Test NetSuite connection & authentication\n' +
            '`/bm netsuite help` - Show detailed NetSuite commands help\n\n' +
            '*Help:*\n' +
            '`/bm help` or `/bm ?` - Show this help message\n\n' +
            '*For coding tasks*, use natural language mentions:\n' +
            '• `@BematicManager fix the login bug`\n' +
            '• `@BematicManager review this PR`\n' +
            '• `code refactor the auth module`\n' +
            '• `review security in payment flow`\n',
          );
          break;
      }
    } catch (error) {
      logger.error({ error, subcommand }, 'Error handling /bm command');
      const message = error instanceof Error ? error.message : 'An unexpected error occurred';
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

/**
 * Register modal submission handler for project configuration
 * This is called when the user submits the /bm config modal
 */
export function registerConfigModalHandler(app: App, ctx: AppContext) {
  app.view('project_config_modal', async ({ view, ack, client, body }) => {
    const meta = JSON.parse(view.private_metadata);
    const channelId = meta.channelId as string;
    const vals = view.state.values;

    const name = vals['project_name']!['value']!.value!;
    const localPath = vals['local_path']!['value']!.value!;
    const agentId = vals['agent_id']!['value']!.selected_option!.value;
    const defaultModel = vals['default_model']!['value']!.selected_option!.value;
    const maxBudget = parseFloat(vals['max_budget']!['value']!.value!) || 5.0;
    const autoCommitPush = vals['auto_commit_push']!['value']!.selected_option!.value === 'true';
    const railwayProjectId = vals['railway_project_id']?.['value']?.value || null;
    const railwayServiceId = vals['railway_service_id']?.['value']?.value || null;
    const railwayEnvironmentId = vals['railway_environment_id']?.['value']?.value || null;

    // Validate
    if (!name || !localPath || !agentId) {
      await ack({
        response_action: 'errors',
        errors: {
          ...(!name ? { project_name: 'Required' } : {}),
          ...(!localPath ? { local_path: 'Required' } : {}),
          ...(!agentId ? { agent_id: 'Required' } : {}),
        },
      });
      return;
    }

    await ack();

    const hasAvailableAgent = agentId === 'auto'
      ? ctx.agentManager.getConnectedAgentIds().length > 0
      : ctx.agentManager.isOnline(agentId);
    const agentWarning = hasAvailableAgent ? '' : '\n:warning: No agents are currently online. Tasks will be queued until an agent connects.';

    const existing = ctx.projectResolver.tryResolve(channelId);

    if (existing) {
      ctx.projectService.update(existing.id, {
        name,
        localPath,
        agentId,
        defaultModel,
        defaultMaxBudget: maxBudget,
        autoCommitPush,
        railwayProjectId,
        railwayServiceId,
        railwayEnvironmentId,
      } as any);

      const railwayInfo = railwayServiceId ? `\n> Railway: \`${railwayServiceId}\`` : '';
      await client.chat.postMessage({
        channel: channelId,
        text: `:white_check_mark: Project *${name}* updated.\n> Path: \`${localPath}\`\n> Agent: ${agentId === 'auto' ? 'Auto (any available)' : '`' + agentId + '`'}\n> Model: \`${defaultModel}\`\n> Budget: $${maxBudget}${railwayInfo}${agentWarning}`,
      });
    } else {
      // Auto-provision user as admin if first project
      const userId = body.user?.id;
      if (userId) {
        const dbUser = ctx.userRepo.findBySlackUserId(userId);
        if (!dbUser) {
          ctx.userRepo.create({
            id: generateId('user'),
            slackUserId: userId,
            slackUsername: body.user?.name ?? userId,
          } as any);
        }
      }

      ctx.projectService.create({
        name,
        slackChannelId: channelId,
        localPath,
        agentId,
        defaultModel,
        defaultMaxBudget: maxBudget,
        autoCommitPush,
        railwayProjectId,
        railwayServiceId,
        railwayEnvironmentId,
      } as any);

      const railwayInfo = railwayServiceId ? `\n> Railway: \`${railwayServiceId}\`` : '';
      await client.chat.postMessage({
        channel: channelId,
        text: `:white_check_mark: Project *${name}* created!\n> Path: \`${localPath}\`\n> Agent: ${agentId === 'auto' ? 'Auto (any available)' : '`' + agentId + '`'}\n> Model: \`${defaultModel}\`\n> Budget: $${maxBudget}${railwayInfo}${agentWarning}\n\nYou can now use \`@BematicManager code <task>\` in this channel.`,
      });
    }

    logger.info({ channelId, name, localPath }, 'Project configured');
  });
}
