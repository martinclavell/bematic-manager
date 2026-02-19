# Test Utilities Package

Comprehensive test utilities for the Bematic Manager testing infrastructure. This package provides reusable utilities for WebSocket testing, database testing, Slack mocking, async helpers, and test logging.

## Installation & Usage

```typescript
import {
  WebSocketTestClient,
  DatabaseTestFactory,
  MockSlackClient,
  TestLogger,
  createTestSetup,
  waitFor,
  sleep,
  retry
} from '@bematic/common/test-utils';
```

## Utilities Overview

### WebSocketTestClient

A comprehensive WebSocket test client for testing WebSocket connections and message handling.

```typescript
const client = new WebSocketTestClient();
await client.connect('ws://localhost:3001', 'test-api-key');

// Send messages
await client.send({ type: 'test', data: 'hello' });

// Wait for specific messages
const response = await client.waitForMessage('response', 5000);

// Check received messages
const messages = client.getReceivedMessages();
expect(messages).toHaveLength(1);

await client.disconnect();
```

### DatabaseTestFactory

Factory for generating consistent test data across all database entities.

```typescript
const factory = new DatabaseTestFactory();

// Create individual entities
const user = factory.createUser({
  email: 'test@example.com',
  isAdmin: true
});

const project = factory.createProject({
  ownerId: user.id,
  name: 'Test Project'
});

// Create complete test suite with relationships
const suite = factory.createTestSuite();
// Returns: { user, project, session, task, auditLog, apiKey }
```

### MockSlackClient

Jest-compatible mock for Slack API interactions.

```typescript
const mockSlack = new MockSlackClient();

// Configure mock responses
mockSlack.postMessage.mockResolvedValue({
  ok: true,
  ts: '1234567890.123456'
});

// Use in your code
await yourService.sendSlackMessage('Hello world');

// Assert calls
expect(mockSlack.postMessage).toHaveBeenCalledWith({
  channel: 'C1234567890',
  text: 'Hello world'
});

// Check call counts
expect(mockSlack.getCallCount('postMessage')).toBe(1);

// Simulate errors
mockSlack.mockError('postMessage', 'channel_not_found');
mockSlack.mockThrow('postMessage', new Error('Network error'));
```

### TestLogger

Capture and assert log messages during tests.

```typescript
const logger = new TestLogger();

// Log messages
logger.info('User logged in');
logger.error('Database error', { table: 'users', operation: 'insert' });

// Assert messages
logger.assertLogged('info', 'User logged in');
logger.assertLogged('error', /Database error/);

// Assert context
logger.assertLogContext('error', { table: 'users' });

// Get logs
const errorLogs = logger.getLogs('error');
expect(errorLogs).toHaveLength(1);
```

### Async Helpers

Utilities for timing-sensitive test operations.

```typescript
// Wait for conditions
await waitFor(() => myVariable === 'expected', 5000);

// Sleep
await sleep(1000);

// Wait for events
const eventData = await waitForEvent(emitter, 'data', 3000);

// Retry operations
const result = await retry(
  () => unstableOperation(),
  maxRetries: 3,
  delay: 1000,
  backoff: true
);

// Timeout promises
const result = await withTimeout(
  slowOperation(),
  5000,
  'Operation timed out'
);
```

## Complete Test Setup

Use `createTestSetup()` for a complete test environment:

```typescript
describe('My Test Suite', () => {
  const setup = createTestSetup();

  afterEach(async () => {
    await setup.cleanup(); // Clean up WebSocket connections
    setup.reset(); // Reset all utilities
  });

  test('should handle user flow', async () => {
    // Use all utilities
    const user = setup.factory.createUser();
    setup.mockSlack.postMessage.mockResolvedValue({ ok: true });
    setup.logger.info('Test started');

    // Your test code here...

    // Assert results
    setup.logger.assertLogged('info', 'Test started');
    expect(setup.mockSlack.getCallCount('postMessage')).toBe(1);
  });
});
```

## Test Patterns

Common test patterns and utilities:

