import { createLogger, type FileAttachment } from '@bematic/common';
import { validateFileSecurely, logSuspiciousFile, type FileValidationResult } from '../../security/file-validator.js';

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

interface FileValidationContext {
  userId?: string;
  channelId?: string;
  timestamp?: string;
}

interface FileUploadConfig {
  maxFileSize: number;
  maxTotalSize: number;
  enableVirusScanning: boolean;
  strictValidation: boolean;
  allowArchives: boolean;
  maxArchiveSize: number;
}

/**
 * Validate a single file for security compliance
 */
async function validateSlackFile(
  file: SlackFile,
  buffer: Buffer,
  config: FileUploadConfig,
  context: FileValidationContext
): Promise<{ isValid: boolean; reason?: string; validationResult?: FileValidationResult }> {
  try {
    const validationResult = await validateFileSecurely(
      file.name,
      file.mimetype || 'application/octet-stream',
      buffer,
      {
        maxSize: config.maxFileSize,
        enableVirusScanning: config.enableVirusScanning,
        strictMode: config.strictValidation
      }
    );

    if (!validationResult.isValid) {
      // Log suspicious file attempts
      logSuspiciousFile(
        file.name,
        file.mimetype || 'application/octet-stream',
        validationResult.detectedMimeType,
        context,
        validationResult.reason || 'File validation failed'
      );

      return {
        isValid: false,
        reason: validationResult.reason,
        validationResult
      };
    }

    // Additional checks for archive files
    if (!config.allowArchives && validationResult.detectedMimeType?.includes('zip')) {
      logSuspiciousFile(
        file.name,
        file.mimetype || 'application/octet-stream',
        validationResult.detectedMimeType,
        context,
        'Archive files are disabled'
      );

      return {
        isValid: false,
        reason: 'Archive files are not allowed',
        validationResult
      };
    }

    // Check archive size limits
    if (validationResult.detectedMimeType?.includes('zip') ||
        validationResult.detectedMimeType?.includes('tar') ||
        validationResult.detectedMimeType?.includes('gzip')) {
      if (buffer.length > config.maxArchiveSize) {
        return {
          isValid: false,
          reason: `Archive file exceeds size limit (${Math.round(config.maxArchiveSize / 1024)}KB)`,
          validationResult
        };
      }
    }

    // Log security level for monitoring
    if (validationResult.securityLevel === 'caution') {
      logger.warn({
        filename: file.name,
        mimetype: file.mimetype,
        detectedMimeType: validationResult.detectedMimeType,
        size: buffer.length,
        context
      }, 'File flagged for caution but allowed');
    }

    return { isValid: true, validationResult };
  } catch (error) {
    logger.error({
      filename: file.name,
      error: error instanceof Error ? error.message : String(error)
    }, 'File validation error');

    return {
      isValid: false,
      reason: 'File validation failed due to internal error'
    };
  }
}

/**
 * Download files from Slack and return them as base64-encoded attachments.
 * Uses the bot token for authenticated access to private file URLs.
 * Now includes comprehensive security validation.
 */
export async function downloadSlackFiles(
  files: SlackFile[] | undefined | null,
  botToken: string,
  config?: FileUploadConfig,
  context?: FileValidationContext
): Promise<FileAttachment[]> {
  if (!files || files.length === 0) return [];

  // Use provided config or fallback to defaults
  const fileConfig: FileUploadConfig = config || {
    maxFileSize: MAX_FILE_SIZE,
    maxTotalSize: MAX_TOTAL_SIZE,
    enableVirusScanning: false,
    strictValidation: false,
    allowArchives: true,
    maxArchiveSize: 2 * 1024 * 1024, // 2MB for archives
  };

  const validationContext: FileValidationContext = context || {};

  const attachments: FileAttachment[] = [];
  let totalSize = 0;

  logger.info({
    fileCount: files.length,
    config: fileConfig,
    context: validationContext
  }, 'Starting secure file download and validation');

  for (const file of files) {
    const downloadUrl = file.url_private_download || file.url_private;
    if (!downloadUrl) continue;

    // Check individual file size (if Slack provides it)
    if (file.size && file.size > fileConfig.maxFileSize) {
      logger.warn(
        { name: file.name, size: file.size, maxSize: fileConfig.maxFileSize },
        'Skipping file — exceeds size limit',
      );
      continue;
    }

    // Check total size budget
    if (file.size && totalSize + file.size > fileConfig.maxTotalSize) {
      logger.warn(
        { name: file.name, totalSize, maxTotalSize: fileConfig.maxTotalSize },
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
      if (buffer.length > fileConfig.maxFileSize) {
        logger.warn({ name: file.name, size: buffer.length }, 'Downloaded file exceeds size limit, skipping');
        continue;
      }

      // Perform comprehensive security validation
      const validation = await validateSlackFile(file, buffer, fileConfig, validationContext);
      if (!validation.isValid) {
        logger.warn({
          name: file.name,
          reason: validation.reason,
          securityLevel: validation.validationResult?.securityLevel
        }, 'File failed security validation, skipping');
        continue;
      }

      totalSize += buffer.length;
      if (totalSize > fileConfig.maxTotalSize) {
        logger.warn({ name: file.name, totalSize }, 'Total size limit reached after download');
        break;
      }

      // Use validated MIME type if different from declared
      const finalMimeType = validation.validationResult?.detectedMimeType || file.mimetype || 'application/octet-stream';

      attachments.push({
        name: file.name,
        mimetype: finalMimeType,
        data: buffer.toString('base64'),
        size: buffer.length,
      });

      logger.info(
        {
          name: file.name,
          declaredMimeType: file.mimetype,
          detectedMimeType: validation.validationResult?.detectedMimeType,
          finalMimeType,
          size: buffer.length,
          securityLevel: validation.validationResult?.securityLevel
        },
        'File validated and downloaded from Slack',
      );
    } catch (error) {
      logger.error(
        { name: file.name, error: error instanceof Error ? error.message : String(error) },
        'Error downloading file from Slack',
      );
    }
  }

  logger.info({
    totalFiles: files.length,
    validatedFiles: attachments.length,
    totalSize,
    averageFileSize: attachments.length > 0 ? Math.round(totalSize / attachments.length) : 0
  }, 'File download and validation completed');

  return attachments;
}

/**
 * Create FileUploadConfig from main application config
 */
export function createFileUploadConfig(appConfig: {
  fileUpload: {
    maxFileSize: number;
    maxTotalSize: number;
    enableVirusScanning: boolean;
    strictValidation: boolean;
    allowArchives: boolean;
    maxArchiveSize: number;
  };
}): FileUploadConfig {
  return {
    maxFileSize: appConfig.fileUpload.maxFileSize,
    maxTotalSize: appConfig.fileUpload.maxTotalSize,
    enableVirusScanning: appConfig.fileUpload.enableVirusScanning,
    strictValidation: appConfig.fileUpload.strictValidation,
    allowArchives: appConfig.fileUpload.allowArchives,
    maxArchiveSize: appConfig.fileUpload.maxArchiveSize,
  };
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
