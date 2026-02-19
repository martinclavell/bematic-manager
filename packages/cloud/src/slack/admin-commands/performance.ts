import type { App } from '@slack/bolt';
import type { AppContext } from '../../context.js';
import {
  Permission,
  createLogger,
  performanceMonitor,
  globalCache,
  projectCache,
  agentCache,
  userCache,
} from '@bematic/common';

const logger = createLogger('admin:performance');

export function registerPerformanceCommands(app: App, ctx: AppContext) {
  // Performance metrics command
  app.command('/performance-metrics', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_VIEW);

      // Update cache metrics
      performanceMonitor.updateCacheMetrics({
        global: globalCache,
        project: projectCache,
        agent: agentCache,
        user: userCache,
      });

      const metrics = performanceMonitor.getMetrics();

      const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms.toFixed(0)}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
      };

      const formatMemory = (bytes: number) => {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
      };

      const formatPercent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

      const response = `:chart_with_upwards_trend: **Performance Metrics**\n\n` +
        `**File Operations:**\n` +
        `• Total: ${metrics.fileOperations.totalCount}\n` +
        `• Average Duration: ${formatDuration(metrics.fileOperations.averageDuration)}\n` +
        `• Error Rate: ${formatPercent(metrics.fileOperations.errorRate)}\n\n` +
        `**Cache Performance:**\n` +
        `• Entries: ${metrics.cache.entriesCount}\n` +
        `• Hit Rate: ${formatPercent(metrics.cache.hitRate)}\n` +
        `• Memory Usage: ${formatMemory(metrics.cache.memoryUsage)}\n\n` +
        `**Database Queries:**\n` +
        `• Total: ${metrics.database.totalQueries}\n` +
        `• Average Duration: ${formatDuration(metrics.database.averageDuration)}\n` +
        `• Slow Queries: ${metrics.database.slowQueries}\n\n` +
        `**WebSocket:**\n` +
        `• Messages/sec: ${metrics.websocket.messagesPerSecond.toFixed(2)}\n` +
        `• Active Connections: ${ctx.agentManager.getConnectedAgentIds().length}\n` +
        `• Error Count: ${metrics.websocket.errorCount}\n\n` +
        `**Agent Tasks:**\n` +
        `• Total Online: ${ctx.agentManager.getConnectedAgentIds().length}\n` +
        `• Average Duration: ${formatDuration(metrics.agents.averageTaskDuration)}\n` +
        `• Completion Rate: ${formatPercent(metrics.agents.taskCompletionRate)}`;

      await respond({
        text: response,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Performance metrics command failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to get performance metrics'}`,
        response_type: 'ephemeral',
      });
    }
  });

  // Performance summary command
  app.command('/performance-summary', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_VIEW);

      const minutes = parseInt(command.text?.trim() || '5', 10) || 5;
      const summary = performanceMonitor.getSummary(minutes);

      const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms.toFixed(0)}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
      };

      const formatPercent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

      let response = `:stopwatch: **Performance Summary** (${summary.timeRange})\n\n` +
        `• Total Events: ${summary.totalEvents}\n` +
        `• Error Rate: ${formatPercent(summary.errorRate)}\n` +
        `• Average Response Time: ${formatDuration(summary.averageResponseTime)}\n` +
        `• Slow Operations: ${summary.slowOperations}\n`;

      if (summary.topOperations.length > 0) {
        response += `\n**Top Operations:**\n`;
        for (const op of summary.topOperations.slice(0, 5)) {
          response += `• ${op.operation}: ${op.count}x (avg: ${formatDuration(op.avgDuration)})\n`;
        }
      }

      await respond({
        text: response,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Performance summary command failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to get performance summary'}`,
        response_type: 'ephemeral',
      });
    }
  });

  // Performance events command
  app.command('/performance-events', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_VIEW);

      const args = command.text?.trim().split(' ') || [];
      const type = args[0] as any || undefined;
      const limit = parseInt(args[1] || '10', 10) || 10;

      const validTypes = ['file_operation', 'cache_access', 'db_query', 'websocket_message', 'task_execution'];
      if (type && !validTypes.includes(type)) {
        await respond({
          text: `:warning: Invalid event type. Valid types: ${validTypes.join(', ')}`,
          response_type: 'ephemeral',
        });
        return;
      }

      const events = performanceMonitor.getEvents(type, Math.min(limit, 20));

      if (events.length === 0) {
        await respond({
          text: `:inbox_tray: No recent events found${type ? ` for type '${type}'` : ''}`,
          response_type: 'ephemeral',
        });
        return;
      }

      const formatDuration = (ms: number) => {
        if (ms < 1000) return `${ms.toFixed(0)}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
      };

      const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
      };

      let response = `:gear: **Recent Performance Events**${type ? ` (${type})` : ''}\n\n`;

      for (const event of events.slice(-10)) {
        const icon = event.success ? ':white_check_mark:' : ':x:';
        const duration = formatDuration(event.duration);
        const time = formatTime(event.timestamp);

        response += `${icon} ${time} | ${event.type}:${event.operation} | ${duration}\n`;

        if (event.metadata && Object.keys(event.metadata).length > 0) {
          const metadata = Object.entries(event.metadata)
            .slice(0, 2)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          response += `  -> ${metadata}\n`;
        }
      }

      if (events.length > 10) {
        response += `\n_Showing last 10 of ${events.length} events_`;
      }

      await respond({
        text: response,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Performance events command failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to get performance events'}`,
        response_type: 'ephemeral',
      });
    }
  });

  // Reset performance metrics command
  app.command('/performance-reset', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_MANAGE);

      const eventCount = performanceMonitor.getEvents().length;
      performanceMonitor.clear();

      logger.info({ userId: command.user_id, eventCount }, 'Performance metrics reset');

      await respond({
        text: `:boom: Performance metrics reset. Cleared ${eventCount} events and all statistics.`,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Performance reset command failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to reset performance metrics'}`,
        response_type: 'ephemeral',
      });
    }
  });
}
