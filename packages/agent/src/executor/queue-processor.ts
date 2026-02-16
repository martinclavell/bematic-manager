import { createLogger, type TaskSubmitPayload } from '@bematic/common';
import { ClaudeExecutor } from './claude-executor.js';
import { validatePath, registerProjectPath } from '../security/path-validator.js';

const logger = createLogger('queue-processor');

interface QueuedTask {
  payload: TaskSubmitPayload;
  abortController: AbortController;
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
  ) {}

  submit(payload: TaskSubmitPayload): void {
    // Validate and register path
    registerProjectPath(payload.localPath);
    validatePath(payload.localPath);

    const task: QueuedTask = {
      payload,
      abortController: new AbortController(),
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
