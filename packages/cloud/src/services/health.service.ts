import { createLogger } from '@bematic/common';
import type { TaskRepository, ProjectRepository } from '@bematic/db';
import type { AgentManager } from '../gateway/agent-manager.js';
import type { AgentHealthTracker } from '../gateway/agent-health-tracker.js';
import type { NotificationService } from './notification.service.js';
import { metrics } from '../utils/metrics.js';

const logger = createLogger('health');

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  components: {
    database: { status: 'up' | 'down'; message?: string };
    agents: { status: 'up' | 'degraded' | 'down'; connected: number; unhealthy: number };
    slack: { status: 'up' | 'degraded' | 'down'; failedMessages: number };
  };
  metrics: {
    tasks: {
      active: number;
      totalSubmitted: number;
      totalCompleted: number;
      totalFailed: number;
    };
    agents: {
      connected: number;
      totalProjects: number;
    };
    performance: {
      avgTaskDurationMs?: number;
      avgSlackLatencyMs?: number;
    };
  };
}

export class HealthService {
  private startTime = Date.now();

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly agentManager: AgentManager,
    private readonly agentHealth: AgentHealthTracker,
    private readonly notifier: NotificationService,
  ) {}

  /**
   * Get comprehensive health status
   */
  async getHealth(): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();
    const uptime = Date.now() - this.startTime;

    // Check database health
    const dbHealth = this.checkDatabase();

    // Check agent health
    const agentHealth = this.checkAgents();

    // Check Slack health
    const slackHealth = this.checkSlack();

    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (
      dbHealth.status === 'down' ||
      agentHealth.status === 'down' ||
      slackHealth.status === 'down'
    ) {
      overallStatus = 'unhealthy';
    } else if (
      agentHealth.status === 'degraded' ||
      slackHealth.status === 'degraded'
    ) {
      overallStatus = 'degraded';
    }

    // Gather metrics
    const allMetrics = metrics.getMetrics();
    const activeTasks = this.taskRepo.findActiveByProjectId('').length; // Gets all active

    const health: HealthStatus = {
      status: overallStatus,
      timestamp,
      uptime,
      version: '1.0.0',
      components: {
        database: dbHealth,
        agents: agentHealth,
        slack: slackHealth,
      },
      metrics: {
        tasks: {
          active: activeTasks,
          totalSubmitted: metrics.getCounter('tasks.submitted') || 0,
          totalCompleted: metrics.getCounter('tasks.completed') || 0,
          totalFailed: metrics.getCounter('tasks.failed') || 0,
        },
        agents: {
          connected: this.agentManager.getConnectedAgentIds().length,
          totalProjects: this.projectRepo.findAll().length,
        },
        performance: {
          avgTaskDurationMs: allMetrics.histograms['task.duration_ms']?.avg,
          avgSlackLatencyMs: allMetrics.histograms['slack.api_latency_ms']?.avg,
        },
      },
    };

    // Log if unhealthy
    if (overallStatus !== 'healthy') {
      logger.warn({ health }, 'System health is degraded or unhealthy');
    }

    return health;
  }

  /**
   * Get simple health check (for Railway health endpoint)
   */
  async getSimpleHealth(): Promise<{ status: 'ok' | 'error'; agents: number; uptime: number }> {
    try {
      // Quick health check - just verify basic connectivity
      const agentCount = this.agentManager.getConnectedAgentIds().length;
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);

      return {
        status: 'ok',
        agents: agentCount,
        uptime,
      };
    } catch (err) {
      logger.error({ err }, 'Health check failed');
      return {
        status: 'error',
        agents: 0,
        uptime: 0,
      };
    }
  }

  private checkDatabase(): { status: 'up' | 'down'; message?: string } {
    try {
      // Simple check - try to query
      this.projectRepo.findAll();
      return { status: 'up' };
    } catch (err) {
      logger.error({ err }, 'Database health check failed');
      return {
        status: 'down',
        message: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  private checkAgents(): { status: 'up' | 'degraded' | 'down'; connected: number; unhealthy: number } {
    const connected = this.agentManager.getConnectedAgentIds().length;
    const unhealthy = this.agentHealth.getUnhealthyAgents().length;

    if (connected === 0) {
      return { status: 'down', connected, unhealthy };
    }

    if (unhealthy > 0 || unhealthy / connected > 0.3) {
      // More than 30% unhealthy
      return { status: 'degraded', connected, unhealthy };
    }

    return { status: 'up', connected, unhealthy };
  }

  private checkSlack(): { status: 'up' | 'degraded' | 'down'; failedMessages: number } {
    const failedMessages = this.notifier.getFailedCount();

    if (failedMessages > 100) {
      return { status: 'down', failedMessages };
    }

    if (failedMessages > 10) {
      return { status: 'degraded', failedMessages };
    }

    return { status: 'up', failedMessages };
  }
}
