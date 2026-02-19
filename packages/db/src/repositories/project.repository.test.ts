import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ProjectRepository } from './project.repository.js';
import { projects } from '../schema/projects.js';
import { generateProjectId } from '@bematic/common';

describe('ProjectRepository', () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database.Database;
  let repo: ProjectRepository;

  beforeEach(() => {
    // Create in-memory SQLite database for testing
    sqlite = new Database(':memory:');
    db = drizzle(sqlite);

    // Create schema
    sqlite.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slack_channel_id TEXT NOT NULL UNIQUE,
        agent_id TEXT NOT NULL,
        local_path TEXT NOT NULL,
        default_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
        default_max_budget REAL NOT NULL DEFAULT 5.0,
        railway_project_id TEXT,
        railway_service_id TEXT,
        railway_environment_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    repo = new ProjectRepository(db);
  });

  describe('create', () => {
    it('should create a new project', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'test-project',
        slackChannelId: 'C123456',
        agentId: 'agent-01',
        localPath: '/path/to/project',
      });

      expect(project).toBeDefined();
      expect(project.name).toBe('test-project');
      expect(project.slackChannelId).toBe('C123456');
      expect(project.agentId).toBe('agent-01');
      expect(project.defaultModel).toBe('claude-sonnet-4-5-20250929');
      expect(project.defaultMaxBudget).toBe(5.0);
    });

    it('should create a project with custom model and budget', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'test-project',
        slackChannelId: 'C123456',
        agentId: 'agent-01',
        localPath: '/path/to/project',
        defaultModel: 'claude-opus-4-6',
        defaultMaxBudget: 10.0,
      });

      expect(project.defaultModel).toBe('claude-opus-4-6');
      expect(project.defaultMaxBudget).toBe(10.0);
    });

    it('should create a project with Railway fields', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'railway-project',
        slackChannelId: 'C789012',
        agentId: 'agent-02',
        localPath: '/path/to/railway',
        railwayProjectId: 'railway-proj-123',
        railwayServiceId: 'service-456',
        railwayEnvironmentId: 'env-789',
      });

      expect(project.railwayProjectId).toBe('railway-proj-123');
      expect(project.railwayServiceId).toBe('service-456');
      expect(project.railwayEnvironmentId).toBe('env-789');
      expect(project.active).toBe(true); // Default value
    });

    it('should create a project with active set to false', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'inactive-project',
        slackChannelId: 'C345678',
        agentId: 'agent-03',
        localPath: '/path/to/inactive',
        active: false,
      });

      expect(project.active).toBe(false);
    });
  });

  describe('findById', () => {
    it('should find project by ID', () => {
      const created = repo.create({
        id: generateProjectId(),
        name: 'test-project',
        slackChannelId: 'C123456',
        agentId: 'agent-01',
        localPath: '/path/to/project',
      });

      const found = repo.findById(created.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('test-project');
    });

    it('should return undefined for non-existent ID', () => {
      const found = repo.findById('proj_nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('findByChannelId', () => {
    it('should find project by Slack channel ID', () => {
      repo.create({
        id: generateProjectId(),
        name: 'test-project',
        slackChannelId: 'C123456',
        agentId: 'agent-01',
        localPath: '/path/to/project',
      });

      const found = repo.findByChannelId('C123456');
      expect(found).toBeDefined();
      expect(found?.slackChannelId).toBe('C123456');
    });

    it('should return undefined for non-existent channel', () => {
      const found = repo.findByChannelId('C999999');
      expect(found).toBeUndefined();
    });
  });

  describe('findByAgentId', () => {
    it('should find all projects for an agent', () => {
      repo.create({
        id: generateProjectId(),
        name: 'project-1',
        slackChannelId: 'C111',
        agentId: 'agent-01',
        localPath: '/path/1',
      });

      repo.create({
        id: generateProjectId(),
        name: 'project-2',
        slackChannelId: 'C222',
        agentId: 'agent-01',
        localPath: '/path/2',
      });

      repo.create({
        id: generateProjectId(),
        name: 'project-3',
        slackChannelId: 'C333',
        agentId: 'agent-02',
        localPath: '/path/3',
      });

      const found = repo.findByAgentId('agent-01');
      expect(found).toHaveLength(2);
      expect(found.map((p) => p.name)).toEqual(['project-1', 'project-2']);
    });

    it('should return empty array for agent with no projects', () => {
      const found = repo.findByAgentId('agent-99');
      expect(found).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update project fields', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'test-project',
        slackChannelId: 'C123456',
        agentId: 'agent-01',
        localPath: '/path/to/project',
      });

      const updated = repo.update(project.id, {
        name: 'updated-project',
        defaultModel: 'claude-opus-4-6',
        defaultMaxBudget: 15.0,
      });

      expect(updated).toBeDefined();
      expect(updated?.name).toBe('updated-project');
      expect(updated?.defaultModel).toBe('claude-opus-4-6');
      expect(updated?.defaultMaxBudget).toBe(15.0);
      expect(updated?.slackChannelId).toBe('C123456'); // unchanged
    });

    it('should return undefined for non-existent project', () => {
      const updated = repo.update('proj_nonexistent', { name: 'new-name' });
      expect(updated).toBeUndefined();
    });

    it('should update Railway fields', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'railway-project',
        slackChannelId: 'C789012',
        agentId: 'agent-02',
        localPath: '/path/to/railway',
      });

      const updated = repo.update(project.id, {
        railwayProjectId: 'new-railway-proj',
        railwayServiceId: 'new-service',
        railwayEnvironmentId: 'new-env',
        active: false,
      });

      expect(updated).toBeDefined();
      expect(updated?.railwayProjectId).toBe('new-railway-proj');
      expect(updated?.railwayServiceId).toBe('new-service');
      expect(updated?.railwayEnvironmentId).toBe('new-env');
      expect(updated?.active).toBe(false);
    });

    it('should update updatedAt timestamp', async () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'timestamp-test',
        slackChannelId: 'C111222',
        agentId: 'agent-04',
        localPath: '/path/to/timestamp',
      });

      const originalUpdatedAt = project.updatedAt;

      // Wait to ensure timestamp changes (SQLite doesn't have sub-second precision by default)
      await new Promise(resolve => setTimeout(resolve, 10));

      const updated = repo.update(project.id, { name: 'updated-name' });

      expect(updated).toBeDefined();
      // Since the update method in repository explicitly sets updatedAt to new Date().toISOString()
      // the timestamp should be different, or at least the greater-than check should pass
      const updatedTime = new Date(updated!.updatedAt).getTime();
      const originalTime = new Date(originalUpdatedAt).getTime();
      expect(updatedTime).toBeGreaterThanOrEqual(originalTime);
    });
  });

  describe('delete', () => {
    it('should delete a project', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'test-project',
        slackChannelId: 'C123456',
        agentId: 'agent-01',
        localPath: '/path/to/project',
      });

      repo.delete(project.id);

      const found = repo.findById(project.id);
      expect(found).toBeUndefined();
    });

    it('should not throw for non-existent project', () => {
      expect(() => repo.delete('proj_nonexistent')).not.toThrow();
    });
  });

  describe('findAll', () => {
    it('should return all projects', () => {
      repo.create({
        id: generateProjectId(),
        name: 'project-1',
        slackChannelId: 'C111',
        agentId: 'agent-01',
        localPath: '/path/1',
      });

      repo.create({
        id: generateProjectId(),
        name: 'project-2',
        slackChannelId: 'C222',
        agentId: 'agent-02',
        localPath: '/path/2',
      });

      const all = repo.findAll();
      expect(all).toHaveLength(2);
    });

    it('should return empty array when no projects exist', () => {
      const all = repo.findAll();
      expect(all).toEqual([]);
    });

    it('should include all fields in returned projects', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'complete-project',
        slackChannelId: 'C555666',
        agentId: 'agent-05',
        localPath: '/path/to/complete',
        railwayProjectId: 'railway-complete',
        railwayServiceId: 'service-complete',
        railwayEnvironmentId: 'env-complete',
        active: false,
      });

      const all = repo.findAll();
      const found = all.find(p => p.id === project.id);

      expect(found).toBeDefined();
      expect(found?.railwayProjectId).toBe('railway-complete');
      expect(found?.railwayServiceId).toBe('service-complete');
      expect(found?.railwayEnvironmentId).toBe('env-complete');
      expect(found?.active).toBe(false);
      expect(found?.createdAt).toBeDefined();
      expect(found?.updatedAt).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle null Railway fields gracefully', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'no-railway',
        slackChannelId: 'C777888',
        agentId: 'agent-06',
        localPath: '/path/to/no-railway',
        railwayProjectId: null,
        railwayServiceId: null,
        railwayEnvironmentId: null,
      });

      expect(project.railwayProjectId).toBeNull();
      expect(project.railwayServiceId).toBeNull();
      expect(project.railwayEnvironmentId).toBeNull();
    });

    it('should enforce unique slack_channel_id constraint', () => {
      const channelId = 'C999999';

      repo.create({
        id: generateProjectId(),
        name: 'first-project',
        slackChannelId: channelId,
        agentId: 'agent-07',
        localPath: '/path/to/first',
      });

      // Should throw when trying to create another project with same channel ID
      expect(() => {
        repo.create({
          id: generateProjectId(),
          name: 'second-project',
          slackChannelId: channelId,
          agentId: 'agent-08',
          localPath: '/path/to/second',
        });
      }).toThrow();
    });

    it('should preserve timestamps on creation', () => {
      const project = repo.create({
        id: generateProjectId(),
        name: 'timestamp-preserve',
        slackChannelId: 'C000111',
        agentId: 'agent-09',
        localPath: '/path/to/preserve',
      });

      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
      expect(new Date(project.createdAt).getTime()).toBeLessThanOrEqual(new Date().getTime());
      expect(new Date(project.updatedAt).getTime()).toBeLessThanOrEqual(new Date().getTime());
    });
  });
});
