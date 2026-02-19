import { desc, eq, like, and, sql } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { promptHistory } from '../schema/prompt-history.js';
import type { PromptHistoryInsert, PromptHistoryRow } from '../schema/prompt-history.js';
import { createLogger } from '@bematic/common';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';

const logger = createLogger('PromptHistoryRepository');

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
    try {
      return this.db.insert(promptHistory).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to create prompt history entry');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'prompt_history',
        data,
      });
    }
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
    try {
      return this.create({
        prompt,
        category: options?.category,
        tags: options?.tags ? JSON.stringify(options.tags) : '[]',
        context: options?.context,
        relatedFiles: options?.relatedFiles ? JSON.stringify(options.relatedFiles) : '[]',
      });
    } catch (error) {
      logger.error({ error, prompt, options }, 'Failed to log prompt history');
      throw error; // Re-throw the error from create() which already has proper classification
    }
  }

  /**
   * Find by ID
   */
  findById(id: number): PromptHistoryRow | undefined {
    try {
      return this.db
        .select()
        .from(promptHistory)
        .where(eq(promptHistory.id, id))
        .get();
    } catch (error) {
      logger.error({ error, id }, 'Failed to find prompt history by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'prompt_history',
        data: { id },
      });
    }
  }

  /**
   * Find all with optional filters and pagination
   */
  findAll(options: PromptHistorySearchOptions = {}): PromptHistoryRow[] {
    try {
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
    } catch (error) {
      logger.error({ error, options }, 'Failed to find prompt history entries');
      throw classifySQLiteError(error, {
        operation: 'findAll',
        table: 'prompt_history',
        data: { options },
      });
    }
  }

  /**
   * Find recent entries
   */
  findRecent(limit = 50): PromptHistoryRow[] {
    try {
      return this.db
        .select()
        .from(promptHistory)
        .orderBy(desc(promptHistory.timestamp))
        .limit(limit)
        .all();
    } catch (error) {
      logger.error({ error, limit }, 'Failed to find recent prompt history entries');
      throw classifySQLiteError(error, {
        operation: 'findRecent',
        table: 'prompt_history',
        data: { limit },
      });
    }
  }

  /**
   * Update an existing entry
   */
  update(id: number, data: Partial<PromptHistoryInsert>): PromptHistoryRow | undefined {
    try {
      const result = this.db
        .update(promptHistory)
        .set(data)
        .where(eq(promptHistory.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('prompt_history', id, {
          operation: 'update',
          data,
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, data }, 'Failed to update prompt history entry');
      throw classifySQLiteError(error, {
        operation: 'update',
        table: 'prompt_history',
        data: { id, ...data },
      });
    }
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
    try {
      return this.update(id, {
        executionStatus: 'completed',
        executionNotes,
        relatedFiles: relatedFiles ? JSON.stringify(relatedFiles) : undefined,
        actualDurationMinutes,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(
        { error, id, executionNotes, relatedFiles, actualDurationMinutes },
        'Failed to mark prompt history as completed',
      );
      throw error; // Re-throw the error from update() which already has proper classification
    }
  }

  /**
   * Mark a prompt as failed
   */
  fail(id: number, executionNotes?: string): PromptHistoryRow | undefined {
    try {
      return this.update(id, {
        executionStatus: 'failed',
        executionNotes,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error, id, executionNotes }, 'Failed to mark prompt history as failed');
      throw error; // Re-throw the error from update() which already has proper classification
    }
  }

  /**
   * Mark a prompt as cancelled
   */
  cancel(id: number, executionNotes?: string): PromptHistoryRow | undefined {
    try {
      return this.update(id, {
        executionStatus: 'cancelled',
        executionNotes,
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error, id, executionNotes }, 'Failed to mark prompt history as cancelled');
      throw error; // Re-throw the error from update() which already has proper classification
    }
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
    try {
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
    } catch (error) {
      logger.error({ error }, 'Failed to get prompt history statistics');
      throw classifySQLiteError(error, {
        operation: 'getStats',
        table: 'prompt_history',
      });
    }
  }

  /**
   * Delete an entry
   */
  delete(id: number): void {
    try {
      const result = this.db.delete(promptHistory).where(eq(promptHistory.id, id)).run();

      if (result.changes === 0) {
        throw new RecordNotFoundError('prompt_history', id, {
          operation: 'delete',
        });
      }
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to delete prompt history entry');
      throw classifySQLiteError(error, {
        operation: 'delete',
        table: 'prompt_history',
        data: { id },
      });
    }
  }

  /**
   * Get all unique categories
   */
  getCategories(): string[] {
    try {
      const results = this.db
        .selectDistinct({ category: promptHistory.category })
        .from(promptHistory)
        .where(sql`${promptHistory.category} IS NOT NULL`)
        .all();

      return results.map((r) => r.category).filter((c): c is string => c !== null);
    } catch (error) {
      logger.error({ error }, 'Failed to get prompt history categories');
      throw classifySQLiteError(error, {
        operation: 'getCategories',
        table: 'prompt_history',
      });
    }
  }

  /**
   * Get all unique tags
   */
  getTags(): string[] {
    try {
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
    } catch (error) {
      logger.error({ error }, 'Failed to get prompt history tags');
      throw classifySQLiteError(error, {
        operation: 'getTags',
        table: 'prompt_history',
      });
    }
  }
}
