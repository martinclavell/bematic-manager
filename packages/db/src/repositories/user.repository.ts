import { eq } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { users } from '../schema/users.js';
import type { UserInsert, UserRow } from '../schema/users.js';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';

// Simple logger for testing
const logger = {
  error: (data: any, msg?: string) => console.error(msg || 'Error:', data),
  info: (data: any, msg?: string) => console.log(msg || 'Info:', data),
  warn: (data: any, msg?: string) => console.warn(msg || 'Warn:', data),
};

export class UserRepository extends BaseRepository {
  create(data: UserInsert): UserRow {
    try {
      return this.db.insert(users).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to create user');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'users',
        data,
      });
    }
  }

  findById(id: string): UserRow | undefined {
    try {
      return this.db.select().from(users).where(eq(users.id, id)).get();
    } catch (error) {
      logger.error({ error, id }, 'Failed to find user by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'users',
        data: { id },
      });
    }
  }

  findBySlackUserId(slackUserId: string): UserRow | undefined {
    try {
      return this.db
        .select()
        .from(users)
        .where(eq(users.slackUserId, slackUserId))
        .get();
    } catch (error) {
      logger.error({ error, slackUserId }, 'Failed to find user by Slack user id');
      throw classifySQLiteError(error, {
        operation: 'findBySlackUserId',
        table: 'users',
        data: { slackUserId },
      });
    }
  }

  upsert(data: UserInsert): UserRow {
    try {
      // Try to find existing
      const existing = this.findBySlackUserId(data.slackUserId);
      if (existing) {
        const result = this.db
          .update(users)
          .set({
            slackUsername: data.slackUsername,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(users.id, existing.id))
          .returning()
          .get();

        if (!result) {
          throw new RecordNotFoundError('users', existing.id, {
            operation: 'upsert-update',
            data,
          });
        }

        return result;
      }
      return this.create(data);
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, data }, 'Failed to upsert user');
      throw classifySQLiteError(error, {
        operation: 'upsert',
        table: 'users',
        data,
      });
    }
  }

  updateRole(id: string, role: string): UserRow | undefined {
    try {
      const result = this.db
        .update(users)
        .set({ role, updatedAt: new Date().toISOString() })
        .where(eq(users.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('users', id, {
          operation: 'updateRole',
          data: { role },
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, role }, 'Failed to update user role');
      throw classifySQLiteError(error, {
        operation: 'updateRole',
        table: 'users',
        data: { id, role },
      });
    }
  }

  findAll(): UserRow[] {
    try {
      return this.db.select().from(users).all();
    } catch (error) {
      logger.error({ error }, 'Failed to find all users');
      throw classifySQLiteError(error, {
        operation: 'findAll',
        table: 'users',
      });
    }
  }

  findByRole(role: string): UserRow[] {
    try {
      return this.db
        .select()
        .from(users)
        .where(eq(users.role, role))
        .all();
    } catch (error) {
      logger.error({ error, role }, 'Failed to find users by role');
      throw classifySQLiteError(error, {
        operation: 'findByRole',
        table: 'users',
        data: { role },
      });
    }
  }

  findActiveUsers(): UserRow[] {
    try {
      return this.db
        .select()
        .from(users)
        .where(eq(users.active, true))
        .all();
    } catch (error) {
      logger.error({ error }, 'Failed to find active users');
      throw classifySQLiteError(error, {
        operation: 'findActiveUsers',
        table: 'users',
      });
    }
  }

  changeRole(id: string, newRole: string): UserRow | undefined {
    try {
      const result = this.db
        .update(users)
        .set({
          role: newRole,
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('users', id, {
          operation: 'changeRole',
          data: { newRole },
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, newRole }, 'Failed to change user role');
      throw classifySQLiteError(error, {
        operation: 'changeRole',
        table: 'users',
        data: { id, newRole },
      });
    }
  }

  deactivateUser(id: string): UserRow | undefined {
    try {
      const result = this.db
        .update(users)
        .set({
          active: false,
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('users', id, {
          operation: 'deactivateUser',
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to deactivate user');
      throw classifySQLiteError(error, {
        operation: 'deactivateUser',
        table: 'users',
        data: { id },
      });
    }
  }

  reactivateUser(id: string): UserRow | undefined {
    try {
      const result = this.db
        .update(users)
        .set({
          active: true,
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('users', id, {
          operation: 'reactivateUser',
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to reactivate user');
      throw classifySQLiteError(error, {
        operation: 'reactivateUser',
        table: 'users',
        data: { id },
      });
    }
  }

  updateRateLimitOverride(id: string, rateLimitOverride: number | null): UserRow | undefined {
    try {
      const result = this.db
        .update(users)
        .set({
          rateLimitOverride,
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('users', id, {
          operation: 'updateRateLimitOverride',
          data: { rateLimitOverride },
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, rateLimitOverride }, 'Failed to update rate limit override');
      throw classifySQLiteError(error, {
        operation: 'updateRateLimitOverride',
        table: 'users',
        data: { id, rateLimitOverride },
      });
    }
  }
}
