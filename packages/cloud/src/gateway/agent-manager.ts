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

  /**
   * Resolve which agent should handle a request.
   * - If preferredAgentId is "auto" or empty, pick any connected agent.
   * - If a specific agent is requested but offline, fall back to any connected agent.
   * Returns the agentId to use, or null if no agents are available.
   */
  resolveAgent(preferredAgentId: string): string | null {
    // If a specific agent is requested and online, use it
    if (preferredAgentId && preferredAgentId !== 'auto' && this.isOnline(preferredAgentId)) {
      return preferredAgentId;
    }

    // Fall back to any connected agent
    const ids = this.getConnectedAgentIds();
    if (ids.length === 0) return null;

    // Pick the least-busy agent (fewest active tasks)
    let best = ids[0]!;
    let bestLoad = this.agents.get(best)!.activeTasks.length;

    for (let i = 1; i < ids.length; i++) {
      const agent = this.agents.get(ids[i]!)!;
      if (agent.activeTasks.length < bestLoad) {
        best = ids[i]!;
        bestLoad = agent.activeTasks.length;
      }
    }

    return best;
  }

  /**
   * Resolve and send to the best available agent.
   * Returns the agentId that was used, or null if no agents available.
   */
  resolveAndSend(preferredAgentId: string, data: string): string | null {
    const agentId = this.resolveAgent(preferredAgentId);
    if (!agentId) return null;
    const sent = this.send(agentId, data);
    return sent ? agentId : null;
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
