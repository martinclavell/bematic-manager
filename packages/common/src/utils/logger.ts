import pino from 'pino';

export function createLogger(name: string, level?: string) {
  return pino({
    name,
    level: level ?? process.env['LOG_LEVEL'] ?? 'info',
    transport:
      process.env['NODE_ENV'] !== 'production'
        ? { target: 'pino/file', options: { destination: 1 } }
        : undefined,
  });
}

export type Logger = pino.Logger;
