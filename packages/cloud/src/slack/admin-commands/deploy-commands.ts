import {
  MessageType,
  createLogger,
  createWSMessage,
  serializeMessage,
  generateId,
} from '@bematic/common';
import type { AppContext } from '../../context.js';
import type { NotificationService } from '../../services/notification.service.js';

const logger = createLogger('admin:deploy-commands');

type RespondFn = (message: string) => Promise<void>;

/**
 * Deployment management commands
 * - deploy
 * - deploy-status
 * - deploy-logs
 */
export class DeployCommands {
  constructor(private readonly ctx: AppContext) {}

  async deploy(channelId: string, userId: string, respond: RespondFn): Promise<void> {
    const project = this.ctx.projectResolver.tryResolve(channelId);
    if (!project) {
      await respond(':x: No project configured for this channel. Use `/bm-config` first.');
      return;
    }

    // Find the agent for this project
    const agentId = project.agentId;
    const agent = this.ctx.agentManager.getAgent(agentId);
    if (!agent) {
      await respond(`:x: Agent \`${agentId}\` is not connected. Cannot deploy.`);
      return;
    }

    const requestId = generateId('deploy');
    const msg = createWSMessage(MessageType.DEPLOY_REQUEST, {
      requestId,
      localPath: project.localPath,
      slackChannelId: channelId,
      slackThreadTs: null,
      requestedBy: userId,
    });

    // Register so message router knows where to post the result
    this.ctx.messageRouter.registerDeployRequest(requestId, channelId, null, userId);

    const sent = this.ctx.agentManager.send(agentId, serializeMessage(msg));
    if (!sent) {
      await respond(':x: Failed to send deploy request to agent.');
      return;
    }

    await respond(`:rocket: Deploy request sent to agent \`${agentId}\`. Running \`railway up\` in \`${project.localPath}\`...`);

    this.ctx.auditLogRepo.log(
      'deploy:requested',
      'project',
      project.id,
      userId,
      { agentId, requestId },
    );
  }

  async deployStatus(channelId: string, respond: RespondFn, notifier: NotificationService): Promise<void> {
    if (!this.ctx.deployService.isConfigured()) {
      await respond(':x: Railway API token not configured.');
      return;
    }

    const project = this.ctx.projectResolver.tryResolve(channelId);
    if (!project) {
      await respond(':x: No project configured for this channel.');
      return;
    }

    if (!project.railwayServiceId) {
      await respond(':x: No Railway service linked to this project.');
      return;
    }

    await respond(':railway_car: Fetching deployment status...');

    const deployment = await this.ctx.deployService.getLatestDeployment(
      project.railwayServiceId,
      project.railwayEnvironmentId,
    );

    if (!deployment) {
      await notifier.postMessage(channelId, ':information_source: No deployments found for this service.');
      return;
    }

    const statusIcon = deployment.status === 'SUCCESS' ? ':white_check_mark:'
      : deployment.status === 'BUILDING' || deployment.status === 'DEPLOYING' ? ':hourglass_flowing_sand:'
      : deployment.status === 'FAILED' || deployment.status === 'CRASHED' ? ':x:'
      : ':grey_question:';

    await notifier.postMessage(
      channelId,
      `${statusIcon} *Latest Deployment*\n` +
      `> ID: \`${deployment.id}\`\n` +
      `> Status: \`${deployment.status}\`\n` +
      `> Created: ${deployment.createdAt}\n` +
      (deployment.staticUrl ? `> URL: ${deployment.staticUrl}\n` : ''),
    );
  }

  async deployLogs(channelId: string, respond: RespondFn, notifier: NotificationService): Promise<void> {
    if (!this.ctx.deployService.isConfigured()) {
      await respond(':x: Railway API token not configured.');
      return;
    }

    const project = this.ctx.projectResolver.tryResolve(channelId);
    if (!project?.railwayServiceId) {
      await respond(':x: No Railway service linked to this project.');
      return;
    }

    await respond(':page_facing_up: Fetching deployment logs...');

    const deployment = await this.ctx.deployService.getLatestDeployment(
      project.railwayServiceId,
      project.railwayEnvironmentId,
    );

    if (!deployment) {
      await notifier.postMessage(channelId, ':information_source: No deployments found.');
      return;
    }

    const logs = await this.ctx.deployService.getDeploymentLogs(deployment.id);
    const truncated = logs.length > 2900 ? logs.slice(-2900) + '\n...(truncated)' : logs;

    await notifier.postMessage(
      channelId,
      `:page_facing_up: *Deploy Logs* (\`${deployment.status}\`)\n\`\`\`${truncated}\`\`\``,
    );
  }
}
