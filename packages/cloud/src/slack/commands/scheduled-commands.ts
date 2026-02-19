import type { RespondFn, SlashCommand } from '@slack/bolt';
import type { WebClient } from '@slack/web-api';
import { createLogger, TimeParser, CronParser } from '@bematic/common';
import type { AppContext } from '../../context.js';
import { BotRegistry } from '@bematic/bots';

const logger = createLogger('slack:scheduled-commands');

/**
 * Handle /bm schedule <time> <bot> <command> <prompt>
 * Example: /bm schedule "tomorrow 3pm" coder fix optimize database queries
 */
export async function handleScheduleCommand(
  command: SlashCommand,
  respond: RespondFn,
  client: WebClient,
  ctx: AppContext,
  subArgs: string[],
) {
  const { user_id, channel_id } = command;

  // Get user's timezone from Slack profile
  let timezone = 'America/New_York'; // default
  try {
    const userInfo = await client.users.info({ user: user_id });
    timezone = (userInfo.user as any)?.tz || 'America/New_York';
  } catch (error) {
    logger.warn({ error, user_id }, 'Failed to get user timezone, using default');
  }

  // Parse: schedule "<time>" <bot> <command> <prompt>
  const fullText = subArgs.join(' ');

  // Extract time (either quoted or first token)
  let timeStr: string;
  let remainingArgs: string[];

  if (fullText.startsWith('"') || fullText.startsWith("'")) {
    const quote = fullText[0];
    const endQuote = fullText.indexOf(quote, 1);
    if (endQuote === -1) {
      await respond(':x: Invalid time format. Use quotes: `/bm schedule "tomorrow 3pm" ...`');
      return;
    }
    timeStr = fullText.slice(1, endQuote);
    remainingArgs = fullText.slice(endQuote + 1).trim().split(/\s+/);
  } else {
    const parts = fullText.split(/\s+/);
    timeStr = parts[0];
    remainingArgs = parts.slice(1);
  }

  if (remainingArgs.length < 3) {
    await respond(
      ':x: Usage: `/bm schedule "<time>" <bot> <command> <prompt>`\n' +
      'Example: `/bm schedule "tomorrow 3pm" coder fix optimize database`'
    );
    return;
  }

  const [botName, commandName, ...promptParts] = remainingArgs;
  const prompt = promptParts.join(' ');

  // Validate time
  const scheduledDate = TimeParser.parseNatural(timeStr, timezone);
  if (!scheduledDate) {
    await respond(`:x: Could not parse time: "${timeStr}". Try formats like:\n• "tomorrow 3pm"\n• "in 2 hours"\n• "2025-03-01 14:00"`);
    return;
  }

  if (!TimeParser.isFuture(scheduledDate)) {
    await respond(`:x: Scheduled time must be in the future. "${timeStr}" is in the past.`);
    return;
  }

  // Validate bot
  const bot = BotRegistry.get(botName as any);
  if (!bot) {
    const validBots = ['coder', 'reviewer', 'ops', 'netsuite'].join(', ');
    await respond(`:x: Unknown bot: "${botName}". Valid bots: ${validBots}`);
    return;
  }

  // Get project
  const project = ctx.projectResolver.tryResolve(channel_id);
  if (!project) {
    await respond(':x: No project configured for this channel. Use `/bm config` first.');
    return;
  }

  try {
    // Create scheduled task
    const scheduled = await ctx.schedulerService.scheduleTask({
      projectId: project.id,
      userId: user_id,
      slackChannelId: channel_id,
      taskType: 'prompt_execution',
      botName: bot.name,
      command: commandName,
      prompt,
      scheduledFor: timeStr,
      timezone,
    });

    const formattedTime = TimeParser.format(scheduledDate, timezone);
    const relativeTime = TimeParser.relative(scheduledDate, timezone);

    await respond(
      `:white_check_mark: *Task scheduled successfully!*\n\n` +
      `:robot_face: Bot: \`${botName}\`\n` +
      `:gear: Command: \`${commandName}\`\n` +
      `:speech_balloon: Prompt: "${prompt}"\n` +
      `:clock3: When: ${formattedTime} (${relativeTime})\n` +
      `:id: Task ID: \`${scheduled.id}\`\n\n` +
      `_Use \`/bm scheduled list\` to view all scheduled tasks_`
    );

    logger.info(
      { taskId: scheduled.id, user: user_id, scheduledFor: formattedTime },
      'Scheduled task created'
    );
  } catch (error) {
    logger.error({ error, user: user_id }, 'Failed to schedule task');
    await respond(`:x: Failed to schedule task: ${error}`);
  }
}

