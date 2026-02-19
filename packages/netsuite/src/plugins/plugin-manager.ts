import type { NetSuitePlugin } from './plugin-interface.js';
import type { NetSuiteClient } from '../core/client/netsuite-client.js';
import type { NetSuiteRequestOptions, NetSuiteResponse } from '../types/common.js';
import { createLogger } from '@bematic/common';

const logger = createLogger('NetSuitePluginManager');

/**
 * Plugin lifecycle manager for NetSuite integrations
 */
export class NetSuitePluginManager {
  private plugins: Map<string, NetSuitePlugin> = new Map();

  /**
   * Register a plugin
   */
  register(plugin: NetSuitePlugin): void {
    if (this.plugins.has(plugin.name)) {
      logger.warn({ pluginName: plugin.name }, 'Plugin already registered, replacing');
    }

    this.plugins.set(plugin.name, plugin);
    logger.info({ pluginName: plugin.name, version: plugin.version }, 'Plugin registered');
  }

  /**
   * Unregister a plugin
   */
  unregister(pluginName: string): void {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      plugin.destroy();
      this.plugins.delete(pluginName);
      logger.info({ pluginName }, 'Plugin unregistered');
    }
  }

  /**
   * Initialize all plugins with client
   */
  async initializeAll(client: NetSuiteClient): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.initialize(client);
        logger.info({ pluginName: plugin.name }, 'Plugin initialized');
      } catch (error) {
        logger.error({ error, pluginName: plugin.name }, 'Plugin initialization failed');
      }
    }
  }

  /**
   * Execute beforeRequest hooks
   */
  async executeBeforeRequest(options: NetSuiteRequestOptions): Promise<NetSuiteRequestOptions> {
    let modifiedOptions = options;

    for (const plugin of this.plugins.values()) {
      if (plugin.beforeRequest) {
        try {
          modifiedOptions = await plugin.beforeRequest(modifiedOptions);
        } catch (error) {
          logger.error({ error, pluginName: plugin.name }, 'beforeRequest hook failed');
        }
      }
    }

    return modifiedOptions;
  }

  /**
   * Execute afterResponse hooks
   */
  async executeAfterResponse<T>(response: NetSuiteResponse<T>): Promise<NetSuiteResponse<T>> {
    let modifiedResponse = response;

    for (const plugin of this.plugins.values()) {
      if (plugin.afterResponse) {
        try {
          modifiedResponse = await plugin.afterResponse(modifiedResponse);
        } catch (error) {
          logger.error({ error, pluginName: plugin.name }, 'afterResponse hook failed');
        }
      }
    }

    return modifiedResponse;
  }

  /**
   * Execute onError hooks
   */
  async executeOnError(error: Error): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onError) {
        try {
          await plugin.onError(error);
        } catch (err) {
          logger.error({ error: err, pluginName: plugin.name }, 'onError hook failed');
        }
      }
    }
  }

  /**
   * Destroy all plugins
   */
  async destroyAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.destroy();
        logger.info({ pluginName: plugin.name }, 'Plugin destroyed');
      } catch (error) {
        logger.error({ error, pluginName: plugin.name }, 'Plugin destruction failed');
      }
    }

    this.plugins.clear();
  }

  /**
   * Get plugin by name
   */
  getPlugin(name: string): NetSuitePlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * List all registered plugins
   */
  listPlugins(): Array<{ name: string; version: string }> {
    return Array.from(this.plugins.values()).map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
    }));
  }
}
