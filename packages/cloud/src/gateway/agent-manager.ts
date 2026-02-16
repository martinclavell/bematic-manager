import type { WebSocket } from 'ws';
import { createLogger, type AgentStatusPayload } from '@bematic/common';
import { EventEmitter } from 'node:events';

const logger = createLogger('agent-manager');

interface ConnectedAgent {
  id: string;
  ws: WebSocket;
  status: AgentStatusPayload['status'];
  activeTasks: string[];
  connectedAt: number;
  lastHeartbeat: number;
}

export class AgentManager extends EventEmitter {
  private agents = new Map<string, ConnectedAgent>();

  register(agentId: string, ws: WebSocket): void {
    const existing = this.agents.get(agentId);
    if (existing) {
      logger.warn({ agentId }, 'Agent already connected, replacing');
      existing.ws.close(1000, 'Replaced by new connection');
    }

    this.agents.set(agentId, {
      id: agentId,
      ws,
      status: 'online',
      activeTasks: [],
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    });

    logger.info({ agentId }, 'Agent registered');
    this.emit('agent:connected', agentId);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
    logger.info({ agentId }, 'Agent unregistered');
    this.emit('agent:disconnected', agentId);
  }

  getAgent(agentId: string): ConnectedAgent | undefined {
    return this.agents.get(agentId);
  }

  isOnline(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  send(agentId: string, data: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent || agent.ws.readyState !== 1) { // WebSocket.OPEN = 1
      return false;
    }
    agent.ws.send(data);
    return true;
  }

  updateHeartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastHeartbeat = Date.now();
    }
  }

  updateStatus(agentId: string, status: AgentStatusPayload): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status.status;
      agent.activeTasks = status.activeTasks;
    }
  }

  getConnectedAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /** Sweep for dead connections (no heartbeat in 2x interval) */
  sweepDead(heartbeatIntervalMs: number): string[] {
    const threshold = Date.now() - heartbeatIntervalMs * 2;
    const dead: string[] = [];

    for (const [agentId, agent] of this.agents) {
      if (agent.lastHeartbeat < threshold) {
        logger.warn({ agentId, lastHeartbeat: agent.lastHeartbeat }, 'Agent heartbeat timeout');
        agent.ws.close(1001, 'Heartbeat timeout');
        dead.push(agentId);
        this.agents.delete(agentId);
      }
    }

    if (dead.length > 0) {
      for (const agentId of dead) {
        this.emit('agent:disconnected', agentId);
      }
    }

    return dead;
  }
}