/**
 * Handle /bm cron create <expression> <bot> <command> <prompt>
 * Example: /bm cron create "0 0 * * *" ops test run integration tests
 */
export async function handleCronCreateCommand(
  command: SlashCommand,
  respond: RespondFn,
  client: WebClient,
  ctx: AppContext,
  subArgs: string[],
) {
  const { user_id, channel_id } = command;

  // Get user's timezone
  let timezone = 'America/New_York';
  try {
    const userInfo = await client.users.info({ user: user_id });
    timezone = (userInfo.user as any)?.tz || 'America/New_York';
  } catch (error) {
    logger.warn({ error, user_id }, 'Failed to get user timezone, using default');
  }

  // Parse: cron create "<expression>" <bot> <command> <prompt>
  const fullText = subArgs.join(' ');

  // Extract cron expression (must be quoted)
  let cronExpression: string;
  let remainingArgs: string[];

  if (fullText.startsWith('"') || fullText.startsWith("'")) {
    const quote = fullText[0];
    const endQuote = fullText.indexOf(quote, 1);
    if (endQuote === -1) {
      await respond(':x: Invalid cron expression format. Use quotes: `/bm cron create "0 0 * * *" ...`');
      return;
    }
    cronExpression = fullText.slice(1, endQuote);
    remainingArgs = fullText.slice(endQuote + 1).trim().split(/\s+/);
  } else {
    await respond(':x: Cron expression must be in quotes: `/bm cron create "0 0 * * *" ...`');
    return;
  }

  if (remainingArgs.length < 3) {
    await respond(
      ':x: Usage: `/bm cron create "<expression>" <bot> <command> <prompt>`\n' +
      'Example: `/bm cron create "0 0 * * *" ops test run daily tests`\n\n' +
      '*Common cron expressions:*\n' +
      '• `0 0 * * *` - Daily at midnight\n' +
      '• `0 9 * * 1-5` - Weekdays at 9am\n' +
      '• `0 */4 * * *` - Every 4 hours'
    );
    return;
  }

  const [botName, commandName, ...promptParts] = remainingArgs;
  const prompt = promptParts.join(' ');

  // Validate cron expression
  if (!CronParser.validate(cronExpression)) {
    await respond(`:x: Invalid cron expression: "${cronExpression}"`);
    return;
  }

  if (!CronParser.isReasonableFrequency(cronExpression)) {
    await respond(`:x: Cron expression must have at least 1 hour between executions (to prevent abuse)`);
    return;
  }

  // Validate bot
  const bot = BotRegistry.get(botName as any);
  if (!bot) {
    const validBots = ['coder', 'reviewer', 'ops', 'netsuite'].join(', ');
    await respond(`:x: Unknown bot: "${botName}". Valid bots: ${validBots}`);
    return;
  }

  // Get project
  const project = ctx.projectResolver.tryResolve(channel_id);
  if (!project) {
    await respond(':x: No project configured for this channel. Use `/bm config` first.');
    return;
  }

  try {
    // Create cron job
    const cronJob = await ctx.schedulerService.createCronJob({
      projectId: project.id,
      userId: user_id,
      slackChannelId: channel_id,
      botName: bot.name,
      command: commandName,
      prompt,
      cronExpression,
      timezone,
    });

    const description = CronParser.describe(cronExpression);
    const nextExecutions = CronParser.getNextN(cronExpression, 3, timezone);

    await respond(
      `:white_check_mark: *Cron job created successfully!*\n\n` +
      `:robot_face: Bot: \`${botName}\`\n` +
      `:gear: Command: \`${commandName}\`\n` +
      `:speech_balloon: Prompt: "${prompt}"\n` +
      `:repeat: Schedule: \`${cronExpression}\` (${description})\n` +
      `:id: Job ID: \`${cronJob.id}\`\n\n` +
      `*Next 3 executions:*\n` +
      nextExecutions.map((d: Date, i: number) => `${i + 1}. ${TimeParser.format(d, timezone)}`).join('\n') +
      `\n\n_Use \`/bm scheduled list\` to view all scheduled tasks_`
    );

    logger.info(
      { taskId: cronJob.id, user: user_id, cronExpression },
      'Cron job created'
    );
  } catch (error) {
    logger.error({ error, user: user_id }, 'Failed to create cron job');
    await respond(`:x: Failed to create cron job: ${error}`);
  }
}

