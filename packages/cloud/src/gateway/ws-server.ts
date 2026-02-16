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
} from '@bematic/common';
import { AgentManager } from './agent-manager.js';
import type { Config } from '../config.js';

const logger = createLogger('ws-server');

export function createWSServer(
  server: Server,
  config: Config,
  agentManager: AgentManager,
  onMessage: (agentId: string, raw: string) => void,
) {
  const wss = new WebSocketServer({ server, path: '/ws/agent' });

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
      try {
        const raw = data.toString();
        const msg = parseMessage(raw);

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

          const { agentId: id, apiKey } = parsed.data;

          if (!config.agentApiKeys.includes(apiKey)) {
            const resp = createWSMessage(MessageType.AUTH_RESPONSE, {
              success: false,
              error: 'Invalid API key',
            });
            ws.send(serializeMessage(resp));
            ws.close(4004, 'Invalid API key');
            return;
          }

          clearTimeout(authTimer);
          authenticated = true;
          agentId = id;
          agentManager.register(agentId, ws);

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
          agentManager.updateHeartbeat(agentId);
          return;
        }

        // Forward all other messages to the router
        if (agentId) {
          onMessage(agentId, raw);
        }
      } catch (error) {
        logger.error({ error }, 'Error processing WS message');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (agentId) {
        agentManager.unregister(agentId);
        logger.info({ agentId }, 'Agent disconnected');
      }
    });

    ws.on('error', (error) => {
      logger.error({ error, agentId }, 'WebSocket error');
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
