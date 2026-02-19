# 09 — WebSocket Protocol Reference

[← Back to Index](./README.md)

---

## Message Envelope

```typescript
{
  type: MessageType,    // string constant
  payload: object,      // type-specific
  id: string,           // msg_xxxx (nanoid)
  timestamp: string     // ISO 8601
}
```

---

## Connection Lifecycle

| Direction | Type | Payload |
|-----------|------|---------|
| Agent→Cloud | `AUTH_REQUEST` | `{ agentId, apiKey, version?, capabilities? }` |
| Cloud→Agent | `AUTH_RESPONSE` | `{ success, agentId?, error?, serverCapabilities? }` |
| Cloud→Agent | `HEARTBEAT_PING` | `{ timestamp, sequenceId }` |
| Agent→Cloud | `HEARTBEAT_PONG` | `{ timestamp, sequenceId, metrics: { cpu, memory, activeTasks, resourceHealth } }` |
| Either | `CONNECTION_UPGRADE` | `{ protocol: 'wss', features: ['circuit-breaker', 'keepalive'] }` |
| Cloud→Agent | `RATE_LIMIT_WARNING` | `{ currentRate, limit, resetTime }` |

---

## Task Lifecycle (Enhanced)

| Direction | Type | Payload |
|-----------|------|---------|
| Cloud→Agent | `TASK_SUBMIT` | `{ taskId, projectId, botName, command, prompt, systemPrompt, allowedTools, model, maxBudget, localPath, slackContext, maxContinuations?, parentTaskId?, priority?, estimatedComplexity? }` |
| Agent→Cloud | `TASK_ACK` | `{ taskId, accepted, queued?, reason?, estimatedStartTime?, resourceAllocation? }` |
| Agent→Cloud | `TASK_PROGRESS` | `{ taskId, step, message, percentage?, resourceUsage?, intermediateFiles? }` |
| Agent→Cloud | `TASK_STREAM` | `{ taskId, text, isPartial, streamType: 'stdout'\|'stderr'\|'claude', chunkId? }` |
| Agent→Cloud | `TASK_COMPLETE` | `{ taskId, result, inputTokens, outputTokens, estimatedCost, durationMs, filesChanged, commandsRun, continuations?, resourceMetrics?, cacheHits? }` |
| Agent→Cloud | `TASK_ERROR` | `{ taskId, error, recoverable, errorCode?, context?, suggestedRetryDelay? }` |
| Cloud→Agent | `TASK_CANCEL` | `{ taskId, reason?, graceful?, timeoutMs? }` |
| Agent→Cloud | `TASK_CANCELLED` | `{ taskId, partialResult?, resourcesReleased?, cleanupComplete? }` |
| Agent→Cloud | `TASK_RESOURCE_WARNING` | `{ taskId, resourceType, currentUsage, threshold, recommendation }` |
| Cloud→Agent | `TASK_PRIORITY_UPDATE` | `{ taskId, newPriority, reason? }` |

---

## System Messages (Enhanced)

| Direction | Type | Payload |
|-----------|------|---------|
| Agent→Cloud | `AGENT_STATUS` | `{ agentId, status, activeTasks, version?, resourceMetrics, capabilities }` |
| Cloud→Agent | `SYSTEM_SHUTDOWN` | `{ reason?, gracePeriod?, affectedTasks? }` |
| Cloud→Agent | `SYSTEM_RESTART` | `{ rebuild?, restartDelay?, preserveQueue? }` |
| Either | `SYSTEM_ERROR` | `{ error, code?, recoverable?, context? }` |
| Cloud→Agent | `CIRCUIT_BREAKER_OPEN` | `{ reason, estimatedRecoveryTime, alternativeAgents? }` |
| Cloud→Agent | `CIRCUIT_BREAKER_CLOSE` | `{ timestamp, connectionQualityScore }` |
| Agent→Cloud | `RESOURCE_ALERT` | `{ alertType, currentUsage, threshold, recommendation }` |
| Cloud→Agent | `LOAD_BALANCING` | `{ recommendedTaskTypes, loadScore, redistributionSuggested }` |

---

## Authentication Flow (Enhanced)

