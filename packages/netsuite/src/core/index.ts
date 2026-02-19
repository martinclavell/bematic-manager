// Core client exports
export { NetSuiteClient } from './client/netsuite-client.js';
export { NetSuiteRESTletClient } from './client/restlet-client.js';
export type { RESTletRequest } from './client/restlet-client.js';

// Authentication exports
export { OAuth1SignatureGenerator } from './auth/oauth1.js';
export type { OAuth1Params } from './auth/oauth1.js';

// Encryption exports
export { CredentialEncryption } from './crypto/encryption.js';
export type { EncryptionOptions } from './crypto/encryption.js';

// Configuration exports
export { NetSuiteConfigManager } from './config/config-manager.js';
export type { ConfigStore } from './config/config-manager.js';