/**
 * Handle /bm scheduled list [--all|--user|--project]
 */
export async function handleScheduledListCommand(
  command: SlashCommand,
  respond: RespondFn,
  ctx: AppContext,
  subArgs: string[],
) {
  const { user_id, channel_id } = command;

  const showAll = subArgs.includes('--all');
  const showUser = subArgs.includes('--user');

  let tasks;
  if (showAll) {
    // Show all tasks (admin only)
    await ctx.authChecker.checkPermission(user_id, 'USER_MANAGE');
    tasks = ctx.scheduledTaskRepo.findAll({ enabled: true });
  } else if (showUser) {
    // Show user's tasks across all projects
    tasks = ctx.scheduledTaskRepo.findByUserId(user_id);
  } else {
    // Show tasks for current project
    const project = ctx.projectResolver.tryResolve(channel_id);
    if (!project) {
      await respond(':x: No project configured for this channel.');
      return;
    }
    tasks = ctx.scheduledTaskRepo.findByProjectId(project.id);
  }

  if (tasks.length === 0) {
    await respond(':inbox_tray: No scheduled tasks found.');
    return;
  }

  // Group by status
  const active = tasks.filter(t => t.status === 'active' || t.status === 'pending');
  const paused = tasks.filter(t => t.status === 'paused');
  const completed = tasks.filter(t => t.status === 'completed').slice(0, 5);

  const sections: string[] = [`:calendar: *Scheduled Tasks* (${tasks.length} total)`];

  if (active.length > 0) {
    sections.push('\n*Active:*');
    for (const task of active.slice(0, 10)) {
      const nextExec = task.nextExecutionAt ? new Date(task.nextExecutionAt) : null;
      const relative = nextExec ? TimeParser.relative(nextExec, task.timezone) : 'N/A';
      const icon = task.isRecurring ? ':repeat:' : ':clock3:';
      sections.push(
        `${icon} \`${task.id}\` - ${task.botName} ${task.command} - ${relative}`
      );
    }
  }

  if (paused.length > 0) {
    sections.push('\n*Paused:*');
    for (const task of paused.slice(0, 5)) {
      sections.push(`⏸️ \`${task.id}\` - ${task.botName} ${task.command}`);
    }
  }

  if (completed.length > 0) {
    sections.push('\n*Recently Completed:*');
    for (const task of completed) {
      sections.push(`✅ \`${task.id}\` - ${task.botName} ${task.command}`);
    }
  }

  sections.push('\n_Use `/bm scheduled show <id>` for details_');

  await respond(sections.join('\n'));
}

/**
 * Handle /bm scheduled show <id>
 */