```
1. CONNECTION ESTABLISHMENT
Agent connects WSS → must send AUTH_REQUEST within 10s
  → Cloud validates connection security (WSS enforcement in production)
  → Cloud logs connection attempt with origin and security status

2. API KEY VALIDATION
Cloud receives AUTH_REQUEST → ApiKeyService.validateKey(apiKey)
  → Database lookup with revocation and expiration checks
  → Update last_used timestamp for valid keys
  → Log authentication attempt in audit trail

3. AUTHENTICATION RESPONSE
Success: AUTH_RESPONSE { success: true, agentId, serverCapabilities }
  → Agent enters authenticated state
  → Circuit breaker resets to closed state
  → Heartbeat monitoring begins

Failure: AUTH_RESPONSE { success: false, error, retryAfter? }
  → Connection terminated with appropriate error code
  → Rate limiting applied for repeated failures
  → Security alert logged for suspicious patterns

4. CAPABILITY NEGOTIATION
Agent + Cloud exchange supported features:
  → Protocol versions (v1, v2)
  → Message compression support
  → Circuit breaker parameters
  → Keepalive intervals
```

### API Key Rotation Flow

```
1. KEY ROTATION INITIATED
/bm rotate-key agent_123 → ApiKeyService.generate(agentId)
  → New key created with overlap period
  → Old key marked for deprecation (not revoked immediately)

2. AGENT NOTIFICATION
Cloud → Agent: KEY_ROTATION_NOTICE { newKey, deprecationTime }
  → Agent updates configuration with new key
  → Agent continues using old key until ready

3. KEY ACTIVATION
Agent → Cloud: AUTH_REQUEST with new key
  → Cloud validates new key
  → Old key automatically revoked after grace period

4. CLEANUP
ApiKeyService.cleanupExpiredKeys() removes old keys
  → Audit trail maintained for key lifecycle
```

---

## Bidirectional Heartbeat Protocol

```
1. CLOUD-INITIATED KEEPALIVE
Cloud sends HEARTBEAT_PING every 30s with sequenceId
  → Agent must respond with HEARTBEAT_PONG within 30s
  → Agent includes current resource metrics in PONG
  → If no PONG within 60s (2x interval) → connection considered dead

2. AGENT-INITIATED KEEPALIVE
Agent sends HEARTBEAT_PING when idle for 60s
  → Cloud responds with HEARTBEAT_PONG + system status
  → Helps detect network issues from agent side
  → Prevents NAT timeout in long-running connections

3. HEARTBEAT FAILURE HANDLING
Missed heartbeat → Circuit breaker evaluation
  → Single miss: Warning logged, continue monitoring
  → Multiple misses: Circuit breaker opens, connection marked unstable
  → Connection timeout: Agent marked offline, tasks queued

4. RECOVERY PROTOCOL
Agent reconnection → Circuit breaker reset evaluation
  → Successful auth + first heartbeat → Circuit breaker closes
  → Offline queue drained in priority order
  → Connection marked stable after sustained heartbeats
```

### Heartbeat Metrics

```
HEARTBEAT_PONG payload includes:
{
  timestamp: ISO8601,
  sequenceId: number,
  metrics: {
    cpu: { percent: number, status: 'ok'|'warning'|'critical' },
    memory: { used: bytes, total: bytes, percent: number, status: string },
    activeTasks: number,
    resourceHealth: 'healthy'|'degraded'|'overloaded',
    connectionQuality: { latency: ms, packetLoss: percent },
    agentVersion: string,
    uptime: seconds
  }
}
```

---

## Connection Resilience Features

### Circuit Breaker Implementation

```
CIRCUIT BREAKER STATES:

1. CLOSED (Normal Operation)
   → All messages flow normally
   → Failure count tracked per connection
   → Heartbeat monitoring active

2. HALF-OPEN (Testing Recovery)
   → Limited message flow to test connection
   → Single failure → back to OPEN
   → Success → transition to CLOSED

3. OPEN (Connection Failed)
   → All new tasks rejected or queued
   → Existing tasks cancelled gracefully
   → Automatic retry timer starts
   → Alternative agents suggested for new tasks

TRIGGER CONDITIONS:
→ 3+ consecutive heartbeat failures
→ 5+ message send failures in 60s
→ Authentication failures (exponential backoff)
→ Resource exhaustion on agent
```

### Exponential Backoff Strategy

```
RECONNECTION BACKOFF:

1. INITIAL ATTEMPT
   → Immediate reconnection on first failure
   → No delay for transient network issues

2. PROGRESSIVE DELAYS
   → Attempt 1: 0s (immediate)
   → Attempt 2: 1s
   → Attempt 3: 2s
   → Attempt 4: 4s
   → Attempt 5: 8s
   → Attempt 6+: 30s (max)

3. BACKOFF MODIFIERS
   → Authentication failures: 2x multiplier
   → Server errors (5xx): 1.5x multiplier
   → Network errors: Standard progression
   → Resource exhaustion: 60s fixed delay

4. BACKOFF RESET
   → Successful connection → reset to immediate
   → 24h without issues → clear failure history
```

### Message Buffering

