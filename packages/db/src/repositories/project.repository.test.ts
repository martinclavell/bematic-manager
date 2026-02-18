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

  describe('findBySlackChannelId', () => {
    it('should find project by Slack channel ID', () => {
      repo.create({
        id: generateProjectId(),
        name: 'test-project',
        slackChannelId: 'C123456',
        agentId: 'agent-01',
        localPath: '/path/to/project',
      });

      const found = repo.findBySlackChannelId('C123456');
      expect(found).toBeDefined();
      expect(found?.slackChannelId).toBe('C123456');
    });

    it('should return undefined for non-existent channel', () => {
      const found = repo.findBySlackChannelId('C999999');
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

      const deleted = repo.delete(project.id);
      expect(deleted).toBe(true);

      const found = repo.findById(project.id);
      expect(found).toBeUndefined();
    });

    it('should return false for non-existent project', () => {
      const deleted = repo.delete('proj_nonexistent');
      expect(deleted).toBe(false);
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
  });
});
