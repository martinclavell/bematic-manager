import { eq } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { sessions } from '../schema/sessions.js';
import type { SessionInsert, SessionRow } from '../schema/sessions.js';

export class SessionRepository extends BaseRepository {
  create(data: SessionInsert): SessionRow {
    return this.db.insert(sessions).values(data).returning().get();
  }

  findById(id: string): SessionRow | undefined {
    return this.db.select().from(sessions).where(eq(sessions.id, id)).get();
  }

  findByTaskId(taskId: string): SessionRow[] {
    return this.db
      .select()
      .from(sessions)
      .where(eq(sessions.taskId, taskId))
      .all();
  }

  complete(
    id: string,
    metrics: {
      inputTokens: number;
      outputTokens: number;
      estimatedCost: number;
      durationMs: number;
    },
  ): SessionRow | undefined {
    return this.db
      .update(sessions)
      .set({
        status: 'completed',
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        estimatedCost: metrics.estimatedCost,
        durationMs: metrics.durationMs,
        completedAt: new Date().toISOString(),
      })
      .where(eq(sessions.id, id))
      .returning()
      .get();
  }
}
