import { eq } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { netsuiteConfigs } from '../schema/netsuite-configs.js';
import type { NetSuiteConfigInsert, NetSuiteConfigRow } from '../schema/netsuite-configs.js';
import { createLogger, performanceMonitor } from '@bematic/common';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';

const logger = createLogger('NetSuiteConfigRepository');

export class NetSuiteConfigRepository extends BaseRepository {
  create(data: NetSuiteConfigInsert): NetSuiteConfigRow {
    try {
      const config = performanceMonitor.recordDatabaseQuery(
        'netsuite_config.create',
        () => this.db.insert(netsuiteConfigs).values(data).returning().get(),
        { projectId: data.projectId }
      );

      return config;
    } catch (error) {
      logger.error({ error, data }, 'Failed to create NetSuite config');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'netsuite_configs',
        data,
      });
    }
  }

  findById(id: string): NetSuiteConfigRow | undefined {
    try {
      const config = performanceMonitor.recordDatabaseQuery(
        'netsuite_config.findById',
        () => this.db.select().from(netsuiteConfigs).where(eq(netsuiteConfigs.id, id)).get(),
        { configId: id }
      );

      return config;
    } catch (error) {
      logger.error({ error, id }, 'Failed to find NetSuite config by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'netsuite_configs',
        data: { id },
      });
    }
  }

  findByProjectId(projectId: string): NetSuiteConfigRow | undefined {
    try {
      const config = performanceMonitor.recordDatabaseQuery(
        'netsuite_config.findByProjectId',
        () => this.db
          .select()
          .from(netsuiteConfigs)
          .where(eq(netsuiteConfigs.projectId, projectId))
          .get(),
        { projectId }
      );

      return config;
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to find NetSuite config by project id');
      throw classifySQLiteError(error, {
        operation: 'findByProjectId',
        table: 'netsuite_configs',
        data: { projectId },
      });
    }
  }

  findAll(): NetSuiteConfigRow[] {
    try {
      return performanceMonitor.recordDatabaseQuery(
        'netsuite_config.findAll',
        () => this.db.select().from(netsuiteConfigs).all()
      );
    } catch (error) {
      logger.error({ error }, 'Failed to find all NetSuite configs');
      throw classifySQLiteError(error, {
        operation: 'findAll',
        table: 'netsuite_configs',
      });
    }
  }

  update(id: string, data: Partial<NetSuiteConfigInsert>): NetSuiteConfigRow | undefined {
    try {
      const result = performanceMonitor.recordDatabaseQuery(
        'netsuite_config.update',
        () => this.db
          .update(netsuiteConfigs)
          .set({ ...data, updatedAt: new Date().toISOString() })
          .where(eq(netsuiteConfigs.id, id))
          .returning()
          .get(),
        { configId: id, updateFields: Object.keys(data) }
      );

      if (!result) {
        throw new RecordNotFoundError('netsuite_configs', id, {
          operation: 'update',
          data,
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, data }, 'Failed to update NetSuite config');
      throw classifySQLiteError(error, {
        operation: 'update',
        table: 'netsuite_configs',
        data: { id, ...data },
      });
    }
  }

  upsertByProjectId(projectId: string, data: Omit<NetSuiteConfigInsert, 'id' | 'projectId'>): NetSuiteConfigRow {
    try {
      const existing = this.findByProjectId(projectId);

      if (existing) {
        return this.update(existing.id, data)!;
      } else {
        const { generateId } = require('@bematic/common');
        return this.create({
          id: generateId('netsuite-config'),
          projectId,
          ...data,
        });
      }
    } catch (error) {
      logger.error({ error, projectId, data }, 'Failed to upsert NetSuite config');
      throw error;
    }
  }

  delete(id: string): void {
    try {
      const result = performanceMonitor.recordDatabaseQuery(
        'netsuite_config.delete',
        () => this.db.delete(netsuiteConfigs).where(eq(netsuiteConfigs.id, id)).run(),
        { configId: id }
      );

      if (result.changes === 0) {
        throw new RecordNotFoundError('netsuite_configs', id, {
          operation: 'delete',
        });
      }
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to delete NetSuite config');
      throw classifySQLiteError(error, {
        operation: 'delete',
        table: 'netsuite_configs',
        data: { id },
      });
    }
  }

  deleteByProjectId(projectId: string): void {
    try {
      const existing = this.findByProjectId(projectId);
      if (existing) {
        this.delete(existing.id);
      }
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to delete NetSuite config by project id');
      throw error;
    }
  }
}
