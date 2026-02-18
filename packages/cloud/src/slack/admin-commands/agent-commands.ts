import {
  MessageType,
  createLogger,
  createWSMessage,
  serializeMessage,
} from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('admin:agent-commands');

type RespondFn = (message: string) => Promise<void>;

/**
 * Agent management admin commands
 * - restart-agent
 * - agent-status
 * - agent-health
 * - agent-health-reset
 */
export class AgentCommands {
  constructor(private readonly ctx: AppContext) {}

  async restartAgent(args: string[], userId: string, respond: RespondFn): Promise<void> {
    const agentIds = this.ctx.agentManager.getConnectedAgentIds();

    if (agentIds.length === 0) {
      await respond(':warning: No agents are currently connected.');
      return;
    }

    const rebuild = args.includes('--rebuild');
    let restarted = 0;

    for (const agentId of agentIds) {
      const msg = createWSMessage(MessageType.SYSTEM_RESTART, {
        reason: `Restart requested by <@${userId}> via Slack`,
        rebuild,
      });
      const sent = this.ctx.agentManager.send(agentId, serializeMessage(msg));
      if (sent) restarted++;
    }

    await respond(
      `:arrows_counterclockwise: Restart signal sent to ${restarted}/${agentIds.length} agent(s).${rebuild ? ' (with rebuild)' : ''} They will reconnect shortly.`,
    );

    this.ctx.auditLogRepo.log(
      'agent:restart',
      'agent',
      agentIds.join(','),
      userId,
      { rebuild, agentCount: agentIds.length },
    );
  }

  async agentStatus(respond: RespondFn): Promise<void> {
    const agentIds = this.ctx.agentManager.getConnectedAgentIds();

    if (agentIds.length === 0) {
      await respond(':red_circle: No agents connected.');
      return;
    }

    const lines = agentIds.map((id) => {
      const agent = this.ctx.agentManager.getAgent(id);
      if (!agent) return `- \`${id}\`: unknown`;
      const uptime = Math.round((Date.now() - agent.connectedAt) / 1000);
      return `- \`${id}\`: *${agent.status}* | Active tasks: ${agent.activeTasks.length} | Connected: ${uptime}s ago`;
    });

    await respond(`:satellite: *Connected Agents (${agentIds.length}):*\n${lines.join('\n')}`);
  }

  async agentHealth(respond: RespondFn): Promise<void> {
    const allHealth = this.ctx.agentHealthTracker.getAllAgentHealth();

    if (allHealth.length === 0) {
      await respond(':red_circle: No agents have reported health data yet.');
      return;
    }

    let response = ':heart: *Agent Health Status*\n\n';

    for (const agent of allHealth) {
      const statusIcon = agent.isHealthy ? ':large_green_circle:' : ':red_circle:';
      const state = agent.circuitState.toUpperCase();

      response += `${statusIcon} *${agent.agentId}* (${state})\n`;
      response += `  • Failure Rate: ${agent.failureRate.toFixed(1)}%\n`;
      response += `  • Total Tasks: ${agent.totalTasks}\n`;

      if (!agent.isHealthy) {
        const timeSince = Date.now() - agent.lastStateChange.getTime();
        response += `  • Unhealthy for: ${this.formatDuration(timeSince)}\n`;
      }

      response += '\n';
    }

    const unhealthy = allHealth.filter(a => !a.isHealthy);
    if (unhealthy.length > 0) {
      response += `\n:warning: ${unhealthy.length} agent(s) are unhealthy and may not accept tasks.`;
    }

    await respond(response);
  }

  async agentHealthReset(args: string[], userId: string, respond: RespondFn): Promise<void> {
    const agentId = args[1];

    if (!agentId) {
      await respond(':x: Usage: `/bm-admin agent-health-reset <agent-id>`');
      return;
    }

    this.ctx.agentHealthTracker.resetAgent(agentId);

    await respond(`:white_check_mark: Circuit breaker reset for agent \`${agentId}\``);

    this.ctx.auditLogRepo.log(
      'agent.health.reset',
      'agent',
      agentId,
      userId,
    );
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
