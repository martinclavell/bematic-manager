import { eq, and, desc } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { tasks } from '../schema/tasks.js';
import type { TaskInsert, TaskRow } from '../schema/tasks.js';

export class TaskRepository extends BaseRepository {
  create(data: TaskInsert): TaskRow {
    return this.db.insert(tasks).values(data).returning().get();
  }

  findById(id: string): TaskRow | undefined {
    return this.db.select().from(tasks).where(eq(tasks.id, id)).get();
  }

  findByProjectId(projectId: string, limit = 50): TaskRow[] {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(desc(tasks.createdAt))
      .limit(limit)
      .all();
  }

  findByStatus(status: string): TaskRow[] {
    return this.db
      .select()
      .from(tasks)
      .where(eq(tasks.status, status))
      .all();
  }

  findActiveByProjectId(projectId: string): TaskRow[] {
    return this.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          eq(tasks.status, 'running'),
        ),
      )
      .all();
  }

  update(id: string, data: Partial<TaskInsert>): TaskRow | undefined {
    return this.db
      .update(tasks)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, id))
      .returning()
      .get();
  }

  complete(
    id: string,
    result: string,
    metrics: {
      inputTokens: number;
      outputTokens: number;
      estimatedCost: number;
      filesChanged: string[];
      commandsRun: string[];
    },
  ): TaskRow | undefined {
    return this.db
      .update(tasks)
      .set({
        status: 'completed',
        result,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        estimatedCost: metrics.estimatedCost,
        filesChanged: JSON.stringify(metrics.filesChanged),
        commandsRun: JSON.stringify(metrics.commandsRun),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, id))
      .returning()
      .get();
  }

  fail(id: string, errorMessage: string): TaskRow | undefined {
    return this.db
      .update(tasks)
      .set({
        status: 'failed',
        errorMessage,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, id))
      .returning()
      .get();
  }
}
