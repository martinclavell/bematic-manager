import { and, desc, eq } from 'drizzle-orm';
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
    return this.create({
      action,
      resourceType,
      resourceId,
      userId: userId ?? null,
      metadata: metadata ? JSON.stringify(metadata) : '{}',
    });
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

  findByUser(userId: string, limit = 100): AuditLogRow[] {
    try {
      return this.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.userId, userId))
        .orderBy(desc(auditLogs.timestamp))
        .limit(limit)
        .all();
    } catch (error) {
      logger.error({ error, userId, limit }, 'Failed to find audit logs by user');
      throw classifySQLiteError(error, {
        operation: 'findByUser',
        table: 'audit_logs',
        data: { userId, limit },
      });
    }
  }

  findByAction(action: string, limit = 100): AuditLogRow[] {
    try {
      return this.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, action))
        .orderBy(desc(auditLogs.timestamp))
        .limit(limit)
        .all();
    } catch (error) {
      logger.error({ error, action, limit }, 'Failed to find audit logs by action');
      throw classifySQLiteError(error, {
        operation: 'findByAction',
        table: 'audit_logs',
        data: { action, limit },
      });
    }
  }

  findByResource(resourceType: string, resourceId: string, limit = 100): AuditLogRow[] {
    try {
      return this.db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resourceType, resourceType),
            eq(auditLogs.resourceId, resourceId),
          )
        )
        .orderBy(desc(auditLogs.timestamp))
        .limit(limit)
        .all();
    } catch (error) {
      logger.error({ error, resourceType, resourceId, limit }, 'Failed to find audit logs by resource');
      throw classifySQLiteError(error, {
        operation: 'findByResource',
        table: 'audit_logs',
        data: { resourceType, resourceId, limit },
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
