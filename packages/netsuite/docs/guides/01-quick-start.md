# Quick Start Guide

Get started with @bematic/netsuite in 5 minutes.

## Prerequisites

- Node.js 20.x or higher
- TypeScript 5.x or higher
- NetSuite account with:
  - Integration record (for OAuth consumer key/secret)
  - Access token (for OAuth token ID/secret)
  - RESTlet deployed (optional, for record operations)

## Installation

```bash
npm install @bematic/netsuite
```

## Step 1: Generate Encryption Key

Generate a secure 256-bit encryption key for credential storage:

```bash
# Using Node.js crypto
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save this as `NETSUITE_ENCRYPTION_KEY` in your environment variables.

## Step 2: Create Your First Client

```typescript
import { NetSuiteClient } from '@bematic/netsuite';

// Create client with direct configuration
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
  timeout: 30000,
});

console.log('✅ NetSuite client created!');
console.log('Account:', client.getAccountId());
console.log('Environment:', client.getEnvironment());
```

## Step 3: Make Your First RESTlet Call

```typescript
// Simple GET request
const response = await client.restlet.get(
  client.config.restletUrl!,
  { action: 'getCustomer', customerId: '1233' }
);

console.log('Customer:', response.data);
console.log('Response time:', response.durationMs + 'ms');
```

## Step 4: Perform Record Operations

```typescript
import { RecordService } from '@bematic/netsuite/services';

const recordService = new RecordService(client, {
  restletUrl: client.config.restletUrl!,
});

// Get a customer record
const customer = await recordService.getRecord('customer', '1233');
console.log('Customer name:', customer.companyname);

// Search for customers
const customers = await recordService.searchRecords(
  'customer',
  [{ field: 'companyname', operator: 'contains', value: 'Acme' }],
  ['internalid', 'companyname', 'email']
);
console.log('Found customers:', customers.length);
```

## Step 5: Generate SEO Debug URL

```typescript
import { NetSuiteSEOService } from '@bematic/netsuite/services';

const seoService = new NetSuiteSEOService(client);

// Generate debug URL
const debugUrl = seoService.buildDebugUrl('www.example.com');
console.log('SEO Debug URL:', debugUrl);
// Output: https://www.example.com?seodebug=T&preview=1234567890&seonojscache=T

// Analyze SEO of a page
const page = await seoService.fetchDebugPage('www.example.com');
const analysis = seoService.analyzeSEO(page.html);
console.log('SEO Analysis:', analysis);
```

## Step 6: Set Up Configuration Manager (Recommended)

For production use, store configurations in a database:

```typescript
import {
  NetSuiteConfigManager,
  DatabaseStorageAdapter,
  CredentialEncryption,
} from '@bematic/netsuite';

// Initialize encryption
const encryption = CredentialEncryption.fromHexKey(
  process.env.NETSUITE_ENCRYPTION_KEY!
);

// Create storage adapter (using your database repository)
const store = new DatabaseStorageAdapter({
  repository: yourNetSuiteConfigRepository,
  encryption,
});

// Create config manager
const configManager = new NetSuiteConfigManager(store);

// Save configuration
await configManager.saveConfig('project-123', {
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
  restletUrl: 'https://...',
});

// Load client from project
const projectClient = await NetSuiteClient.fromProjectId(
  'project-123',
  configManager
);
```

## Error Handling

```typescript
import {
  NetSuiteAuthError,
  NetSuiteAPIError,
  NetSuiteTimeoutError,
} from '@bematic/netsuite/errors';

try {
  const customer = await recordService.getRecord('customer', '1233');
} catch (error) {
  if (error instanceof NetSuiteAuthError) {
    console.error('Authentication failed:', error.message);
    // Handle auth error (refresh token, re-authenticate)
  } else if (error instanceof NetSuiteAPIError) {
    console.error('API error:', error.statusCode, error.code);
    // Handle API error
  } else if (error instanceof NetSuiteTimeoutError) {
    console.error('Request timed out after', error.details?.timeoutMs, 'ms');
    // Handle timeout
  } else {
    console.error('Unknown error:', error);
  }
}
```

## Next Steps

- **[Configuration Guide](./03-configuration.md)** - Learn about all configuration options
- **[Record Operations](./09-record-operations.md)** - Master CRUD operations
- **[Plugin System](./15-plugin-overview.md)** - Extend functionality with plugins
- **[Slack Integration](./13-slack-integration.md)** - Build a Slack bot
- **[Security Best Practices](./18-security.md)** - Secure your integration

## Common Patterns

### Retry Failed Requests

```typescript
const response = await client.restlet.get(url, params, {
  retry: {
    maxAttempts: 3,
    initialDelayMs: 1000,
  },
  timeout: 30000,
});
```

### Switch Environments

```typescript
// Switch to sandbox
client.switchEnvironment('sandbox');

// Make request to sandbox
const sandboxData = await client.restlet.get(url);

// Switch back to production
client.switchEnvironment('production');
```

### Custom Headers

```typescript
const response = await client.restlet.get(url, params, {
  headers: {
    'X-Custom-Header': 'value',
  },
});
```

## Troubleshooting

### Authentication Errors

If you receive `NetSuiteAuthError`:

1. Verify consumer key and secret in NetSuite Integration record
2. Verify token ID and secret in NetSuite Access Token
3. Ensure token is not expired
4. Check Integration record permissions

### Timeout Errors

If you receive `NetSuiteTimeoutError`:

1. Increase timeout: `{ timeout: 60000 }` (60 seconds)
2. Check network connectivity
3. Verify RESTlet URL is correct
4. Check NetSuite system status

### Invalid URL Errors

1. Ensure RESTlet URL includes script and deploy parameters
2. Verify account ID matches NetSuite account
3. Use production URL for production, sandbox URL for sandbox

## Getting Help

- **Documentation**: [Full Documentation](../README.md)
- **Examples**: [Example Code](../examples/)
- **API Reference**: [API Documentation](../api/)
- **Issues**: [GitHub Issues](https://github.com/martinclavell/bematic-manager/issues)

---

**Ready to learn more?** Continue with the [Configuration Guide](./03-configuration.md).
