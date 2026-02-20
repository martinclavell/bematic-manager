import {
  MessageType,
  createWSMessage,
  serializeMessage,
  generateId,
  createLogger,
} from '@bematic/common';
import type { AuditLogRepository } from '@bematic/db';
import type { AgentManager } from '../gateway/agent-manager.js';
import type { MessageRouter } from '../gateway/message-router.js';

const logger = createLogger('ops-service');

export interface SendDeployParams {
  project: {
    id: string;
    localPath: string;
    railwayProjectId?: string | null;
    railwayServiceId?: string | null;
    railwayEnvironmentId?: string | null;
  };
  agentId: string;
  slackChannelId: string;
  slackThreadTs: string | null;
  requestedBy: string;
}

export interface SendRestartParams {
  agentIds: string[];
  reason: string;
  rebuild: boolean;
}

/**
 * Centralized operations service for deploy and restart commands.
 * Single source of truth used by both /bm commands and SyncOrchestrator.
 */
export class OpsService {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly messageRouter: MessageRouter,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  /**
   * Send a deploy request to the agent.
   * Creates the WS message, registers with messageRouter, and sends to agent.
   * Returns { requestId, sent } — caller handles Slack responses.
   */
  sendDeploy(params: SendDeployParams): { requestId: string; sent: boolean } {
    const { project, agentId, slackChannelId, slackThreadTs, requestedBy } = params;

    const requestId = generateId('deploy');
    const msg = createWSMessage(MessageType.DEPLOY_REQUEST, {
      requestId,
      localPath: project.localPath,
      slackChannelId,
      slackThreadTs,
      requestedBy,
      railwayProjectId: project.railwayProjectId,
      railwayServiceId: project.railwayServiceId,
      railwayEnvironmentId: project.railwayEnvironmentId,
    });

    this.messageRouter.registerDeployRequest(requestId, slackChannelId, slackThreadTs, requestedBy);

    const sent = this.agentManager.send(agentId, serializeMessage(msg));

    if (sent) {
      logger.info({ requestId, agentId, projectId: project.id }, 'Deploy request sent');
    } else {
      logger.warn({ requestId, agentId, projectId: project.id }, 'Failed to send deploy request');
    }

    return { requestId, sent };
  }

  /**
   * Send restart signal to one or more agents.
   * Returns count of agents that received the signal.
   */
  sendRestart(params: SendRestartParams): { restarted: number } {
    const { agentIds, reason, rebuild } = params;

    let restarted = 0;

    for (const agentId of agentIds) {
      const msg = createWSMessage(MessageType.SYSTEM_RESTART, {
        reason,
        rebuild,
      });
      const sent = this.agentManager.send(agentId, serializeMessage(msg));
      if (sent) restarted++;
    }

    logger.info({ restarted, total: agentIds.length, rebuild }, 'Restart signals sent');

    return { restarted };
  }
}
