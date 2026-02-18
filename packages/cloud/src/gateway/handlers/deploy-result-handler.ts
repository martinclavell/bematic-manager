import { createLogger, type DeployResultPayload } from '@bematic/common';
import type { AuditLogRepository } from '@bematic/db';
import type { NotificationService } from '../../services/notification.service.js';

const logger = createLogger('deploy-result-handler');

/** Tracks where to send deploy results */
interface DeployRequest {
  slackChannelId: string;
  slackThreadTs: string | null;
  requestedBy: string;
}

export class DeployResultHandler {
  private deployRequests = new Map<string, DeployRequest>();

  constructor(
    private readonly auditLogRepo: AuditLogRepository,
    private readonly notifier: NotificationService,
  ) {}

  /**
   * Register a deploy request so we know where to post the result
   */
  registerDeployRequest(
    requestId: string,
    channelId: string,
    threadTs: string | null,
    userId: string,
  ): void {
    this.deployRequests.set(requestId, {
      slackChannelId: channelId,
      slackThreadTs: threadTs,
      requestedBy: userId,
    });
  }

  async handle(agentId: string, payload: DeployResultPayload): Promise<void> {
    const request = this.deployRequests.get(payload.requestId);
    if (!request) {
      logger.warn({ requestId: payload.requestId }, 'Received deploy result for unknown request');
      return;
    }

    // Build result message
    let message = payload.success
      ? `:white_check_mark: *Deploy succeeded*\n\n`
      : `:x: *Deploy failed*\n\n`;

    if (payload.buildLogsUrl) {
      message += `<${payload.buildLogsUrl}|View build logs>\n\n`;
    }

    if (payload.output) {
      const truncated = payload.output.length > 500
        ? payload.output.slice(0, 500) + '...'
        : payload.output;
      message += `\`\`\`\n${truncated}\n\`\`\``;
    }

    // Post to Slack
    await this.notifier.postMessage(
      request.slackChannelId,
      message,
      request.slackThreadTs,
    );

    // Log to audit trail
    this.auditLogRepo.log(
      payload.success ? 'deploy:success' : 'deploy:failed',
      'deployment',
      payload.requestId,
      request.requestedBy,
      {
        agentId,
        buildLogsUrl: payload.buildLogsUrl,
      },
    );

    // Clean up request
    this.deployRequests.delete(payload.requestId);

    logger.info(
      { requestId: payload.requestId, success: payload.success },
      'Deploy result processed',
    );
  }
}
