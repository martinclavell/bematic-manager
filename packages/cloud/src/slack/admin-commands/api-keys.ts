import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('admin:api-key-commands');

type RespondFn = (message: string) => Promise<void>;

/**
 * API Key management admin commands
 * - api-keys list - Show all keys
 * - api-keys generate <agent-id> [expires-in-days] - Generate new key
 * - api-keys revoke <key-id> - Revoke a key
 * - api-keys cleanup - Clean up expired/revoked keys
 */
export class ApiKeyCommands {
  constructor(private readonly ctx: AppContext) {}

  async handleApiKeyCommand(args: string[], userId: string, respond: RespondFn): Promise<void> {
    const subcommand = args[1];

    switch (subcommand) {
      case 'list':
        await this.listKeys(respond);
        break;
      case 'generate':
        await this.generateKey(args.slice(2), userId, respond);
        break;
      case 'revoke':
        await this.revokeKey(args.slice(2), userId, respond);
        break;
      case 'cleanup':
        await this.cleanupKeys(userId, respond);
        break;
      default:
        await respond(this.getUsage());
        break;
    }
  }

  private async listKeys(respond: RespondFn): Promise<void> {
    try {
      const keys = this.ctx.apiKeyService.listAll();

      if (keys.length === 0) {
        await respond(':key: No API keys found.');
        return;
      }

      let response = `:key: *API Keys (${keys.length}):*\n\n`;

      for (const key of keys) {
        const status = key.revoked
          ? ':red_circle: Revoked'
          : key.expiresAt && key.expiresAt < new Date()
          ? ':warning: Expired'
          : ':large_green_circle: Active';

        const keyPreview = key.key.substring(0, 12) + '...';
        const createdAt = key.createdAt.toLocaleDateString();
        const expiresAt = key.expiresAt?.toLocaleDateString() || 'Never';
        const lastUsedAt = key.lastUsedAt?.toLocaleDateString() || 'Never';

        response += `${status} *${key.id}*\n`;
        response += `  • Agent: \`${key.agentId}\`\n`;
        response += `  • Key: \`${keyPreview}\`\n`;
        response += `  • Created: ${createdAt}\n`;
        response += `  • Expires: ${expiresAt}\n`;
        response += `  • Last used: ${lastUsedAt}\n\n`;
      }

      // Count active keys
      const activeKeys = keys.filter(k => !k.revoked && (k.expiresAt === null || k.expiresAt > new Date()));
      response += `\n:information_source: ${activeKeys.length} active key(s) out of ${keys.length} total.`;

      await respond(response);
    } catch (error) {
      logger.error({ error }, 'Error listing API keys');
      await respond(':x: Error listing API keys. Check logs for details.');
    }
  }

  private async generateKey(args: string[], userId: string, respond: RespondFn): Promise<void> {
    const agentId = args[0];
    const expiresInDaysStr = args[1];

    if (!agentId) {
      await respond(':x: Usage: `/bm-admin api-keys generate <agent-id> [expires-in-days]`');
      return;
    }

    let expiresInDays: number | undefined;
    if (expiresInDaysStr) {
      expiresInDays = parseInt(expiresInDaysStr, 10);
      if (isNaN(expiresInDays) || expiresInDays <= 0) {
        await respond(':x: Invalid expiration days. Must be a positive number.');
        return;
      }
    }

    try {
      const apiKey = this.ctx.apiKeyService.generate({ agentId, expiresInDays }, userId);

      let response = `:white_check_mark: *API Key Generated*\n\n`;
      response += `ID: \`${apiKey.id}\`\n`;
      response += `Agent: \`${apiKey.agentId}\`\n`;
      response += `Key: ||\`${apiKey.key}\`||\n`;  // Spoiler tag to hide sensitive key
      response += `Created: ${apiKey.createdAt.toLocaleDateString()}\n`;
      response += `Expires: ${apiKey.expiresAt?.toLocaleDateString() || 'Never'}\n\n`;
      response += `:warning: *Please copy this key now - it won't be shown again!*`;

      await respond(response);
    } catch (error) {
      logger.error({ error, agentId, expiresInDays }, 'Error generating API key');
      await respond(':x: Error generating API key. Check logs for details.');
    }
  }

  private async revokeKey(args: string[], userId: string, respond: RespondFn): Promise<void> {
    const keyId = args[0];

    if (!keyId) {
      await respond(':x: Usage: `/bm-admin api-keys revoke <key-id>`');
      return;
    }

    try {
      const revokedKey = this.ctx.apiKeyService.revoke(keyId, userId);

      if (!revokedKey) {
        await respond(`:x: API key \`${keyId}\` not found.`);
        return;
      }

      await respond(`:white_check_mark: API key \`${keyId}\` for agent \`${revokedKey.agentId}\` has been revoked.`);
    } catch (error) {
      logger.error({ error, keyId }, 'Error revoking API key');
      await respond(':x: Error revoking API key. Check logs for details.');
    }
  }

  private async cleanupKeys(userId: string, respond: RespondFn): Promise<void> {
    try {
      const result = this.ctx.apiKeyService.cleanupExpiredKeys();

      if (result.deleted === 0) {
        await respond(':broom: No expired or revoked keys to clean up.');
      } else {
        await respond(`:white_check_mark: Cleaned up ${result.deleted} expired/revoked API key(s).`);
      }

      this.ctx.auditLogRepo.log('api-key:cleanup-command', 'api_key', 'system', userId, {
        deletedCount: result.deleted,
      });
    } catch (error) {
      logger.error({ error }, 'Error cleaning up API keys');
      await respond(':x: Error cleaning up API keys. Check logs for details.');
    }
  }

  private getUsage(): string {
    return `:key: *API Key Management Commands*

• \`/bm-admin api-keys list\` - Show all API keys with status
• \`/bm-admin api-keys generate <agent-id> [expires-in-days]\` - Generate new key
• \`/bm-admin api-keys revoke <key-id>\` - Revoke an API key
• \`/bm-admin api-keys cleanup\` - Remove expired/revoked keys

*Examples:*
• \`/bm-admin api-keys generate agent-001 30\` - Generate key for agent-001, expires in 30 days
• \`/bm-admin api-keys generate agent-002\` - Generate permanent key for agent-002
• \`/bm-admin api-keys revoke ak_123abc\` - Revoke specific key`;
  }
}