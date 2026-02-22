import { exec } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { MessageType, createWSMessage, createLogger, type EnvUpdateRequestPayload } from '@bematic/common';
import type { WSClient } from '../connection/ws-client.js';

const logger = createLogger('agent');

export async function handleEnvUpdate(wsClient: WSClient, payload: EnvUpdateRequestPayload) {
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
        outputs.push('✓ Updated ' + envFile);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message, file: envFile }, 'Failed to update .env file');
        outputs.push('✗ Failed to update ' + envFile + ': ' + message);
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
        outputs.push('✓ Railway: ' + railwayOutput);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, 'Failed to update Railway variable');
        outputs.push('✗ Railway failed: ' + message);
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
  const backupPath = filePath + '.backup';
  writeFileSync(backupPath, content);

  const lines = content.split('\n');
  const keyPattern = new RegExp('^' + key + '=');
  let found = false;

  if (operation === 'add') {
    // Replace existing or append new
    const newLines = lines.map((line) => {
      if (keyPattern.test(line.trim())) {
        found = true;
        return key + '=' + value;
      }
      return line;
    });

    if (!found) {
      // Append to end
      newLines.push(key + '=' + value);
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
  const path = nodeBinDir + separator + (process.env.PATH || '');

  const env: Record<string, string | undefined> = { ...process.env, PATH: path };
  if (projectId) env.RAILWAY_PROJECT_ID = projectId;
  if (serviceId) env.RAILWAY_SERVICE_ID = serviceId;
  if (environmentId) env.RAILWAY_ENVIRONMENT_ID = environmentId;

  let command: string;
  if (operation === 'add') {
    // Use railway variable set KEY=VALUE --skip-deploys
    command = 'npx @railway/cli variable set ' + key + '="' + value + '" --skip-deploys';
  } else {
    // Use railway variable delete KEY --skip-deploys
    command = 'npx @railway/cli variable delete ' + key + ' --skip-deploys -y';
  }

  return new Promise<string>((resolve, reject) => {
    exec(command, {
      cwd,
      encoding: 'utf-8',
      timeout: 30_000,
      shell: process.platform === 'win32' ? (process.env.ComSpec || 'C:\Windows\System32\cmd.exe') : '/bin/bash',
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
