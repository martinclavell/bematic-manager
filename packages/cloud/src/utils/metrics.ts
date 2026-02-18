import { createLogger } from '@bematic/common';

const logger = createLogger('metrics');

/**
 * Simple in-memory metrics collector
 * For production, this could be replaced with Prometheus, StatsD, etc.
 */
export class MetricsCollector {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private startTime = Date.now();

  /**
   * Increment a counter
   */
  increment(name: string, value: number = 1, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  /**
   * Decrement a counter
   */
  decrement(name: string, value: number = 1, tags?: Record<string, string>): void {
    this.increment(name, -value, tags);
  }

  /**
   * Set a gauge value
   */
  gauge(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags);
    this.gauges.set(key, value);
  }

  /**
   * Record a histogram value (for latency, duration, etc.)
   */
  histogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.buildKey(name, tags);
    const values = this.histograms.get(key) || [];
    values.push(value);

    // Keep only last 1000 values to prevent memory growth
    if (values.length > 1000) {
      values.shift();
    }

    this.histograms.set(key, values);
  }

  /**
   * Get all metrics in a structured format
   */
  getMetrics(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, { count: number; min: number; max: number; avg: number; p50: number; p95: number; p99: number }>;
    uptime: number;
  } {
    const counters: Record<string, number> = {};
    for (const [key, value] of this.counters) {
      counters[key] = value;
    }

    const gauges: Record<string, number> = {};
    for (const [key, value] of this.gauges) {
      gauges[key] = value;
    }

    const histograms: Record<string, any> = {};
    for (const [key, values] of this.histograms) {
      if (values.length === 0) {
        continue;
      }

      const sorted = [...values].sort((a, b) => a - b);
      const count = sorted.length;
      const sum = sorted.reduce((acc, v) => acc + v, 0);

      histograms[key] = {
        count,
        min: sorted[0],
        max: sorted[count - 1],
        avg: sum / count,
        p50: sorted[Math.floor(count * 0.5)],
        p95: sorted[Math.floor(count * 0.95)],
        p99: sorted[Math.floor(count * 0.99)],
      };
    }

    return {
      counters,
      gauges,
      histograms,
      uptime: Date.now() - this.startTime,
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.startTime = Date.now();
    logger.info('Metrics reset');
  }

  /**
   * Get counter value
   */
  getCounter(name: string, tags?: Record<string, string>): number {
    const key = this.buildKey(name, tags);
    return this.counters.get(key) || 0;
  }

  /**
   * Get gauge value
   */
  getGauge(name: string, tags?: Record<string, string>): number | undefined {
    const key = this.buildKey(name, tags);
    return this.gauges.get(key);
  }

  private buildKey(name: string, tags?: Record<string, string>): string {
    if (!tags || Object.keys(tags).length === 0) {
      return name;
    }

    const tagString = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join(',');

    return `${name}{${tagString}}`;
  }
}

// Global singleton instance
export const metrics = new MetricsCollector();

/**
 * Common metric names
 */
export const MetricNames = {
  // Task metrics
  TASKS_SUBMITTED: 'tasks.submitted',
  TASKS_COMPLETED: 'tasks.completed',
  TASKS_FAILED: 'tasks.failed',
  TASKS_CANCELLED: 'tasks.cancelled',
  TASK_DURATION: 'task.duration_ms',
  TASK_COST: 'task.cost_usd',
  TASK_TOKENS: 'task.tokens',

  // Agent metrics
  AGENTS_CONNECTED: 'agents.connected',
  AGENTS_DISCONNECTED: 'agents.disconnected',
  AGENT_HEARTBEAT_LATENCY: 'agent.heartbeat_latency_ms',

  // Slack metrics
  SLACK_MESSAGES_SENT: 'slack.messages.sent',
  SLACK_MESSAGES_FAILED: 'slack.messages.failed',
  SLACK_API_LATENCY: 'slack.api_latency_ms',

  // WebSocket metrics
  WS_MESSAGES_RECEIVED: 'ws.messages.received',
  WS_MESSAGES_SENT: 'ws.messages.sent',
  WS_CONNECTIONS: 'ws.connections',

  // System metrics
  ACTIVE_TASKS: 'system.active_tasks',
  QUEUE_SIZE: 'system.queue_size',
  OFFLINE_QUEUE_SIZE: 'system.offline_queue_size',
} as const;
