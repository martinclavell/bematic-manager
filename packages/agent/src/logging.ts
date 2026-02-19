import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', 'logs');
const LOG_FILE = join(LOGS_DIR, 'agent.log');

/**
 * Sets up file logging by piping process.stdout to a log file.
 * Pino already writes JSON to stdout, so we tee it to a file.
 */
export async function setupFileLogging(_level: string): Promise<void> {
  try {
    await mkdir(LOGS_DIR, { recursive: true });

    const logStream = createWriteStream(LOG_FILE, { flags: 'a' });

    // Override process.stdout.write to tee output to the log file
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: any, ...args: any[]) => {
      logStream.write(chunk);
      return originalWrite(chunk, ...args);
    };

    const originalErrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: any, ...args: any[]) => {
      logStream.write(chunk);
      return originalErrWrite(chunk, ...args);
    };

    // Flush on exit
    process.on('exit', () => {
      logStream.end();
    });
  } catch {
    // If file logging fails, don't crash - just log to console
    console.error('Failed to setup file logging, continuing with console only');
  }
}

export function getLogFilePath(): string {
  return LOG_FILE;
}
