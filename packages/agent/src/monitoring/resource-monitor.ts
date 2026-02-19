import { EventEmitter } from 'node:events';
import { memoryUsage } from 'node:process';
import * as os from 'node:os';
import { createLogger } from '@bematic/common';

const logger = createLogger('resource-monitor');

export interface MemoryStatus {
  rss: number; // Resident Set Size
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  percentUsed: number;
  limitMB: number;
  status: 'ok' | 'warning' | 'critical' | 'danger';
}

export interface CPUStatus {
  user: number;
  system: number;
  percent: number;
  limitPercent: number;
  status: 'ok' | 'warning' | 'critical';
}

export interface ResourceStatus {
  memory: MemoryStatus;
  cpu: CPUStatus;
  uptime: number;
  healthScore: number; // 0-100, lower is worse
  timestamp: number;
}

export interface ResourceLimits {
  maxMemoryMB: number;
  maxCpuPercent: number;
  taskTimeoutMs: number;
  healthCheckIntervalMs: number;
}

export type ResourceAction =
  | 'log_warning'
  | 'reject_new_tasks'
  | 'cancel_lowest_priority'
  | 'graceful_shutdown';

export interface ResourceEvent {
  type: ResourceAction;
  resource: 'memory' | 'cpu';
  usage: number;
  limit: number;
  status: ResourceStatus;
}

/** Snapshot of per-core CPU times from os.cpus() */
interface CpuTimesSnapshot {
  idle: number;
  total: number;
}

/**
 * Monitors system resources and enforces limits to prevent resource exhaustion.
 * Implements graceful degradation strategy based on resource usage thresholds.
 */
export class ResourceMonitor extends EventEmitter {
  private memoryCheckInterval?: NodeJS.Timeout;
  private cpuCheckInterval?: NodeJS.Timeout;
  private lastCpuSnapshot: CpuTimesSnapshot;
  private startTime = Date.now();
  private isMonitoring = false;
  private currentStatus: ResourceStatus | null = null;

  constructor(private readonly limits: ResourceLimits) {
    super();

    // Validate limits
    if (limits.maxMemoryMB <= 0) {
      throw new Error('maxMemoryMB must be positive');
    }
    if (limits.maxCpuPercent <= 0 || limits.maxCpuPercent > 100) {
      throw new Error('maxCpuPercent must be between 1-100');
    }
    if (limits.taskTimeoutMs <= 0) {
      throw new Error('taskTimeoutMs must be positive');
    }

    // Take initial CPU snapshot for delta-based measurement
    this.lastCpuSnapshot = this.takeCpuSnapshot();

    logger.info({ limits }, 'Resource monitor initialized');
  }

  /**
   * Take a snapshot of aggregate CPU times across all cores.
   * Used to compute system-wide CPU percentage between two snapshots.
   */
  private takeCpuSnapshot(): CpuTimesSnapshot {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      const times = cpu.times;
      idle += times.idle;
      total += times.user + times.nice + times.sys + times.idle + times.irq;
    }

