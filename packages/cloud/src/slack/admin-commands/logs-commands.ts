import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('admin:logs-commands');

type RespondFn = (message: string) => Promise<void>;

/**
 * Prompt history and logs commands
 * - logs
 * - logs --stats
 * - logs --category/--status/--tag/--search
 */
export class LogsCommands {
  constructor(private readonly ctx: AppContext) {}

  async logs(args: string[], respond: RespondFn): Promise<void> {
    const limit = parseInt(args[1] || '20', 10);
    const category = args.find((a, i) => args[i - 1] === '--category');
    const status = args.find((a, i) => args[i - 1] === '--status');
    const tag = args.find((a, i) => args[i - 1] === '--tag');
    const searchText = args.find((a, i) => args[i - 1] === '--search');

    // Show stats if requested
    if (args.includes('--stats')) {
      await this.showStats(respond);
      return;
    }

    // Fetch prompts
    const prompts = this.ctx.promptHistoryRepo.findAll({
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
      const ago = this.formatDuration(Date.now() - timestamp.getTime());

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
  }

  private async showStats(respond: RespondFn): Promise<void> {
    const stats = this.ctx.promptHistoryRepo.getStats();
    await respond(
      ':bar_chart: *Prompt History Statistics*\n' +
      `> Total: ${stats.total}\n` +
      `> :white_check_mark: Completed: ${stats.completed}\n` +
      `> :hourglass_flowing_sand: Pending: ${stats.pending}\n` +
      `> :x: Failed: ${stats.failed}\n` +
      `> :no_entry_sign: Cancelled: ${stats.cancelled}\n` +
      (stats.averageDuration ? `> :stopwatch: Avg Duration: ${stats.averageDuration}m` : ''),
    );
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
