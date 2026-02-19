/**
 * Test utilities for the Bematic Manager testing infrastructure.
 * Provides comprehensive utilities for WebSocket testing, database testing,
 * Slack mocking, async helpers, and test logging.
 *
 * @example
 * ```typescript
 * import {
 *   WebSocketTestClient,
 *   DatabaseTestFactory,
 *   MockSlackClient,
 *   waitFor,
 *   sleep,
 *   TestLogger
 * } from '@bematic/common/test-utils';
 *
 * // WebSocket testing
 * const wsClient = new WebSocketTestClient();
 * await wsClient.connect('ws://localhost:3001', 'test-api-key');
 *
 * // Database test data
 * const factory = new DatabaseTestFactory();
 * const user = factory.createUser({ email: 'test@example.com' });
 *
 * // Slack mocking
 * const mockSlack = new MockSlackClient();
 * mockSlack.postMessage.mockResolvedValue({ ok: true, ts: '123' });
 *
 * // Async helpers
 * await waitFor(() => condition === true, 5000);
 * await sleep(1000);
 *
 * // Test logging
 * const logger = new TestLogger();
 * logger.info('Test started');
 * logger.assertLogged('info', 'Test started');
 * ```
 */

// WebSocket testing utilities
export { WebSocketTestClient } from './websocket-test-client.js';

// Database test data factories
export { DatabaseTestFactory } from './database-test-factory.js';

// Slack API mocking
export { MockSlackClient } from './mock-slack-client.js';

// Async helpers for timing-sensitive operations
export {
  waitFor,
  sleep,
  waitForEvent,
  waitForEvents,
  retry,
  retryWithCondition,
  withTimeout,
  poll,
  waitForSettle,
  debounce,
  limitConcurrency,
  createCancellablePromise
} from './async-helpers.js';

// Test logging utilities
export {
  TestLogger,
  type LogEntry,
  type LogLevel
} from './test-logger.js';

