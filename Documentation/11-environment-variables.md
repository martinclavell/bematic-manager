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
