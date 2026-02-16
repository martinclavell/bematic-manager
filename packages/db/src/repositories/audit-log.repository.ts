import { desc } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { auditLogs } from '../schema/audit-logs.js';
import type { AuditLogInsert, AuditLogRow } from '../schema/audit-logs.js';

export class AuditLogRepository extends BaseRepository {
  create(data: AuditLogInsert): AuditLogRow {
    return this.db.insert(auditLogs).values(data).returning().get();
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
    return this.db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .all();
  }
}
