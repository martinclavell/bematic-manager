import type { SlackCommandContext } from '../types.js';
import { metrics, MetricsCollector } from '../../utils/metrics.js';
import { createLogger } from '@bematic/common';

const logger = createLogger('admin-metrics');

export async function handleMetricsCommand(
  context: SlackCommandContext,
  metricsCollector: MetricsCollector,
): Promise<string> {
  const { args } = context;

  if (args.length === 0) {
    return getMetricsHelp();
  }

  const subCommand = args[0];

  try {
    switch (subCommand) {
      case 'show':
      case 'current':
        return await handleShowMetrics(metricsCollector);
      case 'reset':
        return await handleResetMetrics(metricsCollector);
      case 'export':
        return await handleExportMetrics(metricsCollector);
      case 'top':
        return await handleTopMetrics(args.slice(1), metricsCollector);
      case 'summary':
        return await handleMetricsSummary(args.slice(1), metricsCollector);
      default:
        return `Unknown metrics command: \`${subCommand}\`\n\n${getMetricsHelp()}`;
    }
  } catch (error) {
    logger.error({ error, command: subCommand, args }, 'Metrics command failed');
    return `Error executing metrics command: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

async function handleShowMetrics(metricsCollector: MetricsCollector): Promise<string> {
  const allMetrics = metricsCollector.getMetrics();

  let response = `*Current Metrics*\n\n`;
  response += `*System Uptime*: ${formatDuration(allMetrics.uptime)}\n\n`;

  // Counters
  if (Object.keys(allMetrics.counters).length > 0) {
    response += `*📊 Counters*:\n`;
    const sortedCounters = Object.entries(allMetrics.counters)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15); // Show top 15

    for (const [name, value] of sortedCounters) {
      response += `• ${name}: ${value.toLocaleString()}\n`;
    }
    response += `\n`;
  }

  // Gauges
  if (Object.keys(allMetrics.gauges).length > 0) {
    response += `*📈 Gauges*:\n`;
    const sortedGauges = Object.entries(allMetrics.gauges)
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [name, value] of sortedGauges) {
      response += `• ${name}: ${value.toLocaleString()}\n`;
    }
    response += `\n`;
  }

  // Histograms (show key stats)
  if (Object.keys(allMetrics.histograms).length > 0) {
    response += `*📊 Performance Metrics (Histograms)*:\n`;
    const sortedHistograms = Object.entries(allMetrics.histograms)
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [name, stats] of sortedHistograms) {
      response += `• *${name}*:\n`;
      response += `  Count: ${stats.count} | Avg: ${stats.avg.toFixed(1)}ms\n`;
      response += `  P50: ${stats.p50}ms | P95: ${stats.p95}ms | P99: ${stats.p99}ms\n`;
    }
  }

  if (Object.keys(allMetrics.counters).length === 0 &&
      Object.keys(allMetrics.gauges).length === 0 &&
      Object.keys(allMetrics.histograms).length === 0) {
    response += `No metrics data available yet.`;
  }

  return response;
}

async function handleResetMetrics(metricsCollector: MetricsCollector): Promise<string> {
  metricsCollector.reset();
  return `✅ All metrics have been reset.\n\nMetric collection will continue from now.`;
}

async function handleExportMetrics(metricsCollector: MetricsCollector): Promise<string> {
  const allMetrics = metricsCollector.getMetrics();

  // Create a condensed JSON export
  const exportData = {
    timestamp: new Date().toISOString(),
    uptime: allMetrics.uptime,
    summary: {
      totalCounters: Object.keys(allMetrics.counters).length,
      totalGauges: Object.keys(allMetrics.gauges).length,
      totalHistograms: Object.keys(allMetrics.histograms).length,
    },
    topCounters: Object.entries(allMetrics.counters)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, value]) => ({ name, value })),
    gauges: allMetrics.gauges,
    histogramStats: Object.entries(allMetrics.histograms)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        avg: Math.round(stats.avg * 100) / 100,
        p95: stats.p95,
        p99: stats.p99
      }))
  };

  const jsonString = JSON.stringify(exportData, null, 2);

  // If JSON is too long for Slack, provide a summary instead
  if (jsonString.length > 2500) {
    return `*Metrics Export Summary* (${new Date().toISOString()})\n\n` +
           `📊 **Statistics:**\n` +
           `• Counters: ${exportData.summary.totalCounters}\n` +
           `• Gauges: ${exportData.summary.totalGauges}\n` +
           `• Histograms: ${exportData.summary.totalHistograms}\n` +
           `• Uptime: ${formatDuration(allMetrics.uptime)}\n\n` +
           `**Top Counters:**\n` +
           exportData.topCounters.slice(0, 5)
             .map(c => `• ${c.name}: ${c.value.toLocaleString()}`)
             .join('\n') +
           `\n\n_Full export too large for Slack. Use API endpoint for complete data._`;
  }

  return `*Metrics Export*\n\`\`\`json\n${jsonString}\n\`\`\``;
}

async function handleTopMetrics(args: string[], metricsCollector: MetricsCollector): Promise<string> {
  const limit = args.length > 0 ? parseInt(args[0], 10) : 10;

  if (isNaN(limit) || limit < 1 || limit > 50) {
    return 'Invalid limit. Usage: `metrics top [limit]` (1-50)';
  }

  const allMetrics = metricsCollector.getMetrics();

  let response = `*Top ${limit} Metrics*\n\n`;

  // Top counters
  const topCounters = Object.entries(allMetrics.counters)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);

  if (topCounters.length > 0) {
    response += `*📊 Top Counters*:\n`;
    topCounters.forEach(([name, value], i) => {
      const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`;
      response += `${medal} ${name}: ${value.toLocaleString()}\n`;
    });
    response += `\n`;
  }

  // Slowest operations (from histograms)
  const slowestOps = Object.entries(allMetrics.histograms)
    .map(([name, stats]) => ({ name, avgDuration: stats.avg }))
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, Math.min(limit, 5));

  if (slowestOps.length > 0) {
    response += `*🐌 Slowest Operations (Avg Duration)*:\n`;
    slowestOps.forEach(({ name, avgDuration }, i) => {
      const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`;
      response += `${medal} ${name}: ${avgDuration.toFixed(1)}ms\n`;
    });
  }

  return response;
}

