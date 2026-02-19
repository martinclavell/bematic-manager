/**
 * @bematic/netsuite - Modular NetSuite integration library
 *
 * A comprehensive, extensible library for NetSuite integrations with:
 * - OAuth 1.0 & 2.0 authentication
 * - RESTlet, SuiteQL, and REST API clients
 * - SuiteCommerce SEO utilities
 * - Record CRUD operations
 * - Plugin system for extensibility
 * - Slack bot integration
 * - Database storage adapters
 *
 * @example
 * ```typescript
 * import { NetSuiteClient, NetSuiteConfigManager } from '@bematic/netsuite';
 *
 * const client = await NetSuiteClient.fromProjectId('project-123', configManager);
 * const customer = await client.restlet.get('/restlet/endpoint', { id: '1233' });
 * ```
 */

// Core exports
export * from './core/index.js';

// Service exports
export * from './services/index.js';

// Adapter exports
export * from './adapters/index.js';

// Type exports
export * from './types/index.js';

// Error exports
export * from './errors/index.js';

// Plugin exports
export * from './plugins/index.js';