export async function handleScheduledShowCommand(
  command: SlashCommand,
  respond: RespondFn,
  ctx: AppContext,
  subArgs: string[],
) {
  const { user_id } = command;

  if (subArgs.length === 0) {
    await respond(':x: Usage: `/bm scheduled show <task-id>`');
    return;
  }

  const taskId = subArgs[0];
  const task = ctx.scheduledTaskRepo.findById(taskId);

  if (!task) {
    await respond(`:x: Scheduled task not found: \`${taskId}\``);
    return;
  }

  // Check permissions (user can only view their own tasks unless admin)
  if (task.userId !== user_id) {
    try {
      await ctx.authChecker.checkPermission(user_id, 'USER_MANAGE');
    } catch {
      await respond(':x: You can only view your own scheduled tasks');
      return;
    }
  }

  const nextExec = task.nextExecutionAt ? new Date(task.nextExecutionAt) : null;
  const lastExec = task.lastExecutedAt ? new Date(task.lastExecutedAt) : null;

  let details = `:calendar: *Scheduled Task Details*\n\n`;
  details += `:id: ID: \`${task.id}\`\n`;
  details += `:robot_face: Bot: \`${task.botName}\`\n`;
  details += `:gear: Command: \`${task.command}\`\n`;
  details += `:speech_balloon: Prompt: "${task.prompt}"\n`;
  details += `:grey_question: Status: ${task.status}\n`;
  details += `:vertical_traffic_light: Enabled: ${task.enabled ? 'Yes' : 'No'}\n`;

  if (task.isRecurring) {
    details += `:repeat: Type: Recurring cron job\n`;
    details += `:clock3: Cron: \`${task.cronExpression}\` (${CronParser.describe(task.cronExpression!)})\n`;
    details += `:1234: Executions: ${task.executionCount}`;
    if (task.maxExecutions) {
      details += ` / ${task.maxExecutions}`;
    }
    details += '\n';
  } else {
    details += `:clock3: Type: One-time scheduled task\n`;
  }

  if (nextExec) {
    details += `:arrow_forward: Next execution: ${TimeParser.format(nextExec, task.timezone)} (${TimeParser.relative(nextExec, task.timezone)})\n`;
  }

  if (lastExec) {
    details += `:checkered_flag: Last executed: ${TimeParser.format(lastExec, task.timezone)}\n`;
  }

  details += `\n_Created: ${new Date(task.createdAt).toLocaleString()}_`;

  await respond(details);
}

/**
 * Handle /bm scheduled pause <id>
 */
export async function handleScheduledPauseCommand(
  command: SlashCommand,
  respond: RespondFn,
  ctx: AppContext,
  subArgs: string[],
) {
  const { user_id } = command;

  if (subArgs.length === 0) {
    await respond(':x: Usage: `/bm scheduled pause <task-id>`');
    return;
  }

  const taskId = subArgs[0];

  try {
    await ctx.schedulerService.pauseTask(taskId, user_id);
    await respond(`:pause_button: Scheduled task \`${taskId}\` has been paused.`);
  } catch (error) {
    await respond(`:x: ${error}`);
  }
}

/**
 * Handle /bm scheduled resume <id>
 */
export async function handleScheduledResumeCommand(
  command: SlashCommand,
  respond: RespondFn,
  ctx: AppContext,
  subArgs: string[],
) {
  const { user_id } = command;

  if (subArgs.length === 0) {
    await respond(':x: Usage: `/bm scheduled resume <task-id>`');
    return;
  }

  const taskId = subArgs[0];

  try {
    await ctx.schedulerService.resumeTask(taskId, user_id);
    await respond(`:arrow_forward: Scheduled task \`${taskId}\` has been resumed.`);
  } catch (error) {
    await respond(`:x: ${error}`);
  }
}

/**
 * Handle /bm scheduled cancel <id>
 */
export async function handleScheduledCancelCommand(
  command: SlashCommand,
  respond: RespondFn,
  ctx: AppContext,
  subArgs: string[],
) {
  const { user_id } = command;

  if (subArgs.length === 0) {
    await respond(':x: Usage: `/bm scheduled cancel <task-id>`');
    return;
  }

  const taskId = subArgs[0];

  try {
    await ctx.schedulerService.cancelTask(taskId, user_id);
    await respond(`:x: Scheduled task \`${taskId}\` has been cancelled.`);
  } catch (error) {
    await respond(`:x: ${error}`);
  }
}
