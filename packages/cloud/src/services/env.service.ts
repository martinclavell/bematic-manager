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

const logger = createLogger('env-service');

export interface SendEnvUpdateParams {
  project: {
    id: string;
    localPath: string;
    railwayProjectId?: string | null;
    railwayServiceId?: string | null;
    railwayEnvironmentId?: string | null;
  };
  agentId: string;
  operation: 'add' | 'remove';
  key: string;
  value?: string;
  slackChannelId: string;
  slackThreadTs: string | null;
  requestedBy: string;
}

// Reserved environment variables that should not be modified
const RESERVED_KEYS = new Set([
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'AGENT_API_KEYS',
  'AGENT_API_KEY',
  'ANTHROPIC_API_KEY',
  'DATABASE_URL',
  'CLOUD_WS_URL',
]);

/**
 * Service for managing environment variables across .env files and Railway.
 * Sends ENV_UPDATE_REQUEST to agent for file modifications and Railway sync.
 */
export class EnvService {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly messageRouter: MessageRouter,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  /**
   * Validate environment variable key format and check against reserved keys.
   * @returns null if valid, error message if invalid
   */
  validateKey(key: string): string | null {
    // Check format: must be uppercase letters, numbers, underscores only
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      return 'Invalid format. Environment variable names must start with A-Z or _ and contain only A-Z, 0-9, or _';
    }

    // Check reserved keys
    if (RESERVED_KEYS.has(key)) {
      return `Cannot modify reserved variable: ${key}`;
    }

    return null;
  }

  /**
   * Send environment variable update request to agent.
   * Agent will update .env files and sync to Railway if configured.
   * Returns { requestId, sent } — caller handles Slack responses via messageRouter.
   */
  sendEnvUpdate(params: SendEnvUpdateParams): { requestId: string; sent: boolean } {
    const { project, agentId, operation, key, value, slackChannelId, slackThreadTs, requestedBy } = params;

    // Validate key
    const validationError = this.validateKey(key);
    if (validationError) {
      logger.warn({ key, error: validationError }, 'Invalid environment variable key');
      return { requestId: '', sent: false };
    }

    // Validate value for add operation
    if (operation === 'add' && !value) {
      logger.warn({ key }, 'Missing value for add operation');
      return { requestId: '', sent: false };
    }

    const requestId = generateId('env-update');
    const msg = createWSMessage(MessageType.ENV_UPDATE_REQUEST, {
      requestId,
      operation,
      key,
      value,
      localPath: project.localPath,
      slackChannelId,
      slackThreadTs,
      requestedBy,
      railwayProjectId: project.railwayProjectId,
      railwayServiceId: project.railwayServiceId,
      railwayEnvironmentId: project.railwayEnvironmentId,
    });

    this.messageRouter.registerEnvUpdateRequest(requestId, slackChannelId, slackThreadTs, requestedBy);

    const sent = this.agentManager.send(agentId, serializeMessage(msg));

    if (sent) {
      logger.info({ requestId, agentId, projectId: project.id, operation, key }, 'Env update request sent');

      // Audit log (mask sensitive values)
      this.auditLogRepo.log(
        `env:${operation}`,
        'project',
        project.id,
        requestedBy,
        { key, hasMaskedValue: operation === 'add', requestId },
      );
    } else {
      logger.warn({ requestId, agentId, projectId: project.id }, 'Failed to send env update request');
    }

    return { requestId, sent };
  }
}
