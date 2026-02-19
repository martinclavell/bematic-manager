import { eq } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { projects } from '../schema/projects.js';
import type { ProjectInsert, ProjectRow } from '../schema/projects.js';
import { createLogger, performanceMonitor } from '@bematic/common';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';
import { projectCache, CacheKeys, CacheInvalidators } from '@bematic/common';

const logger = createLogger('ProjectRepository');

export class ProjectRepository extends BaseRepository {
  create(data: ProjectInsert): ProjectRow {
    try {
      const project = performanceMonitor.recordDatabaseQuery(
        'project.create',
        () => this.db.insert(projects).values(data).returning().get(),
        { projectName: data.name }
      );

      if (project) {
        // Cache the new project
        projectCache.set(CacheKeys.project(project.id), project);
        projectCache.set(CacheKeys.projectByChannel(project.slackChannelId), project);

        // Invalidate agent-based cache since it now includes a new project
        projectCache.deleteMatching(CacheKeys.projectByAgent(project.agentId));
      }

      return project;
    } catch (error) {
      logger.error({ error, data }, 'Failed to create project');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'projects',
        data,
      });
    }
  }

  findById(id: string): ProjectRow | undefined {
    try {
      const cacheKey = CacheKeys.project(id);
      const cached = projectCache.get<ProjectRow>(cacheKey);

      if (cached !== null) {
        return cached;
      }

      const project = performanceMonitor.recordDatabaseQuery(
        'project.findById',
        () => this.db.select().from(projects).where(eq(projects.id, id)).get(),
        { projectId: id }
      );

      if (project) {
        projectCache.set(cacheKey, project);
      }

      return project;
    } catch (error) {
      logger.error({ error, id }, 'Failed to find project by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'projects',
        data: { id },
      });
    }
  }

  findByChannelId(channelId: string): ProjectRow | undefined {
    try {
      const cacheKey = CacheKeys.projectByChannel(channelId);
      const cached = projectCache.get<ProjectRow>(cacheKey);

      if (cached !== null) {
        return cached;
      }

      const project = performanceMonitor.recordDatabaseQuery(
        'project.findByChannelId',
        () => this.db
          .select()
          .from(projects)
          .where(eq(projects.slackChannelId, channelId))
          .get(),
        { channelId }
      );

      if (project) {
        projectCache.set(cacheKey, project);
        // Also cache by ID for future lookups
        projectCache.set(CacheKeys.project(project.id), project);
      }

      return project;
    } catch (error) {
      logger.error({ error, channelId }, 'Failed to find project by channel id');
      throw classifySQLiteError(error, {
        operation: 'findByChannelId',
        table: 'projects',
        data: { channelId },
      });
    }
  }

  findByAgentId(agentId: string): ProjectRow[] {
    try {
      const cacheKey = CacheKeys.projectByAgent(agentId);
      const cached = projectCache.get<ProjectRow[]>(cacheKey);

      if (cached !== null) {
        return cached;
      }

      const projectsResult = performanceMonitor.recordDatabaseQuery(
        'project.findByAgentId',
        () => this.db
          .select()
          .from(projects)
          .where(eq(projects.agentId, agentId))
          .all(),
        { agentId }
      );

      if (projectsResult.length > 0) {
        projectCache.set(cacheKey, projectsResult);
        // Also cache individual projects
        projectsResult.forEach((project: ProjectRow) => {
          projectCache.set(CacheKeys.project(project.id), project);
        });
      } else {
        // Cache empty results to avoid repeated DB queries
        projectCache.set(cacheKey, [], 30 * 1000); // 30 seconds TTL for empty results
      }

      return projectsResult;
    } catch (error) {
      logger.error({ error, agentId }, 'Failed to find projects by agent id');
      throw classifySQLiteError(error, {
        operation: 'findByAgentId',
        table: 'projects',
        data: { agentId },
      });
    }
  }

  findAll(): ProjectRow[] {
    try {
      return performanceMonitor.recordDatabaseQuery(
        'project.findAll',
        () => this.db.select().from(projects).all()
      );
    } catch (error) {
      logger.error({ error }, 'Failed to find all projects');
      throw classifySQLiteError(error, {
        operation: 'findAll',
        table: 'projects',
      });
    }
  }

  update(id: string, data: Partial<ProjectInsert>): ProjectRow | undefined {
    try {
      const result = performanceMonitor.recordDatabaseQuery(
        'project.update',
        () => this.db
          .update(projects)
          .set({ ...data, updatedAt: new Date().toISOString() })
          .where(eq(projects.id, id))
          .returning()
          .get(),
        { projectId: id, updateFields: Object.keys(data) }
      );

      if (!result) {
        throw new RecordNotFoundError('projects', id, {
          operation: 'update',
          data,
        });
      }

      // Invalidate all cached entries for this project
      CacheInvalidators.invalidateProject(id);

      // Cache the updated project
      projectCache.set(CacheKeys.project(id), result);

      // Also invalidate channel-based cache if slackChannelId changed
      if (data.slackChannelId) {
        projectCache.deleteMatching(`project:channel:*`);
      }

      // Invalidate agent-based cache if agentId changed
      if (data.agentId) {
        projectCache.deleteMatching(`project:agent:*`);
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, data }, 'Failed to update project');
      throw classifySQLiteError(error, {
        operation: 'update',
        table: 'projects',
        data: { id, ...data },
      });
    }
  }

  delete(id: string): void {
    try {
      // Get project before deletion to clean up related cache entries
      const project = this.findById(id);

      const result = performanceMonitor.recordDatabaseQuery(
        'project.delete',
        () => this.db.delete(projects).where(eq(projects.id, id)).run(),
        { projectId: id }
      );

      if (result.changes === 0) {
        throw new RecordNotFoundError('projects', id, {
          operation: 'delete',
        });
      }

      if (project) {
        // Invalidate all related cache entries
        CacheInvalidators.invalidateProject(id);
        projectCache.delete(CacheKeys.projectByChannel(project.slackChannelId));
        projectCache.deleteMatching(CacheKeys.projectByAgent(project.agentId));
      }
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to delete project');
      throw classifySQLiteError(error, {
        operation: 'delete',
        table: 'projects',
        data: { id },
      });
    }
  }
}
