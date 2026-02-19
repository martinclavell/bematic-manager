# Architecture Overview

Comprehensive guide to the @bematic/netsuite architecture, design patterns, and principles.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Application                          │
│                  (Slack Bot, API, CLI)                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              @bematic/netsuite Package                       │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Public API                           │ │
│  │  NetSuiteClient, RecordService, SEOService, Adapters   │ │
│  └────────────────────┬───────────────────────────────────┘ │
│                       │                                      │
│  ┌────────────────────┴───────────────────────────────────┐ │
│  │                  Core Module                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │ │
│  │  │  Client  │  │   Auth   │  │  Crypto  │  │ Config │ │ │
│  │  │  Layer   │  │  Layer   │  │  Layer   │  │ Manager│ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
│                       │                                      │
│  ┌────────────────────┴───────────────────────────────────┐ │
│  │                Services Layer                           │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │ │
│  │  │  Record  │  │   SEO    │  │   SDF    │  │  Suite │ │ │
│  │  │ Service  │  │ Service  │  │ Service  │  │Commerce│ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
│                       │                                      │
│  ┌────────────────────┴───────────────────────────────────┐ │
│  │               Adapters Layer                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │ │
│  │  │ Database │  │  Slack   │  │   API    │  │ Cache  │ │ │
│  │  │ Adapter  │  │ Adapter  │  │ Adapter  │  │Adapter │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
│                       │                                      │
│  ┌────────────────────┴───────────────────────────────────┐ │
│  │                Plugin System                            │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │ │
│  │  │  Logger  │  │ Metrics  │  │  Cache   │  │ Custom │ │ │
│  │  │  Plugin  │  │  Plugin  │  │  Plugin  │  │ Plugin │ │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────┘ │ │
│  └─────────────────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  NetSuite REST APIs                          │
│         RESTlet, SuiteQL, REST API 2.0, SDF                 │
└─────────────────────────────────────────────────────────────┘
```

## Core Design Principles

### 1. Dependency Injection

All dependencies are injected via constructors, enabling easy testing and flexibility.

```typescript
class RecordService {
  constructor(
    private readonly client: NetSuiteClient,
    private readonly config: RecordServiceConfig,
  ) {}
}

// Easy to mock for testing
const mockClient = { /* ... */ };
const service = new RecordService(mockClient, config);
```

### 2. Strategy Pattern

Pluggable implementations for authentication, storage, and API clients.

```typescript
// Auth strategies
interface AuthStrategy {
  generateAuthHeader(method, url): string;
}

class OAuth1Strategy implements AuthStrategy { /* ... */ }
class OAuth2Strategy implements AuthStrategy { /* ... */ }

// Storage strategies
interface ConfigStore {
  save(id, config): Promise<void>;
  load(id): Promise<Config | null>;
}

class DatabaseStorageAdapter implements ConfigStore { /* ... */ }
class FileStorageAdapter implements ConfigStore { /* ... */ }
```

### 3. Adapter Pattern

Adapters bridge between @bematic/netsuite and external systems without coupling.

```typescript
// Slack Adapter
class NetSuiteSlackAdapter {
  constructor(
    private readonly app: SlackApp,
    private readonly configManager: ConfigManager,
  ) {}
}

// Database Adapter
class DatabaseStorageAdapter implements ConfigStore {
  constructor(
    private readonly repository: Repository,
    private readonly encryption: Encryption,
  ) {}
}
```

### 4. Plugin Architecture

Extend functionality without modifying core code.

```typescript
interface NetSuitePlugin {
  beforeRequest?(options): Promise<options>;
  afterResponse?(response): Promise<response>;
  onError?(error): Promise<void>;
}

class LoggerPlugin implements NetSuitePlugin {
  async afterResponse(response) {
    console.log(`Request completed in ${response.durationMs}ms`);
    return response;
  }
}
```

### 5. Separation of Concerns

Clear boundaries between layers:

- **Core**: Low-level client, auth, encryption
- **Services**: Business logic (records, SEO)
- **Adapters**: Integration with external systems
- **Plugins**: Cross-cutting concerns (logging, metrics)

## Module Structure

### Core Module

**Responsibility**: Foundation for all NetSuite operations.

```
core/
├── client/
│   ├── netsuite-client.ts        # Main client orchestrator
│   ├── restlet-client.ts         # RESTlet API client
│   ├── suiteql-client.ts         # SuiteQL client (future)
│   └── rest-api-client.ts        # REST API 2.0 client (future)
├── auth/
│   ├── oauth1.ts                 # OAuth 1.0 signature generator
│   ├── oauth2.ts                 # OAuth 2.0 handler (future)
│   └── auth-strategy.ts          # Auth strategy interface
├── crypto/
│   ├── encryption.ts             # AES-256-GCM encryption
│   └── key-management.ts         # Key rotation (future)
└── config/
    ├── config-manager.ts         # Central configuration
    └── account-config.ts         # Account-specific settings
