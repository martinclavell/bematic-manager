import type { SlackCommandContext } from '../types.js';
import type { ArchivedTaskRepository } from '@bematic/db';
import type { RetentionService } from '../../services/retention.service.js';
import { createLogger } from '@bematic/common';

const logger = createLogger('admin-archive');

export async function handleArchiveCommand(
  context: SlackCommandContext,
  retentionService: RetentionService,
  archivedTaskRepo: ArchivedTaskRepository,
): Promise<string> {
  const { args } = context;

  if (args.length === 0) {
    return getArchiveHelp();
  }

  const subCommand = args[0];

  try {
    switch (subCommand) {
      case 'list':
        return await handleArchiveList(args.slice(1), archivedTaskRepo);
      case 'restore':
        return await handleArchiveRestore(args.slice(1), retentionService);
      case 'delete':
        return await handleArchiveDelete(args.slice(1), archivedTaskRepo);
      case 'stats':
        return await handleArchiveStats(archivedTaskRepo);
      default:
        return `Unknown archive command: \`${subCommand}\`\n\n${getArchiveHelp()}`;
    }
  } catch (error) {
    logger.error({ error, command: subCommand, args }, 'Archive command failed');
    return `Error executing archive command: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

async function handleArchiveList(args: string[], archivedTaskRepo: ArchivedTaskRepository): Promise<string> {
  const days = args.length > 0 ? parseInt(args[0], 10) : undefined;
  const limit = args.length > 1 ? parseInt(args[1], 10) : 20;

  if (days !== undefined && isNaN(days)) {
    return 'Invalid days parameter. Usage: `archive list [days] [limit]`';
  }

  if (isNaN(limit)) {
    return 'Invalid limit parameter. Usage: `archive list [days] [limit]`';
  }

  const archives = await archivedTaskRepo.findRecent(limit, days);

  if (archives.length === 0) {
    const timeFilter = days ? `in the last ${days} days` : '';
    return `No archived tasks found ${timeFilter}.`;
  }

  let response = `*Archived Tasks* ${days ? `(last ${days} days)` : '(recent)'}:\n\n`;

  for (const archive of archives) {
    const taskData = JSON.parse(archive.taskData);
    const archivedDate = new Date(archive.archivedAt).toLocaleDateString();
    const originalDate = archive.createdAt ? new Date(archive.createdAt).toLocaleDateString() : 'Unknown';

    response += `• *${archive.id}* (Original: ${archive.originalId})\n`;
    response += `  Status: ${archive.status || 'Unknown'} | Reason: ${archive.reason}\n`;
    response += `  Created: ${originalDate} | Archived: ${archivedDate}\n`;
    if (taskData.prompt) {
      const prompt = taskData.prompt.substring(0, 100);
      response += `  Prompt: ${prompt}${taskData.prompt.length > 100 ? '...' : ''}\n`;
    }
    response += `\n`;
  }

  if (archives.length === limit) {
    response += `\n_Showing first ${limit} results. Use \`archive list ${days || ''} <limit>\` to see more._`;
  }

  return response;
}

async function handleArchiveRestore(args: string[], retentionService: RetentionService): Promise<string> {
  if (args.length === 0) {
    return 'Archive ID required. Usage: `archive restore <archive-id>`';
  }

  const archiveId = args[0];

  try {
    const restoredTask = await retentionService.restoreTask(archiveId);
    return `✅ Task restored successfully!\n\n` +
           `Archive ID: \`${archiveId}\`\n` +
           `New Task ID: \`${restoredTask.id}\`\n` +
           `Status: ${restoredTask.status}\n\n` +
           `The task has been restored to the main tasks table with a new ID.`;
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return `❌ Archive not found: \`${archiveId}\`\n\nUse \`archive list\` to see available archives.`;
    }
    throw error;
  }
}

async function handleArchiveDelete(args: string[], archivedTaskRepo: ArchivedTaskRepository): Promise<string> {
  if (args.length === 0) {
    return 'Archive ID required. Usage: `archive delete <archive-id>`';
  }

  const archiveId = args[0];

  // Check if archive exists
  const archive = await archivedTaskRepo.findById(archiveId);
  if (!archive) {
    return `❌ Archive not found: \`${archiveId}\`\n\nUse \`archive list\` to see available archives.`;
  }

  const deleted = await archivedTaskRepo.delete(archiveId);

  if (deleted) {
    const taskData = JSON.parse(archive.taskData);
    return `✅ Archive permanently deleted!\n\n` +
           `Archive ID: \`${archiveId}\`\n` +
           `Original Task ID: \`${archive.originalId}\`\n` +
           `Status: ${archive.status || 'Unknown'}\n` +
           `Reason: ${archive.reason}\n\n` +
           `⚠️ This action cannot be undone.`;
  } else {
    return `❌ Failed to delete archive: \`${archiveId}\``;
  }
}

async function handleArchiveStats(archivedTaskRepo: ArchivedTaskRepository): Promise<string> {
  const stats = await archivedTaskRepo.getStats();

  let response = `*Archive Statistics*\n\n`;
  response += `📊 *Total Archives*: ${stats.total}\n\n`;

  if (stats.total === 0) {
    response += `No archived tasks found.`;
    return response;
  }

  // Archive reasons breakdown
  response += `*By Reason*:\n`;
  for (const [reason, count] of Object.entries(stats.byReason)) {
    const percentage = ((count / stats.total) * 100).toFixed(1);
    response += `• ${reason}: ${count} (${percentage}%)\n`;
  }

  // Status breakdown
  if (Object.keys(stats.byStatus).length > 0) {
    response += `\n*By Original Status*:\n`;
    for (const [status, count] of Object.entries(stats.byStatus)) {
      const percentage = ((count / stats.total) * 100).toFixed(1);
      response += `• ${status}: ${count} (${percentage}%)\n`;
    }
  }

  // Date range
  if (stats.oldestArchive && stats.newestArchive) {
    response += `\n*Date Range*:\n`;
    response += `• Oldest: ${stats.oldestArchive.toLocaleDateString()}\n`;
    response += `• Newest: ${stats.newestArchive.toLocaleDateString()}\n`;

    const daysDiff = Math.ceil((stats.newestArchive.getTime() - stats.oldestArchive.getTime()) / (1000 * 60 * 60 * 24));
    response += `• Span: ${daysDiff} days\n`;
  }

  return response;
}

function getArchiveHelp(): string {
  return `*Archive Management Commands*\n\n` +
         `• \`/bm-admin archive list [days] [limit]\` - List archived tasks (default: last 20)\n` +
         `• \`/bm-admin archive restore <archive-id>\` - Restore archived task to main table\n` +
         `• \`/bm-admin archive delete <archive-id>\` - Permanently delete archive\n` +
         `• \`/bm-admin archive stats\` - Show archive statistics\n\n` +
         `*Examples:*\n` +
         `• \`archive list\` - Show last 20 archived tasks\n` +
         `• \`archive list 7\` - Show archives from last 7 days\n` +
         `• \`archive list 30 50\` - Show 50 archives from last 30 days\n` +
         `• \`archive restore abc-123\` - Restore specific archive\n` +
         `• \`archive delete abc-123\` - Permanently delete archive`;
}