/**
 * Admin command handlers extracted from admin.ts for better organization
 */
import {
  MessageType,
  createWSMessage,
  serializeMessage,
  generateId,
  createLogger,
} from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('admin-handlers');

export interface AdminCommandHandler {
  (args: string[], userId: string, channelId: string, respond: (text: string) => Promise<void>, ctx: AppContext): Promise<void>;
}

/**
 * Handle agent restart command
 */
export const handleRestartAgent: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
  const agentIds = ctx.agentManager.getConnectedAgentIds();

  if (agentIds.length === 0) {
    await respond(':warning: No agents are currently connected.');
    return;
  }

  const rebuild = args.includes('--rebuild');
  let restarted = 0;

  for (const agentId of agentIds) {
    const msg = createWSMessage(MessageType.SYSTEM_RESTART, {
      reason: `Restart requested by <@${userId}> via Slack`,
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
    userId,
    { rebuild, agentCount: agentIds.length },
  );
};

/**
 * Handle agent status command
 */
export const handleAgentStatus: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
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
};

/**
 * Handle workers dashboard command
 */
export const handleWorkers: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
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

    const section = buildAgentSection(agent, agentId, ctx);
    sections.push(section.content);
    totalRunning += section.runningCount;
    totalQueued += section.queuedCount;
  }

  // Summary footer
  sections.push(
    `\n:bar_chart: *Totals:* ${totalRunning} running | ${totalQueued} queued | ${agentIds.length} agent${agentIds.length === 1 ? '' : 's'}`,
  );

  await respond(sections.join('\n'));
};

/**
 * Build the section for a single agent in the workers dashboard
 */
function buildAgentSection(agent: any, agentId: string, ctx: AppContext) {
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

  let content =
    `\n:heavy_minus_sign::heavy_minus_sign::heavy_minus_sign: Agent \`${agentId}\` ${statusIcon} *${agent.status}* :heavy_minus_sign::heavy_minus_sign::heavy_minus_sign:\n` +
    `> :clock1: Uptime: *${uptimeStr}* | Heartbeat: ${heartbeatStr} ago\n` +
    `> :file_folder: Projects: ${projectNames}`;

  if (runningTasks.length > 0) {
    content += `\n> :wrench: *Running Tasks (${runningTasks.length}):*`;
    for (const task of runningTasks) {
      const elapsed = formatDuration(Date.now() - new Date(task.createdAt).getTime());
      const cost = task.estimatedCost > 0 ? ` | $${task.estimatedCost.toFixed(2)}` : '';
      const promptPreview = task.prompt.length > 40
        ? task.prompt.slice(0, 40) + '...'
        : task.prompt;
      content += `\n>    • \`${task.id}\` [${task.botName}] ${task.command} — "${promptPreview}" — <@${task.slackUserId}> — ${elapsed}${cost}`;
    }
  } else {
    content += `\n> :white_check_mark: No running tasks`;
  }

  if (queuedTasks.length > 0) {
    content += `\n> :hourglass_flowing_sand: Queued: ${queuedTasks.length} task${queuedTasks.length === 1 ? '' : 's'}`;
  }

  return {
    content,
    runningCount: runningTasks.length,
    queuedCount: queuedTasks.length,
  };
}

/**
 * Handle deploy command
 */
export const handleDeploy: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
  const project = ctx.projectResolver.tryResolve(channelId);
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
    slackChannelId: channelId,
    slackThreadTs: null,
    requestedBy: userId,
  });

  // Register so message router knows where to post the result
  ctx.messageRouter.registerDeployRequest(requestId, channelId, null, userId);

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
    userId,
    { agentId, requestId },
  );
};

/**
 * Handle deploy status command
 */
export const handleDeployStatus: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
  if (!ctx.deployService.isConfigured()) {
    await respond(':x: Railway API token not configured.');
    return;
  }

  const project = ctx.projectResolver.tryResolve(channelId);
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
};

/**
 * Handle deploy logs command
 */
export const handleDeployLogs: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
  if (!ctx.deployService.isConfigured()) {
    await respond(':x: Railway API token not configured.');
    return;
  }

  const project = ctx.projectResolver.tryResolve(channelId);
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
};

/**
 * Handle cancel task command
 */
export const handleCancelTask: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
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
  await ctx.commandService.cancel(taskId, `Cancelled by admin <@${userId}>`);

  await respond(`:octagonal_sign: Task \`${taskId}\` has been cancelled.`);

  // Log audit trail
  ctx.auditLogRepo.log('task:cancel-admin', 'task', taskId, userId, {
    previousStatus: task.status,
    botName: task.botName,
    projectId: task.projectId,
  });

  logger.info({ taskId, userId }, 'Task cancelled by admin');
};

/**
 * Handle logs command
 */
export const handleLogs: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
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
};

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