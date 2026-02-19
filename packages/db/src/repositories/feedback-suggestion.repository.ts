import { eq, and, desc, gte, lt } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { feedbackSuggestions } from '../schema/feedback-suggestions.js';
import type { FeedbackSuggestionInsert, FeedbackSuggestionRow } from '../schema/feedback-suggestions.js';
import { classifySQLiteError } from '../errors.js';

const logger = {
  error: (data: any, msg?: string) => console.error(msg || 'Error:', data),
  info: (data: any, msg?: string) => console.log(msg || 'Info:', data),
  warn: (data: any, msg?: string) => console.warn(msg || 'Warn:', data),
};

export class FeedbackSuggestionRepository extends BaseRepository {
  /**
   * Create a new feedback suggestion
   */
  create(data: FeedbackSuggestionInsert): FeedbackSuggestionRow {
    try {
      return this.db.insert(feedbackSuggestions).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to create feedback suggestion');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'feedback_suggestions',
        data,
      });
    }
  }

  /**
   * Find suggestion by ID
   */
  findById(id: string): FeedbackSuggestionRow | undefined {
    try {
      return this.db
        .select()
        .from(feedbackSuggestions)
        .where(eq(feedbackSuggestions.id, id))
        .get();
    } catch (error) {
      logger.error({ error, id }, 'Failed to find suggestion by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'feedback_suggestions',
        data: { id },
      });
    }
  }

  /**
   * Find pending suggestions (not yet reviewed)
   */
  findPending(limit = 50): FeedbackSuggestionRow[] {
    try {
      return this.db
        .select()
        .from(feedbackSuggestions)
        .where(eq(feedbackSuggestions.status, 'pending'))
        .orderBy(desc(feedbackSuggestions.createdAt))
        .limit(limit)
        .all();
    } catch (error) {
      logger.error({ error }, 'Failed to find pending suggestions');
      throw classifySQLiteError(error, {
        operation: 'findPending',
        table: 'feedback_suggestions',
        data: {},
      });
    }
  }

  /**
   * Find suggestions by category
   */
  findByCategory(category: string, limit = 100): FeedbackSuggestionRow[] {
    try {
      return this.db
        .select()
        .from(feedbackSuggestions)
        .where(eq(feedbackSuggestions.category, category))
        .orderBy(desc(feedbackSuggestions.createdAt))
        .limit(limit)
        .all();
    } catch (error) {
      logger.error({ error, category }, 'Failed to find suggestions by category');
      throw classifySQLiteError(error, {
        operation: 'findByCategory',
        table: 'feedback_suggestions',
        data: { category },
      });
    }
  }

  /**
   * Find suggestions within date range
   */
  findByDateRange(fromMs: number, toMs: number): FeedbackSuggestionRow[] {
    try {
      return this.db
        .select()
        .from(feedbackSuggestions)
        .where(
          and(
            gte(feedbackSuggestions.createdAt, fromMs),
            lt(feedbackSuggestions.createdAt, toMs)
          )
        )
        .orderBy(desc(feedbackSuggestions.createdAt))
        .all();
    } catch (error) {
      logger.error({ error, fromMs, toMs }, 'Failed to find suggestions by date range');
      throw classifySQLiteError(error, {
        operation: 'findByDateRange',
        table: 'feedback_suggestions',
        data: { fromMs, toMs },
      });
    }
  }

  /**
   * Mark suggestion as reviewed
   */
  markReviewed(id: string, reviewedBy: string): void {
    try {
      this.db
        .update(feedbackSuggestions)
        .set({
          status: 'reviewed',
          reviewedAt: Date.now(),
          reviewedBy,
        })
        .where(eq(feedbackSuggestions.id, id))
        .run();
    } catch (error) {
      logger.error({ error, id, reviewedBy }, 'Failed to mark suggestion as reviewed');
      throw classifySQLiteError(error, {
        operation: 'markReviewed',
        table: 'feedback_suggestions',
        data: { id, reviewedBy },
      });
    }
  }

  /**
   * Mark suggestion as applied
   */
  markApplied(id: string, notes?: string): void {
    try {
      this.db
        .update(feedbackSuggestions)
        .set({
          status: 'applied',
          appliedAt: Date.now(),
          appliedNotes: notes,
        })
        .where(eq(feedbackSuggestions.id, id))
        .run();
    } catch (error) {
      logger.error({ error, id, notes }, 'Failed to mark suggestion as applied');
      throw classifySQLiteError(error, {
        operation: 'markApplied',
        table: 'feedback_suggestions',
        data: { id, notes },
      });
    }
  }

  /**
   * Mark suggestion as rejected
   */
  markRejected(id: string, reviewedBy: string): void {
    try {
      this.db
        .update(feedbackSuggestions)
        .set({
          status: 'rejected',
          reviewedAt: Date.now(),
          reviewedBy,
        })
        .where(eq(feedbackSuggestions.id, id))
        .run();
    } catch (error) {
      logger.error({ error, id, reviewedBy }, 'Failed to mark suggestion as rejected');
      throw classifySQLiteError(error, {
        operation: 'markRejected',
        table: 'feedback_suggestions',
        data: { id, reviewedBy },
      });
    }
  }

  /**
   * Get statistics about suggestions
   */
  getStats(): {
    total: number;
    pending: number;
    reviewed: number;
    applied: number;
    rejected: number;
  } {
    try {
      const all = this.db.select().from(feedbackSuggestions).all();
      return {
        total: all.length,
        pending: all.filter((s) => s.status === 'pending').length,
        reviewed: all.filter((s) => s.status === 'reviewed').length,
        applied: all.filter((s) => s.status === 'applied').length,
        rejected: all.filter((s) => s.status === 'rejected').length,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get suggestion stats');
      throw classifySQLiteError(error, {
        operation: 'getStats',
        table: 'feedback_suggestions',
        data: {},
      });
    }
  }
}
