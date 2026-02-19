import { createLogger } from '@bematic/common';
import type { SchedulerService } from '../services/scheduler.service.js';
import type { ScheduledTaskRepository } from '@bematic/db';

const logger = createLogger('scheduler-worker');

const DEFAULT_TICK_INTERVAL_MS = 30_000; // 30 seconds
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export class SchedulerWorker {
  private interval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private tickIntervalMs: number;

  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly scheduledTaskRepo: ScheduledTaskRepository,
    tickIntervalMs?: number,
  ) {
    this.tickIntervalMs = tickIntervalMs || DEFAULT_TICK_INTERVAL_MS;
  }

  /**
   * Start the scheduler worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scheduler worker is already running');
      return;
    }

    this.isRunning = true;
    logger.info(
      { tickIntervalMs: this.tickIntervalMs },
      'Starting scheduler worker',
    );

    // Run immediately on start
    await this.tick();

    // Then run on interval
    this.interval = setInterval(() => {
      this.tick().catch((error) => {
        logger.error({ error }, 'Scheduler worker tick failed');
      });
    }, this.tickIntervalMs);

    logger.info('Scheduler worker started');
  }

  /**
   * Stop the scheduler worker
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Scheduler worker is not running');
      return;
    }

    logger.info('Stopping scheduler worker');

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.isRunning = false;
    logger.info('Scheduler worker stopped');
  }

  /**
   * Main scheduler tick - check for due tasks and execute them
   */
  private async tick(): Promise<void> {
    try {
      const startTime = Date.now();

      // Find all due scheduled tasks
      const dueTasks = this.scheduledTaskRepo.findDue();

      if (dueTasks.length === 0) {
        logger.debug('No due tasks found');
        return;
      }

      logger.info({ count: dueTasks.length }, 'Found due scheduled tasks');

      // Process each due task
      let successCount = 0;
      let failureCount = 0;

      for (const task of dueTasks) {
        try {
          // Check if task has expired
          if (task.expiresAt && new Date(task.expiresAt) < new Date()) {
            logger.info({ taskId: task.id }, 'Task expired, marking as cancelled');
            this.scheduledTaskRepo.update(task.id, {
              status: 'cancelled',
              enabled: false,
            });
            continue;
          }

          // Execute the task
          await this.schedulerService.executeDueTask(task);
          successCount++;

          logger.info(
            {
              taskId: task.id,
              botName: task.botName,
              command: task.command,
              isRecurring: task.isRecurring,
            },
            'Scheduled task executed successfully',
          );
        } catch (error) {
          failureCount++;
          logger.error(
            { error, taskId: task.id },
            'Failed to execute scheduled task, will retry',
          );

          // Retry logic: delay next execution by 5 minutes
          const retryTime = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
          this.scheduledTaskRepo.update(task.id, {
            nextExecutionAt: retryTime,
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info(
        {
          total: dueTasks.length,
          success: successCount,
          failure: failureCount,
          durationMs: duration,
        },
        'Scheduler tick completed',
      );
    } catch (error) {
      logger.error({ error }, 'Scheduler tick failed');
    }
  }

  /**
   * Get worker status
   */
  getStatus(): {
    isRunning: boolean;
    tickIntervalMs: number;
  } {
    return {
      isRunning: this.isRunning,
      tickIntervalMs: this.tickIntervalMs,
    };
  }

  /**
   * Force a tick (for testing or manual execution)
   */
  async forceTick(): Promise<void> {
    logger.info('Forcing scheduler tick');
    await this.tick();
  }
}
