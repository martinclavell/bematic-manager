import { createLogger, TimeParser, CronParser, generateId } from '@bematic/common';
import type {
  ScheduledTaskRepository,
  ScheduledTaskRow,
  ScheduledTaskInsert,
  AuditLogRepository,
  ProjectRepository,
} from '@bematic/db';
import type { CommandService } from './command.service.js';
import { BotRegistry } from '@bematic/bots';

const logger = createLogger('scheduler-service');

export interface ScheduledTaskConfig {
  projectId: string;
  userId: string;
  slackChannelId: string;
  slackThreadTs?: string;
  taskType: 'reminder' | 'prompt_execution' | 'recurring_job';
  botName: string;
  command: string;
  prompt: string;
  scheduledFor: string; // Natural language or ISO string
  timezone: string;
  cronExpression?: string; // For recurring tasks
  maxExecutions?: number; // Optional limit for recurring tasks
  expiresAt?: string; // Auto-cancel after this date
  metadata?: Record<string, any>;
}

export interface CronJobConfig extends Omit<ScheduledTaskConfig, 'scheduledFor' | 'taskType'> {
  cronExpression: string;
  maxExecutions?: number;
}

export interface SchedulerStats {
  total: number;
  byStatus: Record<string, number>;
  upcoming24h: number;
  overdue: number;
  recurring: number;
}

const MAX_USER_SCHEDULED_TASKS = 50;

export class SchedulerService {
  constructor(
    private readonly scheduledTaskRepo: ScheduledTaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly commandService: CommandService,
    private readonly projectRepo: ProjectRepository,
  ) {}

  /**
   * Schedule a one-time task for later execution
   */
  async scheduleTask(config: ScheduledTaskConfig): Promise<ScheduledTaskRow> {
    logger.info({ config }, 'Creating scheduled task');

    // Enforce quota
    const userTaskCount = this.scheduledTaskRepo.countByUser(config.userId);
    if (userTaskCount >= MAX_USER_SCHEDULED_TASKS) {
      throw new Error(
        `User has reached maximum scheduled tasks limit (${MAX_USER_SCHEDULED_TASKS})`,
      );
    }

    // Parse scheduled time
    const scheduledDate = TimeParser.parseNatural(config.scheduledFor, config.timezone);
    if (!scheduledDate) {
      throw new Error(`Invalid time format: ${config.scheduledFor}`);
    }

    // Validate time is in future
    if (!TimeParser.isFuture(scheduledDate)) {
      throw new Error(`Scheduled time must be in the future: ${config.scheduledFor}`);
    }

    // Validate not too far in future (max 1 year)
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    if (scheduledDate > oneYearFromNow) {
      throw new Error('Scheduled time cannot be more than 1 year in the future');
    }

    const task: ScheduledTaskInsert = {
      id: generateId(),
      projectId: config.projectId,
      userId: config.userId,
      taskType: config.taskType,
      botName: config.botName,
      command: config.command,
      prompt: config.prompt,
      scheduledFor: scheduledDate.toISOString(),
      timezone: config.timezone,
      cronExpression: config.cronExpression || null,
      isRecurring: false,
      nextExecutionAt: scheduledDate.toISOString(),
      status: 'pending',
      enabled: true,
      slackChannelId: config.slackChannelId,
      slackThreadTs: config.slackThreadTs || null,
      metadata: JSON.stringify(config.metadata || {}),
      expiresAt: config.expiresAt || null,
    };

    const created = this.scheduledTaskRepo.create(task);

    await this.auditLogRepo.log(
      'scheduled_task.created',
      'scheduled_task',
      created.id,
      config.userId,
      {
        scheduledFor: scheduledDate.toISOString(),
        timezone: config.timezone,
        taskType: config.taskType,
      },
    );

    logger.info({ taskId: created.id, scheduledFor: scheduledDate }, 'Scheduled task created');
    return created;
  }

