import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import {
  MessageType,
  createLogger,
  parseMessage,
  createWSMessage,
  serializeMessage,
  authRequestSchema,
  type AuthRequestPayload,
  type AuthRequestData,
} from '@bematic/common';
import { AgentManager } from './agent-manager.js';
import type { Config } from '../config.js';
import type { ApiKeyService } from '../services/api-key.service.js';
import { metrics, MetricNames } from '../utils/metrics.js';

const logger = createLogger('ws-server');

export function createWSServer(
  server: Server,
  config: Config,
  agentManager: AgentManager,
  apiKeyService: ApiKeyService,
  onMessage: (agentId: string, raw: string) => void,
) {
  const wss = new WebSocketServer({
    server,
    path: '/ws/agent',
    verifyClient: (info: { origin: string; secure: boolean; req: any }) => {
      // Check if connection is secure either directly or via reverse proxy (Railway, etc.)
      const forwardedProto = info.req.headers['x-forwarded-proto'];
      const isSecure = info.secure || forwardedProto === 'https';

      // Enforce WSS in production if configured
      if (config.ssl.enforceWss && !isSecure) {
        logger.warn(
          {
            origin: info.origin,
            secure: info.secure,
            forwardedProto,
          },
          'Rejected insecure WebSocket connection - WSS required'
        );
        return false;
      }

      return true;
    }
  });

  // Heartbeat sweep interval
  const sweepInterval = setInterval(() => {
    const dead = agentManager.sweepDead(config.ws.heartbeatIntervalMs);
    if (dead.length > 0) {
      logger.info({ dead }, 'Swept dead agents');
    }
  }, config.ws.heartbeatIntervalMs);

  // Heartbeat ping interval
  const pingInterval = setInterval(() => {
    for (const agentId of agentManager.getConnectedAgentIds()) {
      const ping = createWSMessage(MessageType.HEARTBEAT_PING, {
        serverTime: Date.now(),
      });
      agentManager.send(agentId, serializeMessage(ping));
    }
  }, config.ws.heartbeatIntervalMs);

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    logger.info({ url: req.url }, 'New WebSocket connection');

    // Track connection metrics
    metrics.increment('ws.connections.total');
    metrics.increment('ws.connections.active');

    let agentId: string | null = null;
    let authenticated = false;

    // Auth timeout
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        logger.warn('Agent failed to authenticate in time');
        const errMsg = createWSMessage(MessageType.AUTH_RESPONSE, {
          success: false,
          error: 'Authentication timeout',
        });
        ws.send(serializeMessage(errMsg));
        ws.close(4001, 'Authentication timeout');
      }
    }, config.ws.authTimeoutMs);

    ws.on('message', (data) => {
      const startTime = Date.now();

      try {
        const raw = data.toString();
        const msg = parseMessage(raw);

        // Track message metrics
        metrics.increment(MetricNames.WS_MESSAGES_RECEIVED);
        metrics.increment(`ws.messages.received.${msg.type}`);

        // Must authenticate first
        if (!authenticated) {
          if (msg.type !== MessageType.AUTH_REQUEST) {
            ws.close(4002, 'Must authenticate first');
            return;
          }

          const parsed = authRequestSchema.safeParse(msg.payload);
          if (!parsed.success) {
            const resp = createWSMessage(MessageType.AUTH_RESPONSE, {
              success: false,
              error: 'Invalid auth payload',
            });
            ws.send(serializeMessage(resp));
            ws.close(4003, 'Invalid auth payload');
            return;
          }

          const { agentId: id, apiKey } = parsed.data as AuthRequestData;

          // Try database-based API key validation first
          const keyValidation = apiKeyService.validateKey(apiKey);

          // Fall back to config-based validation for backward compatibility
          const isConfigKey = config.agentApiKeys.includes(apiKey);

          if (!keyValidation.isValid && !isConfigKey) {
            metrics.increment('ws.auth.failed');
            const resp = createWSMessage(MessageType.AUTH_RESPONSE, {
              success: false,
              error: keyValidation.reason || 'Invalid API key',
            });
            ws.send(serializeMessage(resp));
            ws.close(4004, 'Invalid API key');
            return;
          }

          // Log which authentication method was used
          if (keyValidation.isValid) {
            logger.info({ agentId: id, keyId: keyValidation.apiKey?.id }, 'Agent authenticated with database API key');
          } else {
            logger.info({ agentId: id }, 'Agent authenticated with legacy config API key');
          }

          metrics.increment('ws.auth.success');
          metrics.increment(MetricNames.AGENTS_CONNECTED);

          clearTimeout(authTimer);
          authenticated = true;
          agentId = id;
          agentManager.register(id, ws);

          const resp = createWSMessage(MessageType.AUTH_RESPONSE, {
            success: true,
            agentId: id,
          });
          ws.send(serializeMessage(resp));
          logger.info({ agentId }, 'Agent authenticated');
          return;
        }

        // Handle heartbeat pong
        if (msg.type === MessageType.HEARTBEAT_PONG && agentId) {
          const pongPayload = msg.payload as { serverTime?: number };
          const pongLatency = Date.now() - (pongPayload?.serverTime || Date.now());
          metrics.histogram(MetricNames.AGENT_HEARTBEAT_LATENCY, pongLatency);
          agentManager.updateHeartbeat(agentId);
          return;
        }

        // Forward all other messages to the router
        if (agentId) {
          onMessage(agentId, raw);
        }

        // Track message processing time
        const processingTime = Date.now() - startTime;
        metrics.histogram('ws.message.processing_time', processingTime);
      } catch (error) {
        logger.error({ error }, 'Error processing WS message');
        metrics.increment('ws.messages.errors');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);

      // Track disconnection metrics
      metrics.decrement('ws.connections.active');

      if (agentId) {
        // Only unregister if this WebSocket is still the active one for this agent.
        // If a newer connection replaced us (via agentManager.register()),
        // the old close handler must NOT remove the new connection.
        const current = agentManager.getAgent(agentId);
        if (current && current.ws === ws) {
          metrics.increment(MetricNames.AGENTS_DISCONNECTED);
          agentManager.unregister(agentId);
          logger.info({ agentId }, 'Agent disconnected');
        } else {
          logger.info({ agentId }, 'Stale WebSocket closed (already replaced by new connection)');
        }
      }
    });

    ws.on('error', (error) => {
      logger.error({ error, agentId }, 'WebSocket error');
      metrics.increment('ws.connection.errors');
    });
  });

  return {
    wss,
    close() {
      clearInterval(sweepInterval);
      clearInterval(pingInterval);
      wss.close();
    },
  };
}
