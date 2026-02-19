import { eq, and, isNull, lt } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { apiKeys } from '../schema/api-keys.js';
import type { ApiKeyInsert, ApiKeyRow } from '../schema/api-keys.js';
import { createLogger } from '@bematic/common';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';

const logger = createLogger('ApiKeyRepository');

export class ApiKeyRepository extends BaseRepository {
  create(data: ApiKeyInsert): ApiKeyRow {
    try {
      return this.db.insert(apiKeys).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data: { ...data, key: '[REDACTED]' } }, 'Failed to create API key');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'api_keys',
        data: { ...data, key: '[REDACTED]' },
      });
    }
  }

  findById(id: string): ApiKeyRow | undefined {
    try {
      return this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).get();
    } catch (error) {
      logger.error({ error, id }, 'Failed to find API key by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'api_keys',
        data: { id },
      });
    }
  }

  findByKey(key: string): ApiKeyRow | undefined {
    try {
      return this.db.select().from(apiKeys).where(eq(apiKeys.key, key)).get();
    } catch (error) {
      logger.error({ error }, 'Failed to find API key by key');
      throw classifySQLiteError(error, {
        operation: 'findByKey',
        table: 'api_keys',
        data: { key: '[REDACTED]' },
      });
    }
  }

  findByAgentId(agentId: string): ApiKeyRow[] {
    try {
      return this.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.agentId, agentId))
        .all();
    } catch (error) {
      logger.error({ error, agentId }, 'Failed to find API keys by agent id');
      throw classifySQLiteError(error, {
        operation: 'findByAgentId',
        table: 'api_keys',
        data: { agentId },
      });
    }
  }

  findValidKeys(): ApiKeyRow[] {
    try {
      const now = new Date();
      return this.db
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.revoked, false),
            // Key is either non-expiring (null) or not yet expired
            // Using OR logic: expiresAt IS NULL OR expiresAt > now
            // Since we can't use OR directly, we'll handle expired keys in a separate method
          )
        )
        .all()
        .filter(key => key.expiresAt === null || key.expiresAt > now);
    } catch (error) {
      logger.error({ error }, 'Failed to find valid API keys');
      throw classifySQLiteError(error, {
        operation: 'findValidKeys',
        table: 'api_keys',
      });
    }
  }

  findAll(): ApiKeyRow[] {
    try {
      return this.db.select().from(apiKeys).all();
    } catch (error) {
      logger.error({ error }, 'Failed to find all API keys');
      throw classifySQLiteError(error, {
        operation: 'findAll',
        table: 'api_keys',
      });
    }
  }

  updateLastUsed(key: string): void {
    try {
      const now = new Date();
      this.db
        .update(apiKeys)
        .set({ lastUsedAt: now })
        .where(eq(apiKeys.key, key))
        .run();
    } catch (error) {
      logger.error({ error }, 'Failed to update last used timestamp');
      throw classifySQLiteError(error, {
        operation: 'updateLastUsed',
        table: 'api_keys',
        data: { key: '[REDACTED]' },
      });
    }
  }

  revoke(id: string): ApiKeyRow | undefined {
    try {
      const result = this.db
        .update(apiKeys)
        .set({ revoked: true })
        .where(eq(apiKeys.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('api_keys', id, {
          operation: 'revoke',
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to revoke API key');
      throw classifySQLiteError(error, {
        operation: 'revoke',
        table: 'api_keys',
        data: { id },
      });
    }
  }

  cleanupExpiredAndRevoked(): { deleted: number } {
    try {
      const now = new Date();

      // First delete revoked keys
      const revokedResult = this.db
        .delete(apiKeys)
        .where(eq(apiKeys.revoked, true))
        .run();

      // Then delete expired keys
      const expiredResult = this.db
        .delete(apiKeys)
        .where(
          and(
            eq(apiKeys.revoked, false),
            lt(apiKeys.expiresAt, now)
          )
        )
        .run();

      const totalDeleted = revokedResult.changes + expiredResult.changes;

      logger.info(
        { revokedDeleted: revokedResult.changes, expiredDeleted: expiredResult.changes },
        'Cleaned up API keys'
      );

      return { deleted: totalDeleted };
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup expired and revoked API keys');
      throw classifySQLiteError(error, {
        operation: 'cleanupExpiredAndRevoked',
        table: 'api_keys',
      });
    }
  }

  delete(id: string): void {
    try {
      const result = this.db.delete(apiKeys).where(eq(apiKeys.id, id)).run();

      if (result.changes === 0) {
        throw new RecordNotFoundError('api_keys', id, {
          operation: 'delete',
        });
      }
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to delete API key');
      throw classifySQLiteError(error, {
        operation: 'delete',
        table: 'api_keys',
        data: { id },
      });
    }
  }
}