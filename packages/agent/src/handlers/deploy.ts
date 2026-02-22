import { exec } from 'node:child_process';
import { dirname } from 'node:path';
import process from 'node:process';
import { MessageType, createWSMessage, createLogger, type DeployRequestPayload } from '@bematic/common';
import type { WSClient } from '../connection/ws-client.js';

const logger = createLogger('agent');

export function handleDeploy(wsClient: WSClient, payload: DeployRequestPayload) {
  logger.info({ localPath: payload.localPath }, 'Running Railway deployment...');

  const command = 'npx @railway/cli up --detach';

  // Derive node bin dir from running process so npx is always found
  const nodeBinDir = dirname(process.execPath);
  const separator = process.platform === 'win32' ? ';' : ':';
  const deployPath = nodeBinDir + separator + (process.env.PATH || '');

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
    shell: process.platform === 'win32' ? (process.env.ComSpec || 'C:\Windows\System32\cmd.exe') : '/bin/bash',
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
          output: 'Deployment failed:\n' + message + '\n\nCommand: ' + command + '\nDirectory: ' + payload.localPath,
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
