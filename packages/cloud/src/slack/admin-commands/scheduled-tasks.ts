import type { SlackCommandContext } from '../types.js';
import type { ScheduledTaskRepository } from '@bematic/db';
import { createLogger } from '@bematic/common';

const logger = createLogger('admin-scheduled-tasks');

export async function handleScheduledTasksCommand(
  context: SlackCommandContext,
  scheduledTaskRepo: ScheduledTaskRepository,
): Promise<string> {
  const { args } = context;

  if (args.length === 0) {
    return getScheduledTasksHelp();
  }

  const subCommand = args[0];

  try {
    switch (subCommand) {
      case 'stats':
        return await handleScheduledStats(scheduledTaskRepo);
      case 'cleanup':
        return await handleScheduledCleanup(args.slice(1), scheduledTaskRepo);
      default:
        return `Unknown scheduled-tasks command: \`${subCommand}\`\n\n${getScheduledTasksHelp()}`;
    }
  } catch (error) {
    logger.error({ error, command: subCommand, args }, 'Scheduled tasks command failed');
    return `Error executing scheduled-tasks command: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

async function handleScheduledStats(scheduledTaskRepo: ScheduledTaskRepository): Promise<string> {
  const allTasks = scheduledTaskRepo.findAll();

  // Count by status
  const activeCount = allTasks.filter(t => t.status === 'active').length;
  const pausedCount = allTasks.filter(t => t.status === 'paused').length;
  const failedCount = allTasks.filter(t => t.status === 'failed').length;

  // Count by type
  const oneTimeCount = allTasks.filter(t => !t.cronExpression).length;
  const recurringCount = allTasks.filter(t => !!t.cronExpression).length;

  // Count by task type
  const taskTypes: Record<string, number> = {};
  for (const task of allTasks) {
    taskTypes[task.taskType] = (taskTypes[task.taskType] || 0) + 1;
  }

  // Count by bot
  const botCounts: Record<string, number> = {};
  for (const task of allTasks) {
    botCounts[task.botName] = (botCounts[task.botName] || 0) + 1;
  }

  // Count by user (top 10)
  const userCounts: Record<string, number> = {};
  for (const task of allTasks) {
    userCounts[task.userId] = (userCounts[task.userId] || 0) + 1;
  }
  const topUsers = Object.entries(userCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  // Calculate next execution stats
  const now = new Date();
  const upcomingTasks = allTasks
    .filter(t => t.status === 'active' && t.nextExecutionAt)
    .map(t => ({
      ...t,
      msUntilExecution: new Date(t.nextExecutionAt!).getTime() - now.getTime(),
    }))
    .filter(t => t.msUntilExecution > 0)
    .sort((a, b) => a.msUntilExecution - b.msUntilExecution);

  const next5Tasks = upcomingTasks.slice(0, 5);

  // Calculate execution history stats (last 24h, 7d, 30d)
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const executions24h = allTasks.filter(t => t.lastExecutedAt && new Date(t.lastExecutedAt) >= oneDayAgo).length;
  const executions7d = allTasks.filter(t => t.lastExecutedAt && new Date(t.lastExecutedAt) >= sevenDaysAgo).length;
  const executions30d = allTasks.filter(t => t.lastExecutedAt && new Date(t.lastExecutedAt) >= thirtyDaysAgo).length;

  let response = `*📊 Scheduled Tasks Statistics*\n\n`;

  response += `*Overall Status*:\n`;
  response += `• Total Tasks: ${allTasks.length}\n`;
  response += `• Active: ${activeCount}\n`;
  response += `• Paused: ${pausedCount}\n`;
  response += `• Failed: ${failedCount}\n\n`;

  response += `*Task Types*:\n`;
  response += `• One-time: ${oneTimeCount}\n`;
  response += `• Recurring (Cron): ${recurringCount}\n\n`;

  if (Object.keys(taskTypes).length > 0) {
    response += `*By Task Type*:\n`;
    Object.entries(taskTypes)
      .sort(([, a], [, b]) => b - a)
      .forEach(([type, count]) => {
        response += `• ${type}: ${count}\n`;
      });
    response += `\n`;
  }

  if (Object.keys(botCounts).length > 0) {
    response += `*By Bot*:\n`;
    Object.entries(botCounts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([bot, count]) => {
        response += `• ${bot}: ${count}\n`;
      });
    response += `\n`;
  }

  if (topUsers.length > 0) {
    response += `*Top Users*:\n`;
    topUsers.forEach(([userId, count]) => {
      response += `• <@${userId}>: ${count} tasks\n`;
    });
    response += `\n`;
  }

  response += `*Execution History*:\n`;
  response += `• Last 24 hours: ${executions24h} tasks executed\n`;
  response += `• Last 7 days: ${executions7d} tasks executed\n`;
  response += `• Last 30 days: ${executions30d} tasks executed\n\n`;

  if (next5Tasks.length > 0) {
    response += `*🕐 Next 5 Upcoming Executions*:\n`;
    next5Tasks.forEach(task => {
      const timeUntil = formatTimeUntil(task.msUntilExecution);
      const taskType = task.cronExpression ? '🔁' : '⏰';
      const taskLabel = `${task.command} ${task.prompt.substring(0, 30)}${task.prompt.length > 30 ? '...' : ''}`;
      response += `${taskType} ${taskLabel} (${task.id.substring(0, 8)}): ${timeUntil}\n`;
    });
    response += `\n`;
  }

  response += `_Use \`/bm-admin scheduled-cleanup\` to remove old tasks._`;

  return response;
}

async function handleScheduledCleanup(args: string[], scheduledTaskRepo: ScheduledTaskRepository): Promise<string> {
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  if (!force && !dryRun) {
    return `⚠️ This will delete completed and failed scheduled tasks older than 30 days.\n\n` +
           `To proceed, use: \`/bm-admin scheduled-cleanup --force\`\n` +
           `To preview without deleting, use: \`/bm-admin scheduled-cleanup --dry-run\``;
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const allTasks = scheduledTaskRepo.findAll();

  // Find tasks to clean up:
  // - One-time tasks that have been executed
  // - Failed tasks older than 30 days
  // - Paused tasks older than 30 days with no recent execution
  const tasksToDelete = allTasks.filter(task => {
    const createdAt = new Date(task.createdAt);
    const lastExecutedAt = task.lastExecutedAt ? new Date(task.lastExecutedAt) : null;

    // One-time tasks that completed
    if (!task.cronExpression && task.lastExecutedAt && task.status !== 'active') {
      return lastExecutedAt && lastExecutedAt < thirtyDaysAgo;
    }

    // Failed tasks older than 30 days
    if (task.status === 'failed' && createdAt < thirtyDaysAgo) {
      return true;
    }

    // Paused tasks older than 30 days that haven't run recently
    if (task.status === 'paused' && createdAt < thirtyDaysAgo) {
      return !lastExecutedAt || lastExecutedAt < thirtyDaysAgo;
    }

    return false;
  });

  if (tasksToDelete.length === 0) {
    return `✅ No scheduled tasks need cleanup. All tasks are recent or active.`;
  }

  // Group by category for reporting
  const oneTimeCompleted = tasksToDelete.filter(t => !t.cronExpression && t.lastExecutedAt).length;
  const failed = tasksToDelete.filter(t => t.status === 'failed').length;
  const paused = tasksToDelete.filter(t => t.status === 'paused').length;

  let response = `*🧹 Scheduled Tasks Cleanup*\n\n`;
  response += `Found ${tasksToDelete.length} tasks eligible for cleanup:\n`;
  response += `• Completed one-time tasks: ${oneTimeCompleted}\n`;
  response += `• Failed tasks (>30 days): ${failed}\n`;
  response += `• Paused tasks (>30 days): ${paused}\n\n`;

  if (dryRun) {
    response += `_This is a dry run. No tasks were deleted._\n\n`;
    response += `To actually delete these tasks, use: \`/bm-admin scheduled-cleanup --force\``;
    return response;
  }

  // Actually delete tasks
  let deletedCount = 0;
  for (const task of tasksToDelete) {
    try {
      scheduledTaskRepo.delete(task.id);
      deletedCount++;
    } catch (error) {
      logger.error({ error, taskId: task.id }, 'Failed to delete scheduled task during cleanup');
    }
  }

  response += `✅ Successfully deleted ${deletedCount} tasks.\n\n`;
  if (deletedCount < tasksToDelete.length) {
    response += `⚠️ ${tasksToDelete.length - deletedCount} tasks failed to delete. Check logs for details.`;
  }

  return response;
}

function formatTimeUntil(ms: number): string {
  if (ms < 0) return 'overdue';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `in ${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `in ${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `in ${minutes}m`;
  }
  return `in ${seconds}s`;
}

function getScheduledTasksHelp(): string {
  return `*Scheduled Tasks Management Commands*\n\n` +
         `• \`/bm-admin scheduled-stats\` - Show comprehensive task statistics\n` +
         `• \`/bm-admin scheduled-cleanup --dry-run\` - Preview tasks eligible for cleanup\n` +
         `• \`/bm-admin scheduled-cleanup --force\` - Delete old completed/failed tasks\n\n` +
         `*Examples:*\n` +
         `• \`scheduled-stats\` - View all statistics and upcoming executions\n` +
         `• \`scheduled-cleanup --dry-run\` - See what would be deleted\n` +
         `• \`scheduled-cleanup --force\` - Clean up tasks older than 30 days`;
}
