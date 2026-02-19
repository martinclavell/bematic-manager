# 11 — Environment Variables

[← Back to Index](./README.md)

---

## Cloud Service (Railway)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | — | Slack bot token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Yes | — | Slack signing secret |
| `SLACK_APP_TOKEN` | Yes | — | Slack app token for Socket Mode (`xapp-...`) |
| `AGENT_API_KEYS` | Yes | — | Comma-separated API keys for agent auth |
| `DATABASE_URL` | No | `./data/bematic.db` | SQLite database file path |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `WS_HEARTBEAT_INTERVAL_MS` | No | `30000` | Heartbeat ping interval |
| `WS_AUTH_TIMEOUT_MS` | No | `10000` | Auth timeout for new connections |
| `RATE_LIMIT_WINDOW_MS` | No | `3600000` | Rate limit window (1 hour) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `50` | Max requests per window |
| `CLOUD_SSL_ENABLED` | No | `true` (prod), `false` (dev) | Enable HTTPS/TLS support |
| `CLOUD_SSL_CERT_PATH` | No | — | Path to TLS certificate file |
| `CLOUD_SSL_KEY_PATH` | No | — | Path to TLS private key file |
| `CLOUD_ENFORCE_WSS` | No | `true` (prod), `false` (dev) | Reject non-WSS connections |

---

## Agent (Local Machine)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLOUD_WS_URL` | Yes | — | Cloud WebSocket URL (`wss://...`) |
| `AGENT_ID` | Yes | — | Unique agent identifier |
| `AGENT_API_KEY` | Yes | — | Must match one of cloud's `AGENT_API_KEYS` |
| `ANTHROPIC_API_KEY` | No | — | Claude API key (falls back to subscription) |
| `MAX_CONCURRENT_TASKS` | No | `3` | Global concurrency limit |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `WS_RECONNECT_BASE_DELAY_MS` | No | `1000` | Initial reconnect delay |
| `WS_RECONNECT_MAX_DELAY_MS` | No | `30000` | Maximum reconnect delay |
| `MAX_CONTINUATIONS` | No | `3` | Max auto-continuations when Claude hits 200-turn limit |
| `AGENT_WS_PROTOCOL` | No | Auto-detect | WebSocket protocol (`wss`/`ws`). Auto: production=wss, dev=ws |
| `AGENT_WS_REJECT_UNAUTHORIZED` | No | `true` | Certificate validation for WSS connections |

---

## Model Routing (Agent)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MODEL_ROUTING_ENABLED` | No | `true` | Master switch — `false` disables routing, all tasks use project default |
| `MODEL_TIER_STANDARD` | No | `claude-sonnet-4-5-20250929` | Sonnet model (default for all read-only/analysis tasks) |
| `MODEL_TIER_PREMIUM` | No | `claude-opus-4-20250514` | Opus model (CoderBot write commands only) |

**Routing strategy:** Sonnet for all tasks except CoderBot write commands (fix, feature, refactor, test) which use Opus.

---

## Security & TLS Configuration

### WebSocket Security

The system automatically enforces secure WebSocket connections (WSS) in production:

- **Agent**: Auto-detects protocol based on `NODE_ENV`. Production uses WSS with certificate validation.
- **Cloud**: Enforces WSS in production, rejects insecure connections when `CLOUD_ENFORCE_WSS=true`.

### TLS Certificate Handling

**Railway/Platform TLS**: In production (Railway), TLS termination is handled by the platform. No certificate files needed.

**Local TLS**: For local HTTPS/WSS testing:
```bash
# Generate self-signed certificates (development only)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Set environment variables
CLOUD_SSL_ENABLED=true
CLOUD_SSL_CERT_PATH=./cert.pem
CLOUD_SSL_KEY_PATH=./key.pem

# Disable certificate validation on agent for self-signed certs
AGENT_WS_REJECT_UNAUTHORIZED=false
```

### Security Best Practices

- Always use WSS in production
- Certificate validation enabled by default (`AGENT_WS_REJECT_UNAUTHORIZED=true`)
- Only disable certificate validation in development with self-signed certificates
- Platform TLS termination (Railway) is preferred over local certificates
