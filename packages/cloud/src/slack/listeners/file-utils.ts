import { createLogger, type FileAttachment } from '@bematic/common';

const logger = createLogger('slack:file-utils');

/** Max size per file: 10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;
/** Max total size across all files: 20MB */
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;

interface SlackFile {
  url_private_download?: string;
  url_private: string;
  name: string;
  mimetype: string;
  filetype: string;
  size?: number;
}

/**
 * Download files from Slack and return them as base64-encoded attachments.
 * Uses the bot token for authenticated access to private file URLs.
 */
export async function downloadSlackFiles(
  files: SlackFile[] | undefined | null,
  botToken: string,
): Promise<FileAttachment[]> {
  if (!files || files.length === 0) return [];

  const attachments: FileAttachment[] = [];
  let totalSize = 0;

  for (const file of files) {
    const downloadUrl = file.url_private_download || file.url_private;
    if (!downloadUrl) continue;

    // Check individual file size (if Slack provides it)
    if (file.size && file.size > MAX_FILE_SIZE) {
      logger.warn(
        { name: file.name, size: file.size, maxSize: MAX_FILE_SIZE },
        'Skipping file — exceeds size limit',
      );
      continue;
    }

    // Check total size budget
    if (file.size && totalSize + file.size > MAX_TOTAL_SIZE) {
      logger.warn(
        { name: file.name, totalSize, maxTotalSize: MAX_TOTAL_SIZE },
        'Skipping file — total size limit reached',
      );
      continue;
    }

    try {
      const response = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${botToken}` },
      });

      if (!response.ok) {
        logger.error(
          { name: file.name, status: response.status, statusText: response.statusText },
          'Failed to download file from Slack',
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Double-check size after download
      if (buffer.length > MAX_FILE_SIZE) {
        logger.warn({ name: file.name, size: buffer.length }, 'Downloaded file exceeds size limit, skipping');
        continue;
      }

      totalSize += buffer.length;
      if (totalSize > MAX_TOTAL_SIZE) {
        logger.warn({ name: file.name, totalSize }, 'Total size limit reached after download');
        break;
      }

      attachments.push({
        name: file.name,
        mimetype: file.mimetype || 'application/octet-stream',
        data: buffer.toString('base64'),
        size: buffer.length,
      });

      logger.info(
        { name: file.name, mimetype: file.mimetype, size: buffer.length },
        'Downloaded file from Slack',
      );
    } catch (error) {
      logger.error(
        { name: file.name, error: error instanceof Error ? error.message : String(error) },
        'Error downloading file from Slack',
      );
    }
  }

  return attachments;
}

/**
 * Build a text description of attached files for the prompt.
 * Used as a fallback and for logging.
 */
export function describeAttachments(attachments: FileAttachment[]): string {
  if (attachments.length === 0) return '';

  const descriptions = attachments.map((a) => {
    const sizeKb = Math.round(a.size / 1024);
    return `- ${a.name} (${a.mimetype}, ${sizeKb}KB)`;
  });

  return `Attached files:\n${descriptions.join('\n')}`;
}
