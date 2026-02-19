import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WSClient } from './ws-client.js';
import type { AgentConfig } from '../config.js';
import WebSocket from 'ws';

// Mock WebSocket
vi.mock('ws', () => {
  return {
    default: vi.fn(),
  };
});

// Mock common utilities
vi.mock('@bematic/common', () => ({
  MessageType: {
    AUTH_REQUEST: 'auth:request',
    AUTH_RESPONSE: 'auth:response',
    HEARTBEAT_PING: 'heartbeat:ping',
    HEARTBEAT_PONG: 'heartbeat:pong',
    TASK_ACK: 'task:ack',
  },
  Limits: {
    AGENT_KEEPALIVE_INTERVAL_MS: 30000,
    CIRCUIT_BREAKER_MAX_FAILURES: 5,
    CIRCUIT_BREAKER_LONG_BACKOFF_MS: 300000,
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createWSMessage: vi.fn((type, payload) => ({ id: 'msg_1', type, payload, timestamp: Date.now() })),
  serializeMessage: vi.fn((msg) => JSON.stringify(msg)),
  parseMessage: vi.fn((raw) => JSON.parse(raw)),
  calculateBackoff: vi.fn((attempt, base, max, jitter) => base * Math.pow(2, attempt)),
}));

const MockWebSocket = WebSocket as unknown as vi.MockedClass<typeof WebSocket>;

// Mock config
const createMockConfig = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  agentId: 'test_agent_001',
  agentApiKey: 'test_api_key_123',
  cloudWsUrl: 'ws://localhost:3001/ws',
  localPath: '/test/project',
  reconnect: {
    baseDelayMs: 100,
    maxDelayMs: 5000,
    maxAttempts: 10,
  },
  executor: {
    timeoutMs: 30000,
    maxConcurrent: 1,
  },
  ...overrides,
});

