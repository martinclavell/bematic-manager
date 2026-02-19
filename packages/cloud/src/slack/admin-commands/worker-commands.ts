import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('admin:worker-commands');

type RespondFn = (message: string) => Promise<void>;

/**
 * Worker dashboard command
 * Shows all agents, projects, and active tasks
 */
export class WorkerCommands {
  constructor(private readonly ctx: AppContext) {}

  async workers(respond: RespondFn): Promise<void> {
    const agentIds = this.ctx.agentManager.getConnectedAgentIds();

    if (agentIds.length === 0) {
      await respond(':red_circle: *Workers Dashboard* — No agents connected.');
      return;
    }

    const sections: string[] = [
      `:factory: *Workers Dashboard* (${agentIds.length} agent${agentIds.length === 1 ? '' : 's'} connected)`,
    ];

    let totalRunning = 0;
    let totalQueued = 0;

    for (const agentId of agentIds) {
      const agent = this.ctx.agentManager.getAgent(agentId);
      if (!agent) continue;

      const queueSize = this.ctx.offlineQueueRepo.findPendingByAgentId(agentId).length;
      const projects = this.ctx.projectRepo.findByAgentId(agentId);
      const runningTasks = agent.activeTasks.map((taskId) => this.ctx.taskRepo.findById(taskId)).filter((t) => !!t);

      totalRunning += runningTasks.length;
      totalQueued += queueSize;

      let agentSection = `\n*Agent: \`${agentId}\`*\n`;
      agentSection += `Status: ${agent.status}\n`;

      if (projects.length === 0) {
        agentSection += `Projects: _None_\n`;
      } else {
        agentSection += `Projects (${projects.length}):\n`;
        for (const proj of projects) {
          agentSection += `  • *${proj.name}* (\`${proj.id}\`)\n`;
        }
      }

      if (runningTasks.length > 0) {
        agentSection += `Running Tasks:\n`;
        for (const task of runningTasks) {
          if (!task) continue;
          const elapsed = Math.round((Date.now() - new Date(task.createdAt).getTime()) / 1000);
          agentSection += `  • \`${task.id}\` — ${task.botName} (${elapsed}s)\n`;
        }
      } else {
        agentSection += `Running Tasks: _None_\n`;
      }

      if (queueSize > 0) {
        agentSection += `:warning: Queued Tasks: ${queueSize}\n`;
      } else {
        agentSection += `Queued Tasks: 0\n`;
      }

      sections.push(agentSection);
    }

    sections.push(`\n*Totals:* ${totalRunning} running, ${totalQueued} queued`);

    await respond(sections.join('\n'));
  }
}
