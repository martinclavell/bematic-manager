import { OfflineQueue } from './offline-queue.js';

// Mock dependencies
const mockRepo = {
  findAllPending: () => [
    { id: 1, agentId: 'agent1', payload: '{"type":"test","data":"message1"}' },
    { id: 2, agentId: 'agent1', payload: '{"type":"test","data":"message2"}' },
    { id: 3, agentId: 'agent2', payload: '{"type":"test","data":"message3"}' },
    { id: 4, agentId: 'agent1', payload: '{"type":"test","data":"message4"}' },
    { id: 5, agentId: 'agent1', payload: '{"type":"test","data":"message5"}' },
  ],
  markDelivered: (id: number) => console.log(`Marked delivered: ${id}`),
  enqueue: () => {},
  cleanExpired: () => 0,
};

const mockAgentManager = {
  resolveAgent: (agentId: string) => agentId,
  send: (agentId: string, payload: string) => {
    console.log(`Sending to ${agentId}: ${JSON.parse(payload).data}`);
    return true;
  },
  on: () => {},
  getConnectedAgentIds: () => ['agent1', 'agent2'],
};

const mockConfig = {
  offlineQueue: {
    maxConcurrentDeliveries: 3,
    deliveryTimeout: 5000,
    preserveMessageOrder: false,
    retryAttempts: 2,
    retryDelayMs: 100,
  },
};

// Test parallel processing
async function testParallelProcessing() {
  console.log('=== Testing Parallel Processing ===');
  const queue = new OfflineQueue(mockRepo as any, mockAgentManager as any, mockConfig as any);

  const startTime = Date.now();
  const delivered = await queue.drainAll();
  const endTime = Date.now();

  console.log(`Delivered: ${delivered} messages in ${endTime - startTime}ms`);

  const metrics = queue.getMetrics();
  console.log('Metrics:', JSON.stringify(metrics, null, 2));
}

// Test sequential processing
async function testSequentialProcessing() {
  console.log('\\n=== Testing Sequential Processing ===');
  const sequentialConfig = {
    ...mockConfig,
    offlineQueue: {
      ...mockConfig.offlineQueue,
      preserveMessageOrder: true,
    },
  };

  const queue = new OfflineQueue(mockRepo as any, mockAgentManager as any, sequentialConfig as any);

  const startTime = Date.now();
  const delivered = await queue.drainAll();
  const endTime = Date.now();

  console.log(`Delivered: ${delivered} messages in ${endTime - startTime}ms`);

  const metrics = queue.getMetrics();
  console.log('Metrics:', JSON.stringify(metrics, null, 2));
}

// Run tests
testParallelProcessing()
  .then(() => testSequentialProcessing())
  .then(() => console.log('\\nAll tests completed!'))
  .catch(console.error);