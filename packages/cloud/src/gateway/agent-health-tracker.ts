import { createLogger } from '@bematic/common';
import { CircuitBreakerManager, CircuitState } from './circuit-breaker.js';

const logger = createLogger('agent-health');

export interface AgentHealthStatus {
  agentId: string;
  isHealthy: boolean;
  circuitState: CircuitState;
  failureRate: number;
  totalTasks: number;
  lastStateChange: Date;
}

/**
 * Tracks agent health using circuit breaker pattern
 * Integrates with MessageRouter to record task outcomes
 */
export class AgentHealthTracker {
  private circuitManager: CircuitBreakerManager;

  constructor() {
    this.circuitManager = new CircuitBreakerManager({
      failureThresholdPercentage: 50, // 50% failure rate trips circuit
      minimumRequestCount: 10, // Need at least 10 tasks in window
      windowSizeMs: 600_000, // 10-minute window
      recoveryTimeoutMs: 60_000, // 1-minute recovery wait
      successThresholdCount: 3, // 3 successes to close circuit
    });
  }

  /**
   * Record a successful task completion
   */
  recordSuccess(agentId: string): void {
    const breaker = this.circuitManager.getBreaker(agentId);
    breaker.recordSuccess();
  }

  /**
   * Record a failed task
   */
  recordFailure(agentId: string): void {
    const breaker = this.circuitManager.getBreaker(agentId);
    breaker.recordFailure();

    const stats = breaker.getStats();
    if (stats.state === CircuitState.OPEN) {
      logger.error(
        {
          agentId,
          failureRate: `${stats.failurePercentage.toFixed(1)}%`,
          failureCount: stats.failureCount,
          totalCount: stats.totalCount,
        },
        'Agent circuit breaker OPEN - agent is unhealthy',
      );
    }
  }

  /**
   * Check if an agent is healthy and can accept tasks
   */
  isHealthy(agentId: string): boolean {
    const breaker = this.circuitManager.getBreaker(agentId);
    return breaker.allowRequest();
  }

  /**
   * Get health status for a specific agent
   */
  getAgentHealth(agentId: string): AgentHealthStatus {
    const breaker = this.circuitManager.getBreaker(agentId);
    const stats = breaker.getStats();

    return {
      agentId,
      isHealthy: stats.state !== CircuitState.OPEN,
      circuitState: stats.state,
      failureRate: stats.failurePercentage,
      totalTasks: stats.totalCount,
      lastStateChange: stats.stateChangeTime,
    };
  }

  /**
   * Get health status for all agents
   */
  getAllAgentHealth(): AgentHealthStatus[] {
    const allStats = this.circuitManager.getAllStats();
    const health: AgentHealthStatus[] = [];

    for (const [agentId, stats] of allStats) {
      health.push({
        agentId,
        isHealthy: stats.state !== CircuitState.OPEN,
        circuitState: stats.state,
        failureRate: stats.failurePercentage,
        totalTasks: stats.totalCount,
        lastStateChange: stats.stateChangeTime,
      });
    }

    return health;
  }

  /**
   * Get list of unhealthy agents
   */
  getUnhealthyAgents(): string[] {
    return this.circuitManager.getFailingAgents();
  }

  /**
   * Manually reset circuit breaker for an agent
   */
  resetAgent(agentId: string): void {
    const breaker = this.circuitManager.getBreaker(agentId);
    breaker.reset();
    logger.info({ agentId }, 'Agent health reset manually');
  }

  /**
   * Remove tracking for an agent (when disconnected)
   */
  removeAgent(agentId: string): void {
    this.circuitManager.removeBreaker(agentId);
  }
}