```

**Key Classes**:
- `NetSuiteClient`: Main entry point, orchestrates all operations
- `NetSuiteRESTletClient`: Handles RESTlet requests with OAuth 1.0
- `OAuth1SignatureGenerator`: Generates HMAC-SHA256 signatures
- `CredentialEncryption`: Encrypts/decrypts credentials
- `NetSuiteConfigManager`: Manages configurations with pluggable storage

### Services Module

**Responsibility**: Business logic and domain-specific operations.

```
services/
├── record/
│   ├── record-service.ts         # Generic CRUD operations
│   ├── customer-service.ts       # Customer-specific logic
│   ├── sales-order-service.ts    # Sales order operations
│   └── item-service.ts           # Item operations
├── seo/
│   ├── seo-service.ts            # SEO debugging utilities
│   └── prerender-service.ts      # Prerender.io integration
├── sdf/
│   ├── sdf-service.ts            # SuiteCloud Development Framework
│   └── deployment-service.ts     # SDF deployments
└── suitecommerce/
    ├── sc-service.ts             # SuiteCommerce utilities
    └── extension-service.ts      # Extension management
```

**Key Classes**:
- `RecordService`: Generic CRUD for any NetSuite record type
- `NetSuiteSEOService`: SuiteCommerce SEO debugging tools
- `CustomerService`: Customer-specific operations (future)
- `SDFService`: SuiteCloud deployment operations (future)

### Adapters Module

**Responsibility**: Integration with external systems.

```
adapters/
├── storage/
│   ├── database-adapter.ts       # Database storage (SQLite, etc.)
│   ├── cache-adapter.ts          # Cache integration (Redis, etc.)
│   └── file-adapter.ts           # File-based storage
├── slack/
│   ├── slack-adapter.ts          # Slack bot integration
│   └── commands.ts               # Slack command handlers
└── api/
    ├── rest-adapter.ts           # REST API adapter
    └── graphql-adapter.ts        # GraphQL adapter (future)
```

**Key Classes**:
- `DatabaseStorageAdapter`: Bridges to database layer (e.g., Drizzle ORM)
- `NetSuiteSlackAdapter`: Slack bot integration for `/bm netsuite` commands
- `CacheAdapter`: Caching layer integration (future)

### Plugin System

**Responsibility**: Extensibility and cross-cutting concerns.

```
plugins/
├── plugin-manager.ts             # Lifecycle management
├── plugin-interface.ts           # Plugin contract
└── builtin/
    ├── logger-plugin.ts          # Logging plugin
    ├── metrics-plugin.ts         # Metrics tracking
    └── cache-plugin.ts           # Caching plugin
```

**Key Classes**:
- `NetSuitePluginManager`: Manages plugin lifecycle
- `NetSuitePlugin`: Interface for all plugins
- `BaseNetSuitePlugin`: Abstract base class for plugins

## Data Flow

### 1. Record Fetch Flow

```
User Code
  │
  ▼
RecordService.getRecord('customer', '1233')
  │
  ▼
NetSuiteClient.restlet.get(url, params)
  │
  ▼
PluginManager.executeBeforeRequest(options)
  │
  ▼
OAuth1SignatureGenerator.generateAuthHeader()
  │
  ▼
fetch(url, { headers: { Authorization: oauth } })
  │
  ▼
PluginManager.executeAfterResponse(response)
  │
  ▼
Return { data, status, headers, durationMs }
```

### 2. Configuration Save Flow

```
User Code
  │
  ▼
ConfigManager.saveConfig(projectId, config)
  │
  ▼
Validate configuration
  │
  ▼
CredentialEncryption.encryptOAuth1(credentials)
  │
  ▼
DatabaseStorageAdapter.save(projectId, encrypted)
  │
  ▼
Repository.upsertByProjectId(projectId, data)
  │
  ▼
Database (SQLite)
```

### 3. Slack Command Flow

```
User: /bm netsuite get customer 1233
  │
  ▼
NetSuiteSlackAdapter.registerGetCommand()
  │
  ▼
checkPermission(userId, 'TASK_CREATE')
  │
  ▼
resolveProject(channelId) → project
  │
  ▼
NetSuiteClient.fromProjectId(project.id, configManager)
  │
  ▼
RecordService.getRecord('customer', '1233')
  │
  ▼
Post result to Slack channel
  │
  ▼
