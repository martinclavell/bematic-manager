import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '../index.js';
import { archivedTasks, type ArchivedTaskRow, type ArchivedTaskInsert } from '../schema/archived-tasks.js';
import { createLogger } from '@bematic/common';

const logger = createLogger('archived-task-repository');

export class ArchivedTaskRepository {
  constructor(private readonly db: DB) {}

  async create(data: ArchivedTaskInsert): Promise<ArchivedTaskRow> {
    logger.debug({ data }, 'Creating archived task');

    const [created] = await this.db
      .insert(archivedTasks)
      .values(data)
      .returning();

    if (!created) {
      throw new Error('Failed to create archived task');
    }

    logger.debug({ id: created.id }, 'Archived task created');
    return created;
  }

  async findById(id: string): Promise<ArchivedTaskRow | null> {
    logger.debug({ id }, 'Finding archived task by ID');

    const [task] = await this.db
      .select()
      .from(archivedTasks)
      .where(eq(archivedTasks.id, id))
      .limit(1);

    return task || null;
  }

  async findByOriginalId(originalId: string): Promise<ArchivedTaskRow | null> {
    logger.debug({ originalId }, 'Finding archived task by original ID');

    const [task] = await this.db
      .select()
      .from(archivedTasks)
      .where(eq(archivedTasks.originalId, originalId))
      .limit(1);

    return task || null;
  }

  async findRecent(limit: number = 50, days?: number): Promise<ArchivedTaskRow[]> {
    logger.debug({ limit, days }, 'Finding recent archived tasks');

    const query = this.db
      .select()
      .from(archivedTasks)
      .orderBy(desc(archivedTasks.archivedAt));

    if (days) {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      query.where(gte(archivedTasks.archivedAt, cutoffDate));
    }

    return await query.limit(limit);
  }

  async findByProject(projectId: string, limit: number = 50): Promise<ArchivedTaskRow[]> {
    logger.debug({ projectId, limit }, 'Finding archived tasks by project');

    return await this.db
      .select()
      .from(archivedTasks)
      .where(eq(archivedTasks.projectId, projectId))
      .orderBy(desc(archivedTasks.archivedAt))
      .limit(limit);
  }

  async findByUser(userId: string, limit: number = 50): Promise<ArchivedTaskRow[]> {
    logger.debug({ userId, limit }, 'Finding archived tasks by user');

    return await this.db
      .select()
      .from(archivedTasks)
      .where(eq(archivedTasks.userId, userId))
      .orderBy(desc(archivedTasks.archivedAt))
      .limit(limit);
  }

  async getStats(): Promise<{
    total: number;
    byReason: Record<string, number>;
    byStatus: Record<string, number>;
    oldestArchive: Date | null;
    newestArchive: Date | null;
  }> {
    logger.debug('Getting archive statistics');

    const [totalResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(archivedTasks);

    const reasonStats = await this.db
      .select({
        reason: archivedTasks.reason,
        count: sql<number>`count(*)`
      })
      .from(archivedTasks)
      .groupBy(archivedTasks.reason);

    const statusStats = await this.db
      .select({
        status: archivedTasks.status,
        count: sql<number>`count(*)`
      })
      .from(archivedTasks)
      .where(sql`${archivedTasks.status} IS NOT NULL`)
      .groupBy(archivedTasks.status);

    const [dateRange] = await this.db
      .select({
        oldest: sql<number>`min(archived_at)`,
        newest: sql<number>`max(archived_at)`
      })
      .from(archivedTasks);

    return {
      total: totalResult.count,
      byReason: reasonStats.reduce((acc: Record<string, number>, { reason, count }: { reason: string; count: number }) => {
        acc[reason] = count;
        return acc;
      }, {} as Record<string, number>),
      byStatus: statusStats.reduce((acc: Record<string, number>, { status, count }: { status: string | null; count: number }) => {
        if (status) acc[status] = count;
        return acc;
      }, {} as Record<string, number>),
      oldestArchive: dateRange.oldest ? new Date(dateRange.oldest * 1000) : null,
      newestArchive: dateRange.newest ? new Date(dateRange.newest * 1000) : null,
    };
  }

  async delete(id: string): Promise<boolean> {
    logger.debug({ id }, 'Deleting archived task');

    const result = await this.db
      .delete(archivedTasks)
      .where(eq(archivedTasks.id, id));

    return result.changes > 0;
  }

  async deleteOldArchives(retentionDays: number): Promise<number> {
    logger.debug({ retentionDays }, 'Deleting old archived tasks');

    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await this.db
      .delete(archivedTasks)
      .where(sql`${archivedTasks.archivedAt} < ${Math.floor(cutoffDate.getTime() / 1000)}`);

    logger.info({ deleted: result.changes }, 'Deleted old archived tasks');
    return result.changes;
  }
}