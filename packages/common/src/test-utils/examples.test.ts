/**
 * Example test file demonstrating usage of the test utilities package.
 * This file serves as documentation and reference for how to use the utilities.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WebSocketTestClient,
  DatabaseTestFactory,
  MockSlackClient,
  TestLogger,
  createTestSetup,
  waitFor,
  sleep,
  retry,
  testPatterns,
  errorSimulation
} from './index.js';

describe('Test Utilities Examples', () => {
  describe('WebSocketTestClient', () => {
    test('should connect and send messages', async () => {
      const client = new WebSocketTestClient();

      // Mock WebSocket for testing
      // In real tests, you'd connect to actual test server
      // await client.connect('ws://localhost:3001', 'test-api-key');

      expect(client).toBeDefined();
      expect(client.getMessageCount()).toBe(0);
    });

    test('should wait for specific message types', async () => {
      const client = new WebSocketTestClient();

      // Simulate receiving messages
      setTimeout(() => {
        client.emit('message', { type: 'test', data: 'hello' });
      }, 100);

      // This would work with real WebSocket connection
      // const message = await client.waitForMessage('test', 1000);
      // expect(message.data).toBe('hello');
    });
  });

  describe('DatabaseTestFactory', () => {
    test('should create test users with defaults', () => {
      const factory = new DatabaseTestFactory();
      const user = factory.createUser();

      expect(user.id).toBeDefined();
      expect(user.email).toMatch(/test\..+@example\.com/);
      expect(user.isActive).toBe(true);
      expect(user.isAdmin).toBe(false);
    });

    test('should create test users with overrides', () => {
      const factory = new DatabaseTestFactory();
      const user = factory.createUser({
        email: 'admin@test.com',
        isAdmin: true
      });

      expect(user.email).toBe('admin@test.com');
      expect(user.isAdmin).toBe(true);
    });

    test('should create complete test suite', () => {
      const factory = new DatabaseTestFactory();
      const suite = factory.createTestSuite();

      expect(suite.user).toBeDefined();
      expect(suite.project).toBeDefined();
      expect(suite.task).toBeDefined();
      expect(suite.session).toBeDefined();
      expect(suite.auditLog).toBeDefined();
      expect(suite.apiKey).toBeDefined();

      // Check relationships
      expect(suite.project.ownerId).toBe(suite.user.id);
      expect(suite.task.projectId).toBe(suite.project.id);
      expect(suite.session.userId).toBe(suite.user.id);
    });
  });

  describe('MockSlackClient', () => {
    let mockSlack: MockSlackClient;

    beforeEach(() => {
      mockSlack = new MockSlackClient();
    });

    afterEach(() => {
      mockSlack.reset();
    });

    test('should mock postMessage calls', async () => {
      // Configure mock response
      mockSlack.postMessage.mockResolvedValue({
        ok: true,
        ts: '1234567890.123456'
      });

      // Use the mock
      const result = await mockSlack.postMessage({
        channel: 'C1234567890',
        text: 'Test message'
      });

      expect(result.ok).toBe(true);
      expect(mockSlack.getCallCount('postMessage')).toBe(1);
      expect(mockSlack.getLastCall('postMessage')).toEqual([{
        channel: 'C1234567890',
        text: 'Test message'
      }]);
    });

    test('should simulate error responses', async () => {
      mockSlack.mockError('postMessage', 'channel_not_found');

      const result = await mockSlack.postMessage({
        channel: 'INVALID',
        text: 'Test'
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe('channel_not_found');
    });

    test('should throw exceptions when configured', async () => {
      mockSlack.mockThrow('postMessage', 'Network error');

      await expect(
        mockSlack.postMessage({ channel: 'C123', text: 'Test' })
      ).rejects.toThrow('Network error');
    });
  });

  describe('TestLogger', () => {
    let logger: TestLogger;

    beforeEach(() => {
      logger = new TestLogger();
    });

    test('should capture log messages', () => {
      logger.info('Test message');
      logger.error('Error occurred', { userId: 123 });

      expect(logger.getLogCount()).toBe(2);
      expect(logger.getLogCount('info')).toBe(1);
      expect(logger.getLogCount('error')).toBe(1);
    });

    test('should assert logged messages', () => {
      logger.info('User logged in');
      logger.error('Failed to connect to database');

      // String matching
      logger.assertLogged('info', 'User logged in');

      // Regex matching
      logger.assertLogged('error', /Failed to connect/);

      // Should throw if not found
      expect(() => {
        logger.assertLogged('warn', 'Not logged');
      }).toThrow();
    });

    test('should assert log context', () => {
      logger.error('Database error', { table: 'users', operation: 'insert' });

      logger.assertLogContext('error', { table: 'users' });
      logger.assertLogContext('error', (ctx) => ctx.operation === 'insert');
    });
  });

  describe('Async Helpers', () => {
    test('should wait for conditions', async () => {
      let condition = false;
      setTimeout(() => { condition = true; }, 100);

      await waitFor(() => condition, 1000);
      expect(condition).toBe(true);
    });

    test('should sleep for specified duration', async () => {
      const start = Date.now();
      await sleep(100);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some variance
      expect(elapsed).toBeLessThan(150);
    });

    test('should retry failed operations', async () => {
      let attempts = 0;
      const operation = vi.fn(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      const result = await retry(operation, 3, 10);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });
  });

  describe('Test Patterns', () => {
    test('should create test user with common defaults', () => {
      const user = testPatterns.createTestUser({
        name: 'Custom Name'
      });

      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Custom Name');
      expect(user.isActive).toBe(true);
    });

    test('should create mock WebSocket messages', () => {
      const message = testPatterns.mockWebSocketMessage('task_complete', {
        taskId: 'task_123',
        result: 'success'
      });

      expect(message.type).toBe('task_complete');
      expect(message.data.taskId).toBe('task_123');
      expect(message.timestamp).toBeDefined();
      expect(message.id).toBeDefined();
    });
  });

  describe('Error Simulation', () => {
    test('should create network errors', () => {
      const error = errorSimulation.networkError('Connection failed');

      expect(error.message).toBe('Connection failed');
      expect((error as any).code).toBe('NETWORK_ERROR');
    });

    test('should create validation errors', () => {
      const error = errorSimulation.validationError('email', 'Invalid email format');

      expect(error.message).toBe('Invalid email format');
      expect((error as any).code).toBe('VALIDATION_ERROR');
      expect((error as any).field).toBe('email');
    });
  });

  describe('Complete Test Setup', () => {
    test('should provide all utilities in one setup', async () => {
      const setup = createTestSetup();

      // All utilities should be available
      expect(setup.factory).toBeInstanceOf(DatabaseTestFactory);
      expect(setup.mockSlack).toBeInstanceOf(MockSlackClient);
      expect(setup.logger).toBeInstanceOf(TestLogger);
      expect(setup.wsClient).toBeInstanceOf(WebSocketTestClient);

      // Create some test data
      const user = setup.factory.createUser();
      setup.logger.info('Test user created', { userId: user.id });
      setup.mockSlack.postMessage.mockResolvedValue({ ok: true });

      // Verify functionality
      expect(user.id).toBeDefined();
      expect(setup.logger.getLogCount('info')).toBe(1);
      expect(setup.mockSlack.getCallCount('postMessage')).toBe(0);

      // Cleanup
      await setup.cleanup();
      expect(setup.logger.getLogCount()).toBe(0);
    });

    test('should reset all utilities', () => {
      const setup = createTestSetup();

      // Create some state
      setup.logger.info('Test message');
      const user = setup.factory.createUser();
      setup.mockSlack.postMessage({ channel: 'C123', text: 'test' });

      // Reset should clear everything
      setup.reset();

      expect(setup.logger.getLogCount()).toBe(0);
      // Mock should be reset (no calls recorded)
      expect(setup.mockSlack.getCallCount('postMessage')).toBe(0);
    });
  });
});

/**
 * Example of how to use test utilities in a real test scenario
 */
