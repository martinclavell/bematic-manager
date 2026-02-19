import type { NetSuiteConfig } from '../../types/common.js';
import { NetSuiteRESTletClient } from './restlet-client.js';
import { NetSuiteConfigManager } from '../config/config-manager.js';

/**
 * Main NetSuite client - entry point for all NetSuite operations
 */
export class NetSuiteClient {
  public readonly restlet: NetSuiteRESTletClient;
  public readonly config: NetSuiteConfig;

  constructor(
    config: NetSuiteConfig,
    private readonly configManager?: NetSuiteConfigManager,
  ) {
    this.config = config;
    this.restlet = new NetSuiteRESTletClient(config);
  }

  /**
   * Create client from project ID (requires ConfigManager)
   */
  static async fromProjectId(
    projectId: string,
    configManager: NetSuiteConfigManager,
  ): Promise<NetSuiteClient> {
    const config = await configManager.getConfig(projectId);
    return new NetSuiteClient(config, configManager);
  }

  /**
   * Create client from direct configuration
   */
  static fromConfig(config: NetSuiteConfig): NetSuiteClient {
    return new NetSuiteClient(config);
  }

  /**
   * Get account ID
   */
  getAccountId(): string {
    return this.config.account.accountId;
  }

  /**
   * Get current environment
   */
  getEnvironment(): 'production' | 'sandbox' {
    return this.config.account.environment;
  }

  /**
   * Switch environment
   */
  switchEnvironment(environment: 'production' | 'sandbox'): void {
    this.config.account.environment = environment;
  }
}
