import { createLogger } from '@bematic/common';

const logger = createLogger('slack:file-utils');

interface SlackFile {
  url_private: string;
  name: string;
  mimetype: string;
  filetype: string;
}

/**
 * Extract file information from Slack message files and return a text
 * description that can be appended to the prompt.
 *
 * For images, includes the private URL so the AI agent is aware an image
 * was attached. For other file types, lists them by name and type.
 */
export function extractFileInfo(
  files: SlackFile[] | undefined | null,
): string | null {
  if (!files || files.length === 0) return null;

  const parts: string[] = [];

  for (const file of files) {
    if (!file.url_private) continue;

    if (file.mimetype?.startsWith('image/')) {
      parts.push(`[Attached image: ${file.name}](${file.url_private})`);
    } else {
      parts.push(
        `[Attached file: ${file.name} (${file.mimetype || file.filetype})](${file.url_private})`,
      );
    }
  }

  if (parts.length === 0) return null;

  logger.debug({ fileCount: parts.length }, 'Extracted file info from message');
  return parts.join('\n');
}
