import { createLogger, taskStreamSchema } from '@bematic/common';
import type { TaskRepository } from '@bematic/db';
import type { StreamAccumulator } from '../stream-accumulator.js';

const logger = createLogger('task-stream-handler');

export class TaskStreamHandler {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly streamAccumulator: StreamAccumulator,
  ) {}

  handle(payload: unknown): void {
    const parsed = taskStreamSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) {
      logger.warn({ taskId: parsed.taskId }, 'Received stream for unknown task');
      return;
    }

    // Accumulate streaming output (batched updates every 3s)
    this.streamAccumulator.addChunk(
      parsed.taskId,
      task.slackChannelId,
      parsed.text,
      task.slackThreadTs,
      parsed.isPartial,
    );

    logger.debug({ taskId: parsed.taskId, textLength: parsed.text.length }, 'Stream chunk received');
  }

  /**
   * Clean up stream after task completion
   */
  cleanup(taskId: string): void {
    this.streamAccumulator.removeStream(taskId);
  }
}