```typescript
import { testPatterns, errorSimulation } from '@bematic/common/test-utils';

// Quick test user creation
const user = testPatterns.createTestUser({ name: 'Custom Name' });

// Mock WebSocket messages
const message = testPatterns.mockWebSocketMessage('task_complete', {
  taskId: 'task_123',
  result: 'success'
});

// Error simulation
const networkError = errorSimulation.networkError('Connection failed');
const validationError = errorSimulation.validationError('email', 'Invalid format');
```

## Vitest Integration

Utilities designed to work seamlessly with Vitest:

```typescript
import { vitestHelpers } from '@bematic/common/test-utils';

// Timeout configuration
test('long running test', async () => {
  // test code
}, vitestHelpers.withTimeout(10000));

// Conditional test execution
test.skipIf(process.env.SKIP_SLOW_TESTS)('slow test', () => {
  // test code
});
```

## Performance Testing

Measure and assert performance:

```typescript
import { performanceUtils } from '@bematic/common/test-utils';

test('should complete within time budget', async () => {
  const result = await performanceUtils.expectWithinTime(1000)(
    () => myExpensiveOperation()
  );

  expect(result).toBe('expected');
});

// Measure execution time
const { result, time } = await performanceUtils.measureTime(
  () => myOperation()
);

console.log(`Operation took ${time}ms`);
```

## Error Simulation

Test error handling with realistic error types:

```typescript
import { errorSimulation } from '@bematic/common/test-utils';

test('should handle network errors', async () => {
  const networkError = errorSimulation.networkError('Connection failed');
  mockService.getData.mockRejectedValue(networkError);

  await expect(myService.processData()).rejects.toMatchObject({
    message: 'Connection failed',
    code: 'NETWORK_ERROR'
  });
});
```

## Best Practices

### 1. Use Complete Setup for Integration Tests

```typescript
const setup = createTestSetup();

beforeEach(() => {
  setup.reset(); // Start with clean state
});

afterEach(async () => {
  await setup.cleanup(); // Clean up resources
});
```

### 2. Create Realistic Test Data

```typescript
const factory = new DatabaseTestFactory();

// Create related entities with proper relationships
const user = factory.createUser({ email: 'test@example.com' });
const project = factory.createProject({ ownerId: user.id });
const task = factory.createTask({
  projectId: project.id,
  status: 'pending'
});
```

### 3. Use Async Helpers for Timing

```typescript
// Instead of arbitrary timeouts
// await sleep(5000); // Bad

// Use condition-based waiting
await waitFor(() => taskStatus === 'completed', 5000); // Good
```

### 4. Assert Comprehensive Logging

```typescript
// Test that important events are logged
logger.assertLogged('audit', 'User logged in');
logger.assertLogContext('audit', { userId: user.id });

// Verify error handling logs
logger.assertLogged('error', /Database connection failed/);
```

### 5. Mock External Dependencies Completely

```typescript
// Mock all Slack interactions
mockSlack.postMessage.mockResolvedValue({ ok: true });
mockSlack.getUserInfo.mockResolvedValue({
  ok: true,
  user: { id: 'U123', profile: { email: 'test@example.com' } }
});

// Verify all expected interactions
expect(mockSlack.postMessage).toHaveBeenCalledTimes(2);
expect(mockSlack.getUserInfo).toHaveBeenCalledWith({ user: 'U123' });
```

## File Structure

```
packages/common/src/test-utils/
├── index.ts                    # Main exports
├── websocket-test-client.ts    # WebSocket testing utilities
├── database-test-factory.ts    # Database test data factories
├── mock-slack-client.ts        # Slack API mocking
├── async-helpers.ts            # Async operation helpers
├── test-logger.ts              # Test logging utilities
├── examples.test.ts            # Usage examples and tests
└── README.md                   # This documentation
```

## Contributing

When adding new test utilities:

1. Add comprehensive JSDoc comments
2. Include usage examples in comments
3. Export from main index.ts
4. Add examples to examples.test.ts
5. Update this README