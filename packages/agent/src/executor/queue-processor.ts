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
 * - One active task per project (prevents file conflicts)
 * - Up to maxConcurrent total tasks across all projects
 */
export class QueueProcessor {
  private activeByProject = new Map<string, QueuedTask>();
  private queueByProject = new Map<string, QueuedTask[]>();
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

    const projectId = payload.projectId;

    // If project already has an active task, queue it
    if (this.activeByProject.has(projectId)) {
      let queue = this.queueByProject.get(projectId);
      if (!queue) {
        queue = [];
        this.queueByProject.set(projectId, queue);
      }
      queue.push(task);
      logger.info(
        { taskId: payload.taskId, projectId, position: queue.length },
        'Task queued (project busy)',
      );
      return;
    }

    // If at max concurrency, queue it
    if (this.totalActive >= this.maxConcurrent) {
      let queue = this.queueByProject.get(projectId);
      if (!queue) {
        queue = [];
        this.queueByProject.set(projectId, queue);
      }
      queue.push(task);
      logger.info(
        { taskId: payload.taskId, position: queue.length },
        'Task queued (max concurrency)',
      );
      return;
    }

    this.executeTask(task);
  }

  cancel(taskId: string): boolean {
    // Check active tasks
    for (const [, task] of this.activeByProject) {
      if (task.payload.taskId === taskId) {
        task.abortController.abort();
        logger.info({ taskId }, 'Task cancellation requested');
        return true;
      }
    }

    // Check queues
    for (const [projectId, queue] of this.queueByProject) {
      const idx = queue.findIndex((t) => t.payload.taskId === taskId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        if (queue.length === 0) this.queueByProject.delete(projectId);
        logger.info({ taskId }, 'Queued task cancelled');
        return true;
      }
    }

    return false;
  }

  getActiveTaskCount(): number {
    return this.totalActive;
  }

  getActiveTasks(): string[] {
    return Array.from(this.activeByProject.values()).map((t) => t.payload.taskId);
  }

  private executeTask(task: QueuedTask): void {
    const { payload, abortController } = task;
    const projectId = payload.projectId;

    this.activeByProject.set(projectId, task);
    this.totalActive++;

    logger.info(
      { taskId: payload.taskId, projectId, totalActive: this.totalActive },
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
        this.activeByProject.delete(projectId);
        this.totalActive--;
        this.processNextForProject(projectId);
      });
  }

  private processNextForProject(projectId: string): void {
    const queue = this.queueByProject.get(projectId);
    if (!queue || queue.length === 0) {
      this.queueByProject.delete(projectId);
      return;
    }

    if (this.totalActive >= this.maxConcurrent) return;

    const next = queue.shift()!;
    if (queue.length === 0) this.queueByProject.delete(projectId);

    this.executeTask(next);
  }
}