// Helper to create mock WebSocket instance
const createMockWebSocketInstance = () => {
  const mockWs = {
    readyState: WebSocket.CONNECTING,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  // Helper to simulate WebSocket events
  const eventHandlers: Record<string, Function[]> = {};

  mockWs.on.mockImplementation((event: string, handler: Function) => {
    if (!eventHandlers[event]) {
      eventHandlers[event] = [];
    }
    eventHandlers[event].push(handler);
  });

  const trigger = (event: string, ...args: any[]) => {
    if (eventHandlers[event]) {
      eventHandlers[event].forEach(handler => handler(...args));
    }
  };

  return { mockWs, trigger };
};

describe('WSClient Basic Tests', () => {
  let client: WSClient;
  let config: AgentConfig;
  let mockWsInstance: any;
  let triggerEvent: (event: string, ...args: any[]) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    config = createMockConfig();
    client = new WSClient(config);

    const { mockWs, trigger } = createMockWebSocketInstance();
    mockWsInstance = mockWs;
    triggerEvent = trigger;

    MockWebSocket.mockReturnValue(mockWsInstance as any);

    // Set up process.env defaults
    delete process.env.AGENT_WS_PROTOCOL;
    delete process.env.AGENT_WS_REJECT_UNAUTHORIZED;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    client.close();
    vi.restoreAllMocks();
  });

  describe('connect', () => {
    it('should create WebSocket with correct URL', () => {
      client.connect();

      expect(MockWebSocket).toHaveBeenCalledWith('ws://localhost:3001/ws', {});
    });

    it('should set up event handlers on WebSocket', () => {
      client.connect();

      expect(mockWsInstance.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockWsInstance.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWsInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWsInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should not connect if already closed', () => {
      client.close();
      client.connect();

      expect(MockWebSocket).not.toHaveBeenCalled();
    });
  });

  describe('connection lifecycle', () => {
    beforeEach(() => {
      client.connect();
      mockWsInstance.readyState = WebSocket.OPEN;
    });

    it('should handle WebSocket open event', () => {
      triggerEvent('open');

      // Should send auth request
      expect(mockWsInstance.send).toHaveBeenCalled();
    });

    it('should handle successful authentication', (done) => {
      client.once('authenticated', () => {
        expect(client.isConnected()).toBe(true);
        done();
      });

      triggerEvent('open');

      // Simulate successful auth response
      const authResponse = JSON.stringify({
        id: 'msg_1',
        type: 'auth:response',
        payload: { success: true },
        timestamp: Date.now(),
      });
      triggerEvent('message', Buffer.from(authResponse));
    });

    it('should handle authentication failure', () => {
      triggerEvent('open');

      // Simulate auth failure
      const authResponse = JSON.stringify({
        id: 'msg_1',
        type: 'auth:response',
        payload: { success: false, error: 'Invalid API key' },
        timestamp: Date.now(),
      });
      triggerEvent('message', Buffer.from(authResponse));

      expect(mockWsInstance.close).toHaveBeenCalledWith(4004, 'Auth failed');
    });

    it('should handle heartbeat ping from server', (done) => {
      client.once('heartbeat:ping', (payload) => {
        expect(payload.serverTime).toBe(123456789);
        done();
      });

      const heartbeat = JSON.stringify({
        id: 'msg_1',
        type: 'heartbeat:ping',
        payload: { serverTime: 123456789 },
        timestamp: Date.now(),
      });
      triggerEvent('message', Buffer.from(heartbeat));
    });

    it('should forward other messages to event listeners', (done) => {
      client.once('message', (message) => {
        expect(message.type).toBe('task:ack');
        expect(message.payload.taskId).toBe('task_123');
        done();
      });

      const taskMessage = JSON.stringify({
        id: 'msg_1',
        type: 'task:ack',
        payload: { taskId: 'task_123', accepted: true },
        timestamp: Date.now(),
      });
      triggerEvent('message', Buffer.from(taskMessage));
    });
  });

  describe('disconnection and reconnection', () => {
    beforeEach(() => {
      client.connect();
      mockWsInstance.readyState = WebSocket.OPEN;
    });

    it('should handle WebSocket close', async () => {
      const disconnectedPromise = new Promise<void>((resolve) => {
        client.once('disconnected', () => {
          expect(client.isConnected()).toBe(false);
          resolve();
        });
      });

      triggerEvent('close', 1006, 'Connection lost');

      await disconnectedPromise;
    });

    it('should schedule reconnection after close', () => {
      vi.useFakeTimers();

      triggerEvent('close', 1006, 'Connection lost');

      // Should schedule reconnect
      vi.advanceTimersByTime(150); // Base delay + some buffer
      expect(MockWebSocket).toHaveBeenCalledTimes(2); // Original + reconnect

      vi.useRealTimers();
    });

    it('should not reconnect when explicitly closed', () => {
      vi.useFakeTimers();

      client.close();
      triggerEvent('close', 1000, 'Agent shutting down');

      vi.advanceTimersByTime(1000);
      expect(MockWebSocket).toHaveBeenCalledTimes(1); // No reconnection

      vi.useRealTimers();
    });
  });

  describe('message sending', () => {
    beforeEach(() => {
      client.connect();
      mockWsInstance.readyState = WebSocket.OPEN;

      // Simulate successful authentication
      triggerEvent('open');
      const authResponse = JSON.stringify({
        id: 'msg_1',
        type: 'auth:response',
        payload: { success: true },
        timestamp: Date.now(),
      });
      triggerEvent('message', Buffer.from(authResponse));
    });

    it('should send messages when connected and authenticated', () => {
      const message = { id: 'msg_1', type: 'task:ack', payload: { taskId: 'task_123', accepted: true }, timestamp: Date.now() };

      const result = client.send(message);

      expect(result).toBe(true);
      expect(mockWsInstance.send).toHaveBeenCalled();
    });

    it('should send raw messages when connected and authenticated', () => {
      const rawMessage = 'raw message data';

      const result = client.sendRaw(rawMessage);

      expect(result).toBe(true);
      expect(mockWsInstance.send).toHaveBeenCalledWith(rawMessage);
    });

    it('should fail to send when not connected', () => {
      // Reset the WebSocket to a disconnected state
      (client as any).authenticated = false;
      mockWsInstance.readyState = WebSocket.CLOSED;

      const message = { id: 'msg_1', type: 'task:ack', payload: { taskId: 'task_123', accepted: true }, timestamp: Date.now() };

      const result = client.send(message);

      expect(result).toBe(false);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      client.connect();
    });

    it('should handle WebSocket errors', () => {
      const error = new Error('Connection error');

      // Should not throw
      expect(() => {
        triggerEvent('error', error);
      }).not.toThrow();
    });

    it('should handle malformed messages gracefully', () => {
      // Should not throw
      expect(() => {
        triggerEvent('message', Buffer.from('invalid json{'));
      }).not.toThrow();
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(client.isConnected()).toBe(false);
    });

    it('should return false when WebSocket is connecting', () => {
      client.connect();
      mockWsInstance.readyState = WebSocket.CONNECTING;

      expect(client.isConnected()).toBe(false);
    });

    it('should return true when connected and authenticated', () => {
      client.connect();
      mockWsInstance.readyState = WebSocket.OPEN;
      triggerEvent('open');

      const authResponse = JSON.stringify({
        id: 'msg_1',
        type: 'auth:response',
        payload: { success: true },
        timestamp: Date.now(),
      });
      triggerEvent('message', Buffer.from(authResponse));

      expect(client.isConnected()).toBe(true);
    });
  });

  describe('close', () => {
    beforeEach(() => {
      client.connect();
      mockWsInstance.readyState = WebSocket.OPEN;
    });

    it('should close WebSocket connection gracefully', () => {
      client.close();

      expect(mockWsInstance.close).toHaveBeenCalledWith(1000, 'Agent shutting down');
    });

    it('should handle close when WebSocket is null', () => {
      (client as any).ws = null;

      expect(() => {
        client.close();
      }).not.toThrow();
    });
  });
});