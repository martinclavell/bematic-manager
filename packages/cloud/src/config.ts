import { Limits } from '@bematic/common';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function loadConfig() {
  return {
    slack: {
      botToken: requireEnv('SLACK_BOT_TOKEN'),
      signingSecret: requireEnv('SLACK_SIGNING_SECRET'),
      appToken: requireEnv('SLACK_APP_TOKEN'),
    },
    agentApiKeys: requireEnv('AGENT_API_KEYS').split(',').map((k) => k.trim()),
    database: {
      url: optionalEnv('DATABASE_URL', './data/bematic.db'),
    },
    server: {
      port: parseInt(optionalEnv('PORT', '3000'), 10),
      nodeEnv: optionalEnv('NODE_ENV', 'development'),
      logLevel: optionalEnv('LOG_LEVEL', 'info'),
    },
    ws: {
      heartbeatIntervalMs: parseInt(
        optionalEnv('WS_HEARTBEAT_INTERVAL_MS', String(Limits.WS_HEARTBEAT_INTERVAL_MS)),
        10,
      ),
      authTimeoutMs: parseInt(
        optionalEnv('WS_AUTH_TIMEOUT_MS', String(Limits.WS_AUTH_TIMEOUT_MS)),
        10,
      ),
    },
    rateLimit: {
      windowMs: parseInt(
        optionalEnv('RATE_LIMIT_WINDOW_MS', String(Limits.RATE_LIMIT_WINDOW_MS)),
        10,
      ),
      maxRequests: parseInt(
        optionalEnv('RATE_LIMIT_MAX_REQUESTS', String(Limits.RATE_LIMIT_MAX_REQUESTS)),
        10,
      ),
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
