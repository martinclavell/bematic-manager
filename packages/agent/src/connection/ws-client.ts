import WebSocket from 'ws';
import {
  MessageType,
  createLogger,
  createWSMessage,
  serializeMessage,
  parseMessage,
  calculateBackoff,
  type WSMessage,
} from '@bematic/common';
import type { AgentConfig } from '../config.js';
import { EventEmitter } from 'node:events';

const logger = createLogger('ws-client');

export class WSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private authenticated = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly config: AgentConfig) {
    super();
  }

  connect(): void {
    if (this.closed) return;

    logger.info({ url: this.config.cloudWsUrl }, 'Connecting to cloud...');

    this.ws = new WebSocket(this.config.cloudWsUrl);
    this.authenticated = false;

    this.ws.on('open', () => {
      logger.info('WebSocket connected, authenticating...');
      this.reconnectAttempt = 0;

      // Send auth request
      const authMsg = createWSMessage(MessageType.AUTH_REQUEST, {
        agentId: this.config.agentId,
        apiKey: this.config.agentApiKey,
        version: '1.0.0',
      });
      this.ws!.send(serializeMessage(authMsg));
    });

    this.ws.on('message', (data) => {
      try {
        const raw = data.toString();
        const msg = parseMessage(raw);

        // Handle auth response
        if (msg.type === MessageType.AUTH_RESPONSE) {
          const payload = msg.payload as { success: boolean; error?: string };
          if (payload.success) {
            this.authenticated = true;
            logger.info('Authenticated with cloud');
            this.emit('authenticated');
          } else {
            logger.error({ error: payload.error }, 'Authentication failed');
            this.ws?.close(4004, 'Auth failed');
          }
          return;
        }

        // Handle heartbeat ping
        if (msg.type === MessageType.HEARTBEAT_PING) {
          this.emit('heartbeat:ping', msg.payload);
          return;
        }

        // Forward other messages
        this.emit('message', msg);
      } catch (error) {
        logger.error({ error }, 'Error processing message');
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn({ code, reason: reason.toString() }, 'WebSocket closed');
      this.authenticated = false;
      this.emit('disconnected');

      if (!this.closed) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error) => {
      logger.error({ error }, 'WebSocket error');
    });
  }

  send(message: WSMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      return false;
    }
    this.ws.send(serializeMessage(message));
    return true;
  }

  sendRaw(data: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) {
      return false;
    }
    this.ws.send(data);
    return true;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.authenticated;
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close(1000, 'Agent shutting down');
  }

  private scheduleReconnect(): void {
    const delay = calculateBackoff(
      this.reconnectAttempt,
      this.config.reconnect.baseDelayMs,
      this.config.reconnect.maxDelayMs,
      true,
    );

    logger.info({ attempt: this.reconnectAttempt, delayMs: Math.round(delay) }, 'Scheduling reconnect');
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
