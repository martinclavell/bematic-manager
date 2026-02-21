import { eq, and, asc, isNull, or } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { globalContexts } from '../schema/global-contexts.js';
import type { GlobalContextInsert, GlobalContextRow } from '../schema/global-contexts.js';
import { createLogger } from '@bematic/common';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';

const logger = createLogger('GlobalContextRepository');

export class GlobalContextRepository extends BaseRepository {
  /**
   * Create a new global context
   */
  create(data: GlobalContextInsert): GlobalContextRow {
    try {
      return this.db.insert(globalContexts).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to create global context');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'global_contexts',
        data,
      });
    }
  }

  /**
   * Find all global contexts (both enabled and disabled)
   */
  findAll(): GlobalContextRow[] {
    try {
      return this.db
        .select()
        .from(globalContexts)
        .orderBy(asc(globalContexts.priority), asc(globalContexts.createdAt))
        .all();
    } catch (error) {
      logger.error({ error }, 'Failed to find all global contexts');
      throw classifySQLiteError(error, {
        operation: 'findAll',
        table: 'global_contexts',
      });
    }
  }

  /**
   * Find all enabled global contexts (scope=global), ordered by priority
   */
  findActiveGlobal(): GlobalContextRow[] {
    try {
      return this.db
        .select()
        .from(globalContexts)
        .where(
          and(
            eq(globalContexts.enabled, true),
            eq(globalContexts.scope, 'global'),
            isNull(globalContexts.projectId)
          )
        )
        .orderBy(asc(globalContexts.priority), asc(globalContexts.createdAt))
        .all();
    } catch (error) {
      logger.error({ error }, 'Failed to find active global contexts');
      throw classifySQLiteError(error, {
        operation: 'findActiveGlobal',
        table: 'global_contexts',
      });
    }
  }

  /**
   * Find all enabled contexts for a specific project (includes project-specific overrides)
   */
  findActiveForProject(projectId: string): GlobalContextRow[] {
    try {
      return this.db
        .select()
        .from(globalContexts)
        .where(
          and(
            eq(globalContexts.enabled, true),
            or(
              // Global contexts
              and(eq(globalContexts.scope, 'global'), isNull(globalContexts.projectId)),
              // Project-specific contexts
              and(eq(globalContexts.scope, 'project'), eq(globalContexts.projectId, projectId))
            )
          )
        )
        .orderBy(asc(globalContexts.priority), asc(globalContexts.createdAt))
        .all();
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to find active contexts for project');
      throw classifySQLiteError(error, {
        operation: 'findActiveForProject',
        table: 'global_contexts',
        data: { projectId },
      });
    }
  }

  /**
   * Find contexts by category
   */
  findByCategory(category: string): GlobalContextRow[] {
    try {
      return this.db
        .select()
        .from(globalContexts)
        .where(eq(globalContexts.category, category))
        .orderBy(asc(globalContexts.priority))
        .all();
    } catch (error) {
      logger.error({ error, category }, 'Failed to find contexts by category');
      throw classifySQLiteError(error, {
        operation: 'findByCategory',
        table: 'global_contexts',
        data: { category },
      });
    }
  }

  /**
   * Find a context by ID
   */
  findById(id: string): GlobalContextRow | undefined {
    try {
      return this.db
        .select()
        .from(globalContexts)
        .where(eq(globalContexts.id, id))
        .get();
    } catch (error) {
      logger.error({ error, id }, 'Failed to find global context by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'global_contexts',
        data: { id },
      });
    }
  }

  /**
   * Update a context
   */
  update(id: string, data: Partial<GlobalContextInsert>): GlobalContextRow {
    try {
      const result = this.db
        .update(globalContexts)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(globalContexts.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('global_contexts', id, {
          operation: 'update',
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, data }, 'Failed to update global context');
      throw classifySQLiteError(error, {
        operation: 'update',
        table: 'global_contexts',
        data: { id, ...data },
      });
    }
  }

  /**
   * Set enabled/disabled status
   */
  setEnabled(id: string, enabled: boolean): GlobalContextRow {
    try {
      return this.update(id, { enabled });
    } catch (error) {
      logger.error({ error, id, enabled }, 'Failed to set enabled status');
      throw error;
    }
  }

  /**
   * Delete a context
   */
  delete(id: string): void {
    try {
      const result = this.db
        .delete(globalContexts)
        .where(eq(globalContexts.id, id))
        .run();

      if (result.changes === 0) {
        throw new RecordNotFoundError('global_contexts', id, {
          operation: 'delete',
        });
      }
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to delete global context');
      throw classifySQLiteError(error, {
        operation: 'delete',
        table: 'global_contexts',
        data: { id },
      });
    }
  }
}
