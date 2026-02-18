import WebSocket from 'ws';
import {
  MessageType,
  Limits,
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
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private consecutiveFailures = 0;
  private circuitBreakerOpen = false;

  constructor(private readonly config: AgentConfig) {
    super();
  }

  connect(): void {
    if (this.closed) return;

    // Circuit breaker logic: if we've failed too many times, use long backoff
    if (this.circuitBreakerOpen) {
      logger.warn(
        { consecutiveFailures: this.consecutiveFailures },
        'Circuit breaker open - using long backoff interval',
      );
    }

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

      // Start keepalive pings
      this.startKeepalive();
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
            this.consecutiveFailures = 0;
            this.circuitBreakerOpen = false;
            logger.info('Authenticated with cloud');
            this.emit('authenticated');
          } else {
            logger.error({ error: payload.error }, 'Authentication failed');
            this.consecutiveFailures++;
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
      this.stopKeepalive();
      this.emit('disconnected');

      // Increment failure counter
      this.consecutiveFailures++;

      // Open circuit breaker if too many failures
      if (this.consecutiveFailures >= Limits.CIRCUIT_BREAKER_MAX_FAILURES) {
        this.circuitBreakerOpen = true;
        logger.error(
          { consecutiveFailures: this.consecutiveFailures },
          'Circuit breaker opened - too many consecutive failures',
        );
      }

      if (!this.closed) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error) => {
      logger.error({ error }, 'WebSocket error');
      this.consecutiveFailures++;
    });
  }

  /**
   * Start sending periodic keepalive pings to the cloud.
   * This ensures the agent can detect dead connections even if cloud stops pinging.
   */
  private startKeepalive(): void {
    this.stopKeepalive();

    this.keepaliveTimer = setInterval(() => {
      if (this.isConnected()) {
        const pingMsg = createWSMessage(MessageType.HEARTBEAT_PING, { serverTime: Date.now() });
        const sent = this.send(pingMsg);
        if (!sent) {
          logger.warn('Failed to send keepalive ping - connection may be dead');
        }
      }
    }, Limits.AGENT_KEEPALIVE_INTERVAL_MS);

    logger.debug({ intervalMs: Limits.AGENT_KEEPALIVE_INTERVAL_MS }, 'Keepalive timer started');
  }

  /**
   * Stop sending keepalive pings
   */
  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
      logger.debug('Keepalive timer stopped');
    }
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
    this.stopKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close(1000, 'Agent shutting down');
  }

  private scheduleReconnect(): void {
    // Use long backoff if circuit breaker is open
    let delay: number;
    if (this.circuitBreakerOpen) {
      delay = Limits.CIRCUIT_BREAKER_LONG_BACKOFF_MS;
    } else {
      delay = calculateBackoff(
        this.reconnectAttempt,
        this.config.reconnect.baseDelayMs,
        this.config.reconnect.maxDelayMs,
        true,
      );
    }

    logger.info(
      {
        attempt: this.reconnectAttempt,
        consecutiveFailures: this.consecutiveFailures,
        circuitBreakerOpen: this.circuitBreakerOpen,
        delayMs: Math.round(delay),
      },
      'Scheduling reconnect',
    );
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
