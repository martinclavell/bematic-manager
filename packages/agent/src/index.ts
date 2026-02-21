import 'dotenv/config';
import process from 'node:process';
process.setMaxListeners(20);
import { exec } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import {
  MessageType,
  createLogger,
  createWSMessage,
  taskSubmitSchema,
  type TaskSubmitPayload,
  type SystemRestartPayload,
  type DeployRequestPayload,
  type PathValidateRequestPayload,
  type EnvUpdateRequestPayload,
} from '@bematic/common';
import { loadAgentConfig } from './config.js';
import { setupGlobalErrorHandlers } from './error-handlers.js';
import { createShutdownHandler } from './shutdown.js';
import { WSClient } from './connection/ws-client.js';
import { setupHeartbeat } from './connection/heartbeat.js';
import { ClaudeExecutor } from './executor/claude-executor.js';
import { QueueProcessor } from './executor/queue-processor.js';
import { setupFileLogging } from './logging.js';
import { ResourceMonitor } from './monitoring/resource-monitor.js';

/** Exit code 75 signals the wrapper script to restart the agent */
const RESTART_EXIT_CODE = 75;

const logger = createLogger('agent');

// Setup global error handlers first
setupGlobalErrorHandlers();

async function main() {
  const config = loadAgentConfig();

  // Setup file logging
  setupFileLogging(config.logLevel);

  logger.info({ agentId: config.agentId }, 'Starting Bematic Agent');

  // Initialize resource monitoring
  const resourceMonitor = new ResourceMonitor(config.resourceLimits);

  // Start monitoring resources immediately
  resourceMonitor.startMonitoring();

  logger.info(
    { limits: config.resourceLimits },
    'Resource monitoring started with configured limits'
  );

  // Initialize WebSocket client
  const wsClient = new WSClient(config);

  // Initialize executor and queue processor with resource monitoring
  const executor = new ClaudeExecutor(wsClient, config.maxContinuations, config.resourceLimits);
  const queueProcessor = new QueueProcessor(executor, config.maxConcurrentTasks, resourceMonitor);

  // Setup resource monitoring event handlers
  resourceMonitor.on('resource-limit', (event) => {
    logger.warn(
      {
        resource: event.resource,
        usage: event.usage,
        limit: event.limit,
        action: event.type,
        healthScore: event.status.healthScore,
      },
      `Resource limit triggered: ${event.type}`
    );

    // Handle different resource actions
    switch (event.type) {
      case 'reject_new_tasks':
        // Queue processor will check canAcceptNewTasks() before processing
        break;

      case 'cancel_lowest_priority':
        // Cancel the task with lowest priority (oldest task in queue)
        const cancelledTaskId = queueProcessor.cancelLowestPriorityTask();
        if (cancelledTaskId) {
          wsClient.send(
            createWSMessage(MessageType.TASK_CANCELLED, {
              taskId: cancelledTaskId,
              reason: `Resource exhaustion: ${event.resource} at ${event.usage.toFixed(1)}%`,
            }),
          );
          logger.warn({ taskId: cancelledTaskId }, 'Cancelled task due to resource exhaustion');
        }
        break;

      case 'graceful_shutdown':
        logger.error(
          { resource: event.resource, usage: event.usage },
          'Resource exhaustion detected - initiating graceful shutdown'
        );
        shutdown('RESOURCE_EXHAUSTION', RESTART_EXIT_CODE);
        break;
    }
  });

  // Setup heartbeat responses with resource status
  setupHeartbeat(wsClient, config.agentId, queueProcessor);

  // Handle incoming messages from cloud
  wsClient.on('message', (msg) => {
    const parsed = msg as { type: string; payload: unknown };

    switch (parsed.type) {
      case MessageType.TASK_SUBMIT: {
        const result = taskSubmitSchema.safeParse(parsed.payload);
        if (!result.success) {
          logger.error({ errors: result.error.issues }, 'Invalid task submit payload');
          return;
        }

        try {
          queueProcessor.submit(result.data as TaskSubmitPayload);
        } catch (error) {
          // Handle resource limit rejections
          const taskPayload = result.data as TaskSubmitPayload;
          const errorMessage = error instanceof Error ? error.message : String(error);

          logger.error(
            { taskId: taskPayload.taskId, error: errorMessage },
            'Task submission failed due to resource limits'
          );

          wsClient.send(
            createWSMessage(MessageType.TASK_ERROR, {
              taskId: taskPayload.taskId,
              error: errorMessage,
              recoverable: false,
              sessionId: null,
            }),
          );
        }
        break;
      }

      case MessageType.TASK_CANCEL: {
        const payload = parsed.payload as { taskId: string; reason: string };
        const cancelled = queueProcessor.cancel(payload.taskId);
        if (cancelled) {
          wsClient.send(
            createWSMessage(MessageType.TASK_CANCELLED, {
              taskId: payload.taskId,
              reason: payload.reason,
            }),
          );
        }
        break;
      }

      case MessageType.DEPLOY_REQUEST: {
        const payload = parsed.payload as DeployRequestPayload;
        logger.info({ requestId: payload.requestId, localPath: payload.localPath }, 'Deploy request received');
        handleDeploy(wsClient, payload);
        break;
      }

      case MessageType.PATH_VALIDATE_REQUEST: {
        const payload = parsed.payload as PathValidateRequestPayload;
        logger.info({ requestId: payload.requestId, localPath: payload.localPath }, 'Path validation request received');
        handlePathValidate(wsClient, payload);
        break;
      }

      case MessageType.ENV_UPDATE_REQUEST: {
        const payload = parsed.payload as EnvUpdateRequestPayload;
        logger.info({ requestId: payload.requestId, operation: payload.operation, key: payload.key }, 'Env update request received');
        handleEnvUpdate(wsClient, payload);
        break;
      }

      case MessageType.SYSTEM_SHUTDOWN: {
        logger.info('Received shutdown signal from cloud');
        shutdown('SYSTEM_SHUTDOWN', 0);
        break;
      }

      case MessageType.SYSTEM_RESTART: {
        const payload = parsed.payload as SystemRestartPayload;
        logger.info({ reason: payload.reason, rebuild: payload.rebuild }, 'Received restart signal from cloud');
        shutdown('SYSTEM_RESTART', RESTART_EXIT_CODE);
        break;
      }

      default:
        logger.debug({ type: parsed.type }, 'Unhandled message type');
    }
  });

  // On connection, send agent status with resource information
  wsClient.on('authenticated', () => {
    const resourceStatus = resourceMonitor.reportStatus();
    wsClient.send(
      createWSMessage(MessageType.AGENT_STATUS, {
        agentId: config.agentId,
        status: 'online',
        activeTasks: queueProcessor.getActiveTasks(),
        version: '1.0.0',
        resourceStatus: {
          healthScore: resourceStatus.healthScore,
          memoryUsagePercent: resourceStatus.memory.percentUsed,
          cpuUsagePercent: resourceStatus.cpu.percent,
          canAcceptTasks: resourceMonitor.canAcceptNewTasks(),
        },
      }),
    );
  });

  wsClient.on('disconnected', () => {
    logger.warn('Disconnected from cloud. Tasks will continue locally.');
  });

  // Connect to cloud
  wsClient.connect();

  // Graceful shutdown using new handler with resource monitor
  const shutdown = createShutdownHandler({
    wsClient,
    queueProcessor,
    executor,
    agentId: config.agentId,
    resourceMonitor,
  });

  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('SIGINT', () => shutdown('SIGINT', 0));

  logger.info('Bematic Agent fully initialized');
}