async function handleMetricsSummary(args: string[], metricsCollector: MetricsCollector): Promise<string> {
  const allMetrics = metricsCollector.getMetrics();

  // Calculate key performance indicators
  const taskMetrics = {
    submitted: allMetrics.counters['tasks.submitted'] || 0,
    completed: allMetrics.counters['tasks.completed'] || 0,
    failed: allMetrics.counters['tasks.failed'] || 0,
    cancelled: allMetrics.counters['tasks.cancelled'] || 0,
  };

  const wsMetrics = {
    connectionsTotal: allMetrics.counters['ws.connections.total'] || 0,
    messagesReceived: allMetrics.counters['ws.messages.received'] || 0,
    messagesSent: allMetrics.counters['ws.messages.sent'] || 0,
    authFailed: allMetrics.counters['ws.auth.failed'] || 0,
  };

  const slackMetrics = {
    messagesSent: allMetrics.counters['slack.messages.sent'] || 0,
    messagesFailed: allMetrics.counters['slack.messages.failed'] || 0,
  };

  const dbMetrics = {
    queriesTotal: allMetrics.counters['db.queries.total'] || 0,
    queriesErrors: allMetrics.counters['db.queries.errors'] || 0,
    slowQueries: allMetrics.counters['db.queries.slow'] || 0,
  };

  // Calculate rates and percentages
  const taskTotal = taskMetrics.submitted;
  const taskSuccessRate = taskTotal > 0 ? (taskMetrics.completed / taskTotal * 100).toFixed(1) : '0';
  const taskFailureRate = taskTotal > 0 ? (taskMetrics.failed / taskTotal * 100).toFixed(1) : '0';

  const slackTotal = slackMetrics.messagesSent + slackMetrics.messagesFailed;
  const slackSuccessRate = slackTotal > 0 ? (slackMetrics.messagesSent / slackTotal * 100).toFixed(1) : '100';

  const dbErrorRate = dbMetrics.queriesTotal > 0 ? (dbMetrics.queriesErrors / dbMetrics.queriesTotal * 100).toFixed(1) : '0';
  const dbSlowRate = dbMetrics.queriesTotal > 0 ? (dbMetrics.slowQueries / dbMetrics.queriesTotal * 100).toFixed(1) : '0';

  let response = `*System Performance Summary*\n\n`;
  response += `*⏱️ Uptime*: ${formatDuration(allMetrics.uptime)}\n\n`;

  response += `*📋 Task Performance*:\n`;
  response += `• Total Submitted: ${taskTotal.toLocaleString()}\n`;
  response += `• Success Rate: ${taskSuccessRate}% (${taskMetrics.completed.toLocaleString()} completed)\n`;
  response += `• Failure Rate: ${taskFailureRate}% (${taskMetrics.failed.toLocaleString()} failed)\n`;
  response += `• Cancelled: ${taskMetrics.cancelled.toLocaleString()}\n\n`;

  response += `*🔌 WebSocket Performance*:\n`;
  response += `• Total Connections: ${wsMetrics.connectionsTotal.toLocaleString()}\n`;
  response += `• Messages: ${wsMetrics.messagesReceived.toLocaleString()} in, ${wsMetrics.messagesSent.toLocaleString()} out\n`;
  response += `• Auth Failures: ${wsMetrics.authFailed.toLocaleString()}\n\n`;

  response += `*💬 Slack Performance*:\n`;
  response += `• Success Rate: ${slackSuccessRate}%\n`;
  response += `• Messages Sent: ${slackMetrics.messagesSent.toLocaleString()}\n`;
  response += `• Failures: ${slackMetrics.messagesFailed.toLocaleString()}\n\n`;

  response += `*🗄️ Database Performance*:\n`;
  response += `• Total Queries: ${dbMetrics.queriesTotal.toLocaleString()}\n`;
  response += `• Error Rate: ${dbErrorRate}%\n`;
  response += `• Slow Queries: ${dbSlowRate}% (>${500}ms)\n`;

  // Add performance trends from histograms
  const taskDurationHist = allMetrics.histograms['task.duration_ms'];
  if (taskDurationHist && taskDurationHist.count > 0) {
    response += `\n*⚡ Task Duration*:\n`;
    response += `• Average: ${formatDuration(taskDurationHist.avg)}\n`;
    response += `• P95: ${formatDuration(taskDurationHist.p95)}\n`;
  }

  return response;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  }

  const hours = minutes / 60;
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }

  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

function getMetricsHelp(): string {
  return `*Metrics Management Commands*\n\n` +
         `• \`/bm-admin metrics show\` - Display current metrics\n` +
         `• \`/bm-admin metrics summary\` - Show performance summary\n` +
         `• \`/bm-admin metrics top [limit]\` - Show top metrics (default: 10)\n` +
         `• \`/bm-admin metrics reset\` - Reset all metrics\n` +
         `• \`/bm-admin metrics export\` - Export metrics as JSON\n\n` +
         `*Examples:*\n` +
         `• \`metrics show\` - Display all current metrics\n` +
         `• \`metrics summary\` - Quick performance overview\n` +
         `• \`metrics top 5\` - Show top 5 counters and slowest operations\n` +
         `• \`metrics reset\` - Clear all metrics and start fresh`;
}