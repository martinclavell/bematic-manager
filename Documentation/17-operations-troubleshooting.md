# Operations & Troubleshooting

This document provides operational procedures, debugging guides, and troubleshooting workflows for the Bematic Manager system.

## Table of Contents

- [System Overview](#system-overview)
- [Health Monitoring](#health-monitoring)
- [Common Issues](#common-issues)
- [Debugging Procedures](#debugging-procedures)
- [Performance Tuning](#performance-tuning)
- [Database Maintenance](#database-maintenance)
- [Agent Management](#agent-management)
- [WebSocket Issues](#websocket-issues)
- [Slack Integration Problems](#slack-integration-problems)
- [Railway Deployment](#railway-deployment)
- [Alerting & Monitoring Setup](#alerting--monitoring-setup)

## System Overview

### Architecture Health Check Points

```ascii
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Slack API     │───▶│  Bematic Cloud  │───▶│  Local Agents   │
│                 │    │                 │    │                 │
│ Health: /health │    │ Health: /health │    │ Health: WS ping │
│ Rate Limits     │    │ Circuit Breaker │    │ Process Status  │
│ Webhook Valid   │    │ DB Connection   │    │ File Access     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Slack Status    │    │ Railway Status  │    │ Agent Logs      │
│ API Response    │    │ Deployment      │    │ Task Execution  │
│ Network Issues  │    │ Resource Usage  │    │ Error Handling  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Key System Components

1. **Slack Integration** - Webhook processing, message sending
2. **WebSocket Gateway** - Real-time agent communication
3. **Task Management** - Queue processing, state management
4. **Database Layer** - SQLite/PostgreSQL operations
5. **Agent Health Tracking** - Circuit breaker pattern
6. **File Security** - Upload validation, virus scanning
7. **Audit Logging** - Security and operational events

## Health Monitoring

### Built-in Health Checks

**Admin Command:** `bm health`

**File:** `packages/cloud/src/services/health.service.ts`

```typescript
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    database: { status: 'up' | 'down'; message?: string };
    agents: { status: 'up' | 'degraded' | 'down'; connected: number; unhealthy: number };
    slack: { status: 'up' | 'degraded' | 'down'; failedMessages: number };
  };
  metrics: {
    tasks: { active: number; totalCompleted: number; totalFailed: number };
    agents: { connected: number; totalProjects: number };
    performance: { avgTaskDurationMs?: number; avgSlackLatencyMs?: number };
  };
}
```

### Health Check Endpoints

**Railway Health Endpoint:** `GET /health`
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00Z",
  "uptime": 3600000,
  "components": {
    "database": { "status": "up" },
    "agents": { "status": "up", "connected": 3, "unhealthy": 0 },
    "slack": { "status": "up", "failedMessages": 0 }
  }
}
```

### Metrics Collection

**Admin Command:** `bm metrics`

**File:** `packages/cloud/src/utils/metrics.ts`

```typescript
// Key metrics to monitor
const CRITICAL_METRICS = {
  // Task metrics
  'tasks.submitted': 'counter',
  'tasks.completed': 'counter',
  'tasks.failed': 'counter',
  'tasks.cancelled': 'counter',
  'tasks.active': 'gauge',

  // Performance metrics
  'task.duration': 'histogram',
  'task.tokens': 'histogram',
  'task.cost': 'histogram',

  // Agent metrics
  'agents.connected': 'gauge',
  'agents.unhealthy': 'gauge',

  // System metrics
  'memory.progress_trackers': 'gauge',
  'memory.deploy_requests': 'gauge',
  'websocket.connections': 'gauge'
};
```

### Monitoring Dashboards

**Basic Metrics Query:**
```typescript
// Get current system metrics
const metrics = await healthService.getHealth();

// Key indicators to monitor:
const healthIndicators = {
  taskSuccessRate: (metrics.tasks.totalCompleted / metrics.tasks.totalSubmitted) * 100,
  averageTaskDuration: metrics.performance.avgTaskDurationMs,
  agentHealthPercentage: ((metrics.agents.connected - metrics.agents.unhealthy) / metrics.agents.connected) * 100,
  systemUptime: metrics.uptime,
  errorRate: (metrics.tasks.totalFailed / metrics.tasks.totalSubmitted) * 100
};
```

## Common Issues

### 1. Tasks Stuck in "Processing" State

**Symptoms:**
- Tasks remain in "processing" status indefinitely
- No progress updates received
- Agent appears connected but unresponsive

**Investigation:**
```bash
# Check agent connection status
bm agents list

# Check specific agent health
bm health

# Check task queue
bm tasks list --status=processing

# Check agent logs
tail -f ~/.bematic/agent.log
```

**Root Causes & Solutions:**

**Agent Process Crashed:**
```bash
# Check if agent is running
ps aux | grep bematic-agent

# Restart agent
bematic-agent start

# Check for core dumps or crash logs
ls -la /tmp/core* ~/.bematic/crashes/
```

**Network Connectivity Issues:**
```bash
# Test WebSocket connection
bm agent test-connection

# Check firewall/proxy settings
curl -I https://your-bematic-cloud.railway.app/health
```

**Circuit Breaker Triggered:**
```bash
# Check circuit breaker status
bm agents health

# Reset circuit breaker if appropriate
bm agents reset-health <agent-id>
```

### 2. High Task Failure Rate

**Symptoms:**
- Multiple tasks failing with similar errors
- Circuit breakers opening frequently
- Poor success rate in metrics

**Investigation Process:**

1. **Check Error Patterns:**
```bash
# Review recent failures
bm logs --filter="task:failed" --limit=50

# Look for common error messages
grep "Task failed" ~/.bematic/cloud.log | tail -20
```

2. **Analyze Failure Types:**
```typescript
// Common failure categories
const failureAnalysis = {
  authentication: /API key|auth|unauthorized/i,
  timeout: /timeout|timed out|deadline/i,
  resources: /memory|disk space|resource/i,
  network: /connection|network|unreachable/i,
  validation: /invalid|malformed|schema/i,
  business: /not found|permission|access/i
};
```

3. **Circuit Breaker Analysis:**
```bash
# Check which agents are unhealthy
bm agents health --unhealthy-only

# Review circuit breaker history
bm logs --filter="circuit-breaker" --since="1h"
```

### 3. Memory Leaks

**Symptoms:**
- Steadily increasing memory usage
- Railway container restarts
- Performance degradation over time

**Investigation:**

**Memory Monitoring:**
```typescript
// Built-in memory tracking (message-router.ts)
const memoryStats = messageRouter.getMemoryStats();
console.log('Progress Trackers:', memoryStats.progressTrackers);
console.log('Deploy Requests:', memoryStats.deployRequests);

// Check for memory leaks in collections
const suspiciousGrowth = {
  progressTrackersGrowth: memoryStats.progressTrackers.count > 1000,
  deployRequestsGrowth: memoryStats.deployRequests.count > 1000,
};
```

**Memory Cleanup Verification:**
```bash
# Check memory cleanup logs
grep "Memory cleanup" ~/.bematic/cloud.log

# Monitor memory usage trends
bm metrics | grep -E "(memory|heap)"
```

### 4. Database Issues

**Symptoms:**
- "Database connection failed" errors
- Slow query performance
- Data inconsistencies

**Investigation:**

**Connection Issues:**
```typescript
// Test database connectivity
try {
  const testResult = await db.select().from(tasks).limit(1);
  console.log('Database connectivity: OK');
} catch (error) {
  console.error('Database error:', error.message);
}
```

**Performance Analysis:**
```sql
-- Check for slow queries (if using PostgreSQL)
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- For SQLite, use EXPLAIN QUERY PLAN
EXPLAIN QUERY PLAN
SELECT * FROM tasks
WHERE agent_id = ? AND status = 'processing';
```

## Debugging Procedures

### 1. End-to-End Task Flow Debugging

**Step-by-Step Debugging:**

```typescript
// 1. Verify task creation
const task = taskRepo.findById(taskId);
console.log('Task status:', task?.status);
console.log('Created at:', task?.createdAt);

// 2. Check agent assignment
const agent = agentManager.getAgent(task.agentId);
console.log('Agent connected:', agent?.isConnected);

// 3. Verify message dispatch
const messagesSent = auditLogRepo.findByAction('message:sent', taskId);
console.log('Messages sent to agent:', messagesSent.length);

// 4. Check agent response
const messagesReceived = auditLogRepo.findByAction('message:received', taskId);
console.log('Responses from agent:', messagesReceived.length);

// 5. Verify task completion
const taskComplete = auditLogRepo.findByAction('task:completed', taskId);
console.log('Task completed:', !!taskComplete);
```

### 2. WebSocket Connection Debugging

**Connection State Analysis:**
```typescript
// Check WebSocket connections
const wsConnections = agentManager.getConnectionStats();
console.log('Total connections:', wsConnections.total);
console.log('Authenticated connections:', wsConnections.authenticated);
console.log('Idle connections:', wsConnections.idle);

// Check specific agent connection
const agentConnection = agentManager.getAgentConnection(agentId);
if (agentConnection) {
  console.log('Connection state:', agentConnection.readyState);
  console.log('Last ping:', agentConnection.lastPing);
  console.log('Message queue size:', agentConnection.messageQueueSize);
}
```

**Message Flow Tracing:**
```typescript
// Enable detailed WebSocket logging
process.env.LOG_LEVEL = 'debug';

// Trace message flow
const messageTrace = {
  sent: auditLogRepo.findByAction('ws:message:sent', agentId),
  received: auditLogRepo.findByAction('ws:message:received', agentId),
  errors: auditLogRepo.findByAction('ws:error', agentId)
};
```

### 3. Slack Integration Debugging

**Webhook Verification:**
```typescript
// Test webhook signature validation
const isValidWebhook = verifySlackSignature(
  requestBody,
  slackSignature,
  timestamp,
  signingSecret
);

if (!isValidWebhook) {
  console.error('Invalid Slack webhook signature');
  // Check signing secret configuration
}
```

**Message Delivery Issues:**
```typescript
// Check Slack API responses
const slackResponse = await slack.chat.postMessage({
  channel: channelId,
  text: message
});

if (!slackResponse.ok) {
  console.error('Slack API error:', slackResponse.error);

  // Common Slack errors and solutions:
  const slackErrors = {
    'channel_not_found': 'Bot not added to channel',
    'not_authed': 'Invalid bot token',
    'rate_limited': 'Hit Slack rate limits',
    'msg_too_long': 'Message exceeds 4000 characters'
  };
}
```

### 4. Performance Debugging

**Slow Task Analysis:**
```typescript
// Identify slow tasks
const slowTasks = taskRepo.findByDuration({
  minDurationMs: 30000, // Tasks taking > 30 seconds
  limit: 20
});

slowTasks.forEach(task => {
  console.log(`Task ${task.id}: ${task.durationMs}ms`);
  console.log('Command:', task.command);
  console.log('Bot:', task.botName);
  console.log('Agent:', task.agentId);
});
```

**Resource Usage Analysis:**
```typescript
// Monitor key performance metrics
const performanceMetrics = {
  avgTaskDuration: metrics.getHistogram('task.duration').avg,
  p95TaskDuration: metrics.getHistogram('task.duration').p95,
  taskThroughput: metrics.getCounter('tasks.completed') / uptimeHours,
  memoryUsage: process.memoryUsage(),
  cpuUsage: process.cpuUsage()
};
```

## Performance Tuning

### 1. Database Optimization

**Index Optimization:**
```sql
-- Essential indexes for performance
CREATE INDEX CONCURRENTLY idx_tasks_agent_status
ON tasks(agent_id, status)
WHERE status IN ('pending', 'processing');

CREATE INDEX CONCURRENTLY idx_tasks_created_status
ON tasks(created_at, status);

CREATE INDEX CONCURRENTLY idx_audit_logs_action_resource
ON audit_logs(action, resource_type, resource_id);

-- Monitor index usage (PostgreSQL)
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

**Query Optimization:**
```typescript
// Use proper pagination for large datasets
const paginatedTasks = await db
  .select()
  .from(tasks)
  .where(gt(tasks.createdAt, cursor))
  .orderBy(tasks.createdAt)
  .limit(50);

// Batch operations for efficiency
const batchSize = 100;
for (let i = 0; i < updates.length; i += batchSize) {
  const batch = updates.slice(i, i + batchSize);
  await db.transaction(async (tx) => {
    await Promise.all(
      batch.map(update => tx.update(tasks).set(update.data).where(eq(tasks.id, update.id)))
    );
  });
}
```

### 2. Memory Management

**Connection Pooling:**
```typescript
// Optimize database connection pool
const dbConfig = {
  max: 20,              // Maximum connections
  min: 5,               // Minimum connections
  idle: 30000,          // Idle timeout (30s)
  acquire: 60000,       // Acquire timeout (60s)
  evict: 1000          // Eviction check interval (1s)
};
```

**Memory Cleanup Configuration:**
```typescript
// Tune memory cleanup (message-router.ts)
const memoryConfig = {
  maxProgressTrackers: 1000,     // Max progress trackers
  maxDeployRequests: 1000,       // Max deploy requests
  progressTrackerTtlMs: 3600000, // 1 hour TTL
  deployRequestTtlMs: 3600000,   // 1 hour TTL
  cleanupIntervalMs: 300000      // 5 minute cleanup
};
```

### 3. WebSocket Optimization

**Connection Management:**
```typescript
// Optimize WebSocket server
const wsConfig = {
  maxConnections: 1000,
  pingInterval: 30000,      // 30s ping interval
  pongTimeout: 5000,        // 5s pong timeout
  messageQueueLimit: 100,   // Max queued messages per connection
  maxPayloadLength: 1024 * 1024 // 1MB max message size
};
```

**Rate Limiting:**
```typescript
// Implement rate limiting
const rateLimitConfig = {
  windowMs: 60000,        // 1 minute window
  maxRequests: 100,       // Max 100 requests per minute per IP
  skipSuccessfulRequests: false,
  skipFailedRequests: false
};
```

## Database Maintenance

### 1. Regular Maintenance Tasks

**Automated Cleanup Script:**
```typescript
// packages/cloud/src/services/maintenance.service.ts
export class MaintenanceService {
  async performDailyMaintenance(): Promise<void> {
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days

    // Clean up completed tasks
    const deletedTasks = await this.taskRepo.deleteCompleted(cutoffDate);

    // Clean up expired API keys
    const deletedKeys = await this.apiKeyRepo.deleteExpired();

    // Clean up old audit logs (except security events)
    const deletedLogs = await this.auditLogRepo.deleteOld(cutoffDate, {
      keepSecurityEvents: true
    });

    // Vacuum database (SQLite)
    await this.db.run('VACUUM');

    logger.info({
      deletedTasks,
      deletedKeys,
      deletedLogs
    }, 'Daily maintenance completed');
  }
}
```

### 2. Database Health Checks

**Integrity Verification:**
```sql
-- SQLite integrity check
PRAGMA integrity_check;

-- Check for orphaned records
SELECT COUNT(*) as orphaned_tasks
FROM tasks t
LEFT JOIN projects p ON t.project_id = p.id
WHERE p.id IS NULL;

-- Check for duplicate API keys
SELECT key, COUNT(*) as duplicates
FROM api_keys
GROUP BY key
HAVING COUNT(*) > 1;
```

**Size Monitoring:**
```typescript
// Monitor database size growth
const dbStats = {
  tasks: await db.select({ count: count() }).from(tasks),
  auditLogs: await db.select({ count: count() }).from(auditLogs),
  apiKeys: await db.select({ count: count() }).from(apiKeys),
  projects: await db.select({ count: count() }).from(projects)
};

// Alert if growth is unusual
if (dbStats.tasks.count > 100000) {
  await alertingService.sendAlert('database-size-warning', dbStats);
}
```

## Agent Management

### 1. Agent Health Monitoring

**Health Check Commands:**
```bash
# List all agents with health status
bm agents list

# Check specific agent health
bm agents health <agent-id>

# Reset unhealthy agent
bm agents reset-health <agent-id>

# Remove disconnected agent
bm agents remove <agent-id>
```

**Circuit Breaker Management:**
```typescript
// Check circuit breaker status
const agentHealth = agentHealthTracker.getAgentHealth(agentId);
console.log('Circuit state:', agentHealth.circuitState);
console.log('Failure rate:', agentHealth.failureRate);
console.log('Last state change:', agentHealth.lastStateChange);

// Manually reset circuit breaker
if (agentHealth.circuitState === 'open') {
  agentHealthTracker.resetAgent(agentId);
  console.log('Circuit breaker reset for agent:', agentId);
}
```

### 2. Agent Deployment Issues

**Connection Problems:**
```typescript
// Diagnose connection issues
const connectionDiagnostics = {
  // Check API key validity
  apiKeyValid: await apiKeyService.validateKey(apiKey),

  // Check network connectivity
  networkReachable: await testNetworkConnection(cloudUrl),

  // Check WebSocket endpoint
  wsEndpointAccessible: await testWebSocketConnection(wsUrl),

  // Check firewall/proxy
  proxyConfigured: !!process.env.HTTP_PROXY,
};
```

**Configuration Validation:**
```typescript
// Validate agent configuration
const configValidation = {
  apiKeyPresent: !!config.apiKey,
  apiKeyFormat: /^bm_[a-f0-9]{64}$/.test(config.apiKey),
  cloudUrlValid: /^https:\/\//.test(config.cloudUrl),
  projectPathExists: fs.existsSync(config.projectPath),
  permissionsOk: await checkFilePermissions(config.projectPath)
};
```

## WebSocket Issues

### 1. Connection Problems

**Debugging Connection Failures:**
```typescript
// WebSocket connection state debugging
ws.on('error', (error) => {
  console.error('WebSocket error:', error.message);

  const errorTypes = {
    'ECONNREFUSED': 'Server not running or firewall blocking',
    'ENOTFOUND': 'DNS resolution failed',
    'ETIMEDOUT': 'Connection timeout - check network/proxy',
    'CERT_ERROR': 'SSL certificate issue',
    'AUTH_FAILED': 'Invalid API key or authentication failure'
  };

  console.log('Likely cause:', errorTypes[error.code] || 'Unknown');
});

ws.on('close', (code, reason) => {
  const closeCodes = {
    1000: 'Normal closure',
    1001: 'Going away',
    1002: 'Protocol error',
    1003: 'Unsupported data',
    1006: 'Abnormal closure (no close frame)',
    1008: 'Policy violation',
    1011: 'Server error'
  };

  console.log(`Connection closed: ${closeCodes[code]} (${code})`);
  console.log('Reason:', reason.toString());
});
```

### 2. Message Delivery Issues

**Message Queue Monitoring:**
```typescript
// Check message queue status
const queueStats = {
  outboundQueue: ws.messageQueue?.length || 0,
  inboundProcessed: ws.messagesProcessed || 0,
  lastMessageTime: ws.lastMessageTime || null,
  connectionLatency: Date.now() - (ws.lastPongTime || Date.now())
};

// Detect stuck messages
if (queueStats.outboundQueue > 10) {
  console.warn('Large outbound queue detected:', queueStats.outboundQueue);
}

if (queueStats.connectionLatency > 5000) {
  console.warn('High connection latency:', queueStats.connectionLatency, 'ms');
}
```

## Slack Integration Problems

### 1. Authentication Issues

**Bot Token Verification:**
```typescript
// Test bot token validity
try {
  const authTest = await slack.auth.test();
  console.log('Bot authenticated as:', authTest.user);
  console.log('Team:', authTest.team);
} catch (error) {
  console.error('Bot authentication failed:', error.message);

  const authErrors = {
    'not_authed': 'Invalid token',
    'account_inactive': 'Bot token deactivated',
    'token_revoked': 'Token was revoked',
    'no_permission': 'Insufficient bot permissions'
  };

  console.log('Fix:', authErrors[error.data?.error] || 'Check bot token configuration');
}
```

### 2. Permission Issues

**Bot Permission Audit:**
```typescript
// Check bot permissions in channel
const botInfo = await slack.bots.info({ bot: botUserId });
const channelInfo = await slack.conversations.info({ channel: channelId });

const permissionChecks = {
  botInChannel: channelInfo.channel?.is_member,
  canPostMessages: botInfo.bot?.app_id ? true : false,
  canReadHistory: channelInfo.channel?.is_member,
  canUploadFiles: true, // Usually allowed if bot is in channel
  canAddReactions: true  // Usually allowed if bot is in channel
};

console.log('Permission audit:', permissionChecks);
```

### 3. Rate Limiting

**Rate Limit Handling:**
```typescript
// Handle Slack rate limits
slack.on('rate_limited', (retryAfter) => {
  console.log(`Rate limited. Retry after ${retryAfter} seconds`);

  // Implement exponential backoff
  setTimeout(() => {
    console.log('Retrying after rate limit...');
  }, retryAfter * 1000);
});

// Monitor rate limit status
const rateLimitStatus = {
  tier: slack.rtm?.tier || 'unknown',
  remaining: slack.rtm?.rateLimitRemaining || 0,
  resetTime: slack.rtm?.rateLimitReset || null
};
```

## Railway Deployment

### 1. Deployment Issues

**Common Railway Problems:**
```bash
# Check deployment status
railway status

# View deployment logs
railway logs --tail

# Check environment variables
railway variables

# Restart service
railway restart
```

**Resource Monitoring:**
```bash
# Check resource usage
railway metrics

# Common resource issues:
# - Memory usage > 512MB (upgrade plan or optimize)
# - CPU usage consistently high
# - Disk space running low
# - Too many concurrent connections
```

### 2. Environment Configuration

**Production Environment Checklist:**
```typescript
const productionChecklist = {
  // Required environment variables
  DATABASE_URL: !!process.env.DATABASE_URL,
  SLACK_SIGNING_SECRET: !!process.env.SLACK_SIGNING_SECRET,
  SLACK_BOT_TOKEN: !!process.env.SLACK_BOT_TOKEN,
  OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,

  // Optional but recommended
  NODE_ENV: process.env.NODE_ENV === 'production',
  LOG_LEVEL: !!process.env.LOG_LEVEL,

  // SSL configuration
  SSL_CERT: !!process.env.SSL_CERT_PATH,
  SSL_KEY: !!process.env.SSL_KEY_PATH,

  // Security
  DB_ENCRYPTION_KEY: !!process.env.DB_ENCRYPTION_KEY
};

// Validate configuration on startup
const missingConfig = Object.entries(productionChecklist)
  .filter(([key, present]) => !present)
  .map(([key]) => key);

if (missingConfig.length > 0) {
  console.error('Missing configuration:', missingConfig);
  process.exit(1);
}
```

## Alerting & Monitoring Setup

### 1. Critical Alerts

**Alert Thresholds:**
```typescript
const alertThresholds = {
  // System health
  healthCheckFailed: 1,          // Alert immediately
  databaseConnectionFailed: 1,   // Alert immediately

  // Performance
  taskFailureRate: 0.1,          // >10% failure rate
  avgTaskDuration: 60000,        // >60 second average
  memoryUsage: 0.8,              // >80% memory usage

  // Agent health
  unhealthyAgentPercentage: 0.3, // >30% agents unhealthy
  agentDisconnectRate: 0.2,      // >20% disconnect rate

  // Slack integration
  slackApiErrorRate: 0.05,       // >5% Slack API errors
  webhookFailureRate: 0.02       // >2% webhook failures
};
```

### 2. Monitoring Dashboard

**Key Metrics to Display:**
```typescript
const dashboardMetrics = {
  // Real-time status
  systemStatus: 'healthy | degraded | unhealthy',
  activeAgents: 'number',
  activeTasks: 'number',
  queuedTasks: 'number',

  // Performance
  avgTaskDuration: 'milliseconds',
  taskThroughput: 'tasks/hour',
  successRate: 'percentage',

  // Resource usage
  memoryUsage: 'MB',
  cpuUsage: 'percentage',
  databaseConnections: 'number',

  // Recent activity
  tasksLast24h: 'number',
  errorsLast24h: 'number',
  agentConnections: 'number'
};
```

### 3. Log Analysis

**Log Aggregation Setup:**
```typescript
// Structured logging for analysis
const logAnalysis = {
  // Error patterns
  criticalErrors: /CRITICAL|FATAL|ERROR/,
  authErrors: /auth|unauthorized|forbidden/i,
  networkErrors: /timeout|connection|network/i,

  // Performance patterns
  slowQueries: /query took|slow query/i,
  memoryWarnings: /memory|heap|out of memory/i,

  // Security patterns
  securityEvents: /security|suspicious|blocked|unauthorized/i,
  rateLimitHit: /rate limit|too many requests/i
};

// Automated log analysis
setInterval(() => {
  analyzeRecentLogs(logAnalysis);
}, 300000); // Every 5 minutes
```

## Incident Response Procedures

### 1. Severity Classification

```typescript
enum IncidentSeverity {
  P1 = 'critical',    // System down, data loss
  P2 = 'high',        // Major functionality impaired
  P3 = 'medium',      // Minor functionality impaired
  P4 = 'low'          // Cosmetic or enhancement
}

const severityActions = {
  [IncidentSeverity.P1]: {
    responseTime: '15 minutes',
    escalation: 'immediate',
    communication: 'real-time updates'
  },
  [IncidentSeverity.P2]: {
    responseTime: '30 minutes',
    escalation: '1 hour',
    communication: 'hourly updates'
  }
};
```

### 2. Response Checklist

**P1 Incident Response:**
1. **Immediate (0-5 minutes)**
   - Confirm incident scope and impact
   - Check system status dashboard
   - Verify if it's a true outage vs. monitoring issue

2. **Assessment (5-15 minutes)**
   - Identify affected components
   - Check recent deployments/changes
   - Review error logs and metrics

3. **Mitigation (15+ minutes)**
   - Implement immediate fixes
   - Roll back recent changes if needed
   - Scale resources if performance related

4. **Recovery (Ongoing)**
   - Monitor system restoration
   - Verify full functionality
   - Update stakeholders

5. **Post-Incident (24-48 hours)**
   - Write incident report
   - Identify root cause
   - Implement preventive measures

## Related Documentation

- [06 - Package: @bematic/cloud](./06-package-cloud.md) - Cloud service architecture
- [07 - Package: @bematic/agent](./07-package-agent.md) - Agent operations
- [10 - Database Schema](./10-database-schema.md) - Database operations
- [15 - Advanced Patterns](./15-advanced-patterns.md) - Circuit breaker patterns
- [16 - Security & Compliance](./16-security-compliance.md) - Security monitoring