describe('Real-world Test Example', () => {
  test('should handle complete user registration flow', async () => {
    const setup = createTestSetup();

    // Setup test data
    const testUser = setup.factory.createUser({
      email: 'newuser@example.com',
      name: 'New User'
    });

    // Mock Slack responses
    setup.mockSlack.postMessage.mockResolvedValue({
      ok: true,
      ts: '1234567890.123456'
    });

    setup.mockSlack.getUserInfo.mockResolvedValue({
      ok: true,
      user: {
        id: testUser.slackUserId,
        profile: { email: testUser.email }
      }
    });

    // In a real test, you'd call your actual service methods here
    // Example:
    // const result = await userService.register(testUser);

    // For this example, we'll just simulate logging
    setup.logger.info('User registration started', { email: testUser.email });
    setup.logger.info('Slack notification sent');
    setup.logger.info('User registration completed', { userId: testUser.id });

    // Assertions
    setup.logger.assertLogged('info', 'User registration started');
    setup.logger.assertLogContext('info', { email: 'newuser@example.com' });
    expect(setup.logger.getLogCount('info')).toBe(3);

    // Verify Slack integration (in real test)
    // expect(setup.mockSlack.postMessage).toHaveBeenCalledWith({
    //   channel: expect.any(String),
    //   text: expect.stringContaining('welcome')
    // });

    await setup.cleanup();
  });
});