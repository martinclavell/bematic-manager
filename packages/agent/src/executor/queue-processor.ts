import { createLogger, type TaskSubmitPayload } from '@bematic/common';
import { ClaudeExecutor } from './claude-executor.js';
import { validatePath, registerProjectPath } from '../security/path-validator.js';
import type { ResourceMonitor } from '../monitoring/resource-monitor.js';

const logger = createLogger('queue-processor');

interface QueuedTask {
  payload: TaskSubmitPayload;
  abortController: AbortController;
  submittedAt: number; // Timestamp when task was submitted
}

/**
 * Processes tasks with concurrency control:
 * - Up to maxConcurrent total tasks across all projects
 * - Multiple tasks can run in parallel for the same project
 */
export class QueueProcessor {
  private activeTasks = new Map<string, QueuedTask>();
  private queue: QueuedTask[] = [];
  private totalActive = 0;

  constructor(
    private readonly executor: ClaudeExecutor,
    private readonly maxConcurrent: number,
    private readonly resourceMonitor?: ResourceMonitor,
  ) {}

  submit(payload: TaskSubmitPayload): void {
    // Check if resource limits allow accepting new tasks
    if (this.resourceMonitor && !this.resourceMonitor.canAcceptNewTasks()) {
      const status = this.resourceMonitor.getCurrentStatus();
      logger.warn(
        {
          taskId: payload.taskId,
          memoryPercent: status.memory.percentUsed,
          cpuPercent: status.cpu.percent,
          healthScore: status.healthScore,
        },
        'Rejecting task due to resource limits'
      );

      // Task will be handled as rejected by caller
      throw new Error(`Task rejected due to resource exhaustion (memory: ${status.memory.percentUsed.toFixed(1)}%, CPU: ${status.cpu.percent.toFixed(1)}%)`);
    }

    // Validate and register path
    registerProjectPath(payload.localPath);
    validatePath(payload.localPath);

    const task: QueuedTask = {
      payload,
      abortController: new AbortController(),
      submittedAt: Date.now(),
    };

    // If at max concurrency, queue it
    if (this.totalActive >= this.maxConcurrent) {
      this.queue.push(task);
      logger.info(
        { taskId: payload.taskId, position: this.queue.length, totalActive: this.totalActive },
        'Task queued (max concurrency)',
      );
      return;
    }

    this.executeTask(task);
  }

  cancel(taskId: string): boolean {
    // Check active tasks
    const active = this.activeTasks.get(taskId);
    if (active) {
      active.abortController.abort();
      logger.info({ taskId }, 'Task cancellation requested');
      return true;
    }

    // Check queue
    const idx = this.queue.findIndex((t) => t.payload.taskId === taskId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      logger.info({ taskId }, 'Queued task cancelled');
      return true;
    }

    return false;
  }

  getActiveTaskCount(): number {
    return this.totalActive;
  }

  getActiveTasks(): string[] {
    return Array.from(this.activeTasks.keys());
  }

  /**
   * Cancel the lowest priority task (oldest active task first, then oldest queued task)
   * Returns the cancelled task ID, or null if no task was cancelled
   */
  cancelLowestPriorityTask(): string | null {
    // First try to cancel the oldest active task
    if (this.activeTasks.size > 0) {
      let oldestTask: QueuedTask | null = null;
      let oldestTaskId: string | null = null;

      for (const [taskId, task] of this.activeTasks.entries()) {
        if (!oldestTask || task.submittedAt < oldestTask.submittedAt) {
          oldestTask = task;
          oldestTaskId = taskId;
        }
      }

      if (oldestTaskId && oldestTask) {
        logger.info(
          {
            taskId: oldestTaskId,
            submittedAt: oldestTask.submittedAt,
            ageMs: Date.now() - oldestTask.submittedAt
          },
          'Cancelling oldest active task due to resource pressure'
        );
        oldestTask.abortController.abort();
        return oldestTaskId;
      }
    }

    // If no active tasks, try to cancel the oldest queued task
    if (this.queue.length > 0) {
      // Queue is naturally ordered by submission time (FIFO), so first item is oldest
      const oldestQueued = this.queue.shift()!;
      logger.info(
        {
          taskId: oldestQueued.payload.taskId,
          submittedAt: oldestQueued.submittedAt,
          ageMs: Date.now() - oldestQueued.submittedAt,
          queuePosition: 0,
        },
        'Cancelling oldest queued task due to resource pressure'
      );
      return oldestQueued.payload.taskId;
    }

    logger.warn('No tasks available to cancel for resource pressure relief');
    return null;
  }

  private executeTask(task: QueuedTask): void {
    const { payload, abortController } = task;

    this.activeTasks.set(payload.taskId, task);
    this.totalActive++;

    logger.info(
      { taskId: payload.taskId, projectId: payload.projectId, totalActive: this.totalActive },
      'Executing task',
    );

    this.executor
      .execute(payload, abortController.signal)
      .catch((error) => {
        const msg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        logger.error({ taskId: payload.taskId, errorMessage: msg, stack }, 'Task execution error');
      })
      .finally(() => {
        this.activeTasks.delete(payload.taskId);
        this.totalActive--;
        this.processNext();
      });
  }

  private processNext(): void {
    if (this.queue.length === 0) return;
    if (this.totalActive >= this.maxConcurrent) return;

    const next = this.queue.shift()!;
    this.executeTask(next);
  }
}
