import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { MessageType, createWSMessage, createLogger, type PathValidateRequestPayload } from '@bematic/common';
import type { WSClient } from '../connection/ws-client.js';

const logger = createLogger('agent');

export async function handlePathValidate(wsClient: WSClient, payload: PathValidateRequestPayload) {
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
