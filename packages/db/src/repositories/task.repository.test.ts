import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { TaskRepository } from './task.repository.js';
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

  // Create tasks table
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

  // Create indexes
  sqlite.exec(`
    CREATE INDEX tasks_status_idx ON tasks(status);
    CREATE INDEX tasks_project_id_idx ON tasks(project_id);
    CREATE INDEX tasks_thread_idx ON tasks(slack_channel_id, slack_thread_ts);
    CREATE INDEX tasks_parent_task_id_idx ON tasks(parent_task_id);
    CREATE INDEX tasks_created_at_idx ON tasks(created_at);
  `);

  return db;
}

describe('TaskRepository', () => {
  let db: ReturnType<typeof drizzle>;
  let repo: TaskRepository;
  let factory: DatabaseTestFactory;

  beforeEach(() => {
    db = createTestDatabase();
    repo = new TaskRepository(db);
    factory = new DatabaseTestFactory();

    // Insert a test project for foreign key constraints
    const testProject = {
      id: 'proj_test123',
      name: 'test-project',
      slackChannelId: 'C123456',
      agentId: 'agent-01',
      localPath: '/test/path',
    };
    db.insert(projects).values(testProject).run();
  });

  describe('create', () => {
    it('should create a task successfully', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
      });

      const result = repo.create(taskData);

      expect(result.id).toBe(taskData.id);
      expect(result.status).toBe(taskData.status);
      expect(result.prompt).toBe(taskData.prompt);
      expect(result.projectId).toBe('proj_test123');
      expect(result.createdAt).toBeDefined();
    });

    it('should throw ConstraintViolationError on duplicate ID', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
      });

      repo.create(taskData);

      expect(() => repo.create(taskData)).toThrow(ConstraintViolationError);
    });

    it('should throw ConstraintViolationError on invalid project reference', () => {
      const taskData = factory.createTask({
        projectId: 'proj_nonexistent',
      });

      expect(() => repo.create(taskData)).toThrow(ConstraintViolationError);
    });

    it('should create task with all optional fields', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
        result: 'Test result',
        errorMessage: 'Test error',
        sessionId: 'session_123',
        parentTaskId: null,
        completedAt: new Date().toISOString(),
      });

      const result = repo.create(taskData);

      expect(result.result).toBe('Test result');
      expect(result.errorMessage).toBe('Test error');
      expect(result.sessionId).toBe('session_123');
      expect(result.completedAt).toBeDefined();
    });
  });

  describe('findById', () => {
    it('should find task by ID when it exists', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
      });
      const created = repo.create(taskData);

      const found = repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.prompt).toBe(created.prompt);
    });

    it('should return undefined when task does not exist', () => {
      const found = repo.findById('task_nonexistent');

      expect(found).toBeUndefined();
    });
  });

  describe('findByProjectId', () => {
    it('should find tasks by project ID with results', () => {
      const task1 = factory.createTask({ projectId: 'proj_test123' });
      const task2 = factory.createTask({ projectId: 'proj_test123' });
      const task3 = factory.createTask({ projectId: 'proj_test123' });

      repo.create(task1);
      repo.create(task2);
      repo.create(task3);

      const results = repo.findByProjectId('proj_test123');

      expect(results).toHaveLength(3);
      expect(results.every(t => t.projectId === 'proj_test123')).toBe(true);
    });

    it('should return empty array when no tasks exist for project', () => {
      const results = repo.findByProjectId('proj_test123');

      expect(results).toEqual([]);
    });

    it('should respect limit parameter', () => {
      // Create 5 tasks
      for (let i = 0; i < 5; i++) {
        const task = factory.createTask({ projectId: 'proj_test123' });
        repo.create(task);
      }

      const results = repo.findByProjectId('proj_test123', 3);

      expect(results).toHaveLength(3);
    });

    it('should order by createdAt desc', () => {
      const task1 = factory.createTask({
        projectId: 'proj_test123',
        createdAt: '2024-01-01T10:00:00Z',
      });
      const task2 = factory.createTask({
        projectId: 'proj_test123',
        createdAt: '2024-01-01T12:00:00Z',
      });

      repo.create(task1);
      repo.create(task2);

      const results = repo.findByProjectId('proj_test123');

      expect(results[0].createdAt).toBe('2024-01-01T12:00:00Z');
      expect(results[1].createdAt).toBe('2024-01-01T10:00:00Z');
    });
  });

  describe('findByStatus', () => {
    it('should find tasks by status with results', () => {
      const runningTask = factory.createTask({
        projectId: 'proj_test123',
        status: 'running',
      });
      const completedTask = factory.createTask({
        projectId: 'proj_test123',
        status: 'completed',
      });
      const pendingTask = factory.createTask({
        projectId: 'proj_test123',
        status: 'pending',
      });

      repo.create(runningTask);
      repo.create(completedTask);
      repo.create(pendingTask);

      const runningResults = repo.findByStatus('running');
      expect(runningResults).toHaveLength(1);
      expect(runningResults[0].status).toBe('running');

      const completedResults = repo.findByStatus('completed');
      expect(completedResults).toHaveLength(1);
      expect(completedResults[0].status).toBe('completed');
    });

    it('should return empty array when no tasks have the specified status', () => {
      const results = repo.findByStatus('failed');

      expect(results).toEqual([]);
    });
  });

  describe('findActiveByProjectId', () => {
    it('should find only running tasks for project', () => {
      const runningTask1 = factory.createTask({
        projectId: 'proj_test123',
        status: 'running',
      });
      const runningTask2 = factory.createTask({
        projectId: 'proj_test123',
        status: 'running',
      });
      const pendingTask = factory.createTask({
        projectId: 'proj_test123',
        status: 'pending',
      });
      const completedTask = factory.createTask({
        projectId: 'proj_test123',
        status: 'completed',
      });

      repo.create(runningTask1);
      repo.create(runningTask2);
      repo.create(pendingTask);
      repo.create(completedTask);

      const activeResults = repo.findActiveByProjectId('proj_test123');

      expect(activeResults).toHaveLength(2);
      expect(activeResults.every(t => t.status === 'running')).toBe(true);
      expect(activeResults.every(t => t.projectId === 'proj_test123')).toBe(true);
    });

    it('should return empty array when no running tasks exist', () => {
      const pendingTask = factory.createTask({
        projectId: 'proj_test123',
        status: 'pending',
      });
      repo.create(pendingTask);

      const activeResults = repo.findActiveByProjectId('proj_test123');

      expect(activeResults).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update task successfully', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
      });
      const created = repo.create(taskData);

      const updateData = {
        status: 'running',
        prompt: 'Updated prompt',
        inputTokens: 500,
      };

      const updated = repo.update(created.id, updateData);

      expect(updated).toBeDefined();
      expect(updated?.status).toBe('running');
      expect(updated?.prompt).toBe('Updated prompt');
      expect(updated?.inputTokens).toBe(500);
      expect(updated?.updatedAt).not.toBe(created.updatedAt);
    });

    it('should throw RecordNotFoundError when task does not exist', () => {
      expect(() => repo.update('task_nonexistent', { status: 'running' }))
        .toThrow(RecordNotFoundError);
    });

    it('should handle constraint violations', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
      });
      const created = repo.create(taskData);

      expect(() => repo.update(created.id, { projectId: 'proj_nonexistent' }))
        .toThrow(ConstraintViolationError);
    });

    it('should update updatedAt timestamp automatically', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
      });
      const created = repo.create(taskData);
      const originalUpdatedAt = created.updatedAt;

      const updated = repo.update(created.id, { status: 'running' });

      expect(updated?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('complete', () => {
    it('should complete task successfully', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
        status: 'running',
      });
      const created = repo.create(taskData);

      const metrics = {
        inputTokens: 1000,
        outputTokens: 2000,
        estimatedCost: 0.15,
        filesChanged: ['src/file1.ts', 'src/file2.ts'],
        commandsRun: ['npm test', 'npm build'],
      };

      const completed = repo.complete(created.id, 'Task completed', metrics);

      expect(completed).toBeDefined();
      expect(completed?.status).toBe('completed');
      expect(completed?.result).toBe('Task completed');
      expect(completed?.inputTokens).toBe(1000);
      expect(completed?.outputTokens).toBe(2000);
      expect(completed?.estimatedCost).toBe(0.15);
      expect(completed?.filesChanged).toBe(JSON.stringify(metrics.filesChanged));
      expect(completed?.commandsRun).toBe(JSON.stringify(metrics.commandsRun));
      expect(completed?.completedAt).toBeDefined();
      expect(completed?.updatedAt).toBeDefined();
    });

    it('should throw RecordNotFoundError when task does not exist', () => {
      const metrics = {
        inputTokens: 1000,
        outputTokens: 2000,
        estimatedCost: 0.15,
        filesChanged: [],
        commandsRun: [],
      };

      expect(() => repo.complete('task_nonexistent', 'Result', metrics))
        .toThrow(RecordNotFoundError);
    });
  });

  describe('findLastSessionInThread', () => {
    it('should find most recent task with session in thread', () => {
      const channelId = 'C123456';
      const threadTs = '1234567890.123456';

      const task1 = factory.createTask({
        projectId: 'proj_test123',
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        sessionId: 'session_1',
        createdAt: '2024-01-01T10:00:00Z',
      });
      const task2 = factory.createTask({
        projectId: 'proj_test123',
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        sessionId: 'session_2',
        createdAt: '2024-01-01T12:00:00Z',
      });
      const task3 = factory.createTask({
        projectId: 'proj_test123',
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        sessionId: null, // No session - should be ignored
        createdAt: '2024-01-01T14:00:00Z',
      });

      repo.create(task1);
      repo.create(task2);
      repo.create(task3);

      const result = repo.findLastSessionInThread(channelId, threadTs);

      expect(result).toBeDefined();
      expect(result?.id).toBe(task2.id);
      expect(result?.sessionId).toBe('session_2');
    });

    it('should return undefined when no tasks with session exist in thread', () => {
      const result = repo.findLastSessionInThread('C123456', '1234567890.123456');

      expect(result).toBeUndefined();
    });
  });

  describe('fail', () => {
    it('should fail task successfully', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
        status: 'running',
      });
      const created = repo.create(taskData);

      const failed = repo.fail(created.id, 'Task failed due to error');

      expect(failed).toBeDefined();
      expect(failed?.status).toBe('failed');
      expect(failed?.errorMessage).toBe('Task failed due to error');
      expect(failed?.completedAt).toBeDefined();
      expect(failed?.updatedAt).toBeDefined();
    });

    it('should throw RecordNotFoundError when task does not exist', () => {
      expect(() => repo.fail('task_nonexistent', 'Error message'))
        .toThrow(RecordNotFoundError);
    });
  });

  describe('findByParentTaskId', () => {
    it('should find subtasks by parent task ID', () => {
      const parentTask = factory.createTask({
        projectId: 'proj_test123',
      });
      const parent = repo.create(parentTask);

      const subtask1 = factory.createSubtask(parent.id, {
        projectId: 'proj_test123',
        createdAt: '2024-01-01T10:00:00Z',
      });
      const subtask2 = factory.createSubtask(parent.id, {
        projectId: 'proj_test123',
        createdAt: '2024-01-01T12:00:00Z',
      });

      repo.create(subtask1);
      repo.create(subtask2);

      const subtasks = repo.findByParentTaskId(parent.id);

      expect(subtasks).toHaveLength(2);
      expect(subtasks[0].createdAt).toBe('2024-01-01T10:00:00Z');
      expect(subtasks[1].createdAt).toBe('2024-01-01T12:00:00Z');
      expect(subtasks.every(t => t.parentTaskId === parent.id)).toBe(true);
    });

    it('should return empty array when no subtasks exist', () => {
      const subtasks = repo.findByParentTaskId('task_nonexistent');

      expect(subtasks).toEqual([]);
    });
  });

  describe('areAllSubtasksComplete', () => {
    it('should return true when all subtasks are completed', () => {
      const parentTask = factory.createTask({
        projectId: 'proj_test123',
      });
      const parent = repo.create(parentTask);

      const completedSubtask1 = factory.createSubtask(parent.id, {
        projectId: 'proj_test123',
        status: 'completed',
      });
      const completedSubtask2 = factory.createSubtask(parent.id, {
        projectId: 'proj_test123',
        status: 'completed',
      });

      repo.create(completedSubtask1);
      repo.create(completedSubtask2);

      const allComplete = repo.areAllSubtasksComplete(parent.id);

      expect(allComplete).toBe(true);
    });

    it('should return true when all subtasks are in terminal states (completed, failed, cancelled)', () => {
      const parentTask = factory.createTask({
        projectId: 'proj_test123',
      });
      const parent = repo.create(parentTask);

      const completedSubtask = factory.createSubtask(parent.id, {
        projectId: 'proj_test123',
        status: 'completed',
      });
      const failedSubtask = factory.createSubtask(parent.id, {
        projectId: 'proj_test123',
        status: 'failed',
      });
      const cancelledSubtask = factory.createSubtask(parent.id, {
        projectId: 'proj_test123',
        status: 'cancelled',
      });

      repo.create(completedSubtask);
      repo.create(failedSubtask);
      repo.create(cancelledSubtask);

      const allComplete = repo.areAllSubtasksComplete(parent.id);

      expect(allComplete).toBe(true);
    });

    it('should return false when some subtasks are not complete', () => {
      const parentTask = factory.createTask({
        projectId: 'proj_test123',
      });
      const parent = repo.create(parentTask);

      const completedSubtask = factory.createSubtask(parent.id, {
        projectId: 'proj_test123',
        status: 'completed',
      });
      const runningSubtask = factory.createSubtask(parent.id, {
        projectId: 'proj_test123',
        status: 'running',
      });

      repo.create(completedSubtask);
      repo.create(runningSubtask);

      const allComplete = repo.areAllSubtasksComplete(parent.id);

      expect(allComplete).toBe(false);
    });

    it('should return false when no subtasks exist', () => {
      const allComplete = repo.areAllSubtasksComplete('task_nonexistent');

      expect(allComplete).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string values gracefully', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
        prompt: '', // Empty prompt
        result: '',
      });

      const created = repo.create(taskData);

      expect(created.prompt).toBe('');
      expect(created.result).toBe('');
    });

    it('should handle null values for optional fields', () => {
      const taskData = factory.createTask({
        projectId: 'proj_test123',
        result: null,
        errorMessage: null,
        sessionId: null,
        parentTaskId: null,
        completedAt: null,
      });

      const created = repo.create(taskData);

      expect(created.result).toBeNull();
      expect(created.errorMessage).toBeNull();
      expect(created.sessionId).toBeNull();
      expect(created.parentTaskId).toBeNull();
      expect(created.completedAt).toBeNull();
    });

    it('should handle very long text fields', () => {
      const longPrompt = 'A'.repeat(10000);
      const taskData = factory.createTask({
        projectId: 'proj_test123',
        prompt: longPrompt,
      });

      const created = repo.create(taskData);

      expect(created.prompt).toBe(longPrompt);
    });

    it('should handle JSON serialization in arrays', () => {
      const filesChanged = ['file1.ts', 'file2.js', 'file3.json'];
      const commandsRun = ['npm install', 'npm test', 'npm build'];

      const taskData = factory.createTask({
        projectId: 'proj_test123',
        filesChanged: JSON.stringify(filesChanged),
        commandsRun: JSON.stringify(commandsRun),
      });

      const created = repo.create(taskData);

      expect(JSON.parse(created.filesChanged)).toEqual(filesChanged);
      expect(JSON.parse(created.commandsRun)).toEqual(commandsRun);
    });
  });
});