# @bematic/netsuite

Comprehensive, modular NetSuite integration library for Node.js applications.

## Features

- **Multiple Auth Methods**: OAuth 1.0, OAuth 2.0 (planned)
- **Multiple API Clients**: RESTlet, SuiteQL (planned), REST API 2.0 (planned)
- **Type-Safe**: Full TypeScript support with NetSuite record types
- **Pluggable Architecture**: Extend functionality with custom plugins
- **Adapters**: Built-in Slack, database, and API adapters
- **Encryption**: AES-256-GCM credential encryption
- **SEO Tools**: SuiteCommerce SEO debugging utilities
- **Extensible**: Easy to add new services, record types, and integrations

## Installation

```bash
npm install @bematic/netsuite
```

## Quick Start

### 1. Basic RESTlet Client

```typescript
import { NetSuiteClient, CredentialEncryption } from '@bematic/netsuite';

const client = NetSuiteClient.fromConfig({
  account: {
    accountId: '1234567',
    productionUrl: 'https://1234567.app.netsuite.com',
    environment: 'production',
  },
  credentials: {
    consumerKey: 'your-consumer-key',
    consumerSecret: 'your-consumer-secret',
    tokenId: 'your-token-id',
    tokenSecret: 'your-token-secret',
  },
  restletUrl: 'https://1234567.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=123&deploy=1',
});

// Make RESTlet requests
const response = await client.restlet.get('/endpoint', { customerId: '1233' });
console.log(response.data);
```

### 2. With Configuration Manager (Recommended)

```typescript
import {
  NetSuiteClient,
  NetSuiteConfigManager,
  DatabaseStorageAdapter,
  CredentialEncryption,
} from '@bematic/netsuite';

// Setup storage adapter
const encryption = CredentialEncryption.fromHexKey(process.env.NETSUITE_ENCRYPTION_KEY!);
const store = new DatabaseStorageAdapter({
  repository: netsuiteConfigRepo, // Your database repository
  encryption,
});

const configManager = new NetSuiteConfigManager(store);

// Save configuration
await configManager.saveConfig('project-123', {
  account: {
    accountId: '1234567',
    productionUrl: 'https://1234567.app.netsuite.com',
    environment: 'production',
  },
  credentials: {
    consumerKey: 'key',
    consumerSecret: 'secret',
    tokenId: 'token',
    tokenSecret: 'secret',
  },
  restletUrl: 'https://...',
});

// Load client from project
const client = await NetSuiteClient.fromProjectId('project-123', configManager);
```

### 3. Record Operations

```typescript
import { RecordService } from '@bematic/netsuite/services';

const recordService = new RecordService(client, {
  restletUrl: client.config.restletUrl!,
});

// Get customer
const customer = await recordService.getRecord('customer', '1233');

// Create sales order
const order = await recordService.createRecord('salesorder', {
  entity: '1233',
  item: [{ item: '456', quantity: 2 }],
});

// Update record
await recordService.updateRecord('customer', '1233', {
  companyname: 'Updated Name',
});

// Search records
const results = await recordService.searchRecords('customer', [
  { field: 'companyname', operator: 'contains', value: 'Acme' },
]);
```

### 4. SEO Debugging

```typescript
import { NetSuiteSEOService } from '@bematic/netsuite/services';

const seoService = new NetSuiteSEOService(client);

// Generate debug URL
const debugUrl = seoService.buildDebugUrl('www.christianartgifts.com');
// Output: https://www.christianartgifts.com?seodebug=T&preview=1234567890&seonojscache=T

// Fetch and analyze page
const page = await seoService.fetchDebugPage('www.christianartgifts.com');
const analysis = seoService.analyzeSEO(page.html);

console.log(analysis);
// { hasTitle: true, hasDescription: true, hasOgTags: true, ... }
```

### 5. Slack Integration

