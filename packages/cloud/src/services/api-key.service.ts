import { createLogger, generateId } from '@bematic/common';
import type { ApiKeyRepository, AuditLogRepository, ApiKeyRow } from '@bematic/db';
import { randomBytes } from 'node:crypto';

const logger = createLogger('api-key-service');

export interface ApiKeyGenerateInput {
  agentId: string;
  expiresInDays?: number;
}

export interface ApiKeyValidationResult {
  isValid: boolean;
  apiKey?: ApiKeyRow;
  reason?: string;
}

export class ApiKeyService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {}

  /**
   * Generate a new API key for an agent
   */
  generate(input: ApiKeyGenerateInput, userId?: string): ApiKeyRow {
    const id = generateId('ak');
    const key = this.generateSecureKey();
    const createdAt = new Date();
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const apiKey = this.apiKeyRepo.create({
      id,
      key,
      agentId: input.agentId,
      createdAt,
      expiresAt,
      revoked: false,
    });

    this.auditLogRepo.log('api-key:generated', 'api_key', id, userId, {
      agentId: input.agentId,
      expiresInDays: input.expiresInDays,
      expiresAt: expiresAt?.toISOString(),
    });

    logger.info(
      {
        keyId: id,
        agentId: input.agentId,
        expiresAt: expiresAt?.toISOString()
      },
      'API key generated'
    );

    return apiKey;
  }

  /**
   * Validate an API key for authentication
   */
  validateKey(key: string): ApiKeyValidationResult {
    try {
      const apiKey = this.apiKeyRepo.findByKey(key);

      if (!apiKey) {
        return { isValid: false, reason: 'Key not found' };
      }

      if (apiKey.revoked) {
        return { isValid: false, reason: 'Key is revoked' };
      }

      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        return { isValid: false, reason: 'Key is expired' };
      }

      // Update last used timestamp
      this.apiKeyRepo.updateLastUsed(key);

      return { isValid: true, apiKey };
    } catch (error) {
      logger.error({ error }, 'Error validating API key');
      return { isValid: false, reason: 'Validation error' };
    }
  }

  /**
   * Get all valid API keys (for backward compatibility with config-based auth)
   */
  getValidKeys(): string[] {
    try {
      const keys = this.apiKeyRepo.findValidKeys();
      return keys.map(k => k.key);
    } catch (error) {
      logger.error({ error }, 'Error getting valid keys');
      return [];
    }
  }

  /**
   * List all API keys for an agent
   */
  listByAgent(agentId: string): ApiKeyRow[] {
    return this.apiKeyRepo.findByAgentId(agentId);
  }

  /**
   * List all API keys
   */
  listAll(): ApiKeyRow[] {
    return this.apiKeyRepo.findAll();
  }

  /**
   * Revoke an API key
   */
  revoke(id: string, userId?: string): ApiKeyRow | undefined {
    const apiKey = this.apiKeyRepo.revoke(id);

    if (apiKey) {
      this.auditLogRepo.log('api-key:revoked', 'api_key', id, userId, {
        agentId: apiKey.agentId,
      });

      logger.info({ keyId: id, agentId: apiKey.agentId }, 'API key revoked');
    }

    return apiKey;
  }

  /**
   * Clean up expired and revoked keys
   */
  cleanupExpiredKeys(): { deleted: number } {
    try {
      const result = this.apiKeyRepo.cleanupExpiredAndRevoked();

      if (result.deleted > 0) {
        logger.info({ deleted: result.deleted }, 'Cleaned up expired/revoked API keys');

        this.auditLogRepo.log('api-key:cleanup', 'api_key', 'system', 'system', {
          deletedCount: result.deleted,
        });
      }

      return result;
    } catch (error) {
      logger.error({ error }, 'Error cleaning up expired keys');
      throw error;
    }
  }

  /**
   * Delete an API key permanently
   */
  delete(id: string, userId?: string): void {
    const apiKey = this.apiKeyRepo.findById(id);

    this.apiKeyRepo.delete(id);

    if (apiKey) {
      this.auditLogRepo.log('api-key:deleted', 'api_key', id, userId, {
        agentId: apiKey.agentId,
      });

      logger.info({ keyId: id, agentId: apiKey.agentId }, 'API key deleted');
    }
  }

  /**
   * Generate a cryptographically secure API key
   */
  private generateSecureKey(): string {
    // Generate 32 bytes (256 bits) of random data
    const bytes = randomBytes(32);
    // Convert to hex and prefix with 'bm_' for identification
    return `bm_${bytes.toString('hex')}`;
  }
}