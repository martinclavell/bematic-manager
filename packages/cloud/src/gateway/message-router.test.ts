import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageRouter } from './message-router.js';

// Mock the common package imports to avoid cache initialization issues
vi.mock('@bematic/common', () => ({
  MessageType: {
    TASK_ACK: 'task:ack',
    TASK_PROGRESS: 'task:progress',
    TASK_STREAM: 'task:stream',
    TASK_COMPLETE: 'task:complete',
    TASK_ERROR: 'task:error',
    TASK_CANCELLED: 'task:cancelled',
    DEPLOY_RESULT: 'deploy:result',
    AGENT_STATUS: 'agent:status',
    AUTH_REQUEST: 'auth:request',
    AUTH_RESPONSE: 'auth:response',
    HEARTBEAT_PING: 'heartbeat:ping',
  },
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
  parseMessage: vi.fn((raw: string) => JSON.parse(raw)),
  taskAckSchema: {
    parse: vi.fn((payload) => payload),
  },
  taskProgressSchema: {
    parse: vi.fn((payload) => payload),
  },
  taskStreamSchema: {
    parse: vi.fn((payload) => payload),
  },
  taskCompleteSchema: {
    parse: vi.fn((payload) => payload),
  },
  taskErrorSchema: {
    parse: vi.fn((payload) => payload),
  },
}));

// Mock BotRegistry
vi.mock('@bematic/bots', () => ({
  BotRegistry: {
    get: vi.fn(() => null),
  },
  ResponseBuilder: {
    taskCompleteBlocks: vi.fn(() => []),
    taskErrorBlocks: vi.fn(() => []),
    subtaskSummaryBlocks: vi.fn(() => []),
  },
}));

// Mock metrics
vi.mock('../utils/metrics.js', () => ({
  metrics: {
    increment: vi.fn(),
    histogram: vi.fn(),
    gauge: vi.fn(),
  },
  MetricNames: {
    TASKS_COMPLETED: 'tasks.completed',
    TASKS_FAILED: 'tasks.failed',
    TASKS_CANCELLED: 'tasks.cancelled',
    TASK_TOKENS: 'task.tokens',
    TASK_COST: 'task.cost',
    TASK_DURATION: 'task.duration',
    ACTIVE_TASKS: 'tasks.active',
  },
}));

// Mock markdown converter
vi.mock('../utils/markdown-to-slack.js', () => ({
  markdownToSlack: vi.fn((text: string) => text),
}));

// Mock task repository methods
const mockTaskRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  findByParentTaskId: vi.fn(),
  areAllSubtasksComplete: vi.fn(),
  findAll: vi.fn(),
  findByProjectId: vi.fn(),
  delete: vi.fn(),
  findByStatus: vi.fn(() => []),
};

const mockAuditLogRepo = {
  log: vi.fn(),
  findAll: vi.fn(),
  findByResourceId: vi.fn(),
  findByUserId: vi.fn(),
  deleteOld: vi.fn(),
};

const mockProjectRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  findByChannelId: vi.fn(),
  findByAgentId: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findAll: vi.fn(),
};

const mockStreamAccumulator = {
  addDelta: vi.fn(),
  removeStream: vi.fn(),
};

const mockNotifier = {
  postMessage: vi.fn(),
  postBlocks: vi.fn(),
  updateMessage: vi.fn(),
  addReaction: vi.fn(),
  removeReaction: vi.fn(),
  notifyAttachmentFailures: vi.fn(),
};

const mockAgentHealthTracker = {
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  isHealthy: vi.fn(),
  getHealth: vi.fn(),
};

const mockCommandService = {
  handleDecompositionComplete: vi.fn(),
};

