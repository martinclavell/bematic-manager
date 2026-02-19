import type { NetSuiteConfig, NetSuiteOAuth1Credentials } from '../../types/common.js';
import { NetSuiteConfigError } from '../../errors/netsuite-error.js';

export interface ConfigStore {
  /** Save configuration */
  save(projectId: string, config: NetSuiteConfig): Promise<void>;
  /** Load configuration */
  load(projectId: string): Promise<NetSuiteConfig | null>;
  /** Delete configuration */
  delete(projectId: string): Promise<void>;
  /** List all configurations */
  list(): Promise<Array<{ projectId: string; accountId: string }>>;
}

/**
 * Central configuration manager for NetSuite integrations
 */
export class NetSuiteConfigManager {
  constructor(private readonly store: ConfigStore) {}

  /**
   * Get configuration for a project
   */
  async getConfig(projectId: string): Promise<NetSuiteConfig> {
    const config = await this.store.load(projectId);
    if (!config) {
      throw new NetSuiteConfigError(`No NetSuite configuration found for project: ${projectId}`);
    }

    this.validateConfig(config);
    return config;
  }

  /**
   * Save configuration for a project
   */
  async saveConfig(projectId: string, config: NetSuiteConfig): Promise<void> {
    this.validateConfig(config);
    await this.store.save(projectId, config);
  }

  /**
   * Delete configuration for a project
   */
  async deleteConfig(projectId: string): Promise<void> {
    await this.store.delete(projectId);
  }

  /**
   * Check if configuration exists
   */
  async hasConfig(projectId: string): Promise<boolean> {
    const config = await this.store.load(projectId);
    return config !== null;
  }

  /**
   * List all project configurations
   */
  async listConfigs(): Promise<Array<{ projectId: string; accountId: string }>> {
    return this.store.list();
  }

  /**
   * Validate configuration completeness
   */
  private validateConfig(config: NetSuiteConfig): void {
    if (!config.account?.accountId) {
      throw new NetSuiteConfigError('Missing required field: account.accountId');
    }

    if (!config.account.productionUrl) {
      throw new NetSuiteConfigError('Missing required field: account.productionUrl');
    }

    if (!config.credentials) {
      throw new NetSuiteConfigError('Missing required field: credentials');
    }

    // Validate OAuth 1.0 credentials if present
    if ('consumerKey' in config.credentials) {
      const oauth1 = config.credentials as NetSuiteOAuth1Credentials;
      if (!oauth1.consumerKey || !oauth1.consumerSecret || !oauth1.tokenId || !oauth1.tokenSecret) {
        throw new NetSuiteConfigError('Incomplete OAuth 1.0 credentials');
      }
    }
  }

  /**
   * Build base URL for account
   */
  getBaseUrl(config: NetSuiteConfig): string {
    const url = config.account.environment === 'sandbox'
      ? config.account.sandboxUrl || config.account.productionUrl
      : config.account.productionUrl;

    return url.replace(/\/$/, ''); // Remove trailing slash
  }
}
