import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { SessionRepository } from './session.repository.js';
import { sessions } from '../schema/sessions.js';
import { tasks } from '../schema/tasks.js';
import { projects } from '../schema/projects.js';
import { DatabaseTestFactory } from '../test-utils/database-test-factory.js';
import { ConstraintViolationError, RecordNotFoundError } from '../errors.js';

function createTestDatabase() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);

  // Create projects table (referenced by tasks)
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

  // Create tasks table (referenced by sessions)
  sqlite.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      bot_name TEXT NOT NULL,
      command TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      error_message TEXT,
      slack_channel_id TEXT NOT NULL,
      slack_thread_ts TEXT,
      slack_user_id TEXT NOT NULL,
      slack_message_ts TEXT,
      session_id TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      max_budget REAL NOT NULL DEFAULT 5.0,
      parent_task_id TEXT,
      files_changed TEXT NOT NULL DEFAULT '[]',
      commands_run TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);

  // Create sessions table
  sqlite.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      agent_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);

  return db;
}

describe('SessionRepository', () => {
  let db: ReturnType<typeof drizzle>;
  let repo: SessionRepository;
  let factory: DatabaseTestFactory;
  let testTaskId: string;

  beforeEach(() => {
    db = createTestDatabase();
    repo = new SessionRepository(db);
    factory = new DatabaseTestFactory();

    // Insert test project and task for foreign key constraints
    const testProject = {
      id: 'proj_test123',
      name: 'test-project',
      slackChannelId: 'C123456',
      agentId: 'agent-01',
      localPath: '/test/path',
    };
    db.insert(projects).values(testProject).run();

    const testTask = factory.createTask({
      id: 'task_test123',
      projectId: 'proj_test123',
    });
    db.insert(tasks).values(testTask).run();
    testTaskId = testTask.id;
  });

  describe('create', () => {
    it('should create session successfully', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });

      const result = repo.create(sessionData);

      expect(result.id).toBe(sessionData.id);
      expect(result.taskId).toBe(testTaskId);
      expect(result.agentId).toBe(sessionData.agentId);
      expect(result.model).toBe(sessionData.model);
      expect(result.inputTokens).toBe(sessionData.inputTokens);
      expect(result.outputTokens).toBe(sessionData.outputTokens);
      expect(result.estimatedCost).toBe(sessionData.estimatedCost);
      expect(result.status).toBe(sessionData.status);
      expect(result.createdAt).toBeDefined();
    });

    it('should create session with default values', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
        inputTokens: undefined, // Should default to 0
        outputTokens: undefined, // Should default to 0
        estimatedCost: undefined, // Should default to 0
        status: undefined, // Should default to 'active'
        durationMs: undefined, // Should be null
        completedAt: undefined, // Should be null
      });

      const result = repo.create(sessionData);

      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.estimatedCost).toBe(0);
      expect(result.status).toBe('active');
      expect(result.durationMs).toBeNull();
      expect(result.completedAt).toBeNull();
    });

    it('should throw ConstraintViolationError on duplicate ID', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });

      repo.create(sessionData);

      expect(() => repo.create(sessionData)).toThrow(ConstraintViolationError);
    });

    it('should throw ConstraintViolationError on invalid task reference', () => {
      const sessionData = factory.createSession({
        taskId: 'task_nonexistent',
      });

      expect(() => repo.create(sessionData)).toThrow(ConstraintViolationError);
    });

    it('should create session with all optional fields', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
        durationMs: 5000,
        completedAt: new Date().toISOString(),
      });

      const result = repo.create(sessionData);

      expect(result.durationMs).toBe(5000);
      expect(result.completedAt).toBeDefined();
    });
  });

  describe('findById', () => {
    it('should find session by ID when it exists', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });
      const created = repo.create(sessionData);

      const found = repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.taskId).toBe(created.taskId);
      expect(found?.agentId).toBe(created.agentId);
    });

    it('should return undefined when session does not exist', () => {
      const found = repo.findById('session_nonexistent');

      expect(found).toBeUndefined();
    });

    it('should return session with all fields', () => {
      const sessionData = factory.createCompletedSession({
        taskId: testTaskId,
        model: 'claude-opus-4-6',
        inputTokens: 1000,
        outputTokens: 2000,
        estimatedCost: 0.5,
        durationMs: 10000,
      });
      const created = repo.create(sessionData);

      const found = repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.model).toBe('claude-opus-4-6');
      expect(found?.inputTokens).toBe(1000);
      expect(found?.outputTokens).toBe(2000);
      expect(found?.estimatedCost).toBe(0.5);
      expect(found?.durationMs).toBe(10000);
      expect(found?.status).toBe('completed');
      expect(found?.completedAt).toBeDefined();
    });
  });

  describe('findByTaskId', () => {
    it('should find sessions by task ID with results', () => {
      const session1 = factory.createSession({ taskId: testTaskId });
      const session2 = factory.createSession({ taskId: testTaskId });
      const session3 = factory.createSession({ taskId: testTaskId });

      repo.create(session1);
      repo.create(session2);
      repo.create(session3);

      const results = repo.findByTaskId(testTaskId);

      expect(results).toHaveLength(3);
      expect(results.every(s => s.taskId === testTaskId)).toBe(true);
    });

    it('should return empty array when no sessions exist for task', () => {
      const results = repo.findByTaskId('task_nonexistent');

      expect(results).toEqual([]);
    });

    it('should return sessions with all fields', () => {
      const sessionData = factory.createCompletedSession({
        taskId: testTaskId,
        agentId: 'test-agent',
        model: 'claude-sonnet-4-5',
      });
      repo.create(sessionData);

      const results = repo.findByTaskId(testTaskId);

      expect(results).toHaveLength(1);
      const session = results[0];
      expect(session.taskId).toBe(testTaskId);
      expect(session.agentId).toBe('test-agent');
      expect(session.model).toBe('claude-sonnet-4-5');
      expect(session.createdAt).toBeDefined();
    });

    it('should find sessions with different statuses', () => {
      const activeSession = factory.createSession({
        taskId: testTaskId,
        status: 'active',
      });
      const completedSession = factory.createSession({
        taskId: testTaskId,
        status: 'completed',
      });

      repo.create(activeSession);
      repo.create(completedSession);

      const results = repo.findByTaskId(testTaskId);

      expect(results).toHaveLength(2);
      expect(results.some(s => s.status === 'active')).toBe(true);
      expect(results.some(s => s.status === 'completed')).toBe(true);
    });
  });

  describe('findAll', () => {
    it('should return all sessions', () => {
      const session1 = factory.createSession({ taskId: testTaskId });
      const session2 = factory.createSession({ taskId: testTaskId });
      const session3 = factory.createSession({ taskId: testTaskId });

      repo.create(session1);
      repo.create(session2);
      repo.create(session3);

      const allSessions = repo.findAll();

      expect(allSessions).toHaveLength(3);
      expect(allSessions.map(s => s.id).sort()).toEqual([session1.id, session2.id, session3.id].sort());
    });

    it('should return empty array when no sessions exist', () => {
      const allSessions = repo.findAll();

      expect(allSessions).toEqual([]);
    });

    it('should return all session fields', () => {
      const sessionData = factory.createCompletedSession({
        taskId: testTaskId,
        agentId: 'test-agent-123',
        model: 'claude-opus-4-6',
        inputTokens: 1500,
        outputTokens: 3000,
        estimatedCost: 0.75,
        durationMs: 15000,
      });
      repo.create(sessionData);

      const allSessions = repo.findAll();

      expect(allSessions).toHaveLength(1);
      const session = allSessions[0];
      expect(session.taskId).toBe(testTaskId);
      expect(session.agentId).toBe('test-agent-123');
      expect(session.model).toBe('claude-opus-4-6');
      expect(session.inputTokens).toBe(1500);
      expect(session.outputTokens).toBe(3000);
      expect(session.estimatedCost).toBe(0.75);
      expect(session.durationMs).toBe(15000);
      expect(session.status).toBe('completed');
      expect(session.createdAt).toBeDefined();
      expect(session.completedAt).toBeDefined();
    });
  });

  describe('complete', () => {
    it('should complete session successfully', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
        status: 'active',
      });
      const created = repo.create(sessionData);

      const metrics = {
        inputTokens: 1200,
        outputTokens: 2400,
        estimatedCost: 0.36,
        durationMs: 8000,
      };

      const completed = repo.complete(created.id, metrics);

      expect(completed).toBeDefined();
      expect(completed?.status).toBe('completed');
      expect(completed?.inputTokens).toBe(1200);
      expect(completed?.outputTokens).toBe(2400);
      expect(completed?.estimatedCost).toBe(0.36);
      expect(completed?.durationMs).toBe(8000);
      expect(completed?.completedAt).toBeDefined();
    });

    it('should throw RecordNotFoundError when session does not exist', () => {
      const metrics = {
        inputTokens: 1000,
        outputTokens: 2000,
        estimatedCost: 0.3,
        durationMs: 5000,
      };

      expect(() => repo.complete('session_nonexistent', metrics))
        .toThrow(RecordNotFoundError);
    });

    it('should handle zero metrics', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });
      const created = repo.create(sessionData);

      const metrics = {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        durationMs: 0,
      };

      const completed = repo.complete(created.id, metrics);

      expect(completed).toBeDefined();
      expect(completed?.inputTokens).toBe(0);
      expect(completed?.outputTokens).toBe(0);
      expect(completed?.estimatedCost).toBe(0);
      expect(completed?.durationMs).toBe(0);
    });

    it('should handle large metrics values', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });
      const created = repo.create(sessionData);

      const metrics = {
        inputTokens: 1000000,
        outputTokens: 2000000,
        estimatedCost: 100.50,
        durationMs: 3600000, // 1 hour
      };

      const completed = repo.complete(created.id, metrics);

      expect(completed).toBeDefined();
      expect(completed?.inputTokens).toBe(1000000);
      expect(completed?.outputTokens).toBe(2000000);
      expect(completed?.estimatedCost).toBe(100.50);
      expect(completed?.durationMs).toBe(3600000);
    });

    it('should update completedAt timestamp', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });
      const created = repo.create(sessionData);

      const beforeTime = new Date();
      const metrics = {
        inputTokens: 100,
        outputTokens: 200,
        estimatedCost: 0.03,
        durationMs: 1000,
      };

      const completed = repo.complete(created.id, metrics);
      const afterTime = new Date();

      expect(completed?.completedAt).toBeDefined();
      const completedAt = new Date(completed!.completedAt!);
      expect(completedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(completedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('delete', () => {
    it('should delete session successfully', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });
      const created = repo.create(sessionData);

      const deleted = repo.delete(created.id);

      expect(deleted).toBe(true);

      // Verify session is actually deleted
      const found = repo.findById(created.id);
      expect(found).toBeUndefined();
    });

    it('should return false when session does not exist', () => {
      const deleted = repo.delete('session_nonexistent');

      expect(deleted).toBe(false);
    });

    it('should handle deleting already deleted session', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });
      const created = repo.create(sessionData);

      // Delete first time
      const deleted1 = repo.delete(created.id);
      expect(deleted1).toBe(true);

      // Try to delete again
      const deleted2 = repo.delete(created.id);
      expect(deleted2).toBe(false);
    });

    it('should not affect other sessions', () => {
      const session1 = factory.createSession({ taskId: testTaskId });
      const session2 = factory.createSession({ taskId: testTaskId });

      const created1 = repo.create(session1);
      const created2 = repo.create(session2);

      // Delete only one session
      const deleted = repo.delete(created1.id);
      expect(deleted).toBe(true);

      // Verify the other session still exists
      const found = repo.findById(created2.id);
      expect(found).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle sessions with null duration and completedAt', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
        durationMs: null,
        completedAt: null,
      });

      const created = repo.create(sessionData);

      expect(created.durationMs).toBeNull();
      expect(created.completedAt).toBeNull();
    });

    it('should handle very long model names', () => {
      const longModelName = 'claude-' + 'a'.repeat(100) + '-model';
      const sessionData = factory.createSession({
        taskId: testTaskId,
        model: longModelName,
      });

      const created = repo.create(sessionData);

      expect(created.model).toBe(longModelName);
    });

    it('should handle special characters in agent ID', () => {
      const specialAgentId = 'agent-123_test.example@domain.com';
      const sessionData = factory.createSession({
        taskId: testTaskId,
        agentId: specialAgentId,
      });

      const created = repo.create(sessionData);

      expect(created.agentId).toBe(specialAgentId);
    });

    it('should handle unicode characters in model name', () => {
      const unicodeModel = 'claude-模型-🤖-test';
      const sessionData = factory.createSession({
        taskId: testTaskId,
        model: unicodeModel,
      });

      const created = repo.create(sessionData);

      expect(created.model).toBe(unicodeModel);
    });

    it('should handle negative duration (edge case)', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
        status: 'active',
      });
      const created = repo.create(sessionData);

      const metrics = {
        inputTokens: 100,
        outputTokens: 200,
        estimatedCost: 0.03,
        durationMs: -1000, // Negative duration
      };

      const completed = repo.complete(created.id, metrics);

      expect(completed?.durationMs).toBe(-1000);
    });

    it('should handle fractional costs', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });
      const created = repo.create(sessionData);

      const metrics = {
        inputTokens: 333,
        outputTokens: 667,
        estimatedCost: 0.123456789,
        durationMs: 2500,
      };

      const completed = repo.complete(created.id, metrics);

      expect(completed?.estimatedCost).toBeCloseTo(0.123456789);
    });

    it('should preserve exact timestamps', () => {
      const specificTime = '2024-01-01T12:00:00.000Z';
      const sessionData = factory.createSession({
        taskId: testTaskId,
        createdAt: specificTime,
      });

      const created = repo.create(sessionData);

      expect(created.createdAt).toBe(specificTime);
    });

    it('should handle multiple sessions for same task', () => {
      const sessionIds: string[] = [];

      // Create 5 sessions for the same task
      for (let i = 0; i < 5; i++) {
        const sessionData = factory.createSession({ taskId: testTaskId });
        const created = repo.create(sessionData);
        sessionIds.push(created.id);
      }

      const sessions = repo.findByTaskId(testTaskId);
      expect(sessions).toHaveLength(5);
      expect(sessions.map(s => s.id).sort()).toEqual(sessionIds.sort());
    });

    it('should handle concurrent operations gracefully', () => {
      const sessionData = factory.createSession({
        taskId: testTaskId,
      });
      const created = repo.create(sessionData);

      // Simulate concurrent complete operations
      const metrics = {
        inputTokens: 100,
        outputTokens: 200,
        estimatedCost: 0.03,
        durationMs: 1000,
      };

      const completed = repo.complete(created.id, metrics);
      expect(completed).toBeDefined();

      // Second complete should fail since record doesn't exist anymore
      // or if it does exist, it should still work
      try {
        const completed2 = repo.complete(created.id, metrics);
        expect(completed2).toBeDefined();
      } catch (error) {
        expect(error).toBeInstanceOf(RecordNotFoundError);
      }
    });
  });
});