// Import directly from utils
function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

function generateTaskId(): string {
  return `task_${generateId()}`;
}

function generateSessionId(): string {
  return `session_${generateId()}`;
}

function generateProjectId(): string {
  return `proj_${generateId()}`;
}
import type { TaskInsert } from '../schema/tasks.js';
import type { OfflineQueueInsert } from '../schema/offline-queue.js';
import type { UserInsert } from '../schema/users.js';
import type { SessionInsert } from '../schema/sessions.js';

/**
 * Factory for creating test data with realistic defaults
 * Provides consistent test data generation across all repository tests
 */
export class DatabaseTestFactory {
  private counter = 0;

  private getUniqueId(): string {
    return `${Date.now()}-${++this.counter}`;
  }

  createTask(overrides: Partial<TaskInsert> = {}): TaskInsert {
    const uniqueId = this.getUniqueId();
    return {
      id: generateTaskId(),
      projectId: generateProjectId(),
      botName: 'code',
      command: 'write',
      prompt: `Test prompt ${uniqueId}`,
      status: 'pending',
      slackChannelId: `C${uniqueId}`,
      slackUserId: `U${uniqueId}`,
      slackThreadTs: `1234567890.${this.counter.toString().padStart(6, '0')}`,
      slackMessageTs: `1234567890.${(this.counter + 1).toString().padStart(6, '0')}`,
      inputTokens: 100,
      outputTokens: 200,
      estimatedCost: 0.05,
      maxBudget: 5.0,
      filesChanged: JSON.stringify([`src/test-${uniqueId}.ts`]),
      commandsRun: JSON.stringify([`npm test ${uniqueId}`]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  createOfflineQueueMessage(overrides: Partial<OfflineQueueInsert> = {}): OfflineQueueInsert {
    const uniqueId = this.getUniqueId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

    return {
      agentId: `agent-${uniqueId}`,
      messageType: 'task_submit',
      payload: JSON.stringify({ test: `payload-${uniqueId}` }),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      delivered: false,
      ...overrides,
    };
  }

  createUser(overrides: Partial<UserInsert> = {}): UserInsert {
    const uniqueId = this.getUniqueId();
    return {
      id: generateId(),
      slackUserId: `U${uniqueId}`,
      slackUsername: `testuser${uniqueId}`,
      role: 'developer',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  createSession(overrides: Partial<SessionInsert> = {}): SessionInsert {
    const uniqueId = this.getUniqueId();
    return {
      id: generateSessionId(),
      taskId: generateTaskId(),
      agentId: `agent-${uniqueId}`,
      model: 'claude-sonnet-4-6',
      inputTokens: 150,
      outputTokens: 300,
      estimatedCost: 0.08,
      status: 'active',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  createExpiredOfflineQueueMessage(overrides: Partial<OfflineQueueInsert> = {}): OfflineQueueInsert {
    const now = new Date();
    const expiredAt = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago

    return this.createOfflineQueueMessage({
      expiresAt: expiredAt.toISOString(),
      ...overrides,
    });
  }

  createCompletedTask(overrides: Partial<TaskInsert> = {}): TaskInsert {
    return this.createTask({
      status: 'completed',
      result: 'Task completed successfully',
      completedAt: new Date().toISOString(),
      ...overrides,
    });
  }

  createFailedTask(overrides: Partial<TaskInsert> = {}): TaskInsert {
    return this.createTask({
      status: 'failed',
      errorMessage: 'Task failed with error',
      completedAt: new Date().toISOString(),
      ...overrides,
    });
  }

  createSubtask(parentTaskId: string, overrides: Partial<TaskInsert> = {}): TaskInsert {
    return this.createTask({
      parentTaskId,
      ...overrides,
    });
  }

  createCompletedSession(overrides: Partial<SessionInsert> = {}): SessionInsert {
    return this.createSession({
      status: 'completed',
      durationMs: 5000,
      completedAt: new Date().toISOString(),
      ...overrides,
    });
  }
}