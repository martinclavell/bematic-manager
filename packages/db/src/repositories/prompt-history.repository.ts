import { desc, eq, like, and, sql } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { promptHistory } from '../schema/prompt-history.js';
import type { PromptHistoryInsert, PromptHistoryRow } from '../schema/prompt-history.js';

export interface PromptHistorySearchOptions {
  category?: string;
  status?: string;
  searchText?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export class PromptHistoryRepository extends BaseRepository {
  /**
   * Create a new prompt history entry
   */
  create(data: PromptHistoryInsert): PromptHistoryRow {
    return this.db.insert(promptHistory).values(data).returning().get();
  }

  /**
   * Log a new prompt/task
   */
  log(
    prompt: string,
    options?: {
      category?: string;
      tags?: string[];
      context?: string;
      relatedFiles?: string[];
    },
  ): PromptHistoryRow {
    return this.create({
      prompt,
      category: options?.category,
      tags: options?.tags ? JSON.stringify(options.tags) : '[]',
      context: options?.context,
      relatedFiles: options?.relatedFiles ? JSON.stringify(options.relatedFiles) : '[]',
    });
  }

  /**
   * Find by ID
   */
  findById(id: number): PromptHistoryRow | undefined {
    return this.db
      .select()
      .from(promptHistory)
      .where(eq(promptHistory.id, id))
      .get();
  }

  /**
   * Find all with optional filters and pagination
   */
  findAll(options: PromptHistorySearchOptions = {}): PromptHistoryRow[] {
    const { category, status, searchText, tag, limit = 100, offset = 0 } = options;

    const conditions = [];

    if (category) {
      conditions.push(eq(promptHistory.category, category));
    }

    if (status) {
      conditions.push(eq(promptHistory.executionStatus, status));
    }

    if (searchText) {
      conditions.push(
        sql`(${promptHistory.prompt} LIKE ${`%${searchText}%`} OR ${promptHistory.context} LIKE ${`%${searchText}%`})`,
      );
    }

    if (tag) {
      conditions.push(
        sql`${promptHistory.tags} LIKE ${`%"${tag}"%`}`,
      );
    }

    let query = this.db
      .select()
      .from(promptHistory)
      .orderBy(desc(promptHistory.timestamp))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    return query.all();
  }

  /**
   * Find recent entries
   */
  findRecent(limit = 50): PromptHistoryRow[] {
    return this.db
      .select()
      .from(promptHistory)
      .orderBy(desc(promptHistory.timestamp))
      .limit(limit)
      .all();
  }

  /**
   * Update an existing entry
   */
  update(id: number, data: Partial<PromptHistoryInsert>): PromptHistoryRow | undefined {
    return this.db
      .update(promptHistory)
      .set(data)
      .where(eq(promptHistory.id, id))
      .returning()
      .get();
  }

  /**
   * Mark a prompt as completed
   */
  complete(
    id: number,
    executionNotes?: string,
    relatedFiles?: string[],
    actualDurationMinutes?: number,
  ): PromptHistoryRow | undefined {
    return this.update(id, {
      executionStatus: 'completed',
      executionNotes,
      relatedFiles: relatedFiles ? JSON.stringify(relatedFiles) : undefined,
      actualDurationMinutes,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Mark a prompt as failed
   */
  fail(id: number, executionNotes?: string): PromptHistoryRow | undefined {
    return this.update(id, {
      executionStatus: 'failed',
      executionNotes,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Mark a prompt as cancelled
   */
  cancel(id: number, executionNotes?: string): PromptHistoryRow | undefined {
    return this.update(id, {
      executionStatus: 'cancelled',
      executionNotes,
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    completed: number;
    pending: number;
    failed: number;
    cancelled: number;
    averageDuration: number | null;
  } {
    const totalResult = this.db
      .select({ count: sql<number>`count(*)` })
      .from(promptHistory)
      .get();

    const completedResult = this.db
      .select({ count: sql<number>`count(*)` })
      .from(promptHistory)
      .where(eq(promptHistory.executionStatus, 'completed'))
      .get();

    const pendingResult = this.db
      .select({ count: sql<number>`count(*)` })
      .from(promptHistory)
      .where(eq(promptHistory.executionStatus, 'pending'))
      .get();

    const failedResult = this.db
      .select({ count: sql<number>`count(*)` })
      .from(promptHistory)
      .where(eq(promptHistory.executionStatus, 'failed'))
      .get();

    const cancelledResult = this.db
      .select({ count: sql<number>`count(*)` })
      .from(promptHistory)
      .where(eq(promptHistory.executionStatus, 'cancelled'))
      .get();

    const avgDurationResult = this.db
      .select({ avg: sql<number | null>`avg(${promptHistory.actualDurationMinutes})` })
      .from(promptHistory)
      .where(eq(promptHistory.executionStatus, 'completed'))
      .get();

    return {
      total: totalResult?.count ?? 0,
      completed: completedResult?.count ?? 0,
      pending: pendingResult?.count ?? 0,
      failed: failedResult?.count ?? 0,
      cancelled: cancelledResult?.count ?? 0,
      averageDuration: avgDurationResult?.avg ?? null,
    };
  }

  /**
   * Delete an entry
   */
  delete(id: number): void {
    this.db.delete(promptHistory).where(eq(promptHistory.id, id)).run();
  }

  /**
   * Get all unique categories
   */
  getCategories(): string[] {
    const results = this.db
      .selectDistinct({ category: promptHistory.category })
      .from(promptHistory)
      .where(sql`${promptHistory.category} IS NOT NULL`)
      .all();

    return results.map((r) => r.category).filter((c): c is string => c !== null);
  }

  /**
   * Get all unique tags
   */
  getTags(): string[] {
    const results = this.db
      .select({ tags: promptHistory.tags })
      .from(promptHistory)
      .all();

    const allTags = new Set<string>();
    for (const row of results) {
      try {
        const tags = JSON.parse(row.tags) as string[];
        tags.forEach((tag) => allTags.add(tag));
      } catch {
        // Ignore invalid JSON
      }
    }

    return Array.from(allTags).sort();
  }
}
