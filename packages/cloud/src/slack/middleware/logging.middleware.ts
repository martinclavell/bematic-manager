import type { Middleware, SlackEventMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { createLogger } from '@bematic/common';

const logger = createLogger('slack:middleware');

export const loggingMiddleware: Middleware<SlackEventMiddlewareArgs & AllMiddlewareArgs> = async ({ body, next }) => {
  const eventType = (body as Record<string, unknown>)['type'] ?? 'unknown';
  logger.debug({ eventType }, 'Slack event received');
  await next();
};
