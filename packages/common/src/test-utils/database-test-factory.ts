import type {
  UserInsert,
  TaskInsert,
  ProjectInsert,
  SessionInsert,
  AuditLogInsert,
  OfflineQueueInsert,
  PromptHistoryInsert,
  ApiKeyInsert
} from '@bematic/db';

/**
 * Factory for generating consistent test data across all database entities.
 * Provides methods to create valid test data with sensible defaults and
 * the ability to override specific fields.
 *
 * @example
 * ```typescript
 * const factory = new DatabaseTestFactory();
 *
 * // Create a user with defaults
 * const user = factory.createUser();
 *
 * // Create a user with overrides
 * const adminUser = factory.createUser({
 *   email: 'admin@example.com',
 *   isAdmin: true
 * });
 *
 * // Create related entities
 * const project = factory.createProject({ ownerId: user.id });
 * const task = factory.createTask({ projectId: project.id });
 * ```
 */
export class DatabaseTestFactory {
  private static idCounter = 1000;

  /**
   * Generate a unique ID for test entities
   */
  private generateId(): string {
    return `test_${DatabaseTestFactory.idCounter++}_${Date.now()}`;
  }

  /**
   * Create a test user record
   * @param overrides Partial user data to override defaults
   * @returns Complete UserInsert object
   */
  createUser(overrides: Partial<UserInsert> = {}): UserInsert {
    const id = this.generateId();
    return {
      id,
      slackUserId: `U${this.randomString(10).toUpperCase()}`,
      email: this.randomEmail(),
      name: `Test User ${id.slice(-4)}`,
      isAdmin: false,
      isActive: true,
      preferences: JSON.stringify({
        notifications: true,
        theme: 'light'
      }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides
    };
  }

  /**
   * Create a test project record
   * @param overrides Partial project data to override defaults
   * @returns Complete ProjectInsert object
   */
  createProject(overrides: Partial<ProjectInsert> = {}): ProjectInsert {
    const id = this.generateId();
    return {
      id,
      name: `Test Project ${id.slice(-4)}`,
      description: `Test project for automated testing - ${id}`,
      ownerId: overrides.ownerId || this.generateId(),
      slackChannelId: `C${this.randomString(10).toUpperCase()}`,
      settings: JSON.stringify({
        autoRespond: true,
        notifyOnComplete: true,
        retentionDays: 30
      }),
      isArchived: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides
    };
  }

  /**
   * Create a test task record
   * @param overrides Partial task data to override defaults
   * @returns Complete TaskInsert object
   */
  createTask(overrides: Partial<TaskInsert> = {}): TaskInsert {
    const id = this.generateId();
    return {
      id,
      projectId: overrides.projectId || this.generateId(),
      agentId: overrides.agentId || null,
      sessionId: overrides.sessionId || this.generateId(),
      prompt: `Test task prompt for task ${id}`,
      response: overrides.response || null,
      status: 'pending',
      priority: 'medium',
      metadata: JSON.stringify({
        source: 'test',
        testId: id,
        environment: 'test'
      }),
      createdAt: Date.now(),
      startedAt: overrides.startedAt || null,
      completedAt: overrides.completedAt || null,
      ...overrides
    };
  }

  /**
   * Create a test session record
   * @param overrides Partial session data to override defaults
   * @returns Complete SessionInsert object
   */
  createSession(overrides: Partial<SessionInsert> = {}): SessionInsert {
    const id = this.generateId();
    return {
      id,
      projectId: overrides.projectId || this.generateId(),
      userId: overrides.userId || this.generateId(),
      slackThreadTs: `${this.randomTimestamp()}.${this.randomString(6)}`,
      status: 'active',
      metadata: JSON.stringify({
        testSession: true,
        sessionId: id
      }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides
    };
  }

  /**
   * Create a test audit log record
   * @param overrides Partial audit log data to override defaults
   * @returns Complete AuditLogInsert object
   */
  createAuditLog(overrides: Partial<AuditLogInsert> = {}): AuditLogInsert {
    const id = this.generateId();
    return {
      id,
      userId: overrides.userId || this.generateId(),
      action: 'test_action',
      resource: 'test_resource',
      resourceId: this.generateId(),
      details: JSON.stringify({
        testLog: true,
        logId: id,
        timestamp: new Date().toISOString()
      }),
      ipAddress: '127.0.0.1',
      userAgent: 'DatabaseTestFactory/1.0.0',
      createdAt: Date.now(),
      ...overrides
    };
  }

  /**
   * Create a test offline queue message record
   * @param overrides Partial offline queue data to override defaults
   * @returns Complete OfflineQueueInsert object
   */
  createOfflineQueueMessage(overrides: Partial<OfflineQueueInsert> = {}): OfflineQueueInsert {
    const id = this.generateId();
    return {
      id,
      agentId: overrides.agentId || this.generateId(),
      type: 'test_message',
      data: JSON.stringify({
        testMessage: true,
        messageId: id,
        timestamp: Date.now()
      }),
      priority: 5,
      attempts: 0,
      maxAttempts: 3,
      createdAt: Date.now(),
      nextAttemptAt: Date.now() + (5 * 60 * 1000), // 5 minutes from now
      ...overrides
    };
  }

  /**
   * Create a test prompt history record
   * @param overrides Partial prompt history data to override defaults
   * @returns Complete PromptHistoryInsert object
   */
  createPromptHistory(overrides: Partial<PromptHistoryInsert> = {}): PromptHistoryInsert {
    const id = this.generateId();
    return {
      id,
      userId: overrides.userId || this.generateId(),
      prompt: `Test prompt for history ${id}`,
      response: `Test response for prompt ${id}`,
      model: 'claude-3-sonnet-20240229',
      metadata: JSON.stringify({
        testPrompt: true,
        promptId: id,
        usage: {
          input_tokens: 100,
          output_tokens: 150
        }
      }),
      createdAt: Date.now(),
      ...overrides
    };
  }

  /**
   * Create a test API key record
   * @param overrides Partial API key data to override defaults
   * @returns Complete ApiKeyInsert object
   */
  createApiKey(overrides: Partial<ApiKeyInsert> = {}): ApiKeyInsert {
    const id = this.generateId();
    return {
      id,
      userId: overrides.userId || this.generateId(),
      name: `Test API Key ${id.slice(-4)}`,
      keyHash: this.randomString(64),
      permissions: JSON.stringify(['read', 'write']),
      isActive: true,
      expiresAt: overrides.expiresAt || null,
      lastUsedAt: overrides.lastUsedAt || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides
    };
  }

  /**
   * Generate a random string of specified length
   * @param length String length (default: 8)
   * @returns Random alphanumeric string
   */
  randomString(length = 8): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Generate a random test email address
   * @returns Test email address
   */
  randomEmail(): string {
    return `test.${this.randomString(6).toLowerCase()}@example.com`;
  }

  /**
   * Generate a random timestamp within the last year
   * @returns Unix timestamp
   */
  randomTimestamp(): number {
    const now = Date.now();
    const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);
    return Math.floor(Math.random() * (now - oneYearAgo)) + oneYearAgo;
  }

  /**
   * Generate a random future timestamp
   * @param maxDaysFromNow Maximum days from now (default: 30)
   * @returns Unix timestamp in the future
   */
  randomFutureTimestamp(maxDaysFromNow = 30): number {
    const now = Date.now();
    const maxMs = maxDaysFromNow * 24 * 60 * 60 * 1000;
    return now + Math.floor(Math.random() * maxMs);
  }

  /**
   * Generate a random Slack user ID format
   * @returns Slack user ID (U followed by 10 characters)
   */
  randomSlackUserId(): string {
    return `U${this.randomString(10).toUpperCase()}`;
  }

  /**
   * Generate a random Slack channel ID format
   * @returns Slack channel ID (C followed by 10 characters)
   */
  randomSlackChannelId(): string {
    return `C${this.randomString(10).toUpperCase()}`;
  }

  /**
   * Generate a random Slack thread timestamp format
   * @returns Slack thread timestamp
   */
  randomSlackThreadTs(): string {
    return `${this.randomTimestamp()}.${this.randomString(6)}`;
  }

  /**
   * Create a set of related test entities for comprehensive testing
   * @returns Object containing related test entities
   */
  createTestSuite(): {
    user: UserInsert;
    project: ProjectInsert;
    session: SessionInsert;
    task: TaskInsert;
    auditLog: AuditLogInsert;
    apiKey: ApiKeyInsert;
  } {
    const user = this.createUser();
    const project = this.createProject({ ownerId: user.id });
    const session = this.createSession({
      projectId: project.id,
      userId: user.id
    });
    const task = this.createTask({
      projectId: project.id,
      sessionId: session.id
    });
    const auditLog = this.createAuditLog({
      userId: user.id,
      resourceId: project.id
    });
    const apiKey = this.createApiKey({ userId: user.id });

    return {
      user,
      project,
      session,
      task,
      auditLog,
      apiKey
    };
  }

  /**
   * Generate multiple entities of the same type
   * @param factory Factory method to use
   * @param count Number of entities to create
   * @param overridesArray Array of overrides for each entity
   * @returns Array of created entities
   */
  createMultiple<T>(
    factory: (overrides?: any) => T,
    count: number,
    overridesArray: Array<Partial<T>> = []
  ): T[] {
    const entities: T[] = [];
    for (let i = 0; i < count; i++) {
      const overrides = overridesArray[i] || {};
      entities.push(factory.call(this, overrides));
    }
    return entities;
  }

  /**
   * Reset the ID counter for predictable test IDs
   * @param startValue Starting value for the counter (default: 1000)
   */
  static resetIdCounter(startValue = 1000): void {
    DatabaseTestFactory.idCounter = startValue;
  }
}