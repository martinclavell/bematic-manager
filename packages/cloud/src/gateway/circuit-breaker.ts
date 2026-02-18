import { createLogger } from '@bematic/common';

const logger = createLogger('circuit-breaker');

export enum CircuitState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Circuit is tripped, rejecting requests
  HALF_OPEN = 'half-open', // Testing if service has recovered
}

export interface CircuitBreakerConfig {
  /** Failure threshold (percentage) to trip the circuit (0-100) */
  failureThresholdPercentage: number;
  /** Minimum number of requests before circuit can trip */
  minimumRequestCount: number;
  /** Time window in ms to track failures */
  windowSizeMs: number;
  /** Time in ms to wait before attempting to recover (half-open) */
  recoveryTimeoutMs: number;
  /** Number of successful requests in half-open needed to close circuit */
  successThresholdCount: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThresholdPercentage: 50, // 50% failure rate trips circuit
  minimumRequestCount: 10, // Need at least 10 requests in window
  windowSizeMs: 600_000, // 10-minute window
  recoveryTimeoutMs: 60_000, // 1-minute recovery wait
  successThresholdCount: 3, // 3 successes to close circuit
};

interface RequestRecord {
  timestamp: number;
  success: boolean;
}

/**
 * Circuit breaker pattern implementation for agent failure detection
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private records: RequestRecord[] = [];
  private stateChangeTime: number = Date.now();
  private halfOpenSuccesses: number = 0;

  constructor(
    private readonly agentId: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CONFIG,
  ) {}

  /**
   * Record a successful task completion
   */
  recordSuccess(): void {
    this.addRecord(true);

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.successThresholdCount) {
        this.transitionToState(CircuitState.CLOSED);
        this.halfOpenSuccesses = 0;
        logger.info({ agentId: this.agentId }, 'Circuit breaker closed after recovery');
      }
    }
  }

  /**
   * Record a failed task
   */
  recordFailure(): void {
    this.addRecord(false);

    if (this.state === CircuitState.HALF_OPEN) {
      // Failed during recovery, trip circuit again
      this.transitionToState(CircuitState.OPEN);
      this.halfOpenSuccesses = 0;
      logger.warn({ agentId: this.agentId }, 'Circuit breaker re-opened after recovery failure');
      return;
    }

    if (this.state === CircuitState.CLOSED) {
      // Check if we should trip the circuit
      const stats = this.calculateStats();
      if (
        stats.totalCount >= this.config.minimumRequestCount &&
        stats.failurePercentage >= this.config.failureThresholdPercentage
      ) {
        this.transitionToState(CircuitState.OPEN);
        logger.error(
          {
            agentId: this.agentId,
            failureRate: `${stats.failurePercentage.toFixed(1)}%`,
            totalRequests: stats.totalCount,
          },
          'Circuit breaker tripped due to high failure rate',
        );
      }
    }
  }

  /**
   * Check if requests should be allowed
   */
  allowRequest(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      // Check if recovery timeout has elapsed
      const now = Date.now();
      if (now - this.stateChangeTime >= this.config.recoveryTimeoutMs) {
        this.transitionToState(CircuitState.HALF_OPEN);
        logger.info({ agentId: this.agentId }, 'Circuit breaker entering half-open state');
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow limited requests to test recovery
    return true;
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): {
    state: CircuitState;
    failurePercentage: number;
    totalCount: number;
    failureCount: number;
    successCount: number;
    stateChangeTime: Date;
  } {
    const stats = this.calculateStats();
    return {
      state: this.state,
      failurePercentage: stats.failurePercentage,
      totalCount: stats.totalCount,
      failureCount: stats.failureCount,
      successCount: stats.successCount,
      stateChangeTime: new Date(this.stateChangeTime),
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.records = [];
    this.halfOpenSuccesses = 0;
    this.stateChangeTime = Date.now();
    logger.info({ agentId: this.agentId }, 'Circuit breaker manually reset');
  }

  private addRecord(success: boolean): void {
    const now = Date.now();
    this.records.push({ timestamp: now, success });

    // Remove records outside the time window
    const cutoff = now - this.config.windowSizeMs;
    this.records = this.records.filter((r) => r.timestamp >= cutoff);
  }

  private calculateStats(): {
    totalCount: number;
    failureCount: number;
    successCount: number;
    failurePercentage: number;
  } {
    const totalCount = this.records.length;
    const failureCount = this.records.filter((r) => !r.success).length;
    const successCount = totalCount - failureCount;
    const failurePercentage = totalCount > 0 ? (failureCount / totalCount) * 100 : 0;

    return { totalCount, failureCount, successCount, failurePercentage };
  }

  private transitionToState(newState: CircuitState): void {
    this.state = newState;
    this.stateChangeTime = Date.now();
  }
}

/**
 * Manages circuit breakers for all agents
 */
export class CircuitBreakerManager {
  private breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly config: CircuitBreakerConfig = DEFAULT_CONFIG) {}

  /**
   * Get or create circuit breaker for an agent
   */
  getBreaker(agentId: string): CircuitBreaker {
    let breaker = this.breakers.get(agentId);
    if (!breaker) {
      breaker = new CircuitBreaker(agentId, this.config);
      this.breakers.set(agentId, breaker);
    }
    return breaker;
  }

  /**
   * Remove circuit breaker for an agent (when agent disconnects)
   */
  removeBreaker(agentId: string): void {
    this.breakers.delete(agentId);
    logger.debug({ agentId }, 'Circuit breaker removed');
  }

  /**
   * Get statistics for all circuit breakers
   */
  getAllStats(): Map<string, ReturnType<CircuitBreaker['getStats']>> {
    const stats = new Map();
    for (const [agentId, breaker] of this.breakers) {
      stats.set(agentId, breaker.getStats());
    }
    return stats;
  }

  /**
   * Get list of agents with open circuits
   */
  getFailingAgents(): string[] {
    const failing: string[] = [];
    for (const [agentId, breaker] of this.breakers) {
      if (breaker.getState() === CircuitState.OPEN) {
        failing.push(agentId);
      }
    }
    return failing;
  }
}