async function handlePathValidate(wsClient: WSClient, payload: PathValidateRequestPayload) {
  try {
    logger.info({ localPath: payload.localPath }, 'Validating local path...');

    const pathExists = existsSync(payload.localPath);
    let created = false;

    if (!pathExists) {
      logger.info({ localPath: payload.localPath }, 'Path does not exist, creating...');
      await mkdir(payload.localPath, { recursive: true });
      created = true;
      logger.info({ localPath: payload.localPath }, 'Path created successfully');
    } else {
      logger.info({ localPath: payload.localPath }, 'Path already exists');
    }

    wsClient.send(
      createWSMessage(MessageType.PATH_VALIDATE_RESULT, {
        requestId: payload.requestId,
        success: true,
        exists: pathExists,
        created,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message, localPath: payload.localPath }, 'Path validation failed');
    wsClient.send(
      createWSMessage(MessageType.PATH_VALIDATE_RESULT, {
        requestId: payload.requestId,
        success: false,
        exists: false,
        created: false,
        error: message,
      }),
    );
  }
}

function handleDeploy(wsClient: WSClient, payload: DeployRequestPayload) {
  logger.info({ localPath: payload.localPath }, 'Running Railway deployment...');

  const command = 'npx @railway/cli up --detach';

  // Derive node bin dir from running process so npx is always found
  const nodeBinDir = dirname(process.execPath);
  const separator = process.platform === 'win32' ? ';' : ':';
  const deployPath = `${nodeBinDir}${separator}${process.env.PATH || ''}`;

  // Build deploy environment: pass through host env (includes Railway browser auth)
  // but remove RAILWAY_TOKEN/RAILWAY_API_TOKEN so they don't override browser session.
  // Project targeting comes from the payload (configured via /bm config).
  const deployEnv: Record<string, string | undefined> = { ...process.env, PATH: deployPath };
  delete deployEnv.RAILWAY_TOKEN;
  delete deployEnv.RAILWAY_API_TOKEN;
  if (payload.railwayProjectId) deployEnv.RAILWAY_PROJECT_ID = payload.railwayProjectId;
  if (payload.railwayServiceId) deployEnv.RAILWAY_SERVICE_ID = payload.railwayServiceId;
  if (payload.railwayEnvironmentId) deployEnv.RAILWAY_ENVIRONMENT_ID = payload.railwayEnvironmentId;

  logger.info({
    command,
    cwd: payload.localPath,
    hasProjectId: !!payload.railwayProjectId,
    hasServiceId: !!payload.railwayServiceId,
  }, 'Starting Railway deploy');

  exec(command, {
    cwd: payload.localPath,
    encoding: 'utf-8',
    timeout: 300_000,
    shell: process.platform === 'win32' ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : '/bin/bash',
    env: deployEnv,
  }, (err: Error | null, stdout: string, stderr: string) => {
    if (err) {
      const message = stderr || err.message;
      logger.error({
        error: message,
        stderr,
        stdout,
        cwd: payload.localPath,
        command,
        env: {
          hasRailwayToken: !!process.env.RAILWAY_TOKEN,
          path: process.env.PATH,
        }
      }, 'Deploy failed');
      wsClient.send(
        createWSMessage(MessageType.DEPLOY_RESULT, {
          requestId: payload.requestId,
          success: false,
          output: `Deployment failed:\n${message}\n\nCommand: ${command}\nDirectory: ${payload.localPath}`,
        }),
      );
      return;
    }

    const output = stdout.trim();
    const urlMatch = output.match(/(https:\/\/railway\.com\/[^\s]+)/);

    logger.info({ output, buildLogsUrl: urlMatch?.[1] }, 'Deploy succeeded');

    wsClient.send(
      createWSMessage(MessageType.DEPLOY_RESULT, {
        requestId: payload.requestId,
        success: true,
        output,
        buildLogsUrl: urlMatch?.[1],
      }),
    );
  });
}

async function handleEnvUpdate(wsClient: WSClient, payload: EnvUpdateRequestPayload) {
  logger.info({ localPath: payload.localPath, operation: payload.operation, key: payload.key }, 'Processing environment update...');

  const filesUpdated: string[] = [];
  const outputs: string[] = [];
  let railwayUpdated = false;

  try {
    // Find all .env files in the project directory
    const envFiles = findEnvFiles(payload.localPath);

    if (envFiles.length === 0) {
      throw new Error('No .env files found in project directory');
    }

    // Update each .env file
    for (const envFile of envFiles) {
      try {
        updateEnvFile(envFile, payload.operation, payload.key, payload.value);
        filesUpdated.push(envFile);
        outputs.push(`✓ Updated ${envFile}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message, file: envFile }, 'Failed to update .env file');
        outputs.push(`✗ Failed to update ${envFile}: ${message}`);
      }
    }

    // Update Railway if configured
    if (payload.railwayServiceId) {
      try {
        const railwayOutput = await updateRailwayVariable(
          payload.operation,
          payload.key,
          payload.value,
          payload.localPath,
          payload.railwayProjectId,
          payload.railwayServiceId,
          payload.railwayEnvironmentId
        );
        railwayUpdated = true;
        outputs.push(`✓ Railway: ${railwayOutput}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, 'Failed to update Railway variable');
        outputs.push(`✗ Railway failed: ${message}`);
        // Don't fail the whole operation if Railway fails
      }
    }

    wsClient.send(
      createWSMessage(MessageType.ENV_UPDATE_RESULT, {
        requestId: payload.requestId,
        success: true,
        operation: payload.operation,
        key: payload.key,
        filesUpdated,
        railwayUpdated,
        output: outputs.join('\n'),
      }),
    );

    logger.info({ requestId: payload.requestId, filesUpdated: filesUpdated.length, railwayUpdated }, 'Env update succeeded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message, localPath: payload.localPath }, 'Env update failed');
    wsClient.send(
      createWSMessage(MessageType.ENV_UPDATE_RESULT, {
        requestId: payload.requestId,
        success: false,
        operation: payload.operation,
        key: payload.key,
        filesUpdated,
        railwayUpdated: false,
        output: outputs.join('\n'),
        error: message,
      }),
    );
  }
}

/**
 * Find all .env files in project directory (root + packages/*).
 * Returns absolute paths.
 */
function findEnvFiles(projectPath: string): string[] {
  const envFiles: string[] = [];

  // Check root .env
  const rootEnv = join(projectPath, '.env');
  if (existsSync(rootEnv)) {
    envFiles.push(rootEnv);
  }

  // Check packages/agent/.env and packages/cloud/.env
  const packagesPath = join(projectPath, 'packages');
  if (existsSync(packagesPath)) {
    const agentEnv = join(packagesPath, 'agent', '.env');
    const cloudEnv = join(packagesPath, 'cloud', '.env');

    if (existsSync(agentEnv)) envFiles.push(agentEnv);
    if (existsSync(cloudEnv)) envFiles.push(cloudEnv);
  }

  return envFiles;
}

/**
 * Update a single .env file: add, update, or remove a key.
 * Creates backup before modifying.
 */
function updateEnvFile(filePath: string, operation: 'add' | 'remove', key: string, value?: string): void {
  // Read existing file
  let content = '';
  if (existsSync(filePath)) {
    content = readFileSync(filePath, 'utf-8');
  }

  // Backup
  const backupPath = `${filePath}.backup`;
  writeFileSync(backupPath, content);

  const lines = content.split('\n');
  const keyPattern = new RegExp(`^${key}=`);
  let found = false;

  if (operation === 'add') {
    // Replace existing or append new
    const newLines = lines.map((line) => {
      if (keyPattern.test(line.trim())) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });

    if (!found) {
      // Append to end
      newLines.push(`${key}=${value}`);
    }

    writeFileSync(filePath, newLines.join('\n'));
  } else if (operation === 'remove') {
    // Filter out the key
    const newLines = lines.filter((line) => !keyPattern.test(line.trim()));
    writeFileSync(filePath, newLines.join('\n'));
  }
}

/**
 * Update Railway environment variable using railway CLI.
 * Returns output on success, throws on error.
 */
async function updateRailwayVariable(
  operation: 'add' | 'remove',
  key: string,
  value: string | undefined,
  cwd: string,
  projectId?: string | null,
  serviceId?: string | null,
  environmentId?: string | null
): Promise<string> {
  const nodeBinDir = dirname(process.execPath);
  const separator = process.platform === 'win32' ? ';' : ':';
  const path = `${nodeBinDir}${separator}${process.env.PATH || ''}`;

  const env: Record<string, string | undefined> = { ...process.env, PATH: path };
  if (projectId) env.RAILWAY_PROJECT_ID = projectId;
  if (serviceId) env.RAILWAY_SERVICE_ID = serviceId;
  if (environmentId) env.RAILWAY_ENVIRONMENT_ID = environmentId;

  let command: string;
  if (operation === 'add') {
    // Use railway variable set KEY=VALUE --skip-deploys
    command = `npx @railway/cli variable set ${key}="${value}" --skip-deploys`;
  } else {
    // Use railway variable delete KEY --skip-deploys
    command = `npx @railway/cli variable delete ${key} --skip-deploys -y`;
  }

  return new Promise<string>((resolve, reject) => {
    exec(command, {
      cwd,
      encoding: 'utf-8',
      timeout: 30_000,
      shell: process.platform === 'win32' ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : '/bin/bash',
      env,
    }, (err, stdout, stderr) => {
      if (err) {
        const message = stderr || err.message;
        reject(new Error(message));
        return;
      }
      resolve(stdout.trim() || 'Variable updated');
    });
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start agent');
  process.exit(1);
});
