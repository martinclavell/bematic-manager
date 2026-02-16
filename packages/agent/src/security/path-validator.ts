import * as path from 'node:path';
import { createLogger, ValidationError } from '@bematic/common';

const logger = createLogger('path-validator');

/** Set of registered project directories (absolute, normalized) */
const registeredPaths = new Set<string>();

export function registerProjectPath(localPath: string): void {
  const normalized = path.resolve(localPath);
  registeredPaths.add(normalized);
  logger.info({ path: normalized }, 'Registered project path');
}

export function validatePath(targetPath: string): void {
  const normalized = path.resolve(targetPath);

  for (const registered of registeredPaths) {
    if (normalized === registered || normalized.startsWith(registered + path.sep)) {
      return; // Path is within a registered project directory
    }
  }

  throw new ValidationError(
    `Path "${targetPath}" is outside registered project directories`,
  );
}

export function isPathValid(targetPath: string): boolean {
  try {
    validatePath(targetPath);
    return true;
  } catch {
    return false;
  }
}
