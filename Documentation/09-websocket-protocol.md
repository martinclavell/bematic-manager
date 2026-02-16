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
| Agent→Cloud | `AUTH_REQUEST` | `{ agentId, apiKey, version? }` |
| Cloud→Agent | `AUTH_RESPONSE` | `{ success, agentId?, error? }` |
| Cloud→Agent | `HEARTBEAT_PING` | `{ timestamp }` |
| Agent→Cloud | `HEARTBEAT_PONG` | `{ timestamp, metrics: { cpu, memory, activeTasks } }` |

---

## Task Lifecycle

| Direction | Type | Payload |
|-----------|------|---------|
| Cloud→Agent | `TASK_SUBMIT` | `{ taskId, projectId, botName, command, prompt, systemPrompt, allowedTools, model, maxBudget, localPath, slackContext }` |
| Agent→Cloud | `TASK_ACK` | `{ taskId, accepted, queued?, reason? }` |
| Agent→Cloud | `TASK_PROGRESS` | `{ taskId, step, message, percentage? }` |
| Agent→Cloud | `TASK_STREAM` | `{ taskId, text, isPartial }` |
| Agent→Cloud | `TASK_COMPLETE` | `{ taskId, result, inputTokens, outputTokens, estimatedCost, durationMs, filesChanged, commandsRun }` |
| Agent→Cloud | `TASK_ERROR` | `{ taskId, error, recoverable }` |
| Cloud→Agent | `TASK_CANCEL` | `{ taskId, reason? }` |
| Agent→Cloud | `TASK_CANCELLED` | `{ taskId }` |

---

## System Messages

| Direction | Type | Payload |
|-----------|------|---------|
| Agent→Cloud | `AGENT_STATUS` | `{ agentId, status, activeTasks, version? }` |
| Cloud→Agent | `SYSTEM_SHUTDOWN` | `{ reason? }` |
| Cloud→Agent | `SYSTEM_RESTART` | `{ rebuild? }` |
| Either | `SYSTEM_ERROR` | `{ error, code? }` |

---

## Authentication Flow

```
Agent connects WSS → must send AUTH_REQUEST within 10s
  → Cloud validates API key against AGENT_API_KEYS env var
  → Success: AUTH_RESPONSE { success: true, agentId }
  → Failure: AUTH_RESPONSE { success: false, error } → disconnect
```

---

## Heartbeat Protocol

```
Cloud sends HEARTBEAT_PING every 30s
  → Agent must respond with HEARTBEAT_PONG
  → If no PONG within 60s (2x interval) → connection considered dead
  → Cloud disconnects and cleans up agent state
```
