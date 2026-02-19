import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';
import type { NotificationService } from '../../services/notification.service.js';

const logger = createLogger('admin:health-commands');

type RespondFn = (message: string) => Promise<void>;

/**
 * System health and metrics commands
 * - health
 * - metrics
 */
export class HealthCommands {
  constructor(private readonly ctx: AppContext) {}

  async health(respond: RespondFn, channelId: string, notifier: NotificationService): Promise<void> {
    await respond(':heart: Fetching system health...');

    const health = await this.ctx.healthService.getHealth();

    const statusEmoji =
      health.status === 'healthy' ? ':large_green_circle:' :
      health.status === 'degraded' ? ':large_yellow_circle:' :
      ':red_circle:';

    let response = `${statusEmoji} *System Health: ${health.status.toUpperCase()}*\n\n`;

    // Components
    response += '*Components:*\n';
    response += `Database: ${health.components.database.status === 'up' ? ':white_check_mark:' : ':x:'}\n`;
    response += `Agents: ${health.components.agents.connected} connected, ${health.components.agents.unhealthy} unhealthy\n`;
    response += `Slack: ${health.components.slack.failedMessages} failed messages\n\n`;

    // Metrics
    response += '*Metrics:*\n';
    response += `Active Tasks: ${health.metrics.tasks.active}\n`;
    response += `Total Completed: ${health.metrics.tasks.totalCompleted}\n`;
    response += `Total Failed: ${health.metrics.tasks.totalFailed}\n`;

    if (health.metrics.performance.avgTaskDurationMs) {
      const avgSeconds = (health.metrics.performance.avgTaskDurationMs / 1000).toFixed(1);
      response += `Avg Task Duration: ${avgSeconds}s\n`;
    }

    response += `\nUptime: ${this.formatDuration(health.uptime)}`;

    await notifier.postMessage(channelId, response);
  }

  async metrics(respond: RespondFn, channelId: string, notifier: NotificationService): Promise<void> {
    await respond(':bar_chart: Fetching system metrics...');

    const health = await this.ctx.healthService.getHealth();

    let response = ':bar_chart: *System Metrics*\n\n';

    response += '*Tasks:*\n';
    response += `• Active: ${health.metrics.tasks.active}\n`;
    response += `• Submitted: ${health.metrics.tasks.totalSubmitted}\n`;
    response += `• Completed: ${health.metrics.tasks.totalCompleted}\n`;
    response += `• Failed: ${health.metrics.tasks.totalFailed}\n`;

    const successRate = health.metrics.tasks.totalSubmitted > 0
      ? ((health.metrics.tasks.totalCompleted / health.metrics.tasks.totalSubmitted) * 100).toFixed(1)
      : '0';
    response += `• Success Rate: ${successRate}%\n\n`;

    response += '*Agents:*\n';
    response += `• Connected: ${health.metrics.agents.connected}\n`;
    response += `• Total Projects: ${health.metrics.agents.totalProjects}\n\n`;

    if (health.metrics.performance.avgTaskDurationMs) {
      response += '*Performance:*\n';
      response += `• Avg Task Duration: ${(health.metrics.performance.avgTaskDurationMs / 1000).toFixed(1)}s\n`;
      if (health.metrics.performance.avgSlackLatencyMs) {
        response += `• Avg Slack Latency: ${health.metrics.performance.avgSlackLatencyMs.toFixed(0)}ms\n`;
      }
    }

    await notifier.postMessage(channelId, response);
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