  /**
   * Create a recurring cron job
   */
  async createCronJob(config: CronJobConfig): Promise<ScheduledTaskRow> {
    logger.info({ config }, 'Creating cron job');

    // Enforce quota
    const userTaskCount = this.scheduledTaskRepo.countByUser(config.userId);
    if (userTaskCount >= MAX_USER_SCHEDULED_TASKS) {
      throw new Error(
        `User has reached maximum scheduled tasks limit (${MAX_USER_SCHEDULED_TASKS})`,
      );
    }

    // Validate cron expression
    if (!CronParser.validate(config.cronExpression)) {
      throw new Error(`Invalid cron expression: ${config.cronExpression}`);
    }

    // Validate frequency (prevent abuse)
    if (!CronParser.isReasonableFrequency(config.cronExpression)) {
      throw new Error(
        'Cron expression must have at least 1 hour between executions (to prevent abuse)',
      );
    }

    // Calculate next execution
    const nextExecution = CronParser.getNext(config.cronExpression, config.timezone);

    const task: ScheduledTaskInsert = {
      id: generateId(),
      projectId: config.projectId,
      userId: config.userId,
      taskType: 'recurring_job',
      botName: config.botName,
      command: config.command,
      prompt: config.prompt,
      scheduledFor: nextExecution.toISOString(),
      timezone: config.timezone,
      cronExpression: config.cronExpression,
      isRecurring: true,
      nextExecutionAt: nextExecution.toISOString(),
      maxExecutions: config.maxExecutions || null,
      status: 'active',
      enabled: true,
      slackChannelId: config.slackChannelId,
      slackThreadTs: config.slackThreadTs || null,
      metadata: JSON.stringify(config.metadata || {}),
      expiresAt: config.expiresAt || null,
    };

    const created = this.scheduledTaskRepo.create(task);

    await this.auditLogRepo.log(
      'cron_job.created',
      'scheduled_task',
      created.id,
      config.userId,
      {
        cronExpression: config.cronExpression,
        nextExecution: nextExecution.toISOString(),
        description: CronParser.describe(config.cronExpression),
      },
    );

    logger.info(
      { taskId: created.id, cronExpression: config.cronExpression, nextExecution },
      'Cron job created',
    );
    return created;
  }

  /**
   * Execute a due scheduled task by submitting it to the command service
   */
  async executeDueTask(scheduledTask: ScheduledTaskRow): Promise<void> {
    logger.info({ taskId: scheduledTask.id }, 'Executing scheduled task');

    try {
      // Get project and bot
      const project = this.projectRepo.findById(scheduledTask.projectId);
      if (!project) {
        throw new Error(`Project not found: ${scheduledTask.projectId}`);
      }

      const bot = BotRegistry.get(scheduledTask.botName as any);
      if (!bot) {
        throw new Error(`Bot not found: ${scheduledTask.botName}`);
      }

      // Parse command
      const parsedCommand = bot.parseCommand(`${scheduledTask.command} ${scheduledTask.prompt}`);

      // Submit task to command service
      await this.commandService.submit({
        bot,
        command: parsedCommand,
        project,
        slackContext: {
          channelId: scheduledTask.slackChannelId,
          threadTs: scheduledTask.slackThreadTs || null,
          userId: scheduledTask.userId,
        },
      });

      // Update scheduled task
      if (scheduledTask.isRecurring) {
        // Calculate next execution
        const nextExecution = CronParser.getNext(
          scheduledTask.cronExpression!,
          scheduledTask.timezone,
        );
        const newExecutionCount = scheduledTask.executionCount + 1;

        // Check if max executions reached
        const shouldComplete =
          scheduledTask.maxExecutions && newExecutionCount >= scheduledTask.maxExecutions;

        this.scheduledTaskRepo.update(scheduledTask.id, {
          lastExecutedAt: new Date().toISOString(),
          nextExecutionAt: nextExecution.toISOString(),
          executionCount: newExecutionCount,
          lastTriggeredAt: new Date().toISOString(),
          status: shouldComplete ? 'completed' : 'active',
        });

        logger.info(
          {
            taskId: scheduledTask.id,
            executionCount: newExecutionCount,
            nextExecution,
            completed: shouldComplete,
          },
          'Recurring task executed, next execution scheduled',
        );
      } else {
        // One-time task → mark completed
        this.scheduledTaskRepo.update(scheduledTask.id, {
          status: 'completed',
          lastExecutedAt: new Date().toISOString(),
          lastTriggeredAt: new Date().toISOString(),
        });

        logger.info({ taskId: scheduledTask.id }, 'One-time scheduled task completed');
      }

      await this.auditLogRepo.log(
        'scheduled_task.executed',
        'scheduled_task',
        scheduledTask.id,
        scheduledTask.userId,
        {
          isRecurring: scheduledTask.isRecurring,
          executionCount: scheduledTask.executionCount + 1,
        },
      );
    } catch (error) {
      logger.error({ error, taskId: scheduledTask.id }, 'Failed to execute scheduled task');

      // Mark as failed
      this.scheduledTaskRepo.update(scheduledTask.id, {
        status: 'failed',
      });

      await this.auditLogRepo.log(
        'scheduled_task.failed',
        'scheduled_task',
        scheduledTask.id,
        scheduledTask.userId,
        { error: String(error) },
      );

      throw error;
    }
  }

