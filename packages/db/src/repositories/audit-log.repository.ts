import { desc, eq } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { auditLogs } from '../schema/audit-logs.js';
import type { AuditLogInsert, AuditLogRow } from '../schema/audit-logs.js';
import { createLogger } from '@bematic/common';
import { classifySQLiteError } from '../errors.js';

const logger = createLogger('AuditLogRepository');

export class AuditLogRepository extends BaseRepository {
  create(data: AuditLogInsert): AuditLogRow {
    try {
      return this.db.insert(auditLogs).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to create audit log entry');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'audit_logs',
        data,
      });
    }
  }

  log(
    action: string,
    resourceType: string,
    resourceId: string | null,
    userId?: string | null,
    metadata?: Record<string, unknown>,
  ): AuditLogRow {
    try {
      return this.create({
        action,
        resourceType,
        resourceId,
        userId: userId ?? null,
        metadata: metadata ? JSON.stringify(metadata) : '{}',
      });
    } catch (error) {
      logger.error(
        { error, action, resourceType, resourceId, userId, metadata },
        'Failed to log audit entry',
      );
      throw error; // Re-throw the error from create() which already has proper classification
    }
  }

  findRecent(limit = 100): AuditLogRow[] {
    try {
      return this.db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.timestamp))
        .limit(limit)
        .all();
    } catch (error) {
      logger.error({ error, limit }, 'Failed to find recent audit logs');
      throw classifySQLiteError(error, {
        operation: 'findRecent',
        table: 'audit_logs',
        data: { limit },
      });
    }
  }

  findAll(): AuditLogRow[] {
    try {
      return this.db.select().from(auditLogs).all();
    } catch (error) {
      logger.error({ error }, 'Failed to find all audit logs');
      throw classifySQLiteError(error, {
        operation: 'findAll',
        table: 'audit_logs',
      });
    }
  }

  delete(id: number): boolean {
    try {
      const result = this.db.delete(auditLogs).where(eq(auditLogs.id, id)).run();
      return result.changes > 0;
    } catch (error) {
      logger.error({ error, id }, 'Failed to delete audit log entry');
      throw classifySQLiteError(error, {
        operation: 'delete',
        table: 'audit_logs',
        data: { id },
      });
    }
  }
}
