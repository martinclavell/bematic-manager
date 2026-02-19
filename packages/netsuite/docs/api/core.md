# Core API Reference

Complete API reference for the core module of @bematic/netsuite.

## Table of Contents

- [NetSuiteClient](#netsuiteclient)
- [NetSuiteRESTletClient](#netsuiterestletclient)
- [OAuth1SignatureGenerator](#oauth1signaturegenerator)
- [CredentialEncryption](#credentialencryption)
- [NetSuiteConfigManager](#netsuiteconfigmanager)

---

## NetSuiteClient

Main client for all NetSuite operations.

### Constructor

```typescript
constructor(
  config: NetSuiteConfig,
  configManager?: NetSuiteConfigManager
)
```

### Static Methods

#### `fromConfig(config: NetSuiteConfig): NetSuiteClient`

Create client from direct configuration.

**Parameters:**
- `config`: NetSuite configuration object

**Returns:** NetSuiteClient instance

**Example:**
```typescript
const client = NetSuiteClient.fromConfig({
  account: {
    accountId: '1234567',
    productionUrl: 'https://1234567.app.netsuite.com',
    environment: 'production',
  },
  credentials: { /* OAuth 1.0 credentials */ },
  restletUrl: 'https://...',
});
```

#### `fromProjectId(projectId: string, configManager: NetSuiteConfigManager): Promise<NetSuiteClient>`

Create client from project ID (requires ConfigManager).

**Parameters:**
- `projectId`: Project identifier
- `configManager`: Configuration manager instance

**Returns:** Promise resolving to NetSuiteClient

**Example:**
```typescript
const client = await NetSuiteClient.fromProjectId(
  'project-123',
  configManager
);
```

### Instance Properties

#### `restlet: NetSuiteRESTletClient`

RESTlet API client instance.

**Type:** NetSuiteRESTletClient (read-only)

#### `config: NetSuiteConfig`

Current NetSuite configuration.

**Type:** NetSuiteConfig (read-only)

### Instance Methods

#### `getAccountId(): string`

Get NetSuite account ID.

**Returns:** Account ID string

**Example:**
```typescript
const accountId = client.getAccountId();
console.log(accountId); // "1234567"
```

#### `getEnvironment(): 'production' | 'sandbox'`

Get current environment.

**Returns:** Current environment string

**Example:**
```typescript
const env = client.getEnvironment();
console.log(env); // "production"
```

#### `switchEnvironment(environment: 'production' | 'sandbox'): void`

Switch between production and sandbox environments.

**Parameters:**
- `environment`: Target environment

**Example:**
```typescript
client.switchEnvironment('sandbox');
const data = await client.restlet.get(url);

client.switchEnvironment('production');
```

---

## NetSuiteRESTletClient

Client for NetSuite RESTlet API calls with OAuth 1.0 authentication.

### Constructor

```typescript
constructor(config: NetSuiteConfig)
```

### Methods

#### `request<T>(req: RESTletRequest, options?: NetSuiteRequestOptions): Promise<NetSuiteResponse<T>>`

Execute a RESTlet request.

**Parameters:**
- `req`: Request configuration
  - `method`: HTTP method ('GET' | 'POST' | 'PUT' | 'DELETE')
  - `url`: RESTlet endpoint URL
  - `body?`: Request body (for POST/PUT)
  - `params?`: Query parameters
- `options?`: Request options
  - `headers?`: Custom headers
  - `timeout?`: Request timeout in ms
  - `noRetry?`: Disable automatic retry
  - `retry?`: Custom retry configuration

**Returns:** Promise resolving to NetSuiteResponse

**Example:**
```typescript
const response = await client.restlet.request({
  method: 'GET',
  url: 'https://1234567.restlets.api.netsuite.com/...',
  params: { customerId: '1233' },
}, {
  timeout: 30000,
  retry: { maxAttempts: 3, initialDelayMs: 1000 },
});

console.log(response.data);
console.log(response.durationMs);
```

#### `get<T>(url: string, params?: Record<string, string>, options?: NetSuiteRequestOptions): Promise<NetSuiteResponse<T>>`

Execute GET request.

**Parameters:**
- `url`: RESTlet endpoint URL
- `params?`: Query parameters
- `options?`: Request options

**Returns:** Promise resolving to NetSuiteResponse

**Example:**
```typescript
const response = await client.restlet.get(
  'https://1234567.restlets.api.netsuite.com/...',
  { action: 'getCustomer', id: '1233' }
);
```

#### `post<T>(url: string, body?: any, options?: NetSuiteRequestOptions): Promise<NetSuiteResponse<T>>`

Execute POST request.

**Parameters:**
- `url`: RESTlet endpoint URL
- `body?`: Request body
- `options?`: Request options

**Returns:** Promise resolving to NetSuiteResponse

**Example:**
```typescript
const response = await client.restlet.post(
  'https://1234567.restlets.api.netsuite.com/...',
  {
    action: 'createCustomer',
    data: {
      companyname: 'Acme Corp',
      email: 'contact@acme.com',
    },
  }
);
```

#### `put<T>(url: string, body?: any, options?: NetSuiteRequestOptions): Promise<NetSuiteResponse<T>>`

Execute PUT request.

**Parameters:**
- `url`: RESTlet endpoint URL
- `body?`: Request body
- `options?`: Request options

**Returns:** Promise resolving to NetSuiteResponse

**Example:**
```typescript
const response = await client.restlet.put(
  url,
  {
    action: 'updateCustomer',
    id: '1233',
    data: { companyname: 'Acme Corporation' },
  }
);
```

#### `delete<T>(url: string, options?: NetSuiteRequestOptions): Promise<NetSuiteResponse<T>>`

Execute DELETE request.

**Parameters:**
- `url`: RESTlet endpoint URL
- `options?`: Request options

**Returns:** Promise resolving to NetSuiteResponse

**Example:**
```typescript
await client.restlet.delete(url, {
  headers: { 'X-Delete-Reason': 'duplicate' },
});
```

---

## OAuth1SignatureGenerator

Generates OAuth 1.0 signatures for NetSuite RESTlet authentication.

### Constructor

```typescript
constructor(credentials: NetSuiteOAuth1Credentials)
```

**Parameters:**
- `credentials`: OAuth 1.0 credentials
  - `consumerKey`: Consumer key from Integration record
  - `consumerSecret`: Consumer secret from Integration record
  - `tokenId`: Token ID from Access Token
  - `tokenSecret`: Token secret from Access Token

### Methods

#### `generateSignature(method: string, url: string, oauthParams: OAuth1Params): string`

Generate OAuth 1.0 signature for a request.

**Parameters:**
- `method`: HTTP method ('GET', 'POST', 'PUT', 'DELETE')
- `url`: Full request URL with query parameters
- `oauthParams`: OAuth parameters (excluding signature)

**Returns:** Base64-encoded HMAC-SHA256 signature

**Example:**
```typescript
const generator = new OAuth1SignatureGenerator(credentials);

const signature = generator.generateSignature(
  'GET',
  'https://1234567.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=123&deploy=1',
  {
    oauth_consumer_key: 'key',
    oauth_token: 'token',
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: '1234567890',
    oauth_nonce: 'abc123',
    oauth_version: '1.0',
  }
);
```

#### `generateAuthHeader(method: string, url: string, realm: string): string`

Generate complete OAuth 1.0 Authorization header.

**Parameters:**
- `method`: HTTP method
- `url`: Full request URL
- `realm`: NetSuite account ID

**Returns:** OAuth Authorization header string

**Example:**
```typescript
const authHeader = generator.generateAuthHeader(
  'GET',
  'https://1234567.restlets.api.netsuite.com/...',
  '1234567'
);

// Result: OAuth realm="1234567",oauth_consumer_key="...",oauth_token="...",...
```

---

## CredentialEncryption

AES-256-GCM encryption/decryption for NetSuite credentials.

### Constructor

```typescript
constructor(options: EncryptionOptions)
```

**Parameters:**
- `options`: Encryption options
  - `key`: Encryption key (32 bytes for AES-256)
  - `algorithm?`: Algorithm name (default: 'aes-256-gcm')

### Static Methods

#### `fromHexKey(hexKey: string): CredentialEncryption`

Create instance from hex-encoded key string.

**Parameters:**
- `hexKey`: 64-character hex string (32 bytes)

**Returns:** CredentialEncryption instance

**Throws:** NetSuiteConfigError if key length is invalid

**Example:**
```typescript
const encryption = CredentialEncryption.fromHexKey(
  process.env.NETSUITE_ENCRYPTION_KEY!
);
```

### Instance Methods

#### `encrypt(plaintext: string): string`

Encrypt plaintext credential.

**Parameters:**
- `plaintext`: Plaintext credential string

**Returns:** Encrypted string in format `iv:authTag:ciphertext` (hex-encoded)

**Throws:** NetSuiteConfigError on encryption failure

**Example:**
```typescript
const encrypted = encryption.encrypt('my-secret-key');
// Result: "a1b2c3d4e5f6:1a2b3c4d5e6f:9f8e7d6c5b4a..."
```

#### `decrypt(ciphertext: string): string`

Decrypt encrypted credential.

**Parameters:**
- `ciphertext`: Encrypted string in format `iv:authTag:ciphertext`

**Returns:** Decrypted plaintext string

**Throws:** NetSuiteConfigError on decryption failure

**Example:**
```typescript
const decrypted = encryption.decrypt(encrypted);
// Result: "my-secret-key"
```

#### `encryptOAuth1(credentials: {...}): {...}`

Encrypt OAuth 1.0 credentials.

**Parameters:**
- `credentials`: OAuth 1.0 credentials object
  - `consumerKey`: Consumer key
  - `consumerSecret`: Consumer secret
  - `tokenId`: Token ID
  - `tokenSecret`: Token secret

**Returns:** Object with encrypted credentials

**Example:**
```typescript
const encrypted = encryption.encryptOAuth1({
  consumerKey: 'key',
  consumerSecret: 'secret',
  tokenId: 'token',
  tokenSecret: 'secret',
});
```

#### `decryptOAuth1(encrypted: {...}): {...}`

Decrypt OAuth 1.0 credentials.

**Parameters:**
- `encrypted`: Encrypted credentials object

**Returns:** Object with decrypted credentials

**Example:**
```typescript
const decrypted = encryption.decryptOAuth1(encrypted);
// Result: { consumerKey: 'key', consumerSecret: 'secret', ... }
```

---

## NetSuiteConfigManager

Central configuration manager with pluggable storage.

### Constructor

```typescript
constructor(store: ConfigStore)
```

**Parameters:**
- `store`: Storage adapter implementing ConfigStore interface

### Methods

#### `getConfig(projectId: string): Promise<NetSuiteConfig>`

Get configuration for a project.

**Parameters:**
- `projectId`: Project identifier

**Returns:** Promise resolving to NetSuiteConfig

**Throws:** NetSuiteConfigError if configuration not found

**Example:**
```typescript
const config = await configManager.getConfig('project-123');
```

#### `saveConfig(projectId: string, config: NetSuiteConfig): Promise<void>`

Save configuration for a project.

**Parameters:**
- `projectId`: Project identifier
- `config`: NetSuite configuration

**Throws:** NetSuiteConfigError on validation or storage failure

**Example:**
```typescript
await configManager.saveConfig('project-123', {
  account: { /* ... */ },
  credentials: { /* ... */ },
  restletUrl: '...',
});
```

#### `deleteConfig(projectId: string): Promise<void>`

Delete configuration for a project.

**Parameters:**
- `projectId`: Project identifier

**Example:**
```typescript
await configManager.deleteConfig('project-123');
```

#### `hasConfig(projectId: string): Promise<boolean>`

Check if configuration exists for a project.

**Parameters:**
- `projectId`: Project identifier

**Returns:** Promise resolving to boolean

**Example:**
```typescript
if (await configManager.hasConfig('project-123')) {
  const config = await configManager.getConfig('project-123');
}
```

#### `listConfigs(): Promise<Array<{projectId: string, accountId: string}>>`

List all project configurations.

**Returns:** Promise resolving to array of project/account pairs

**Example:**
```typescript
const configs = await configManager.listConfigs();
console.log(configs);
// [{ projectId: 'project-123', accountId: '1234567' }, ...]
```

#### `getBaseUrl(config: NetSuiteConfig): string`

Build base URL for account based on environment.

**Parameters:**
- `config`: NetSuite configuration

**Returns:** Base URL string (without trailing slash)

**Example:**
```typescript
const baseUrl = configManager.getBaseUrl(config);
// Result: "https://1234567.app.netsuite.com"
```

---

## Type Definitions

### NetSuiteConfig

```typescript
interface NetSuiteConfig {
  account: NetSuiteAccountConfig;
  credentials: NetSuiteCredentials;
  restletUrl?: string;
  suiteqlUrl?: string;
  timeout?: number;
  retry?: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };
}
```

### NetSuiteAccountConfig

```typescript
interface NetSuiteAccountConfig {
  accountId: string;
  productionUrl: string;
  sandboxUrl?: string;
  environment: 'production' | 'sandbox';
}
```

### NetSuiteOAuth1Credentials

```typescript
interface NetSuiteOAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}
```

### NetSuiteRequestOptions

```typescript
interface NetSuiteRequestOptions {
  headers?: Record<string, string>;
  timeout?: number;
  noRetry?: boolean;
  retry?: {
    maxAttempts: number;
    initialDelayMs: number;
  };
}
```

### NetSuiteResponse<T>

```typescript
interface NetSuiteResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
  durationMs: number;
}
```

### ConfigStore

```typescript
interface ConfigStore {
  save(projectId: string, config: NetSuiteConfig): Promise<void>;
  load(projectId: string): Promise<NetSuiteConfig | null>;
  delete(projectId: string): Promise<void>;
  list(): Promise<Array<{ projectId: string; accountId: string }>>;
}
```

---

## Next Steps

- **[Services API](./services.md)** - RecordService, SEOService
- **[Adapters API](./adapters.md)** - Storage and integration adapters
- **[Errors API](./errors.md)** - Error classes and handling
- **[Usage Guide](../guides/06-client-usage.md)** - Practical examples

---

[← Back to API Reference](../README.md#api-reference)
