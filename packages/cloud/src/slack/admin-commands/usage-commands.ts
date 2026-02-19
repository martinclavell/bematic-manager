import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';
import { sql } from 'drizzle-orm';
import { sessions, tasks } from '@bematic/db';

const logger = createLogger('admin:usage-commands');

type RespondFn = (message: string) => Promise<void>;

interface UsageStats {
  totalTasks: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  completedTasks: number;
  failedTasks: number;
  modelBreakdown: Record<string, { count: number; tokens: number; cost: number }>;
}

interface UsageByEntity {
  entity: string;
  tasks: number;
  tokens: number;
  cost: number;
}

/**
 * Usage tracking and budget management commands
 * - usage (overview dashboard)
 * - usage today
 * - usage week
 * - usage month
 * - usage by-bot
 * - usage by-project
 * - usage set-budget <amount>
 */
export class UsageCommands {
  constructor(private readonly ctx: AppContext) {}

  async usage(args: string[], respond: RespondFn): Promise<void> {
    const subcommand = args[0]?.toLowerCase();

    try {
      switch (subcommand) {
        case 'today':
          await this.usageToday(respond);
          break;
        case 'week':
          await this.usageWeek(respond);
          break;
        case 'month':
          await this.usageMonth(respond);
          break;
        case 'by-bot':
          await this.usageByBot(respond);
          break;
        case 'by-project':
          await this.usageByProject(respond);
          break;
        case 'set-budget':
          await this.setMonthlyBudget(args.slice(1), respond);
          break;
        default:
          await this.usageOverview(respond);
          break;
      }
    } catch (error) {
      logger.error({ error, args }, 'Usage command failed');
      await respond(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async usageOverview(respond: RespondFn): Promise<void> {
    const allTimeStats = this.getUsageStats();
    const monthStats = this.getUsageStats(this.getMonthStart());
    const weekStats = this.getUsageStats(this.getWeekStart());
    const todayStats = this.getUsageStats(this.getTodayStart());

    let response = ':bar_chart: *Claude API Usage Overview*\n\n';

    // Today
    response += `*Today:*\n`;
    response += `• Tasks: ${todayStats.completedTasks} completed, ${todayStats.failedTasks} failed\n`;
    response += `• Tokens: ${this.formatNumber(todayStats.totalTokens)} (${this.formatNumber(todayStats.totalInputTokens)} in, ${this.formatNumber(todayStats.totalOutputTokens)} out)\n`;
    response += `• Cost: $${todayStats.totalCost.toFixed(4)}\n\n`;

    // This Week
    response += `*This Week:*\n`;
    response += `• Tasks: ${weekStats.completedTasks} completed, ${weekStats.failedTasks} failed\n`;
    response += `• Tokens: ${this.formatNumber(weekStats.totalTokens)}\n`;
    response += `• Cost: $${weekStats.totalCost.toFixed(4)}\n\n`;

    // This Month
    response += `*This Month:*\n`;
    response += `• Tasks: ${monthStats.completedTasks} completed, ${monthStats.failedTasks} failed\n`;
    response += `• Tokens: ${this.formatNumber(monthStats.totalTokens)}\n`;
    response += `• Cost: $${monthStats.totalCost.toFixed(2)}\n\n`;

    // All Time
    response += `*All Time:*\n`;
    response += `• Total Tasks: ${allTimeStats.totalTasks}\n`;
    response += `• Total Tokens: ${this.formatNumber(allTimeStats.totalTokens)}\n`;
    response += `• Total Cost: $${allTimeStats.totalCost.toFixed(2)}\n\n`;

    // Model breakdown for this month
    if (Object.keys(monthStats.modelBreakdown).length > 0) {
      response += `*Model Usage (This Month):*\n`;
      for (const [model, stats] of Object.entries(monthStats.modelBreakdown)) {
        const modelName = this.formatModelName(model);
        response += `• ${modelName}: ${stats.count} tasks, $${stats.cost.toFixed(2)}\n`;
      }
      response += `\n`;
    }

    // Quick commands
    response += `*Commands:*\n`;
    response += `• \`/bm-admin usage today\` - Today's usage\n`;
    response += `• \`/bm-admin usage week\` - This week\n`;
    response += `• \`/bm-admin usage month\` - This month\n`;
    response += `• \`/bm-admin usage by-bot\` - Usage by bot\n`;
    response += `• \`/bm-admin usage by-project\` - Usage by project\n\n`;

    // Link to Claude.ai usage page
    response += `:link: <https://claude.ai/settings/usage|View Claude.ai Web UI Usage>`;

    await respond(response);
  }

  private async usageToday(respond: RespondFn): Promise<void> {
    const stats = this.getUsageStats(this.getTodayStart());
    await this.sendPeriodUsage('Today', stats, respond);
  }

  private async usageWeek(respond: RespondFn): Promise<void> {
    const stats = this.getUsageStats(this.getWeekStart());
    await this.sendPeriodUsage('This Week', stats, respond);
  }

  private async usageMonth(respond: RespondFn): Promise<void> {
    const stats = this.getUsageStats(this.getMonthStart());
    await this.sendPeriodUsage('This Month', stats, respond);
  }

  private async sendPeriodUsage(
    period: string,
    stats: UsageStats,
    respond: RespondFn,
  ): Promise<void> {
    let response = `:bar_chart: *Usage - ${period}*\n\n`;

    response += `*Summary:*\n`;
    response += `• Completed Tasks: ${stats.completedTasks}\n`;
    response += `• Failed Tasks: ${stats.failedTasks}\n`;
    response += `• Success Rate: ${this.calculateSuccessRate(stats)}%\n`;
    response += `• Total Tokens: ${this.formatNumber(stats.totalTokens)}\n`;
    response += `  - Input: ${this.formatNumber(stats.totalInputTokens)}\n`;
    response += `  - Output: ${this.formatNumber(stats.totalOutputTokens)}\n`;
    response += `• Estimated Cost: $${stats.totalCost.toFixed(4)}\n\n`;

    if (Object.keys(stats.modelBreakdown).length > 0) {
      response += `*Model Breakdown:*\n`;
      const sorted = Object.entries(stats.modelBreakdown)
        .sort(([, a], [, b]) => b.cost - a.cost);

      for (const [model, data] of sorted) {
        const modelName = this.formatModelName(model);
        const avgTokens = data.count > 0 ? Math.round(data.tokens / data.count) : 0;
        response += `• *${modelName}*:\n`;
        response += `  Tasks: ${data.count} | Tokens: ${this.formatNumber(data.tokens)} (avg ${this.formatNumber(avgTokens)}) | Cost: $${data.cost.toFixed(4)}\n`;
      }
    }

    await respond(response);
  }

  private async usageByBot(respond: RespondFn): Promise<void> {
    const db = this.ctx.db;

    const result = db
      .select({
        botType: tasks.botName,
        taskCount: sql<number>`count(distinct ${tasks.id})`,
        totalTokens: sql<number>`sum(${sessions.inputTokens} + ${sessions.outputTokens})`,
        totalCost: sql<number>`sum(${sessions.estimatedCost})`,
      })
      .from(sessions)
      .innerJoin(tasks, sql`${tasks.id} = ${sessions.taskId}`)
      .where(sql`${sessions.status} = 'completed'`)
      .groupBy(tasks.botName)
      .all();

    if (result.length === 0) {
      await respond(':information_source: No usage data available yet.');
      return;
    }

    let response = ':robot_face: *Usage by Bot*\n\n';

    const sorted = result.sort((a: typeof result[0], b: typeof result[0]) => (b.totalCost || 0) - (a.totalCost || 0));

    for (const row of sorted) {
      const botName = this.formatBotName(row.botType || 'unknown');
      response += `*${botName}*:\n`;
      response += `• Tasks: ${row.taskCount || 0}\n`;
      response += `• Tokens: ${this.formatNumber(row.totalTokens || 0)}\n`;
      response += `• Cost: $${(row.totalCost || 0).toFixed(4)}\n\n`;
    }

    await respond(response);
  }

  private async usageByProject(respond: RespondFn): Promise<void> {
    const db = this.ctx.db;

    const result = db
      .select({
        projectId: tasks.projectId,
        taskCount: sql<number>`count(distinct ${tasks.id})`,
        totalTokens: sql<number>`sum(${sessions.inputTokens} + ${sessions.outputTokens})`,
        totalCost: sql<number>`sum(${sessions.estimatedCost})`,
      })
      .from(sessions)
      .innerJoin(tasks, sql`${tasks.id} = ${sessions.taskId}`)
      .where(sql`${sessions.status} = 'completed'`)
      .groupBy(tasks.projectId)
      .all();

    if (result.length === 0) {
      await respond(':information_source: No usage data available yet.');
      return;
    }

    let response = ':file_folder: *Usage by Project*\n\n';

    const sorted = result.sort((a: typeof result[0], b: typeof result[0]) => (b.totalCost || 0) - (a.totalCost || 0));

    for (const row of sorted) {
      const projectName = row.projectId || 'unknown';
      response += `*${projectName}*:\n`;
      response += `• Tasks: ${row.taskCount || 0}\n`;
      response += `• Tokens: ${this.formatNumber(row.totalTokens || 0)}\n`;
      response += `• Cost: $${(row.totalCost || 0).toFixed(4)}\n\n`;
    }

    await respond(response);
  }

  private async setMonthlyBudget(args: string[], respond: RespondFn): Promise<void> {
    if (args.length === 0) {
      await respond(
        ':information_source: Usage: `/bm-admin usage set-budget <amount>`\n' +
        'Example: `/bm-admin usage set-budget 100` (sets $100/month budget)',
      );
      return;
    }

    const amount = parseFloat(args[0]);
    if (isNaN(amount) || amount <= 0) {
      await respond(':x: Invalid amount. Please provide a positive number.');
      return;
    }

    // TODO: Store budget in database (needs new table or config)
    // For now, just show a placeholder message
    await respond(
      `:white_check_mark: Monthly budget would be set to $${amount.toFixed(2)}\n\n` +
      '_Note: Budget tracking storage not yet implemented. This is a placeholder._',
    );
  }

  // Helper methods

  private getUsageStats(since?: Date): UsageStats {
    const db = this.ctx.db;

    let whereClause = sql`${sessions.status} = 'completed'`;
    if (since) {
      const sinceIso = since.toISOString();
      whereClause = sql`${sessions.status} = 'completed' AND ${sessions.createdAt} >= ${sinceIso}`;
    }

    // Get completed sessions with task data
    const completedSessions = db
      .select({
        inputTokens: sessions.inputTokens,
        outputTokens: sessions.outputTokens,
        estimatedCost: sessions.estimatedCost,
        model: sessions.model,
        taskId: sessions.taskId,
        taskStatus: tasks.status,
      })
      .from(sessions)
      .innerJoin(tasks, sql`${tasks.id} = ${sessions.taskId}`)
      .where(whereClause)
      .all();

    const stats: UsageStats = {
      totalTasks: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      completedTasks: 0,
      failedTasks: 0,
      modelBreakdown: {},
    };

    const uniqueTasks = new Set<string>();

    for (const row of completedSessions) {
      // Count unique tasks
      if (!uniqueTasks.has(row.taskId)) {
        uniqueTasks.add(row.taskId);
        stats.totalTasks++;
        if (row.taskStatus === 'completed') {
          stats.completedTasks++;
        } else if (row.taskStatus === 'failed') {
          stats.failedTasks++;
        }
      }

      // Accumulate tokens and cost
      stats.totalInputTokens += row.inputTokens || 0;
      stats.totalOutputTokens += row.outputTokens || 0;
      stats.totalTokens += (row.inputTokens || 0) + (row.outputTokens || 0);
      stats.totalCost += row.estimatedCost || 0;

      // Model breakdown
      const model = row.model || 'unknown';
      if (!stats.modelBreakdown[model]) {
        stats.modelBreakdown[model] = { count: 0, tokens: 0, cost: 0 };
      }
      stats.modelBreakdown[model].count++;
      stats.modelBreakdown[model].tokens += (row.inputTokens || 0) + (row.outputTokens || 0);
      stats.modelBreakdown[model].cost += row.estimatedCost || 0;
    }

    return stats;
  }

  private getTodayStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  }

  private getWeekStart(): Date {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday as start of week
    return new Date(now.getFullYear(), now.getMonth(), diff, 0, 0, 0, 0);
  }

  private getMonthStart(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  }

  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(2)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  }

  private formatModelName(model: string): string {
    // Simplify model names for display
    if (model.includes('sonnet')) return 'Sonnet 4.5';
    if (model.includes('opus')) return 'Opus 4';
    if (model.includes('haiku')) return 'Haiku';
    return model;
  }

  private formatBotName(botType: string): string {
    // Convert bot type to friendly name
    const mapping: Record<string, string> = {
      coder: 'Coder Bot',
      reviewer: 'Reviewer Bot',
      planner: 'Planner Bot',
      ops: 'Ops Bot',
      netsuite: 'NetSuite Bot',
    };
    return mapping[botType.toLowerCase()] || botType;
  }

  private calculateSuccessRate(stats: UsageStats): string {
    if (stats.totalTasks === 0) return '0.0';
    return ((stats.completedTasks / stats.totalTasks) * 100).toFixed(1);
  }
}