    return { idle, total };
  }

  /**
   * Start monitoring system resources at configured intervals
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      logger.warn('Resource monitoring already started');
      return;
    }

    this.isMonitoring = true;

    // Monitor memory and CPU at the configured health check interval
    this.memoryCheckInterval = setInterval(() => {
      this.checkAndEnforceMemoryLimits();
    }, this.limits.healthCheckIntervalMs);

    this.cpuCheckInterval = setInterval(() => {
      this.checkAndEnforceCpuLimits();
    }, this.limits.healthCheckIntervalMs);

    logger.info({ intervalMs: this.limits.healthCheckIntervalMs }, 'Resource monitoring started');
  }

  /**
   * Stop resource monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) return;

    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = undefined;
    }

    if (this.cpuCheckInterval) {
      clearInterval(this.cpuCheckInterval);
      this.cpuCheckInterval = undefined;
    }

    this.isMonitoring = false;
    logger.info('Resource monitoring stopped');
  }

  /**
   * Get current memory usage status
   */
  checkMemoryUsage(): MemoryStatus {
    const mem = memoryUsage();
    const rssInMB = mem.rss / (1024 * 1024);
    const percentUsed = (rssInMB / this.limits.maxMemoryMB) * 100;

    let status: MemoryStatus['status'] = 'ok';
    if (percentUsed >= 98) status = 'danger';
    else if (percentUsed >= 95) status = 'critical';
    else if (percentUsed >= 90) status = 'warning';

    return {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      percentUsed,
      limitMB: this.limits.maxMemoryMB,
      status,
    };
  }

  /**
   * Get current system-wide CPU usage status.
   * Uses os.cpus() delta between snapshots for accurate measurement across all cores.
   */
  checkCPUUsage(): CPUStatus {
    const current = this.takeCpuSnapshot();
    const prev = this.lastCpuSnapshot;

    const idleDelta = current.idle - prev.idle;
    const totalDelta = current.total - prev.total;

    // System-wide CPU percentage (0-100)
    const percent = totalDelta > 0
      ? Math.min(((totalDelta - idleDelta) / totalDelta) * 100, 100)
      : 0;

    this.lastCpuSnapshot = current;

    let status: CPUStatus['status'] = 'ok';
    if (percent >= this.limits.maxCpuPercent) status = 'critical';
    else if (percent >= this.limits.maxCpuPercent * 0.8) status = 'warning';

    return {
      user: current.total - current.idle, // approximate user+sys
      system: 0,
      percent,
      limitPercent: this.limits.maxCpuPercent,
      status,
    };
  }

  /**
   * Enforce memory limits and trigger appropriate actions
   */
  private checkAndEnforceMemoryLimits(): void {
    const memory = this.checkMemoryUsage();

    if (memory.status !== 'ok') {
      const event: ResourceEvent = {
        type: this.getMemoryAction(memory.status),
        resource: 'memory',
        usage: memory.percentUsed,
        limit: 100,
        status: this.reportStatus(),
      };

      this.enforceLimit('memory', memory.percentUsed, event);
    }
  }

  /**
   * Enforce CPU limits and trigger appropriate actions
   */
  private checkAndEnforceCpuLimits(): void {
    const cpu = this.checkCPUUsage();

    if (cpu.status !== 'ok') {
      const event: ResourceEvent = {
        type: this.getCpuAction(cpu.status),
        resource: 'cpu',
        usage: cpu.percent,
        limit: cpu.limitPercent,
        status: this.reportStatus(),
      };

      this.enforceLimit('cpu', cpu.percent, event);
    }
  }

  /**
   * Determine appropriate action based on memory status
   */
  private getMemoryAction(status: MemoryStatus['status']): ResourceAction {
    switch (status) {
      case 'warning': return 'log_warning';
      case 'critical': return 'reject_new_tasks';
      case 'danger': return 'graceful_shutdown';
      default: return 'log_warning';
    }
  }

  /**
   * Determine appropriate action based on CPU status
   */
  private getCpuAction(status: CPUStatus['status']): ResourceAction {
    switch (status) {
      case 'warning': return 'log_warning';
      case 'critical': return 'cancel_lowest_priority';
      default: return 'log_warning';
    }
  }

  /**
   * Enforce resource limits by triggering the appropriate action
   */
  enforceLimit(resource: 'memory' | 'cpu', usage: number, event: ResourceEvent): void {
    const { type, limit } = event;

    logger.warn(
      {
        resource,
        usage: usage.toFixed(1),
        limit,
        action: type,
        status: event.status
      },
      `Resource limit enforcement triggered: ${type}`
    );

    // Emit event for external handlers (like queue processor)
    this.emit('resource-limit', event);

    // Internal actions
    switch (type) {
      case 'log_warning':
        logger.warn(
          { resource, usage: usage.toFixed(1), limit },
          `Resource usage warning: ${resource} at ${usage.toFixed(1)}%`
        );
        break;

      case 'reject_new_tasks':
        logger.warn(
          { resource, usage: usage.toFixed(1), limit },
          `High resource usage detected - new tasks will be rejected`
        );
        break;

      case 'cancel_lowest_priority':
        logger.error(
          { resource, usage: usage.toFixed(1), limit },
          `Critical resource usage - cancelling lowest priority task`
        );
        break;

      case 'graceful_shutdown':
        logger.error(
          { resource, usage: usage.toFixed(1), limit },
          `Dangerous resource usage - initiating graceful shutdown`
        );
        // Graceful shutdown will be handled by the main process
        break;
    }
  }

  /**
   * Get comprehensive resource status report
   */
  reportStatus(): ResourceStatus {
    const memory = this.checkMemoryUsage();
    const cpu = this.checkCPUUsage();
    const uptime = Date.now() - this.startTime;

    // Calculate health score (0-100, lower is worse)
    const memoryScore = Math.max(0, 100 - memory.percentUsed);
    const cpuScore = Math.max(0, 100 - cpu.percent);
    const healthScore = Math.min(memoryScore, cpuScore);

    this.currentStatus = {
      memory,
      cpu,
      uptime,
      healthScore,
      timestamp: Date.now(),
    };

    return this.currentStatus;
  }

  /**
   * Get the current cached status (if available) or generate a new one
   */
  getCurrentStatus(): ResourceStatus {
    return this.currentStatus || this.reportStatus();
  }

  /**
   * Check if the system is healthy enough to accept new tasks
   */
  canAcceptNewTasks(): boolean {
    const status = this.getCurrentStatus();
    return status.memory.status !== 'critical' &&
           status.memory.status !== 'danger' &&
           status.cpu.status !== 'critical';
  }

  /**
   * Check if a graceful shutdown should be initiated
   */
  shouldShutdown(): boolean {
    const status = this.getCurrentStatus();
    return status.memory.status === 'danger';
  }

  /**
   * Create a task timeout controller based on configured limits
   */
  createTaskTimeoutController(): AbortController {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      logger.warn(
        { timeoutMs: this.limits.taskTimeoutMs },
        'Task timeout reached - aborting'
      );
      controller.abort();
    }, this.limits.taskTimeoutMs);

    // Clean up timeout when aborted from external source
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timeout);
    }, { once: true });

    return controller;
  }

  /**
   * Get resource limits configuration
   */
  getLimits(): ResourceLimits {
    return { ...this.limits };
  }
}
