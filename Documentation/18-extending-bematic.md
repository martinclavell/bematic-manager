# Extending Bematic

This document provides comprehensive guides for extending the Bematic Manager system with custom functionality, including adding new bot types, integrations, and custom monitoring.

## Table of Contents

- [Adding New Bot Types](#adding-new-bot-types)
- [Custom Integration Development](#custom-integration-development)
- [Message Handler Extensions](#message-handler-extensions)
- [Database Schema Extensions](#database-schema-extensions)
- [Admin Command Creation](#admin-command-creation)
- [Custom Metrics and Monitoring](#custom-metrics-and-monitoring)
- [Plugin Development Guidelines](#plugin-development-guidelines)
- [Testing Custom Extensions](#testing-custom-extensions)
- [Deployment and Distribution](#deployment-and-distribution)

## Adding New Bot Types

### Step-by-Step Bot Creation Guide

**1. Create Bot Implementation**

**File:** `packages/bots/src/my-bot/my-bot.bot.ts`

```typescript
import { BotName, type BotCommand, type ParsedCommand } from '@bematic/common';
import { BaseBotPlugin } from '../base/base-bot.js';

export class MyBot extends BaseBotPlugin {
  name = BotName.MY_BOT; // Add to BotName enum in common
  displayName = 'My Bot';
  description = 'Custom bot description';
  defaultCommand = 'default';

  commands: BotCommand[] = [
    {
      name: 'default',
      description: 'Default bot action',
      aliases: ['do'],
      defaultPromptTemplate: 'Perform this action: {args}',
    },
    {
      name: 'analyze',
      description: 'Analyze something',
      aliases: ['check', 'review'],
      defaultPromptTemplate: 'Analyze the following: {args}',
    },
  ];

  protected getSystemPrompt(): string {
    return `You are a specialized AI assistant for [your domain].

Your role:
- [Define primary responsibilities]
- [Define secondary capabilities]
- [Define constraints or limitations]

Rules:
- [Specific rules for this bot type]
- Always provide clear explanations
- Follow established patterns in the codebase`;
  }

  protected getAllowedTools(): string[] {
    return [
      'Read', 'Edit', 'Write',     // File operations
      'Glob', 'Grep',              // Search operations
      'Bash',                      // Command execution
      'WebFetch',                  // Web access (if needed)
      // Add custom tools as needed
    ];
  }

  // Optional: Custom decomposition logic
  shouldDecompose(command: ParsedCommand): boolean {
    const complexCommands = ['analyze', 'audit', 'migrate'];
    return (
      complexCommands.includes(command.command) &&
      command.args.length > 200 // Long tasks benefit from decomposition
    );
  }

  // Optional: Custom response formatting
  formatResult(result: any): any {
    // Custom formatting logic
    return super.formatResult(result);
  }

  formatError(error: string, taskId: string): any {
    // Custom error formatting
    return super.formatError(error, taskId);
  }
}
```

**2. Update Type Definitions**

**File:** `packages/common/src/types/index.ts`

```typescript
export enum BotName {
  CODER = 'coder',
  REVIEWER = 'reviewer',
  OPS = 'ops',
  PLANNER = 'planner',
  MY_BOT = 'my-bot', // Add your bot
}

// Update bot keywords mapping
export const BOT_KEYWORDS: Record<BotName, string[]> = {
  [BotName.CODER]: ['code', 'fix', 'implement', 'dev'],
  [BotName.REVIEWER]: ['review', 'check', 'audit'],
  [BotName.OPS]: ['ops', 'deploy', 'devops'],
  [BotName.PLANNER]: ['plan', 'design', 'architecture'],
  [BotName.MY_BOT]: ['mybot', 'custom', 'special'], // Add keywords
};

// Update slash commands
export const BOT_SLASH_COMMANDS: Record<string, BotName> = {
  '/bm-code': BotName.CODER,
  '/bm-review': BotName.REVIEWER,
  '/bm-ops': BotName.OPS,
  '/bm-plan': BotName.PLANNER,
  '/bm-custom': BotName.MY_BOT, // Add slash command
};
```

**3. Register Bot**

**File:** `packages/bots/src/index.ts`

```typescript
// Add import
export { MyBot } from './my-bot/my-bot.bot.js';

// Update registration function
import { MyBot } from './my-bot/my-bot.bot.js';

export function registerAllBots(): void {
  BotRegistry.register(new CoderBot());
  BotRegistry.register(new ReviewerBot());
  BotRegistry.register(new OpsBot());
  BotRegistry.register(new PlannerBot());
  BotRegistry.register(new MyBot()); // Register your bot
}
```

**4. Add Slack Command Configuration**

Add your slash command to your Slack app configuration:

```bash
# In Slack App dashboard, add slash command:
Command: /bm-custom
Request URL: https://your-app.railway.app/slack/command
Description: Custom bot for specialized tasks
Usage Hint: [task description]
```

### Advanced Bot Features

**Custom Tool Integration:**
```typescript
export class MyBot extends BaseBotPlugin {
  protected getAllowedTools(): string[] {
    return [
      ...super.getAllowedTools(),
      'MyCustomTool',  // Reference to custom tool
    ];
  }

  // Custom tool execution (if needed)
  async executeCustomTool(toolName: string, params: any): Promise<any> {
    switch (toolName) {
      case 'MyCustomTool':
        return await this.myCustomToolHandler(params);
      default:
        return super.executeCustomTool?.(toolName, params);
    }
  }
}
```

**Dynamic Command Registration:**
```typescript
export class MyBot extends BaseBotPlugin {
  constructor(private config: BotConfig) {
    super();

    // Dynamically build commands based on configuration
    this.commands = this.buildCommands(config);
  }

  private buildCommands(config: BotConfig): BotCommand[] {
    const baseCommands = [/* ... */];

    // Add conditional commands based on config
    if (config.features.advancedMode) {
      baseCommands.push({
        name: 'advanced',
        description: 'Advanced operation',
        aliases: ['adv'],
        defaultPromptTemplate: 'Perform advanced operation: {args}',
      });
    }

    return baseCommands;
  }
}
```

## Custom Integration Development

### Webhook Integration Example

**File:** `packages/cloud/src/integrations/custom-webhook.ts`

```typescript
import { createLogger } from '@bematic/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NotificationService } from '../services/notification.service.js';

const logger = createLogger('custom-webhook');

export class CustomWebhookIntegration {
  constructor(
    private readonly notifier: NotificationService,
    private readonly config: {
      secretKey: string;
      allowedChannels: string[];
    }
  ) {}

  async handleWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // 1. Verify webhook signature
      const signature = req.headers['x-custom-signature'] as string;
      if (!this.verifySignature(signature, req.body)) {
        res.statusCode = 403;
        res.end('Invalid signature');
        return;
      }

      // 2. Parse webhook payload
      const payload = this.parsePayload(req.body);

      // 3. Process the webhook
      await this.processWebhook(payload);

      res.statusCode = 200;
      res.end('OK');

    } catch (error) {
      logger.error({ error: error.message }, 'Webhook processing failed');
      res.statusCode = 500;
      res.end('Internal server error');
    }
  }

  private verifySignature(signature: string, body: Buffer): boolean {
    const expected = this.computeSignature(body);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  }

  private async processWebhook(payload: any): Promise<void> {
    switch (payload.event) {
      case 'deployment.success':
        await this.handleDeploymentSuccess(payload);
        break;
      case 'deployment.failure':
        await this.handleDeploymentFailure(payload);
        break;
      default:
        logger.warn({ event: payload.event }, 'Unknown webhook event');
    }
  }

  private async handleDeploymentSuccess(payload: any): Promise<void> {
    const message = `:white_check_mark: Deployment successful!\n` +
                   `Project: ${payload.project}\n` +
                   `Environment: ${payload.environment}\n` +
                   `Version: ${payload.version}`;

    // Send to configured channels
    for (const channel of this.config.allowedChannels) {
      await this.notifier.postMessage(channel, message);
    }
  }
}
```

### API Integration Pattern

**File:** `packages/cloud/src/integrations/external-api.ts`

```typescript
export class ExternalApiIntegration {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: { baseUrl: string; apiKey: string }) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  async makeRequest<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      data?: any;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const { method = 'GET', data, headers = {} } = options;

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Example integration method
  async createIssue(issue: { title: string; description: string }): Promise<any> {
    return this.makeRequest('/issues', {
      method: 'POST',
      data: issue
    });
  }
}
```

## Message Handler Extensions

### Custom Message Type Handler

**File:** `packages/cloud/src/gateway/custom-message-handler.ts`

```typescript
import { MessageType, parseMessage, createLogger } from '@bematic/common';
import type { TaskRepository, AuditLogRepository } from '@bematic/db';

const logger = createLogger('custom-message-handler');

export class CustomMessageHandler {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository
  ) {}

  async handleCustomMessage(agentId: string, rawMessage: string): Promise<void> {
    const message = parseMessage(rawMessage);

    switch (message.type) {
      case 'CUSTOM_EVENT' as MessageType:
        await this.handleCustomEvent(agentId, message.payload);
        break;
      case 'CUSTOM_METRIC' as MessageType:
        await this.handleCustomMetric(agentId, message.payload);
        break;
      default:
        logger.warn({ type: message.type }, 'Unknown custom message type');
    }
  }

  private async handleCustomEvent(agentId: string, payload: any): Promise<void> {
    // Process custom event
    logger.info({ agentId, payload }, 'Custom event received');

    // Log to audit trail
    this.auditLogRepo.log('custom:event', 'agent', agentId, null, payload);

    // Trigger custom logic
    await this.processCustomEvent(payload);
  }

  private async handleCustomMetric(agentId: string, payload: any): Promise<void> {
    // Process custom metrics
    const { metricName, value, tags } = payload;

    logger.debug({ agentId, metricName, value, tags }, 'Custom metric received');

    // Store or forward metric
    await this.storeCustomMetric(agentId, metricName, value, tags);
  }

  private async processCustomEvent(payload: any): Promise<void> {
    // Implement custom event processing logic
    // This could trigger notifications, update database, etc.
  }

  private async storeCustomMetric(
    agentId: string,
    metricName: string,
    value: number,
    tags: Record<string, string>
  ): Promise<void> {
    // Store custom metric (could be to database, external system, etc.)
    const metricData = {
      agentId,
      metricName,
      value,
      tags,
      timestamp: new Date()
    };

    // Example: Store to audit log
    this.auditLogRepo.log('metric:custom', 'agent', agentId, null, metricData);
  }
}
```

### Extending Message Router

**File:** `packages/cloud/src/gateway/extended-message-router.ts`

```typescript
import { MessageRouter } from './message-router.js';
import { CustomMessageHandler } from './custom-message-handler.js';

export class ExtendedMessageRouter extends MessageRouter {
  private customHandler: CustomMessageHandler;

  constructor(
    // ... existing constructor parameters
    customHandler: CustomMessageHandler
  ) {
    super(/* ... existing parameters */);
    this.customHandler = customHandler;
  }

  async handleAgentMessage(agentId: string, raw: string): Promise<void> {
    // First try standard message handling
    try {
      await super.handleAgentMessage(agentId, raw);
    } catch (error) {
      // If standard handling fails, try custom handling
      logger.debug({ agentId, error }, 'Standard handling failed, trying custom');
      await this.customHandler.handleCustomMessage(agentId, raw);
    }
  }

  // Add custom message routing
  protected async routeCustomMessage(agentId: string, messageType: string, payload: any): Promise<void> {
    switch (messageType) {
      case 'CUSTOM_DEPLOYMENT':
        await this.handleCustomDeployment(agentId, payload);
        break;
      case 'CUSTOM_NOTIFICATION':
        await this.handleCustomNotification(agentId, payload);
        break;
      default:
        logger.warn({ messageType }, 'Unhandled custom message type');
    }
  }
}
```

## Database Schema Extensions

### Adding New Tables

**File:** `packages/db/src/schema/custom-table.ts`

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const customMetrics = sqliteTable('custom_metrics', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  metricName: text('metric_name').notNull(),
  value: real('value').notNull(),
  tags: text('tags', { mode: 'json' }).$type<Record<string, string>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const customEvents = sqliteTable('custom_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  resourceId: text('resource_id'),
  resourceType: text('resource_type'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, any>>(),
  userId: text('user_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export type CustomMetricRow = typeof customMetrics.$inferSelect;
export type CustomMetricInsert = typeof customMetrics.$inferInsert;
export type CustomEventRow = typeof customEvents.$inferSelect;
export type CustomEventInsert = typeof customEvents.$inferInsert;
```

### Custom Repository Implementation

**File:** `packages/db/src/repositories/custom-metric.repository.ts`

```typescript
import { BaseRepository } from './base.repository.js';
import { customMetrics, type CustomMetricRow, type CustomMetricInsert } from '../schema/custom-table.js';
import { eq, and, desc, gte, lte } from 'drizzle-orm';

export class CustomMetricRepository extends BaseRepository<typeof customMetrics, CustomMetricRow> {
  constructor(db: Database) {
    super(db, customMetrics);
  }

  async create(metric: Omit<CustomMetricInsert, 'id' | 'createdAt'>): Promise<CustomMetricRow> {
    const id = generateId('cm');
    const createdAt = new Date();

    const [inserted] = await this.db
      .insert(customMetrics)
      .values({ ...metric, id, createdAt })
      .returning();

    return inserted;
  }

  async findByAgent(agentId: string, limit = 100): Promise<CustomMetricRow[]> {
    return this.db
      .select()
      .from(customMetrics)
      .where(eq(customMetrics.agentId, agentId))
      .orderBy(desc(customMetrics.createdAt))
      .limit(limit);
  }

  async findByMetricName(
    metricName: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<CustomMetricRow[]> {
    let query = this.db
      .select()
      .from(customMetrics)
      .where(eq(customMetrics.metricName, metricName));

    if (timeRange) {
      query = query.where(
        and(
          gte(customMetrics.createdAt, timeRange.start),
          lte(customMetrics.createdAt, timeRange.end)
        )
      );
    }

    return query.orderBy(desc(customMetrics.createdAt));
  }

  async getAggregatedMetrics(
    metricName: string,
    agentId?: string
  ): Promise<{
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  }> {
    // Note: This is a simplified example
    // For production, you'd use proper SQL aggregation functions
    let query = this.db
      .select()
      .from(customMetrics)
      .where(eq(customMetrics.metricName, metricName));

    if (agentId) {
      query = query.where(eq(customMetrics.agentId, agentId));
    }

    const results = await query;
    const values = results.map(r => r.value);

    return {
      count: values.length,
      sum: values.reduce((sum, val) => sum + val, 0),
      avg: values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : 0,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }
}
```

### Database Migration

**File:** `packages/db/drizzle/0001_custom_extensions.sql`

```sql
CREATE TABLE `custom_metrics` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_id` text NOT NULL,
  `metric_name` text NOT NULL,
  `value` real NOT NULL,
  `tags` text,
  `created_at` integer NOT NULL
);

CREATE TABLE `custom_events` (
  `id` text PRIMARY KEY NOT NULL,
  `event_type` text NOT NULL,
  `resource_id` text,
  `resource_type` text,
  `payload` text,
  `user_id` text,
  `created_at` integer NOT NULL
);

-- Indexes for performance
CREATE INDEX `idx_custom_metrics_agent_name` ON `custom_metrics` (`agent_id`, `metric_name`);
CREATE INDEX `idx_custom_metrics_created` ON `custom_metrics` (`created_at`);
CREATE INDEX `idx_custom_events_type_created` ON `custom_events` (`event_type`, `created_at`);
```

## Admin Command Creation

### Custom Admin Commands

**File:** `packages/cloud/src/slack/admin-commands/custom-commands.ts`

```typescript
import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';
import type { CustomMetricRepository } from '@bematic/db';

const logger = createLogger('admin:custom-commands');

type RespondFn = (message: string) => Promise<void>;

export class CustomCommands {
  constructor(
    private readonly ctx: AppContext,
    private readonly customMetricRepo: CustomMetricRepository
  ) {}

  async customMetrics(respond: RespondFn, args: string[]): Promise<void> {
    const [metricName, agentId] = args;

    if (!metricName) {
      await respond('Usage: `bm custom-metrics <metric-name> [agent-id]`');
      return;
    }

    try {
      const metrics = await this.customMetricRepo.findByMetricName(metricName);
      const aggregated = await this.customMetricRepo.getAggregatedMetrics(metricName, agentId);

      let response = `:bar_chart: *Custom Metric: ${metricName}*\n\n`;

      if (agentId) {
        response += `Agent: ${agentId}\n`;
      }

      response += `*Summary:*\n`;
      response += `• Count: ${aggregated.count}\n`;
      response += `• Average: ${aggregated.avg.toFixed(2)}\n`;
      response += `• Min: ${aggregated.min}\n`;
      response += `• Max: ${aggregated.max}\n`;
      response += `• Total: ${aggregated.sum.toFixed(2)}\n`;

      if (metrics.length > 0) {
        response += `\n*Recent Values:*\n`;
        metrics.slice(0, 5).forEach(metric => {
          const timestamp = metric.createdAt.toLocaleString();
          response += `• ${metric.value} (${timestamp})\n`;
        });
      }

      await respond(response);

    } catch (error) {
      logger.error({ error: error.message, metricName, agentId }, 'Failed to fetch custom metrics');
      await respond(`:x: Failed to fetch metrics: ${error.message}`);
    }
  }

  async customEvents(respond: RespondFn, args: string[]): Promise<void> {
    const [eventType, limit = '10'] = args;

    if (!eventType) {
      await respond('Usage: `bm custom-events <event-type> [limit]`');
      return;
    }

    try {
      // Implementation would fetch custom events
      const events = []; // await this.customEventRepo.findByType(eventType, parseInt(limit));

      let response = `:calendar: *Custom Events: ${eventType}*\n\n`;

      if (events.length === 0) {
        response += 'No events found.';
      } else {
        events.forEach((event: any, index: number) => {
          const timestamp = new Date(event.createdAt).toLocaleString();
          response += `${index + 1}. ${timestamp} - ${JSON.stringify(event.payload)}\n`;
        });
      }

      await respond(response);

    } catch (error) {
      logger.error({ error: error.message, eventType }, 'Failed to fetch custom events');
      await respond(`:x: Failed to fetch events: ${error.message}`);
    }
  }

  async customStatus(respond: RespondFn): Promise<void> {
    try {
      // Custom status check logic
      const status = {
        customIntegrationsActive: true,
        customMetricsCount: 0, // await this.customMetricRepo.count(),
        lastCustomEvent: null, // await this.customEventRepo.findLatest(),
        customHealthChecks: {
          externalApi: await this.checkExternalApiHealth(),
          customWebhook: await this.checkCustomWebhookHealth(),
        }
      };

      let response = `:gear: *Custom System Status*\n\n`;

      response += `*Integrations:* ${status.customIntegrationsActive ? ':white_check_mark:' : ':x:'}\n`;
      response += `*Custom Metrics:* ${status.customMetricsCount} recorded\n`;

      response += `\n*Health Checks:*\n`;
      response += `• External API: ${status.customHealthChecks.externalApi ? ':white_check_mark:' : ':x:'}\n`;
      response += `• Custom Webhook: ${status.customHealthChecks.customWebhook ? ':white_check_mark:' : ':x:'}\n`;

      if (status.lastCustomEvent) {
        response += `\n*Last Custom Event:* ${status.lastCustomEvent}`;
      }

      await respond(response);

    } catch (error) {
      logger.error({ error: error.message }, 'Failed to get custom status');
      await respond(`:x: Failed to get custom status: ${error.message}`);
    }
  }

  private async checkExternalApiHealth(): Promise<boolean> {
    // Implement external API health check
    return true;
  }

  private async checkCustomWebhookHealth(): Promise<boolean> {
    // Implement custom webhook health check
    return true;
  }
}
```

### Registering Custom Commands

**File:** `packages/cloud/src/slack/admin-commands/index.ts`

```typescript
import { CustomCommands } from './custom-commands.js';

export const customCommands = {
  'custom-metrics': async (ctx: AdminContext, args: string[]) => {
    const customCmds = new CustomCommands(ctx.appContext, ctx.customMetricRepo);
    await customCmds.customMetrics(ctx.respond, args);
  },

  'custom-events': async (ctx: AdminContext, args: string[]) => {
    const customCmds = new CustomCommands(ctx.appContext, ctx.customMetricRepo);
    await customCmds.customEvents(ctx.respond, args);
  },

  'custom-status': async (ctx: AdminContext) => {
    const customCmds = new CustomCommands(ctx.appContext, ctx.customMetricRepo);
    await customCmds.customStatus(ctx.respond);
  }
};
```

## Custom Metrics and Monitoring

### Custom Metrics Collector

**File:** `packages/cloud/src/monitoring/custom-metrics.ts`

```typescript
import { createLogger, generateId } from '@bematic/common';
import type { CustomMetricRepository } from '@bematic/db';

const logger = createLogger('custom-metrics');

export interface CustomMetric {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp?: Date;
}

export class CustomMetricsCollector {
  constructor(
    private readonly repo: CustomMetricRepository,
    private readonly agentId: string
  ) {}

  async recordMetric(metric: CustomMetric): Promise<void> {
    try {
      await this.repo.create({
        agentId: this.agentId,
        metricName: metric.name,
        value: metric.value,
        tags: metric.tags || {},
      });

      logger.debug({ metric }, 'Custom metric recorded');

    } catch (error) {
      logger.error({ error: error.message, metric }, 'Failed to record custom metric');
    }
  }

  async recordBatch(metrics: CustomMetric[]): Promise<void> {
    for (const metric of metrics) {
      await this.recordMetric(metric);
    }
  }

  // Convenience methods for common metric types
  async recordCounter(name: string, value: number = 1, tags?: Record<string, string>): Promise<void> {
    await this.recordMetric({ name, value, tags });
  }

  async recordGauge(name: string, value: number, tags?: Record<string, string>): Promise<void> {
    await this.recordMetric({ name, value, tags });
  }

  async recordTimer(name: string, durationMs: number, tags?: Record<string, string>): Promise<void> {
    await this.recordMetric({ name, value: durationMs, tags: { ...tags, unit: 'ms' } });
  }

  // High-level metrics for common scenarios
  async recordTaskMetrics(taskId: string, metrics: {
    duration?: number;
    tokenCount?: number;
    cost?: number;
    filesChanged?: number;
  }): Promise<void> {
    const baseTagas = { taskId };

    const promises = [];

    if (metrics.duration !== undefined) {
      promises.push(this.recordTimer('task.duration', metrics.duration, baseTagas));
    }

    if (metrics.tokenCount !== undefined) {
      promises.push(this.recordGauge('task.tokens', metrics.tokenCount, baseTagas));
    }

    if (metrics.cost !== undefined) {
      promises.push(this.recordGauge('task.cost', metrics.cost, baseTagas));
    }

    if (metrics.filesChanged !== undefined) {
      promises.push(this.recordGauge('task.files_changed', metrics.filesChanged, baseTagas));
    }

    await Promise.all(promises);
  }
}
```

### Custom Health Checks

**File:** `packages/cloud/src/monitoring/custom-health.ts`

```typescript
export interface CustomHealthCheck {
  name: string;
  check: () => Promise<{ healthy: boolean; message?: string; details?: any }>;
  timeout: number; // milliseconds
  critical: boolean; // Whether failure should mark system as unhealthy
}

export class CustomHealthMonitor {
  private checks = new Map<string, CustomHealthCheck>();

  registerCheck(check: CustomHealthCheck): void {
    this.checks.set(check.name, check);
  }

  unregisterCheck(name: string): void {
    this.checks.delete(name);
  }

  async runAllChecks(): Promise<{
    overall: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, { status: 'pass' | 'fail'; message?: string; duration: number }>;
  }> {
    const results: Record<string, any> = {};
    let criticalFailures = 0;
    let totalFailures = 0;

    for (const [name, check] of this.checks) {
      const startTime = Date.now();

      try {
        const result = await Promise.race([
          check.check(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
          )
        ]) as { healthy: boolean; message?: string };

        const duration = Date.now() - startTime;

        results[name] = {
          status: result.healthy ? 'pass' : 'fail',
          message: result.message,
          duration
        };

        if (!result.healthy) {
          totalFailures++;
          if (check.critical) {
            criticalFailures++;
          }
        }

      } catch (error) {
        const duration = Date.now() - startTime;

        results[name] = {
          status: 'fail',
          message: error.message,
          duration
        };

        totalFailures++;
        if (check.critical) {
          criticalFailures++;
        }
      }
    }

    // Determine overall health
    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (criticalFailures > 0) {
      overall = 'unhealthy';
    } else if (totalFailures > 0) {
      overall = 'degraded';
    }

    return { overall, checks: results };
  }

  // Example custom health checks
  static createDatabaseCheck(db: any): CustomHealthCheck {
    return {
      name: 'database',
      timeout: 5000,
      critical: true,
      check: async () => {
        try {
          await db.raw('SELECT 1');
          return { healthy: true, message: 'Database connection OK' };
        } catch (error) {
          return { healthy: false, message: `Database error: ${error.message}` };
        }
      }
    };
  }

  static createExternalApiCheck(apiUrl: string, apiKey: string): CustomHealthCheck {
    return {
      name: 'external_api',
      timeout: 10000,
      critical: false,
      check: async () => {
        try {
          const response = await fetch(`${apiUrl}/health`, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });

          if (response.ok) {
            return { healthy: true, message: 'External API responding' };
          } else {
            return { healthy: false, message: `API returned ${response.status}` };
          }
        } catch (error) {
          return { healthy: false, message: `API unreachable: ${error.message}` };
        }
      }
    };
  }
}
```

## Plugin Development Guidelines

### Plugin Architecture Principles

1. **Separation of Concerns** - Each plugin should have a single, well-defined purpose
2. **Minimal Dependencies** - Plugins should minimize external dependencies
3. **Error Isolation** - Plugin failures shouldn't crash the main system
4. **Configuration-Driven** - Plugins should be configurable without code changes
5. **Testing** - All plugins should have comprehensive test coverage

### Plugin Base Class

**File:** `packages/common/src/plugins/base-plugin.ts`

```typescript
export abstract class BasePlugin {
  abstract name: string;
  abstract version: string;
  abstract description: string;

  protected logger = createLogger(`plugin:${this.name}`);
  protected config: PluginConfig;

  constructor(config: PluginConfig = {}) {
    this.config = config;
  }

  // Lifecycle methods
  async initialize(): Promise<void> {
    this.logger.info({ name: this.name, version: this.version }, 'Plugin initializing');
    await this.onInitialize();
  }

  async shutdown(): Promise<void> {
    this.logger.info({ name: this.name }, 'Plugin shutting down');
    await this.onShutdown();
  }

  // Override in subclasses
  protected async onInitialize(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}

  // Health check
  async healthCheck(): Promise<{ healthy: boolean; message?: string }> {
    try {
      const result = await this.onHealthCheck();
      return result || { healthy: true };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  protected async onHealthCheck(): Promise<{ healthy: boolean; message?: string }> {
    return { healthy: true };
  }

  // Configuration validation
  protected validateConfig(schema: any): void {
    // Use Zod or similar for validation
    try {
      schema.parse(this.config);
    } catch (error) {
      throw new Error(`Plugin ${this.name} configuration invalid: ${error.message}`);
    }
  }
}
```

### Plugin Manager

**File:** `packages/cloud/src/plugins/plugin-manager.ts`

```typescript
export class PluginManager {
  private plugins = new Map<string, BasePlugin>();
  private initialized = false;

  async loadPlugin(plugin: BasePlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} is already loaded`);
    }

    try {
      await plugin.initialize();
      this.plugins.set(plugin.name, plugin);

      logger.info({ name: plugin.name, version: plugin.version }, 'Plugin loaded successfully');
    } catch (error) {
      logger.error({ name: plugin.name, error: error.message }, 'Failed to load plugin');
      throw error;
    }
  }

  async unloadPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin ${name} is not loaded`);
    }

    try {
      await plugin.shutdown();
      this.plugins.delete(name);

      logger.info({ name }, 'Plugin unloaded successfully');
    } catch (error) {
      logger.error({ name, error: error.message }, 'Failed to unload plugin');
      throw error;
    }
  }

  async initializeAll(): Promise<void> {
    if (this.initialized) return;

    const results = await Promise.allSettled(
      Array.from(this.plugins.values()).map(plugin => plugin.initialize())
    );

    const failures = results
      .map((result, index) => ({ result, plugin: Array.from(this.plugins.values())[index] }))
      .filter(({ result }) => result.status === 'rejected');

    if (failures.length > 0) {
      logger.warn({ failures: failures.length }, 'Some plugins failed to initialize');
    }

    this.initialized = true;
  }

  async shutdownAll(): Promise<void> {
    if (!this.initialized) return;

    await Promise.allSettled(
      Array.from(this.plugins.values()).map(plugin => plugin.shutdown())
    );

    this.initialized = false;
  }

  getPlugin<T extends BasePlugin>(name: string): T | undefined {
    return this.plugins.get(name) as T;
  }

  getAllPlugins(): BasePlugin[] {
    return Array.from(this.plugins.values());
  }

  async healthCheckAll(): Promise<Record<string, { healthy: boolean; message?: string }>> {
    const results: Record<string, any> = {};

    await Promise.all(
      Array.from(this.plugins.entries()).map(async ([name, plugin]) => {
        try {
          results[name] = await plugin.healthCheck();
        } catch (error) {
          results[name] = { healthy: false, message: error.message };
        }
      })
    );

    return results;
  }
}
```

## Testing Custom Extensions

### Bot Testing Framework

**File:** `packages/bots/src/test/bot-test-framework.ts`

```typescript
import type { BotPlugin, ParsedCommand, BotExecutionConfig } from '@bematic/common';

export class BotTestFramework {
  constructor(private bot: BotPlugin) {}

  // Test command parsing
  testCommandParsing(input: string, expected: Partial<ParsedCommand>): void {
    const result = this.bot.parseCommand(input);

    expect(result.command).toBe(expected.command);
    expect(result.args).toBe(expected.args);

    if (expected.flags) {
      expect(result.flags).toEqual(expected.flags);
    }
  }

  // Test execution config generation
  testExecutionConfig(
    command: ParsedCommand,
    projectContext: any,
    expected: Partial<BotExecutionConfig>
  ): void {
    const config = this.bot.buildExecutionConfig(command, projectContext);

    expect(config.model).toBe(expected.model);
    expect(config.maxBudget).toBe(expected.maxBudget);
    expect(config.allowedTools).toEqual(expected.allowedTools);

    if (expected.systemPrompt) {
      expect(config.systemPrompt).toContain(expected.systemPrompt);
    }
  }

  // Test response formatting
  testResponseFormatting(input: any, expectedStructure: any): void {
    const formatted = this.bot.formatResult(input);

    expect(formatted).toMatchObject(expectedStructure);
  }

  // Integration test
  async testEndToEnd(input: string, mockProjectContext: any): Promise<BotExecutionConfig> {
    const command = this.bot.parseCommand(input);
    const config = this.bot.buildExecutionConfig(command, mockProjectContext);

    // Verify the full pipeline works
    expect(config.systemPrompt).toBeTruthy();
    expect(config.prompt).toBeTruthy();
    expect(config.model).toBeTruthy();
    expect(config.allowedTools.length).toBeGreaterThan(0);

    return config;
  }
}
```

### Integration Testing

**File:** `packages/cloud/src/test/integration-test-helpers.ts`

```typescript
export class IntegrationTestHelpers {
  static async testWebhookIntegration(
    integration: any,
    mockPayload: any
  ): Promise<void> {
    const req = mockRequest(mockPayload);
    const res = mockResponse();

    await integration.handleWebhook(req, res);

    expect(res.statusCode).toBe(200);
  }

  static async testCustomMessageHandler(
    handler: any,
    agentId: string,
    message: any
  ): Promise<void> {
    const mockAuditRepo = {
      log: jest.fn()
    };

    await handler.handleCustomMessage(agentId, JSON.stringify(message));

    expect(mockAuditRepo.log).toHaveBeenCalled();
  }

  static async testDatabaseExtensions(
    repo: any,
    sampleData: any
  ): Promise<void> {
    // Test creation
    const created = await repo.create(sampleData);
    expect(created.id).toBeTruthy();

    // Test retrieval
    const retrieved = await repo.findById(created.id);
    expect(retrieved).toEqual(created);

    // Test querying
    const queried = await repo.findByField('someField', sampleData.someField);
    expect(queried).toContain(created);
  }
}

// Mock helpers
function mockRequest(body: any) {
  return {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' }
  };
}

function mockResponse() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader: jest.fn(),
    end: jest.fn()
  };

  return res;
}
```

## Deployment and Distribution

### Plugin Packaging

**File:** `packages/plugins/my-custom-plugin/package.json`

```json
{
  "name": "@bematic/plugin-my-custom",
  "version": "1.0.0",
  "description": "Custom plugin for Bematic",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "prepublish": "npm run build"
  },
  "peerDependencies": {
    "@bematic/common": "workspace:*",
    "@bematic/db": "workspace:*"
  },
  "files": ["dist", "README.md"],
  "keywords": ["bematic", "plugin", "custom"],
  "bematic": {
    "pluginType": "integration",
    "requiredPermissions": ["database:read", "webhook:receive"],
    "supportedVersions": [">=1.0.0"]
  }
}
```

### Plugin Configuration

**File:** `packages/plugins/my-custom-plugin/config.schema.json`

```json
{
  "type": "object",
  "properties": {
    "apiKey": {
      "type": "string",
      "description": "API key for external service"
    },
    "webhookUrl": {
      "type": "string",
      "format": "uri",
      "description": "Webhook endpoint URL"
    },
    "enabledFeatures": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of enabled plugin features"
    },
    "rateLimitConfig": {
      "type": "object",
      "properties": {
        "maxRequests": { "type": "number", "minimum": 1 },
        "windowMs": { "type": "number", "minimum": 1000 }
      },
      "required": ["maxRequests", "windowMs"]
    }
  },
  "required": ["apiKey"],
  "additionalProperties": false
}
```

### Installation Guide

**Plugin Installation Instructions:**

1. **Install the plugin package:**
```bash
npm install @bematic/plugin-my-custom
```

2. **Configure the plugin:**
```typescript
// In your application startup
import { MyCustomPlugin } from '@bematic/plugin-my-custom';
import { PluginManager } from '@bematic/cloud';

const pluginManager = new PluginManager();

const customPlugin = new MyCustomPlugin({
  apiKey: process.env.CUSTOM_PLUGIN_API_KEY,
  webhookUrl: process.env.CUSTOM_WEBHOOK_URL,
  enabledFeatures: ['feature1', 'feature2']
});

await pluginManager.loadPlugin(customPlugin);
```

3. **Environment Variables:**
```bash
# Add to your .env file
CUSTOM_PLUGIN_API_KEY=your-api-key-here
CUSTOM_WEBHOOK_URL=https://your-webhook-url.com/webhook
```

4. **Register webhook endpoints** (if applicable):
```typescript
// Add to your server routes
app.post('/webhook/custom', customPlugin.handleWebhook.bind(customPlugin));
```

### Best Practices Summary

1. **Documentation** - Provide comprehensive documentation and examples
2. **Configuration** - Use JSON Schema for configuration validation
3. **Error Handling** - Implement robust error handling and logging
4. **Testing** - Include unit and integration tests
5. **Versioning** - Follow semantic versioning for releases
6. **Security** - Validate all inputs and secure sensitive data
7. **Performance** - Monitor resource usage and implement proper cleanup
8. **Monitoring** - Include health checks and custom metrics

## Related Documentation

- [05 - Package: @bematic/bots](./05-package-bots.md) - Bot architecture
- [06 - Package: @bematic/cloud](./06-package-cloud.md) - Cloud service integration
- [10 - Database Schema](./10-database-schema.md) - Database extension patterns
- [13 - Coding Conventions](./13-coding-conventions.md) - Development standards
- [15 - Advanced Patterns](./15-advanced-patterns.md) - Architecture patterns