  /**
   * Pause a scheduled task
   */
  async pauseTask(id: string, userId: string): Promise<ScheduledTaskRow | undefined> {
    logger.info({ taskId: id, userId }, 'Pausing scheduled task');

    const task = this.scheduledTaskRepo.findById(id);
    if (!task) {
      throw new Error(`Scheduled task not found: ${id}`);
    }

    if (task.userId !== userId) {
      throw new Error('You can only pause your own scheduled tasks');
    }

    const updated = this.scheduledTaskRepo.update(id, {
      enabled: false,
      status: 'paused',
    });

    await this.auditLogRepo.log('scheduled_task.paused', 'scheduled_task', id, userId);

    return updated;
  }

  /**
   * Resume a paused scheduled task
   */
  async resumeTask(id: string, userId: string): Promise<ScheduledTaskRow | undefined> {
    logger.info({ taskId: id, userId }, 'Resuming scheduled task');

    const task = this.scheduledTaskRepo.findById(id);
    if (!task) {
      throw new Error(`Scheduled task not found: ${id}`);
    }

    if (task.userId !== userId) {
      throw new Error('You can only resume your own scheduled tasks');
    }

    const updated = this.scheduledTaskRepo.update(id, {
      enabled: true,
      status: task.isRecurring ? 'active' : 'pending',
    });

    await this.auditLogRepo.log('scheduled_task.resumed', 'scheduled_task', id, userId);

    return updated;
  }

  /**
   * Cancel a scheduled task
   */
  async cancelTask(id: string, userId: string): Promise<void> {
    logger.info({ taskId: id, userId }, 'Cancelling scheduled task');

    const task = this.scheduledTaskRepo.findById(id);
    if (!task) {
      throw new Error(`Scheduled task not found: ${id}`);
    }

    if (task.userId !== userId) {
      throw new Error('You can only cancel your own scheduled tasks');
    }

    this.scheduledTaskRepo.update(id, {
      status: 'cancelled',
      enabled: false,
    });

    await this.auditLogRepo.log('scheduled_task.cancelled', 'scheduled_task', id, userId);
  }

  /**
   * Update a scheduled task
   */
  async updateTask(
    id: string,
    userId: string,
    updates: {
      scheduledFor?: string;
      prompt?: string;
      cronExpression?: string;
    },
  ): Promise<ScheduledTaskRow | undefined> {
    logger.info({ taskId: id, userId, updates }, 'Updating scheduled task');

    const task = this.scheduledTaskRepo.findById(id);
    if (!task) {
      throw new Error(`Scheduled task not found: ${id}`);
    }

    if (task.userId !== userId) {
      throw new Error('You can only update your own scheduled tasks');
    }

    const updateData: Partial<ScheduledTaskInsert> = {};

    // Update scheduled time
    if (updates.scheduledFor) {
      const newDate = TimeParser.parseNatural(updates.scheduledFor, task.timezone);
      if (!newDate || !TimeParser.isFuture(newDate)) {
        throw new Error('Invalid or past scheduled time');
      }
      updateData.scheduledFor = newDate.toISOString();
      updateData.nextExecutionAt = newDate.toISOString();
    }

    // Update prompt
    if (updates.prompt) {
      updateData.prompt = updates.prompt;
    }

    // Update cron expression
    if (updates.cronExpression && task.isRecurring) {
      if (!CronParser.validate(updates.cronExpression)) {
        throw new Error('Invalid cron expression');
      }
      if (!CronParser.isReasonableFrequency(updates.cronExpression)) {
        throw new Error('Cron expression must have at least 1 hour between executions');
      }
      const nextExecution = CronParser.getNext(updates.cronExpression, task.timezone);
      updateData.cronExpression = updates.cronExpression;
      updateData.nextExecutionAt = nextExecution.toISOString();
    }

    const updated = this.scheduledTaskRepo.update(id, updateData);

    await this.auditLogRepo.log('scheduled_task.updated', 'scheduled_task', id, userId, updates);

    return updated;
  }

  /**
   * List scheduled tasks with filters
   */
  listTasks(filters: {
    projectId?: string;
    userId?: string;
    status?: string;
    enabled?: boolean;
  }): ScheduledTaskRow[] {
    return this.scheduledTaskRepo.findAll(filters);
  }

  /**
   * Get scheduler statistics
   */
  async getStats(): Promise<SchedulerStats> {
    const byStatus = this.scheduledTaskRepo.countByStatus();
    const upcoming = this.scheduledTaskRepo.getUpcoming(24);
    const allTasks = this.scheduledTaskRepo.findAll({ enabled: true });

    const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
    const recurring = allTasks.filter((t) => t.isRecurring).length;

    // Count overdue tasks
    const now = new Date().toISOString();
    const overdue = allTasks.filter(
      (t) => t.nextExecutionAt && t.nextExecutionAt < now && t.status === 'active',
    ).length;

    return {
      total,
      byStatus,
      upcoming24h: upcoming.length,
      overdue,
      recurring,
    };
  }
}
