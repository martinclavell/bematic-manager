import type { ConfigStore } from '../../core/config/config-manager.js';
import type { NetSuiteConfig } from '../../types/common.js';
import { CredentialEncryption } from '../../core/crypto/encryption.js';

export interface DatabaseConfig {
  /** Repository for NetSuite configs */
  repository: {
    findByProjectId(projectId: string): any | undefined;
    upsertByProjectId(projectId: string, data: any): any;
    delete(id: string): void;
    findAll(): any[];
  };
  /** Encryption instance for credentials */
  encryption: CredentialEncryption;
}

/**
 * Database storage adapter for NetSuite configurations
 * Bridges between NetSuite module and Bematic database layer
 */
export class DatabaseStorageAdapter implements ConfigStore {
  constructor(private readonly config: DatabaseConfig) {}

  async save(projectId: string, nsConfig: NetSuiteConfig): Promise<void> {
    // Encrypt credentials before storage
    const encrypted = this.encryptCredentials(nsConfig);

    const data = {
      accountNumber: nsConfig.account.accountId,
      productionUrl: nsConfig.account.productionUrl,
      sandboxUrl: nsConfig.account.sandboxUrl || null,
      restletUrl: nsConfig.restletUrl || '',
      consumerKey: encrypted.consumerKey,
      consumerSecret: encrypted.consumerSecret,
      tokenId: encrypted.tokenId,
      tokenSecret: encrypted.tokenSecret,
    };

    this.config.repository.upsertByProjectId(projectId, data);
  }

  async load(projectId: string): Promise<NetSuiteConfig | null> {
    const row = this.config.repository.findByProjectId(projectId);
    if (!row) {
      return null;
    }

    // Decrypt credentials
    const decrypted = this.config.encryption.decryptOAuth1({
      consumerKey: row.consumerKey,
      consumerSecret: row.consumerSecret,
      tokenId: row.tokenId,
      tokenSecret: row.tokenSecret,
    });

    return {
      account: {
        accountId: row.accountNumber,
        productionUrl: row.productionUrl,
        sandboxUrl: row.sandboxUrl || undefined,
        environment: 'production',
      },
      credentials: {
        consumerKey: decrypted.consumerKey,
        consumerSecret: decrypted.consumerSecret,
        tokenId: decrypted.tokenId,
        tokenSecret: decrypted.tokenSecret,
      },
      restletUrl: row.restletUrl || undefined,
    };
  }

  async delete(projectId: string): Promise<void> {
    const row = this.config.repository.findByProjectId(projectId);
    if (row) {
      this.config.repository.delete(row.id);
    }
  }

  async list(): Promise<Array<{ projectId: string; accountId: string }>> {
    const rows = this.config.repository.findAll();
    return rows.map((row: any) => ({
      projectId: row.projectId,
      accountId: row.accountNumber,
    }));
  }

  private encryptCredentials(config: NetSuiteConfig): {
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
  } {
    if ('consumerKey' in config.credentials) {
      return this.config.encryption.encryptOAuth1({
        consumerKey: config.credentials.consumerKey,
        consumerSecret: config.credentials.consumerSecret,
        tokenId: config.credentials.tokenId,
        tokenSecret: config.credentials.tokenSecret,
      });
    }

    throw new Error('Only OAuth 1.0 credentials are currently supported');
  }
}