// Helper to create mock task
const createMockTask = (overrides = {}) => ({
  id: 'task_123',
  projectId: 'proj_123',
  botName: 'default',
  command: 'build',
  prompt: 'Build the project',
  systemPrompt: 'You are a helpful assistant',
  localPath: '/project',
  model: 'claude-sonnet-4-5',
  maxBudget: 5.0,
  allowedTools: ['terminal', 'editor'],
  resumeSessionId: null,
  maxContinuations: 0,
  parentTaskId: null,
  status: 'pending',
  result: null,
  errorMessage: null,
  sessionId: null,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCost: 0,
  filesChanged: '[]',
  commandsRun: '[]',
  slackChannelId: 'C123456',
  slackThreadTs: '1234567890.123',
  slackUserId: 'U123456',
  slackMessageTs: '1234567890.456',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('MessageRouter Basic Tests', () => {
  let router: MessageRouter;

  beforeEach(() => {
    vi.clearAllMocks();

    router = new MessageRouter(
      mockTaskRepo as any,
      mockAuditLogRepo as any,
      mockStreamAccumulator as any,
      mockNotifier as any,
      mockAgentHealthTracker as any,
    );

    router.setCommandService(mockCommandService as any, mockProjectRepo as any);
  });

  describe('handleAgentMessage', () => {
    it('should handle task acknowledgment messages', async () => {
      const task = createMockTask({ status: 'pending' });
      mockTaskRepo.findById.mockReturnValue(task);

      const message = JSON.stringify({
        id: 'msg_1',
        type: 'task:ack',
        payload: {
          taskId: 'task_123',
          accepted: true,
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockTaskRepo.update).toHaveBeenCalledWith('task_123', { status: 'running' });
    });

    it('should handle rejected task acknowledgment', async () => {
      const task = createMockTask({ status: 'pending' });
      mockTaskRepo.findById.mockReturnValue(task);

      const message = JSON.stringify({
        id: 'msg_1',
        type: 'task:ack',
        payload: {
          taskId: 'task_123',
          accepted: false,
          reason: 'Agent busy',
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockTaskRepo.update).toHaveBeenCalledWith('task_123', {
        status: 'failed',
        errorMessage: 'Agent busy',
      });
    });

    it('should handle task progress messages', async () => {
      const task = createMockTask();
      mockTaskRepo.findById.mockReturnValue(task);
      mockNotifier.postMessage.mockResolvedValue('1234567890.789');

      const message = JSON.stringify({
        id: 'msg_1',
        type: 'task:progress',
        payload: {
          taskId: 'task_123',
          type: 'tool_use',
          message: 'Running npm install',
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockNotifier.postMessage).toHaveBeenCalled();
    });

    it('should handle task stream messages', async () => {
      const task = createMockTask();
      mockTaskRepo.findById.mockReturnValue(task);

      const message = JSON.stringify({
        id: 'msg_1',
        type: 'task:stream',
        payload: {
          taskId: 'task_123',
          delta: 'Some output text',
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockStreamAccumulator.addDelta).toHaveBeenCalledWith(
        'task_123',
        'Some output text',
        'C123456',
        '1234567890.123'
      );
    });

    it('should handle task completion messages', async () => {
      const task = createMockTask({ status: 'running' });
      mockTaskRepo.findById.mockReturnValue(task);

      const message = JSON.stringify({
        id: 'msg_1',
        type: 'task:complete',
        payload: {
          taskId: 'task_123',
          result: 'Task completed successfully',
          sessionId: 'session_123',
          inputTokens: 1000,
          outputTokens: 500,
          estimatedCost: 0.15,
          filesChanged: ['file1.ts', 'file2.ts'],
          commandsRun: ['npm install', 'npm build'],
          durationMs: 30000,
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockTaskRepo.complete).toHaveBeenCalledWith('task_123', 'Task completed successfully', {
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCost: 0.15,
        filesChanged: ['file1.ts', 'file2.ts'],
        commandsRun: ['npm install', 'npm build'],
      });
      expect(mockAgentHealthTracker.recordSuccess).toHaveBeenCalledWith('agent_1');
    });

    it('should handle task error messages', async () => {
      const task = createMockTask({ status: 'running' });
      mockTaskRepo.findById.mockReturnValue(task);

      const message = JSON.stringify({
        id: 'msg_1',
        type: 'task:error',
        payload: {
          taskId: 'task_123',
          error: 'Command failed',
          recoverable: false,
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockTaskRepo.fail).toHaveBeenCalledWith('task_123', 'Command failed');
      expect(mockAgentHealthTracker.recordFailure).toHaveBeenCalledWith('agent_1');
    });

    it('should handle task cancellation messages', async () => {
      const task = createMockTask({ status: 'running' });
      mockTaskRepo.findById.mockReturnValue(task);

      const message = JSON.stringify({
        id: 'msg_1',
        type: 'task:cancelled',
        payload: {
          taskId: 'task_123',
          reason: 'User cancelled',
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockTaskRepo.update).toHaveBeenCalledWith('task_123', { status: 'cancelled' });
    });

    it('should handle unknown message types gracefully', async () => {
      const message = JSON.stringify({
        id: 'msg_1',
        type: 'unknown:type',
        payload: { data: 'test' },
        timestamp: Date.now(),
      });

      // Should not throw
      await expect(router.handleAgentMessage('agent_1', message)).resolves.not.toThrow();
    });

    it('should ignore messages for non-existent tasks', async () => {
      mockTaskRepo.findById.mockReturnValue(null);

      const message = JSON.stringify({
        id: 'msg_1',
        type: 'task:ack',
        payload: {
          taskId: 'nonexistent',
          accepted: true,
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockTaskRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('deploy requests', () => {
    it('should handle deploy result for registered request', async () => {
      router.registerDeployRequest('deploy_123', 'C123456', '1234567890.123', 'U123456');

      const message = JSON.stringify({
        id: 'msg_1',
        type: 'deploy:result',
        payload: {
          requestId: 'deploy_123',
          success: true,
          output: 'Deployment successful',
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockNotifier.postMessage).toHaveBeenCalledWith(
        'C123456',
        expect.stringContaining('Deploy uploaded successfully'),
        '1234567890.123'
      );
    });

    it('should ignore deploy result for unknown request', async () => {
      const message = JSON.stringify({
        id: 'msg_1',
        type: 'deploy:result',
        payload: {
          requestId: 'unknown_deploy',
          success: true,
          output: 'Success',
        },
        timestamp: Date.now(),
      });

      await router.handleAgentMessage('agent_1', message);

      expect(mockNotifier.postMessage).not.toHaveBeenCalled();
    });
  });
});