// Re-export commonly used types for convenience
export type {
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
 * Create a complete test setup with all utilities initialized
 * @returns Object containing all test utilities ready for use
 *
 * @example
 * ```typescript
 * const testSetup = createTestSetup();
 *
 * // Use the utilities
 * const user = testSetup.factory.createUser();
 * testSetup.mockSlack.postMessage.mockResolvedValue({ ok: true });
 * testSetup.logger.info('Test setup complete');
 *
 * // Cleanup after tests
 * testSetup.cleanup();
 * ```
 */
export function createTestSetup() {
  const factory = new DatabaseTestFactory();
  const mockSlack = new MockSlackClient();
  const logger = new TestLogger();
  const wsClient = new WebSocketTestClient();

  return {
    factory,
    mockSlack,
    logger,
    wsClient,
    /**
     * Clean up all test utilities
     */
    async cleanup(): Promise<void> {
      logger.clear();
      mockSlack.reset();
      if (wsClient.isConnectedToServer()) {
        await wsClient.disconnect();
      }
      wsClient.clearMessages();
    },
    /**
     * Reset all test utilities to initial state
     */
    reset(): void {
      logger.clear();
      mockSlack.reset();
      wsClient.clearMessages();
      DatabaseTestFactory.resetIdCounter();
    }
  };
}

/**
 * Vitest-specific test helpers and matchers
 */
export const vitestHelpers = {
  /**
   * Create a test timeout that works with Vitest
   * @param timeout Timeout in milliseconds
   * @returns Timeout configuration for Vitest
   */
  withTimeout: (timeout: number) => ({ timeout }),

  /**
   * Skip test conditionally based on environment
   * @param condition Condition to check
   * @param reason Reason for skipping
   * @returns Skip configuration
   */
  skipIf: (condition: boolean, reason?: string) => ({
    skip: condition,
    reason
  }),

  /**
   * Run test only in specific conditions
   * @param condition Condition to check
   * @param reason Reason for running only when condition is met
   * @returns Only configuration
   */
  runIf: (condition: boolean, reason?: string) => ({
    only: condition,
    reason
  })
};

/**
 * Common test patterns and utilities
 */
export const testPatterns = {
  /**
   * Create a test user with common test data
   * @param overrides Optional overrides for user data
   * @returns Test user data
   */
  createTestUser: (overrides?: any) => {
    const factory = new DatabaseTestFactory();
    return factory.createUser({
      email: 'test@example.com',
      name: 'Test User',
      isAdmin: false,
      isActive: true,
      ...overrides
    });
  },

  /**
   * Create a complete test project setup
   * @param overrides Optional overrides for project data
   * @returns Test project with related data
   */
  createTestProject: (overrides?: any) => {
    const factory = new DatabaseTestFactory();
    const suite = factory.createTestSuite();
    return {
      ...suite,
      ...overrides
    };
  },

  /**
   * Create mock WebSocket server response
   * @param type Message type
   * @param data Message data
   * @returns Mock WebSocket message
   */
  mockWebSocketMessage: (type: string, data?: any) => ({
    type,
    data,
    timestamp: Date.now(),
    id: Math.random().toString(36).substr(2, 9)
  }),

  /**
   * Create mock Slack event
   * @param type Event type
   * @param data Event data
   * @returns Mock Slack event
   */
  mockSlackEvent: (type: string, data?: any) => ({
    type,
    event_ts: Date.now().toString(),
    team_id: 'T01234567890',
    api_app_id: 'A01234567890',
    event: {
      type,
      ...data,
      ts: `${Date.now()}.${Math.floor(Math.random() * 1000000)}`
    }
  })
};

/**
 * Error simulation utilities for testing error handling
 */
export const errorSimulation = {
  /**
   * Create a network error
   * @param message Error message
   * @returns Network error instance
   */
  networkError: (message = 'Network error') => {
    const error = new Error(message);
    (error as any).code = 'NETWORK_ERROR';
    return error;
  },

  /**
   * Create a timeout error
   * @param message Error message
   * @returns Timeout error instance
   */
  timeoutError: (message = 'Request timeout') => {
    const error = new Error(message);
    (error as any).code = 'TIMEOUT';
    return error;
  },

  /**
   * Create a database error
   * @param message Error message
   * @returns Database error instance
   */
  databaseError: (message = 'Database error') => {
    const error = new Error(message);
    (error as any).code = 'DATABASE_ERROR';
    return error;
  },

  /**
   * Create a validation error
   * @param field Field name
   * @param message Error message
   * @returns Validation error instance
   */
  validationError: (field: string, message = 'Validation failed') => {
    const error = new Error(message);
    (error as any).code = 'VALIDATION_ERROR';
    (error as any).field = field;
    return error;
  }
};

/**
 * Performance testing utilities
 */
export const performanceUtils = {
  /**
   * Measure execution time of a function
   * @param fn Function to measure
   * @returns Execution time in milliseconds
   */
  async measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; time: number }> {
    const start = performance.now();
    const result = await fn();
    const time = performance.now() - start;
    return { result, time };
  },

  /**
   * Create a performance budget assertion
   * @param maxTime Maximum allowed time in milliseconds
   * @returns Function to assert performance
   */
  expectWithinTime: (maxTime: number) => async <T>(fn: () => Promise<T>) => {
    const { result, time } = await performanceUtils.measureTime(fn);
    if (time > maxTime) {
      throw new Error(`Operation took ${time}ms, expected less than ${maxTime}ms`);
    }
    return result;
  }
};

// Default export for convenience
export default {
  WebSocketTestClient,
  DatabaseTestFactory,
  MockSlackClient,
  TestLogger,
  createTestSetup,
  vitestHelpers,
  testPatterns,
  errorSimulation,
  performanceUtils,
  // Async helpers
  waitFor,
  sleep,
  waitForEvent,
  retry,
  withTimeout,
  poll
};