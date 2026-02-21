import type { WebSocket } from 'ws';
import { createLogger, type AgentStatusPayload, agentCache, CacheKeys } from '@bematic/common';
import { EventEmitter } from 'node:events';
import { metrics, MetricNames } from '../utils/metrics.js';

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

    const agent = {
      id: agentId,
      ws,
      status: 'online' as const,
      activeTasks: [],
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    this.agents.set(agentId, agent);

    // Cache agent status and metadata
    agentCache.set(CacheKeys.agentStatus(agentId), {
      status: agent.status,
      activeTasks: agent.activeTasks,
      connectedAt: agent.connectedAt,
      lastHeartbeat: agent.lastHeartbeat,
    });

    agentCache.set(CacheKeys.agentMetadata(agentId), {
      id: agentId,
      isOnline: true,
      connectedAt: agent.connectedAt,
    });

    logger.info({ agentId }, 'Agent registered');
    metrics.increment(MetricNames.AGENTS_CONNECTED);
    metrics.gauge(MetricNames.WS_CONNECTIONS, this.agents.size);
    this.emit('agent:connected', agentId);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);

    // Update cached agent status to offline
    agentCache.set(CacheKeys.agentStatus(agentId), {
      status: 'offline',
      activeTasks: [],
      connectedAt: 0,
      lastHeartbeat: Date.now(),
    }, 60 * 1000); // Keep offline status cached for 1 minute

    agentCache.set(CacheKeys.agentMetadata(agentId), {
      id: agentId,
      isOnline: false,
      disconnectedAt: Date.now(),
    }, 60 * 1000); // Keep offline metadata for 1 minute

    logger.info({ agentId }, 'Agent unregistered');
    metrics.increment(MetricNames.AGENTS_DISCONNECTED);
    metrics.gauge(MetricNames.WS_CONNECTIONS, this.agents.size);
    this.emit('agent:disconnected', agentId);
  }

  getAgent(agentId: string): ConnectedAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get cached agent status (includes offline agents)
   */
  getCachedAgentStatus(agentId: string): AgentStatusPayload | null {
    return agentCache.get<AgentStatusPayload>(CacheKeys.agentStatus(agentId));
  }

  /**
   * Get cached agent metadata (includes offline agents)
   */
  getCachedAgentMetadata(agentId: string): { id: string; isOnline: boolean; connectedAt?: number; disconnectedAt?: number } | null {
    return agentCache.get(CacheKeys.agentMetadata(agentId));
  }

  isOnline(agentId: string): boolean {
    // Check in-memory first for fastest response
    if (this.agents.has(agentId)) {
      return true;
    }

    // Check cache for recent status
    const cachedStatus = this.getCachedAgentStatus(agentId);
    return cachedStatus?.status === 'online' || false;
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

      // Update cached status with new heartbeat
      agentCache.set(CacheKeys.agentStatus(agentId), {
        status: agent.status,
        activeTasks: agent.activeTasks,
        connectedAt: agent.connectedAt,
        lastHeartbeat: agent.lastHeartbeat,
      });
    }
  }

  updateStatus(agentId: string, status: AgentStatusPayload): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status.status;
      agent.activeTasks = status.activeTasks;

      // Update cached status
      agentCache.set(CacheKeys.agentStatus(agentId), {
        status: status.status,
        activeTasks: status.activeTasks,
        connectedAt: agent.connectedAt,
        lastHeartbeat: agent.lastHeartbeat,
      });
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

  /**
   * Add a task to the agent's active tasks list
   */
  addActiveTask(agentId: string, taskId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      if (!agent.activeTasks.includes(taskId)) {
        agent.activeTasks.push(taskId);

        // Update cached status
        agentCache.set(CacheKeys.agentStatus(agentId), {
          status: agent.status,
          activeTasks: agent.activeTasks,
          connectedAt: agent.connectedAt,
          lastHeartbeat: agent.lastHeartbeat,
        });
      }
    }
  }

  /**
   * Remove a task from the agent's active tasks list
   */
  removeActiveTask(agentId: string, taskId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      const index = agent.activeTasks.indexOf(taskId);
      if (index !== -1) {
        agent.activeTasks.splice(index, 1);

        // Update cached status
        agentCache.set(CacheKeys.agentStatus(agentId), {
          status: agent.status,
          activeTasks: agent.activeTasks,
          connectedAt: agent.connectedAt,
          lastHeartbeat: agent.lastHeartbeat,
        });
      }
    }
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
