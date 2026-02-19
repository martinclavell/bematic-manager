import { eq, lt, and, isNull } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { sessions } from '../schema/sessions.js';
import type { SessionInsert, SessionRow } from '../schema/sessions.js';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';

// Simple logger for testing
const logger = {
  error: (data: any, msg?: string) => console.error(msg || 'Error:', data),
  info: (data: any, msg?: string) => console.log(msg || 'Info:', data),
  warn: (data: any, msg?: string) => console.warn(msg || 'Warn:', data),
};

export class SessionRepository extends BaseRepository {
  create(data: SessionInsert): SessionRow {
    try {
      return this.db.insert(sessions).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to create session');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'sessions',
        data,
      });
    }
  }

  findById(id: string): SessionRow | undefined {
    try {
      return this.db.select().from(sessions).where(eq(sessions.id, id)).get();
    } catch (error) {
      logger.error({ error, id }, 'Failed to find session by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'sessions',
        data: { id },
      });
    }
  }

  findByTaskId(taskId: string): SessionRow[] {
    try {
      return this.db
        .select()
        .from(sessions)
        .where(eq(sessions.taskId, taskId))
        .all();
    } catch (error) {
      logger.error({ error, taskId }, 'Failed to find sessions by task id');
      throw classifySQLiteError(error, {
        operation: 'findByTaskId',
        table: 'sessions',
        data: { taskId },
      });
    }
  }

  findAll(): SessionRow[] {
    try {
      return this.db.select().from(sessions).all();
    } catch (error) {
      logger.error({ error }, 'Failed to find all sessions');
      throw classifySQLiteError(error, {
        operation: 'findAll',
        table: 'sessions',
      });
    }
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
    try {
      const result = this.db
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

      if (!result) {
        throw new RecordNotFoundError('sessions', id, {
          operation: 'complete',
          data: { metrics },
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, metrics }, 'Failed to complete session');
      throw classifySQLiteError(error, {
        operation: 'complete',
        table: 'sessions',
        data: { id, metrics },
      });
    }
  }

  delete(id: string): boolean {
    try {
      const result = this.db.delete(sessions).where(eq(sessions.id, id)).run();
      return result.changes > 0;
    } catch (error) {
      logger.error({ error, id }, 'Failed to delete session');
      throw classifySQLiteError(error, {
        operation: 'delete',
        table: 'sessions',
        data: { id },
      });
    }
  }

  findExpired(): SessionRow[] {
    try {
      const now = new Date().toISOString();
      return this.db
        .select()
        .from(sessions)
        .where(
          and(
            lt(sessions.expiresAt, now),
            eq(sessions.status, 'active')
          )
        )
        .all();
    } catch (error) {
      logger.error({ error }, 'Failed to find expired sessions');
      throw classifySQLiteError(error, {
        operation: 'findExpired',
        table: 'sessions',
      });
    }
  }

  findActiveSessions(): SessionRow[] {
    try {
      return this.db
        .select()
        .from(sessions)
        .where(eq(sessions.status, 'active'))
        .all();
    } catch (error) {
      logger.error({ error }, 'Failed to find active sessions');
      throw classifySQLiteError(error, {
        operation: 'findActiveSessions',
        table: 'sessions',
      });
    }
  }

  invalidateSession(id: string): SessionRow | undefined {
    try {
      const result = this.db
        .update(sessions)
        .set({
          status: 'invalidated',
          completedAt: new Date().toISOString(),
        })
        .where(eq(sessions.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('sessions', id, {
          operation: 'invalidateSession',
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to invalidate session');
      throw classifySQLiteError(error, {
        operation: 'invalidateSession',
        table: 'sessions',
        data: { id },
      });
    }
  }

  updateLastActivity(id: string): SessionRow | undefined {
    try {
      const result = this.db
        .update(sessions)
        .set({
          lastActivityAt: new Date().toISOString(),
        })
        .where(eq(sessions.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('sessions', id, {
          operation: 'updateLastActivity',
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to update last activity');
      throw classifySQLiteError(error, {
        operation: 'updateLastActivity',
        table: 'sessions',
        data: { id },
      });
    }
  }

  cleanupExpiredSessions(): number {
    try {
      const now = new Date().toISOString();
      const result = this.db
        .update(sessions)
        .set({
          status: 'expired',
          completedAt: now,
        })
        .where(
          and(
            lt(sessions.expiresAt, now),
            eq(sessions.status, 'active')
          )
        )
        .run();

      return result.changes;
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup expired sessions');
      throw classifySQLiteError(error, {
        operation: 'cleanupExpiredSessions',
        table: 'sessions',
      });
    }
  }

  extendSession(id: string, hoursToAdd: number = 24): SessionRow | undefined {
    try {
      const currentSession = this.findById(id);
      if (!currentSession) {
        throw new RecordNotFoundError('sessions', id, {
          operation: 'extendSession',
        });
      }

      const newExpiresAt = new Date(Date.now() + (hoursToAdd * 60 * 60 * 1000)).toISOString();

      const result = this.db
        .update(sessions)
        .set({
          expiresAt: newExpiresAt,
          lastActivityAt: new Date().toISOString(),
        })
        .where(eq(sessions.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('sessions', id, {
          operation: 'extendSession',
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, hoursToAdd }, 'Failed to extend session');
      throw classifySQLiteError(error, {
        operation: 'extendSession',
        table: 'sessions',
        data: { id, hoursToAdd },
      });
    }
  }
}
