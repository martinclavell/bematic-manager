import { Limits } from '@bematic/common';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalBoolEnv(name: string, fallback: boolean): boolean {
  const val = process.env[name];
  if (val === undefined) return fallback;
  return val === 'true';
}

export function loadConfig() {
  const nodeEnv = optionalEnv('NODE_ENV', 'development');
  const isProduction = nodeEnv === 'production';

  return {
    slack: {
      botToken: requireEnv('SLACK_BOT_TOKEN'),
      signingSecret: requireEnv('SLACK_SIGNING_SECRET'),
      appToken: requireEnv('SLACK_APP_TOKEN'),
    },
    agentApiKeys: requireEnv('AGENT_API_KEYS').split(',').map((k) => k.trim()),
    railway: {
      apiToken: optionalEnv('RAILWAY_API_TOKEN', ''),
    },
    database: {
      url: optionalEnv('DATABASE_URL', './data/bematic.db'),
    },
    server: {
      port: parseInt(optionalEnv('PORT', '3000'), 10),
      nodeEnv,
      logLevel: optionalEnv('LOG_LEVEL', 'info'),
    },
    ssl: {
      enabled: optionalBoolEnv('CLOUD_SSL_ENABLED', isProduction),
      certPath: optionalEnv('CLOUD_SSL_CERT_PATH', ''),
      keyPath: optionalEnv('CLOUD_SSL_KEY_PATH', ''),
      enforceWss: optionalBoolEnv('CLOUD_ENFORCE_WSS', isProduction),
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
    fileUpload: {
      maxFileSize: parseInt(optionalEnv('SLACK_MAX_ATTACHMENT_SIZE', String(10 * 1024 * 1024)), 10),
      maxTotalSize: parseInt(optionalEnv('SLACK_MAX_TOTAL_ATTACHMENT_SIZE', String(20 * 1024 * 1024)), 10),
      enableVirusScanning: optionalBoolEnv('ENABLE_VIRUS_SCANNING', false),
      strictValidation: optionalBoolEnv('STRICT_FILE_VALIDATION', isProduction),
      allowArchives: optionalBoolEnv('ALLOW_ARCHIVE_UPLOADS', true),
      maxArchiveSize: parseInt(optionalEnv('MAX_ARCHIVE_SIZE', String(2 * 1024 * 1024)), 10),
    },
    offlineQueue: {
      maxConcurrentDeliveries: parseInt(optionalEnv('OFFLINE_QUEUE_MAX_CONCURRENT', '5'), 10),
      deliveryTimeout: parseInt(optionalEnv('OFFLINE_QUEUE_DELIVERY_TIMEOUT', '30000'), 10),
      preserveMessageOrder: optionalBoolEnv('OFFLINE_QUEUE_PRESERVE_ORDER', true),
      retryAttempts: parseInt(optionalEnv('OFFLINE_QUEUE_RETRY_ATTEMPTS', '3'), 10),
      retryDelayMs: parseInt(optionalEnv('OFFLINE_QUEUE_RETRY_DELAY_MS', '1000'), 10),
    },
    security: {
      headers: {
        enableHsts: optionalBoolEnv('SECURITY_ENABLE_HSTS', isProduction),
        enableCsp: optionalBoolEnv('SECURITY_ENABLE_CSP', true),
        allowedOrigins: optionalEnv('SECURITY_ALLOWED_ORIGINS', [
          'https://hooks.slack.com',
          'https://slack.com',
          'https://railway.app',
          'https://up.railway.app',
          ...(isProduction ? [] : ['http://localhost:3000', 'http://127.0.0.1:3000'])
        ].join(',')).split(',').map(o => o.trim()).filter(Boolean),
        customHeaders: {},
      },
      cors: {
        enabled: optionalBoolEnv('SECURITY_CORS_ENABLED', true),
        credentials: optionalBoolEnv('SECURITY_CORS_CREDENTIALS', true),
        maxAge: parseInt(optionalEnv('SECURITY_CORS_MAX_AGE', '86400'), 10),
      },
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
