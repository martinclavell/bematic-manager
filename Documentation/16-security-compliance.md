# Security & Compliance

This document outlines the security model, compliance considerations, and security best practices for the Bematic Manager system.

## Table of Contents

- [Security Model Overview](#security-model-overview)
- [Authentication & Authorization](#authentication--authorization)
- [API Key Management](#api-key-management)
- [File Security Validation](#file-security-validation)
- [WebSocket Security](#websocket-security)
- [Security Headers](#security-headers)
- [Audit Trail & Logging](#audit-trail--logging)
- [Data Protection & Privacy](#data-protection--privacy)
- [Compliance Considerations](#compliance-considerations)
- [Security Best Practices](#security-best-practices)

## Security Model Overview

### Trust Boundaries

The Bematic system operates with multiple trust boundaries:

```ascii
┌─────────────────────────────────────────────────────────────┐
│                         Internet                            │
│  ┌──────────────────┐              ┌──────────────────┐    │
│  │   Slack Client   │──────────────│  Railway Cloud   │    │
│  │                  │   HTTPS/WSS  │                  │    │
│  └──────────────────┘              └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                                               │
                                        Trust Boundary #1
                                               │
┌─────────────────────────────────────────────────────────────┐
│                    Bematic Cloud                            │
│  ┌──────────────────┐              ┌──────────────────┐    │
│  │  Slack Gateway   │──────────────│   WebSocket      │    │
│  │  • Webhook Auth  │     IPC      │   Gateway        │    │
│  │  • Bot Tokens    │              │  • Agent Auth    │    │
│  └──────────────────┘              └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                                               │
                                        Trust Boundary #2
                                               │
┌─────────────────────────────────────────────────────────────┐
│                    Local Agents                             │
│  ┌──────────────────┐              ┌──────────────────┐    │
│  │   Agent Process  │──────────────│  Local File      │    │
│  │  • API Keys      │   File I/O   │  System          │    │
│  │  • WS Client     │              │                  │    │
│  └──────────────────┘              └──────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Security Layers

1. **Network Security** - HTTPS/WSS, CORS, Security Headers
2. **Authentication** - API keys, Bot tokens, Webhook signatures
3. **Authorization** - Role-based access, Channel permissions
4. **Input Validation** - File validation, Message sanitization
5. **Data Protection** - Encryption at rest, Audit logging

## Authentication & Authorization

### Slack Bot Authentication

**Bot Token Validation:**
```typescript
// Slack bot token format: xoxb-*
const SLACK_BOT_TOKEN_PATTERN = /^xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+$/;

function validateSlackToken(token: string): boolean {
  return SLACK_BOT_TOKEN_PATTERN.test(token);
}
```

**Webhook Signature Verification:**
```typescript
import crypto from 'node:crypto';

function verifySlackSignature(
  body: string,
  signature: string,
  timestamp: string,
  signingSecret: string
): boolean {
  // Prevent replay attacks (timestamp must be within 5 minutes)
  const requestTime = parseInt(timestamp) * 1000;
  const now = Date.now();
  if (Math.abs(now - requestTime) > 300000) { // 5 minutes
    return false;
  }

  // Verify signature
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(`v0:${timestamp}:${body}`);
  const expected = `v0=${hmac.digest('hex')}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### Agent API Key Authentication

**Files:**
- `packages/cloud/src/services/api-key.service.ts`
- `packages/db/src/schema/api-keys.ts`

**Key Generation:**
```typescript
export class ApiKeyService {
  private generateSecureKey(): string {
    // Generate cryptographically secure random key
    const bytes = randomBytes(32); // 256-bit key
    return `bm_${bytes.toString('hex')}`;
  }

  generate(input: ApiKeyGenerateInput): ApiKeyRow {
    const key = this.generateSecureKey();
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    return this.apiKeyRepo.create({
      id: generateId('ak'),
      key,
      agentId: input.agentId,
      createdAt: new Date(),
      expiresAt,
      revoked: false
    });
  }
}
```

**Key Validation:**
```typescript
validateKey(key: string): ApiKeyValidationResult {
  const apiKey = this.apiKeyRepo.findByKey(key);

  if (!apiKey) {
    return { isValid: false, reason: 'Key not found' };
  }

  if (apiKey.revoked) {
    this.auditLogRepo.log('api-key:access-denied', 'api_key', apiKey.id, null, {
      reason: 'revoked',
      agentId: apiKey.agentId
    });
    return { isValid: false, reason: 'Key is revoked' };
  }

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return { isValid: false, reason: 'Key is expired' };
  }

  // Update last used timestamp
  this.apiKeyRepo.updateLastUsed(apiKey.id);

  return { isValid: true, apiKey };
}
```

### Permission Model

**Channel-based Authorization:**
```typescript
interface ChannelPermission {
  channelId: string;
  botUserId: string;
  canRead: boolean;
  canWrite: boolean;
  canManageBot: boolean;
}

async function hasPermission(
  userId: string,
  channelId: string,
  action: 'read' | 'write' | 'manage'
): Promise<boolean> {
  // Check if user is in channel
  const channelInfo = await slack.conversations.info({ channel: channelId });
  if (!channelInfo.channel?.is_member) {
    return false;
  }

  // Check admin permissions for management actions
  if (action === 'manage') {
    return isSlackAdmin(userId, channelId);
  }

  return true; // Read/write allowed for channel members
}
```

## API Key Management

### Key Lifecycle

```ascii
┌──────────────┐    ┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│   Generate   │───▶│   Active    │───▶│   Expired    │───▶│   Archived   │
│              │    │             │    │              │    │              │
│ • New Agent  │    │ • In Use    │    │ • Auto Exp   │    │ • Cleanup    │
│ • Manual     │    │ • Validated │    │ • Manual Exp │    │ • Audit Only │
└──────────────┘    └─────────────┘    └──────────────┘    └──────────────┘
                             │
                             ▼
                    ┌──────────────┐
                    │   Revoked    │
                    │              │
                    │ • Compromised│
                    │ • Manual Rev │
                    │ • Policy Viol│
                    └──────────────┘
```

### Key Rotation Workflow

**Automated Rotation:**
```typescript
export class ApiKeyRotationService {
  async rotateKey(agentId: string, userId?: string): Promise<{
    oldKey: string;
    newKey: ApiKeyRow;
  }> {
    const existingKeys = this.apiKeyRepo.findByAgent(agentId);

    // Generate new key
    const newKey = this.apiKeyService.generate({ agentId }, userId);

    // Schedule old key revocation (grace period for agent update)
    setTimeout(() => {
      existingKeys.forEach(key => {
        this.apiKeyService.revokeKey(key.id, userId, 'rotation');
      });
    }, 300000); // 5-minute grace period

    this.auditLogRepo.log('api-key:rotated', 'api_key', newKey.id, userId, {
      agentId,
      oldKeyIds: existingKeys.map(k => k.id),
      gracePeriodMs: 300000
    });

    return {
      oldKey: existingKeys[0]?.key || '',
      newKey
    };
  }
}
```

**Manual Rotation via Admin Commands:**
```typescript
// In admin-commands/api-keys.ts
export const apiKeyCommands = {
  'keys rotate': async (ctx: AdminContext, [agentId]: string[]) => {
    if (!agentId) throw new Error('Agent ID required');

    const result = await ctx.apiKeyService.rotateKey(agentId, ctx.userId);

    return `🔄 Rotated API key for agent: ${agentId}\n` +
           `Old key: ${result.oldKey.substring(0, 8)}...\n` +
           `New key: ${result.newKey.key.substring(0, 8)}...\n` +
           `⏰ Grace period: 5 minutes`;
  }
};
```

### Key Security Best Practices

1. **Never log full API keys** - Always truncate in logs
2. **Use secure random generation** - `crypto.randomBytes()`
3. **Implement expiration** - Default 90-day expiry
4. **Audit all key operations** - Generation, usage, revocation
5. **Secure transmission** - Only over HTTPS/WSS
6. **Environment isolation** - Separate keys per environment

## File Security Validation

**File:** `packages/cloud/src/security/file-validator.ts`

### Multi-Layer Validation

```typescript
export async function validateFileSecurely(
  filename: string,
  declaredMimeType: string,
  buffer: Buffer,
  options: {
    maxSize?: number;
    enableVirusScanning?: boolean;
    strictMode?: boolean;
  } = {}
): Promise<FileValidationResult> {
  // 1. Extension blacklist check
  if (BLOCKED_EXTENSIONS.has(getFileExtension(filename))) {
    return { isValid: false, securityLevel: 'blocked', reason: 'Dangerous extension' };
  }

  // 2. Magic number detection
  const detectedMimeType = detectFileTypeFromMagic(buffer);
  if (detectedMimeType === 'application/x-executable') {
    return { isValid: false, securityLevel: 'blocked', reason: 'Executable file' };
  }

  // 3. MIME type whitelist
  if (!ALLOWED_MIME_TYPES.has(declaredMimeType)) {
    return { isValid: false, securityLevel: 'blocked', reason: 'MIME type not allowed' };
  }

  // 4. MIME consistency check
  if (detectedMimeType && detectedMimeType !== declaredMimeType) {
    // Check for acceptable variations
    const acceptable = isAcceptableMimeVariation(declaredMimeType, detectedMimeType);
    if (!acceptable) {
      return { isValid: false, securityLevel: 'blocked', reason: 'MIME mismatch' };
    }
  }

  // 5. File size limits
  const sizeLimit = getFileSizeLimit(declaredMimeType);
  if (buffer.length > sizeLimit) {
    return { isValid: false, securityLevel: 'blocked', reason: 'Size exceeded' };
  }

  // 6. Content-specific validation
  if (declaredMimeType === 'image/svg+xml') {
    if (containsMaliciousScript(buffer.toString('utf8'))) {
      return { isValid: false, securityLevel: 'blocked', reason: 'SVG contains scripts' };
    }
  }

  return { isValid: true, securityLevel: 'safe' };
}
```

### File Size Limits by Category

```typescript
export const FILE_SIZE_LIMITS = {
  image: 5 * 1024 * 1024,      // 5MB for images
  document: 10 * 1024 * 1024,  // 10MB for documents
  archive: 2 * 1024 * 1024,    // 2MB for archives (security)
  text: 1024 * 1024,           // 1MB for text files
  default: 10 * 1024 * 1024,   // 10MB default
};
```

### Magic Number Detection

```typescript
const MAGIC_NUMBERS: Record<string, Buffer[]> = {
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  'image/jpeg': [
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE1]),
    Buffer.from([0xFF, 0xD8, 0xFF, 0xDB])
  ],
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  'application/x-executable': [
    Buffer.from([0x4D, 0x5A]),        // MZ (Windows PE)
    Buffer.from([0x7F, 0x45, 0x4C, 0x46]), // ELF
    Buffer.from([0xFE, 0xED, 0xFA, 0xCE])  // Mach-O
  ]
};
```

## WebSocket Security

### Secure WebSocket Connection

**Files:**
- `packages/cloud/src/gateway/ws-server.ts`
- `packages/agent/src/connection/ws-client.ts`

**Server-side Security:**
```typescript
import { WebSocketServer } from 'ws';
import https from 'node:https';

const server = https.createServer({
  cert: fs.readFileSync(config.ssl.cert),
  key: fs.readFileSync(config.ssl.key)
});

const wss = new WebSocketServer({
  server,
  verifyClient: (info) => {
    // 1. Check origin
    const origin = info.origin;
    if (!isAllowedOrigin(origin)) {
      logger.warn({ origin }, 'WebSocket origin not allowed');
      return false;
    }

    // 2. Rate limiting
    const clientIP = info.req.socket.remoteAddress;
    if (rateLimiter.isRateLimited(clientIP)) {
      logger.warn({ clientIP }, 'WebSocket rate limited');
      return false;
    }

    return true;
  }
});
```

**Authentication Flow:**
```typescript
wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `wss://${req.headers.host}`);
  const apiKey = url.searchParams.get('api_key');

  if (!apiKey) {
    ws.close(1008, 'API key required');
    return;
  }

  const validation = apiKeyService.validateKey(apiKey);
  if (!validation.isValid) {
    logger.warn({
      reason: validation.reason,
      ip: req.socket.remoteAddress
    }, 'WebSocket authentication failed');

    ws.close(1008, 'Authentication failed');
    return;
  }

  // Store agent context
  ws.agentId = validation.apiKey!.agentId;
  ws.authenticated = true;

  logger.info({ agentId: ws.agentId }, 'Agent connected via WebSocket');
});
```

### Message Validation

```typescript
ws.on('message', async (data) => {
  if (!ws.authenticated) {
    ws.close(1008, 'Not authenticated');
    return;
  }

  try {
    const message = parseMessage(data.toString());

    // Validate message schema
    if (!isValidMessage(message)) {
      logger.warn({
        agentId: ws.agentId,
        messageType: message.type
      }, 'Invalid message format');
      return;
    }

    await messageRouter.handleAgentMessage(ws.agentId, data.toString());

  } catch (error) {
    logger.error({
      agentId: ws.agentId,
      error: error.message
    }, 'Message processing error');
  }
});
```

## Security Headers

**File:** `packages/cloud/src/middleware/security-headers.ts`

### HTTP Security Headers

```typescript
export function setSecurityHeaders(res: ServerResponse, options: SecurityHeadersOptions) {
  // HTTP Strict Transport Security (HSTS)
  if (options.enableHsts) {
    res.setHeader('Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload');
  }

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // XSS Protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy
  res.setHeader('Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=()');

  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // Slack integrations may need inline
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' wss: ws:",
    "object-src 'none'",
    "base-uri 'none'"
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  // Remove server info
  res.removeHeader('Server');
  res.removeHeader('X-Powered-By');
}
```

### CORS Configuration

```typescript
function handleCors(req: IncomingMessage, res: ServerResponse, options: SecurityHeadersOptions) {
  const origin = req.headers.origin;

  if (origin) {
    const isAllowedOrigin = options.allowedOrigins.some(allowed => {
      if (allowed.includes('*')) {
        const pattern = allowed.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(origin);
      }
      return allowed === origin;
    });

    if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else {
      logger.warn({ origin, allowedOrigins: options.allowedOrigins }, 'CORS origin blocked');
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-API-Key, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
}
```

## Audit Trail & Logging

**File:** `packages/db/src/repositories/audit-log.repository.ts`

### Audit Log Structure

```typescript
export interface AuditLogEntry {
  id: string;
  action: string;           // api-key:generated, task:completed, etc.
  resourceType: string;     // api_key, task, user, etc.
  resourceId: string;       // ID of affected resource
  userId?: string;          // Who performed the action
  metadata: Record<string, unknown>; // Action-specific data
  ipAddress?: string;       // Source IP
  userAgent?: string;       // Client info
  createdAt: Date;
}
```

### Security Event Logging

```typescript
export class AuditLogRepository {
  async logSecurityEvent(
    event: string,
    resourceId: string,
    context: {
      userId?: string;
      agentId?: string;
      ip?: string;
      userAgent?: string;
      reason?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
    }
  ): Promise<void> {
    await this.log(`security:${event}`, 'security', resourceId, context.userId, {
      ...context,
      timestamp: new Date().toISOString(),
      severity: context.severity || 'medium'
    });

    // High/Critical security events trigger alerts
    if (['high', 'critical'].includes(context.severity || '')) {
      await this.alertingService.sendSecurityAlert({
        event,
        resourceId,
        context,
        timestamp: new Date()
      });
    }
  }
}
```

### Security Audit Queries

```typescript
// Find suspicious activity patterns
async function findSuspiciousActivity(timeframe: { start: Date; end: Date }) {
  return await db
    .select()
    .from(auditLogs)
    .where(and(
      like(auditLogs.action, 'security:%'),
      gte(auditLogs.createdAt, timeframe.start),
      lte(auditLogs.createdAt, timeframe.end)
    ))
    .orderBy(desc(auditLogs.createdAt));
}

// API key abuse detection
async function detectApiKeyAbuse(agentId: string): Promise<boolean> {
  const recentFailures = await db
    .select({ count: count() })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.action, 'api-key:access-denied'),
      like(auditLogs.metadata, `%"agentId":"${agentId}"%`),
      gte(auditLogs.createdAt, new Date(Date.now() - 3600000)) // 1 hour
    ));

  return (recentFailures[0]?.count || 0) > 10; // More than 10 failures per hour
}
```

## Data Protection & Privacy

### Encryption at Rest

**Database Configuration:**
```typescript
// SQLite encryption (when using SQLCipher)
const db = drizzle(new Database(dbPath, {
  key: process.env.DB_ENCRYPTION_KEY, // 256-bit key
  cipher: 'aes-256-gcm'
}));
```

### Data Minimization

**Retention Policies:**
```typescript
export class RetentionService {
  async cleanupExpiredData(): Promise<void> {
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days

    // Clean up completed tasks
    await this.taskRepo.deleteCompleted(cutoffDate);

    // Clean up expired API keys
    await this.apiKeyRepo.deleteExpired(cutoffDate);

    // Clean up old audit logs (keep security events longer)
    await this.auditLogRepo.deleteOld(cutoffDate, {
      keepSecurityEvents: true,
      securityRetentionDays: 365
    });

    logger.info({ cutoffDate }, 'Data retention cleanup completed');
  }
}
```

### PII Handling

```typescript
interface PersonalData {
  userId: string;
  email?: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

// GDPR-compliant data deletion
export class PrivacyService {
  async deleteUserData(userId: string, reason: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Delete user data
      await tx.delete(users).where(eq(users.id, userId));

      // Anonymize audit logs (keep for compliance but remove PII)
      await tx.update(auditLogs)
        .set({
          userId: null,
          metadata: sql`json_remove(metadata, '$.email', '$.name')`
        })
        .where(eq(auditLogs.userId, userId));

      // Archive/anonymize task data
      await tx.update(tasks)
        .set({ userId: null })
        .where(eq(tasks.userId, userId));
    });

    this.auditLogRepo.log('privacy:data-deleted', 'user', userId, null, {
      reason,
      deletedAt: new Date().toISOString()
    });
  }
}
```

## Compliance Considerations

### GDPR Compliance

**Data Processing Lawfulness:**
- **Consent:** User explicitly consents to bot interactions
- **Legitimate Interest:** System operations and security monitoring
- **Contract Performance:** Service delivery as requested

**Data Subject Rights:**
```typescript
export class GDPRService {
  // Right to Access (Article 15)
  async exportUserData(userId: string): Promise<UserDataExport> {
    const user = await this.userRepo.findById(userId);
    const tasks = await this.taskRepo.findByUser(userId);
    const auditLogs = await this.auditLogRepo.findByUser(userId);

    return {
      personal: user,
      tasks: tasks.map(t => ({ ...t, content: '[REDACTED]' })), // Redact sensitive content
      auditTrail: auditLogs,
      exportedAt: new Date().toISOString()
    };
  }

  // Right to Rectification (Article 16)
  async updateUserData(userId: string, updates: Partial<UserData>): Promise<void> {
    await this.userRepo.update(userId, updates);

    this.auditLogRepo.log('privacy:data-updated', 'user', userId, userId, {
      updatedFields: Object.keys(updates),
      updatedAt: new Date().toISOString()
    });
  }

  // Right to Erasure (Article 17)
  async deleteUserData(userId: string): Promise<void> {
    await this.privacyService.deleteUserData(userId, 'user-request');
  }
}
```

### SOC 2 Compliance Considerations

**Security Controls:**
- Access controls and authentication
- Data encryption and protection
- Audit logging and monitoring
- Incident response procedures
- Vendor management (Slack, Railway, etc.)

**Availability Controls:**
- Redundancy and failover
- Monitoring and alerting
- Backup and recovery
- Capacity planning

## Security Best Practices

### Deployment Security

**Railway Configuration:**
```yaml
# railway.toml
[build]
builder = "DOCKERFILE"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "ON_FAILURE"

[variables]
NODE_ENV = "production"
# Never store secrets in railway.toml
# Use Railway's secret management instead
```

**Environment Variables Security:**
```bash
# Production secrets (set via Railway dashboard)
DATABASE_URL="postgresql://..."           # Encrypted connection string
SLACK_SIGNING_SECRET="..."               # Webhook verification
OPENAI_API_KEY="sk-..."                  # Claude API key
DB_ENCRYPTION_KEY="..."                  # Database encryption key

# Development (.env.example)
DATABASE_URL="file:./dev.db"            # Local SQLite
SLACK_SIGNING_SECRET="dev-secret"        # Development webhook
OPENAI_API_KEY="sk-dev-..."             # Development API key
```

### Code Security

**Input Sanitization:**
```typescript
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const purify = DOMPurify(window);

function sanitizeHtmlContent(html: string): string {
  return purify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre'],
    ALLOWED_ATTR: []
  });
}
```

**SQL Injection Prevention:**
```typescript
// Always use parameterized queries with Drizzle ORM
const tasks = await db
  .select()
  .from(tasksTable)
  .where(and(
    eq(tasksTable.userId, userId),           // Parameterized
    eq(tasksTable.status, status)            // Parameterized
  ));

// NEVER do this:
// const query = `SELECT * FROM tasks WHERE user_id = '${userId}'`; // Vulnerable!
```

### Monitoring & Alerting

**Security Monitoring:**
```typescript
export class SecurityMonitor {
  async checkSecurityMetrics(): Promise<SecurityReport> {
    const metrics = {
      // API key security
      expiredKeys: await this.apiKeyRepo.countExpired(),
      revokedKeys: await this.apiKeyRepo.countRevoked(),
      keyUsageViolations: await this.detectKeyAbuse(),

      // Authentication failures
      authFailures: await this.auditLogRepo.countRecentFailures(),
      rateLimitViolations: await this.rateLimiter.getViolations(),

      // File security
      blockedFiles: await this.auditLogRepo.countBlockedFiles(),
      suspiciousUploads: await this.detectSuspiciousUploads(),

      // System health
      unhealthyAgents: this.agentHealthTracker.getUnhealthyAgents().length,
      circuitBreakersOpen: await this.countOpenCircuitBreakers()
    };

    // Trigger alerts for concerning metrics
    if (metrics.authFailures > 100) {
      await this.alertingService.sendAlert('high-auth-failures', metrics);
    }

    return { timestamp: new Date(), metrics };
  }
}
```

### Incident Response

**Security Incident Workflow:**

1. **Detection** - Automated alerts, manual reporting
2. **Assessment** - Severity classification, impact analysis
3. **Containment** - Revoke compromised keys, block IPs
4. **Investigation** - Audit log analysis, root cause
5. **Recovery** - System restoration, key rotation
6. **Documentation** - Incident report, lessons learned

**Example Incident Response:**
```typescript
export class IncidentResponse {
  async handleSecurityIncident(incident: SecurityIncident): Promise<void> {
    // 1. Log the incident
    await this.auditLogRepo.logSecurityEvent('incident:detected', incident.id, {
      severity: incident.severity,
      type: incident.type,
      description: incident.description
    });

    // 2. Immediate containment
    if (incident.compromisedApiKeys) {
      await Promise.all(
        incident.compromisedApiKeys.map(keyId =>
          this.apiKeyService.revokeKey(keyId, 'system', 'security-incident')
        )
      );
    }

    // 3. Notify stakeholders
    await this.notificationService.sendIncidentAlert(incident);

    // 4. Start investigation
    await this.startInvestigation(incident);

    logger.error({
      incidentId: incident.id,
      severity: incident.severity,
      type: incident.type
    }, 'Security incident response initiated');
  }
}
```

## Related Documentation

- [06 - Package: @bematic/cloud](./06-package-cloud.md) - Cloud service security
- [09 - WebSocket Protocol](./09-websocket-protocol.md) - Secure communication
- [11 - Environment Variables](./11-environment-variables.md) - Secure configuration
- [15 - Advanced Patterns](./15-advanced-patterns.md) - Security patterns
- [17 - Operations & Troubleshooting](./17-operations-troubleshooting.md) - Security monitoring