```
BUFFERING STRATEGY:

1. OUTBOUND BUFFER (Agent → Cloud)
   → Buffer size: 100 messages or 10MB
   → Priority: TASK_COMPLETE > TASK_ERROR > TASK_PROGRESS > TASK_STREAM
   → TTL: 5 minutes for progress, 60 minutes for completion
   → Overflow: Drop oldest TASK_STREAM messages first

2. INBOUND BUFFER (Cloud → Agent)
   → Buffer size: 50 messages or 5MB
   → Priority: TASK_CANCEL > TASK_SUBMIT > HEARTBEAT_PING > SYSTEM_*
   → TTL: 10 minutes for tasks, 2 minutes for heartbeats
   → Overflow: Reject new TASK_SUBMIT, maintain control messages

3. BUFFER DRAIN
   → On reconnection: drain buffers in priority order
   → Rate limiting: max 10 messages/second during drain
   → Failed delivery: move to dead letter queue
```

---

## WebSocket Security (WSS)

### TLS Configuration

```
PRODUCTION REQUIREMENTS:

1. WSS ENFORCEMENT
   → verifyClient callback rejects non-WSS in production
   → HTTP connections upgraded to HTTPS before WebSocket upgrade
   → Certificate validation enabled by default

2. CERTIFICATE VALIDATION
   → rejectUnauthorized: true (default)
   → Support for custom CA certificates
   → Certificate pinning for high-security environments

3. TLS SETTINGS
   → Minimum TLS 1.2 required
   → Strong cipher suites enforced
   → Perfect Forward Secrecy enabled

DEVELOPMENT OVERRIDES:
→ AGENT_WS_PROTOCOL=ws allows insecure connections
→ AGENT_WS_REJECT_UNAUTHORIZED=false disables cert validation
→ Warning logged when security disabled
```

### Security Headers

```
WEBSOCKET UPGRADE HEADERS:

1. REQUIRED HEADERS
   → Origin validation against whitelist
   → User-Agent verification
   → Proper WebSocket protocol negotiation

2. SECURITY HEADERS
   → Strict-Transport-Security for HTTPS enforcement
   → X-Frame-Options to prevent embedding
   → Content-Security-Policy for XSS protection
```

---

## Performance Metrics

### Connection Metrics

```
CONNECTION HEALTH METRICS:

1. LATENCY MEASUREMENTS
   → RTT (Round Trip Time) via heartbeat timing
   → Message delivery time tracking
   → Authentication handshake duration
   → Connection establishment time

2. THROUGHPUT METRICS
   → Messages per second (inbound/outbound)
   → Bytes per second transfer rates
   → Queue processing rates
   → Buffer utilization percentages

3. RELIABILITY METRICS
   → Connection uptime percentage
   → Successful message delivery rate
   → Heartbeat response consistency
   → Circuit breaker activation frequency

4. RESOURCE METRICS
   → Memory usage for buffers
   → CPU overhead for message processing
   → Network bandwidth utilization
   → Connection pool efficiency
```

### Performance Monitoring

```
MONITORING IMPLEMENTATION:

1. REAL-TIME DASHBOARDS
   → Connection status per agent
   → Message flow visualization
   → Performance trend analysis
   → Alert thresholds and notifications

2. HISTORICAL ANALYSIS
   → Connection quality over time
   → Performance degradation patterns
   → Peak usage identification
   → Capacity planning insights

3. ALERTING CONDITIONS
   → RTT > 5s (network issues)
   → Message loss > 1% (reliability)
   → Buffer overflow events
   → Circuit breaker frequent activation
```

---

## Message Versioning & Compatibility

### Protocol Versioning

```
PROTOCOL EVOLUTION:

1. VERSION NEGOTIATION
   → Agent sends supported versions in AUTH_REQUEST
   → Cloud responds with selected version
   → Both parties use selected version for session

2. BACKWARDS COMPATIBILITY
   → v1: Basic message types, simple heartbeat
   → v2: Enhanced payloads, circuit breaker, metrics
   → v3: Future - compression, multiplexing

3. GRACEFUL DEGRADATION
   → Unknown message types logged and ignored
   → Missing optional fields handled gracefully
   → Version mismatch warnings in logs

4. MIGRATION STRATEGY
   → Dual-version support during transitions
   → Gradual rollout of new protocol features
   → Deprecation notices for old versions
```

---

## Cross-References

For detailed information on related WebSocket topics, see:

- [Data Flow (Doc 08)](./08-data-flow.md) - End-to-end message flow patterns
- [Security & Authentication (Doc 15)](./15-security-auth.md) - API key management and validation
- [Performance & Caching (Doc 16)](./16-performance-caching.md) - Connection optimization strategies
- [Monitoring & Metrics (Doc 17)](./17-monitoring-metrics.md) - WebSocket monitoring implementation
