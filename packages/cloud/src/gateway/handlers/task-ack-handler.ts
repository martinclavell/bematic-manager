import { createLogger, taskAckSchema } from '@bematic/common';
import type { TaskRepository } from '@bematic/db';

const logger = createLogger('task-ack-handler');

export class TaskAckHandler {
  constructor(private readonly taskRepo: TaskRepository) {}

  async handle(payload: unknown): Promise<void> {
    const parsed = taskAckSchema.parse(payload);

    if (parsed.accepted) {
      // Task was accepted by agent
      if (parsed.queued) {
        logger.info({ taskId: parsed.taskId }, 'Task queued on agent (at capacity)');
        this.taskRepo.update(parsed.taskId, { status: 'queued' });
      } else {
        logger.info({ taskId: parsed.taskId }, 'Task accepted by agent, starting execution');
        this.taskRepo.update(parsed.taskId, { status: 'running' });
      }
    } else {
      // Task was rejected
      logger.warn({ taskId: parsed.taskId, reason: parsed.reason }, 'Task rejected by agent');
      this.taskRepo.fail(parsed.taskId, parsed.reason || 'Rejected by agent');
    }
  }
}