logAudit('netsuite:record:fetched', ...)
```

## Error Handling Strategy

### Error Hierarchy

```
Error
  │
  └── NetSuiteError (base)
        ├── NetSuiteAuthError (401, 403)
        ├── NetSuiteAPIError (4xx, 5xx)
        ├── NetSuiteValidationError (400)
        ├── NetSuiteConfigError (config issues)
        ├── NetSuiteTimeoutError (408)
        └── NetSuiteRateLimitError (429)
```

### Error Propagation

```
RESTletClient.request()
  │ (try/catch)
  ├── Network error → NetSuiteAPIError
  ├── Timeout → NetSuiteTimeoutError
  ├── 401/403 → NetSuiteAuthError
  ├── 429 → NetSuiteRateLimitError
  └── Other → NetSuiteAPIError
```

## Security Architecture

### Credential Encryption

```
Plaintext Credentials
  │
  ▼
AES-256-GCM Encryption
  │
  ▼
Encrypted Format: iv:authTag:ciphertext
  │
  ▼
Stored in Database
```

**Key Management**:
- 256-bit key from `NETSUITE_ENCRYPTION_KEY` env var
- 64 hex characters (32 bytes)
- Generate with: `crypto.randomBytes(32).toString('hex')`

### OAuth 1.0 Signature

```
Request Parameters
  │
  ▼
Build Signature Base String
  │
  ▼
HMAC-SHA256(base, consumerSecret&tokenSecret)
  │
  ▼
Base64 Encode
  │
  ▼
Authorization Header
```

## Extensibility Points

### 1. Add New API Client

```typescript
class SuiteQLClient {
  constructor(private readonly config: NetSuiteConfig) {}

  async query(sql: string): Promise<any> {
    // Implementation
  }
}

// Add to NetSuiteClient
class NetSuiteClient {
  public readonly restlet: NetSuiteRESTletClient;
  public readonly suiteql: SuiteQLClient;

  constructor(config: NetSuiteConfig) {
    this.restlet = new NetSuiteRESTletClient(config);
    this.suiteql = new SuiteQLClient(config);
  }
}
```

### 2. Add New Service

```typescript
class CustomerService {
  constructor(private readonly client: NetSuiteClient) {}

  async getCustomer(id: string): Promise<Customer> {
    return this.client.restlet.get(url, { customerId: id });
  }

  async searchByEmail(email: string): Promise<Customer[]> {
    // Implementation
  }
}
```

### 3. Add New Adapter

```typescript
class RedisStorageAdapter implements ConfigStore {
  constructor(private readonly redis: RedisClient) {}

  async save(id: string, config: NetSuiteConfig): Promise<void> {
    await this.redis.set(`netsuite:${id}`, JSON.stringify(config));
  }

  // ... other methods
}
```

### 4. Add New Plugin

```typescript
class MetricsPlugin extends BaseNetSuitePlugin {
  name = 'metrics';
  version = '1.0.0';

  async afterResponse(response: NetSuiteResponse): Promise<NetSuiteResponse> {
    metrics.histogram('netsuite.request.duration', response.durationMs);
    metrics.increment('netsuite.request.total');
    return response;
  }
}
```

## Performance Considerations

### 1. Connection Pooling
- RESTlet client reuses HTTP connections
- Keep-alive enabled by default

### 2. Caching Strategy
- ConfigManager caches loaded configurations
- Plugin system supports cache plugins
- Future: Response caching with TTL

### 3. Retry Logic
- Exponential backoff for failed requests
- Configurable max attempts and delays
- Circuit breaker pattern (future)

### 4. Timeout Management
- Per-request timeout configuration
- Default: 30 seconds
- Override via request options

## Testing Strategy

### Unit Tests
- Mock NetSuiteClient for service tests
- Mock ConfigStore for manager tests
- Mock fetch for client tests

### Integration Tests
- Real NetSuite sandbox account
- Test full OAuth flow
- Verify encryption/decryption

### Contract Tests
- Validate plugin interface
- Verify adapter contracts
- Test error hierarchy

## Best Practices

1. **Always use ConfigManager** for production (not direct config)
2. **Encrypt credentials** before storage
3. **Handle all error types** explicitly
4. **Use TypeScript** for type safety
5. **Implement retry logic** for transient failures
6. **Log all operations** for audit trail
7. **Validate inputs** before API calls
8. **Use plugins** for cross-cutting concerns
9. **Test with sandbox** before production
10. **Monitor performance** with metrics plugins

## Next Steps

- **[Client Usage Guide](./06-client-usage.md)** - Deep dive into client operations
- **[Plugin System](./15-plugin-overview.md)** - Build custom plugins
- **[Security Best Practices](./18-security.md)** - Secure your integration
- **[Performance Optimization](./19-performance.md)** - Optimize for scale

---

[← Back to Documentation](../README.md)