```typescript
import { NetSuiteSlackAdapter } from '@bematic/netsuite/adapters';
import { App } from '@slack/bolt';

const slackAdapter = new NetSuiteSlackAdapter(app, {
  configManager,
  checkPermission: async (userId, permission) => {
    // Your permission checker
  },
  resolveProject: (channelId) => {
    // Your project resolver
  },
  logAudit: (action, type, id, userId, meta) => {
    // Your audit logger
  },
});

// Register /bm netsuite commands
slackAdapter.register();
```

## Architecture

```
@bematic/netsuite
├── core/           # Core functionality
│   ├── client/     # API clients (RESTlet, SuiteQL, REST)
│   ├── auth/       # OAuth 1.0, OAuth 2.0
│   ├── crypto/     # Credential encryption
│   └── config/     # Configuration management
├── services/       # Business logic
│   ├── record/     # Record CRUD operations
│   ├── seo/        # SEO debugging
│   ├── sdf/        # SuiteCloud Development Framework
│   └── suitecommerce/ # SuiteCommerce utilities
├── adapters/       # Integration adapters
│   ├── slack/      # Slack bot integration
│   ├── storage/    # Database storage
│   └── api/        # REST/GraphQL adapters
├── plugins/        # Plugin system
├── types/          # TypeScript definitions
└── errors/         # Custom error classes
```

## Plugin System

```typescript
import { BaseNetSuitePlugin, NetSuitePluginManager } from '@bematic/netsuite/plugins';

class LoggerPlugin extends BaseNetSuitePlugin {
  name = 'logger';
  version = '1.0.0';

  async afterResponse(response) {
    console.log(`Request completed in ${response.durationMs}ms`);
    return response;
  }

  async onError(error) {
    console.error('Request failed:', error.message);
  }
}

const pluginManager = new NetSuitePluginManager();
pluginManager.register(new LoggerPlugin());
await pluginManager.initializeAll(client);
```

## Environment Variables

```bash
# Encryption key for credentials (64 hex chars = 32 bytes)
NETSUITE_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

## Error Handling

```typescript
import {
  NetSuiteError,
  NetSuiteAuthError,
  NetSuiteAPIError,
  NetSuiteTimeoutError,
} from '@bematic/netsuite/errors';

try {
  await client.restlet.get('/endpoint');
} catch (error) {
  if (error instanceof NetSuiteAuthError) {
    console.error('Authentication failed:', error.message);
  } else if (error instanceof NetSuiteTimeoutError) {
    console.error('Request timed out');
  } else if (error instanceof NetSuiteAPIError) {
    console.error('API error:', error.statusCode, error.code);
  }
}
```

## TypeScript

Full type safety for NetSuite records:

```typescript
import type { NetSuiteConfig, NetSuiteResponse } from '@bematic/netsuite/types';

interface Customer {
  id: string;
  companyname: string;
  email: string;
}

const response: NetSuiteResponse<Customer> = await client.restlet.get<Customer>('/endpoint');
```

## Advanced Usage

### Custom Storage Adapter

```typescript
import { ConfigStore } from '@bematic/netsuite/core';

class CustomStorageAdapter implements ConfigStore {
  async save(projectId: string, config: NetSuiteConfig): Promise<void> {
    // Your implementation
  }

  async load(projectId: string): Promise<NetSuiteConfig | null> {
    // Your implementation
  }

  async delete(projectId: string): Promise<void> {
    // Your implementation
  }

  async list(): Promise<Array<{ projectId: string; accountId: string }>> {
    // Your implementation
  }
}
```

### Retry Logic

```typescript
const response = await client.restlet.get('/endpoint', {}, {
  retry: {
    maxAttempts: 3,
    initialDelayMs: 1000,
  },
  timeout: 30000,
});
```

## License

MIT

## Contributing

Contributions welcome! This is a modular architecture designed for extensibility.

### Adding New Services

1. Create service file in `src/services/<category>/<service-name>.ts`
2. Export from `src/services/index.ts`
3. Add tests
4. Update documentation

### Adding New Adapters

1. Create adapter file in `src/adapters/<adapter-name>/<adapter-name>-adapter.ts`
2. Export from `src/adapters/index.ts`
3. Document integration steps

## Support

For issues and feature requests, please open a GitHub issue.
