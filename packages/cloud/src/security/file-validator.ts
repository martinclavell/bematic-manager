import { createLogger } from '@bematic/common';

const logger = createLogger('security:file-validator');

/**
 * File validation result with security metadata
 */
export interface FileValidationResult {
  isValid: boolean;
  reason?: string;
  securityLevel: 'safe' | 'caution' | 'blocked';
  detectedMimeType?: string;
  detectedExtension?: string;
}

/**
 * Magic number signatures for file type detection
 */
const MAGIC_NUMBERS: Record<string, Buffer[]> = {
  'image/png': [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  'image/jpeg': [
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE1]),
    Buffer.from([0xFF, 0xD8, 0xFF, 0xE2]),
    Buffer.from([0xFF, 0xD8, 0xFF, 0xDB]),
  ],
  'image/gif': [
    Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), // GIF87a
    Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
  ],
  'image/svg+xml': [Buffer.from('<?xml')],
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])], // %PDF
  'application/zip': [
    Buffer.from([0x50, 0x4B, 0x03, 0x04]), // PK..
    Buffer.from([0x50, 0x4B, 0x05, 0x06]), // Empty zip
    Buffer.from([0x50, 0x4B, 0x07, 0x08]), // Spanned zip
  ],
  'text/plain': [Buffer.from([0xEF, 0xBB, 0xBF])], // UTF-8 BOM (optional)
  'application/json': [Buffer.from([0x7B]), Buffer.from([0x5B])], // { or [
  'application/xml': [Buffer.from('<?xml')],
  // Microsoft Office formats
  'application/msword': [Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    Buffer.from([0x50, 0x4B, 0x03, 0x04])
  ],
  // Executable signatures (for blocking)
  'application/x-executable': [
    Buffer.from([0x4D, 0x5A]), // MZ (Windows PE)
    Buffer.from([0x7F, 0x45, 0x4C, 0x46]), // ELF
    Buffer.from([0xFE, 0xED, 0xFA, 0xCE]), // Mach-O 32-bit
    Buffer.from([0xFE, 0xED, 0xFA, 0xCF]), // Mach-O 64-bit
  ]
};

/**
 * MIME types allowed for upload (whitelist approach)
 */
const ALLOWED_MIME_TYPES = new Set([
  // Text formats
  'text/plain',
  'text/markdown',
  'text/csv',
  // Code formats
  'text/x-python',
  'text/x-javascript',
  'application/javascript',
  'text/x-typescript',
  'application/json',
  'application/xml',
  'text/xml',
  'text/html',
  'text/css',
  'application/x-yaml',
  'text/yaml',
  // Document formats
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Image formats
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  // Archive formats (with caution)
  'application/zip',
  'application/x-tar',
  'application/gzip',
]);

/**
 * File extensions that are blocked regardless of MIME type
 */
const BLOCKED_EXTENSIONS = new Set([
  // Executable files
  '.exe', '.dll', '.so', '.dylib', '.app', '.deb', '.rpm',
  // Script files (unless explicitly allowed via MIME)
  '.sh', '.bat', '.ps1', '.cmd', '.com', '.scr', '.pif',
  // System files
  '.sys', '.drv', '.vxd', '.ocx',
  // Potentially dangerous
  '.msi', '.jar', '.class',
  // Macro-enabled documents
  '.docm', '.xlsm', '.pptm', '.dotm', '.xltm',
]);

/**
 * File extensions that require additional caution
 */
const CAUTION_EXTENSIONS = new Set([
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.svg', // Can contain scripts
  '.html', '.htm', // Can contain scripts
]);

/**
 * Maximum file sizes by category (in bytes)
 */
export const FILE_SIZE_LIMITS = {
  image: 5 * 1024 * 1024,      // 5MB for images
  document: 10 * 1024 * 1024,  // 10MB for documents
  archive: 2 * 1024 * 1024,    // 2MB for archives (security)
  text: 1024 * 1024,           // 1MB for text files
  default: 10 * 1024 * 1024,   // 10MB default
};

/**
 * Detect file type from magic number/file signature
 */
function detectFileTypeFromMagic(buffer: Buffer): string | undefined {
  for (const [mimeType, signatures] of Object.entries(MAGIC_NUMBERS)) {
    for (const signature of signatures) {
      if (buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)) {
        return mimeType;
      }
    }
  }

  // Check for text files (fallback)
  const textSample = buffer.subarray(0, Math.min(1024, buffer.length)).toString('utf8');
  if (/^[\x09\x0A\x0D\x20-\x7E]*$/.test(textSample)) {
    return 'text/plain';
  }

  return undefined;
}

/**
 * Get file size limit based on MIME type category
 */
function getFileSizeLimit(mimeType: string): number {
  if (mimeType.startsWith('image/')) return FILE_SIZE_LIMITS.image;
  if (mimeType.startsWith('text/')) return FILE_SIZE_LIMITS.text;
  if (mimeType === 'application/pdf' || mimeType.includes('word') || mimeType.includes('excel')) {
    return FILE_SIZE_LIMITS.document;
  }
  if (mimeType === 'application/zip' || mimeType.includes('tar') || mimeType.includes('gzip')) {
    return FILE_SIZE_LIMITS.archive;
  }
  return FILE_SIZE_LIMITS.default;
}

/**
 * Extract file extension from filename
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot === -1 ? '' : filename.substring(lastDot).toLowerCase();
}

/**
 * Validate file based on security policies
 */
export function validateFile(
  filename: string,
  declaredMimeType: string,
  buffer: Buffer,
  maxSize?: number
): FileValidationResult {
  const extension = getFileExtension(filename);
  const detectedMimeType = detectFileTypeFromMagic(buffer);

  logger.debug({
    filename,
    extension,
    declaredMimeType,
    detectedMimeType,
    size: buffer.length
  }, 'Validating file');

  // Check for blocked extensions first
  if (BLOCKED_EXTENSIONS.has(extension)) {
    logger.warn({
      filename,
      extension,
      reason: 'blocked_extension'
    }, 'File blocked due to dangerous extension');

    return {
      isValid: false,
      reason: `File extension '${extension}' is not allowed for security reasons`,
      securityLevel: 'blocked',
      detectedMimeType,
      detectedExtension: extension
    };
  }

  // Check for executable files via magic number
  if (detectedMimeType === 'application/x-executable') {
    logger.warn({
      filename,
      detectedMimeType,
      reason: 'executable_detected'
    }, 'Executable file detected and blocked');

    return {
      isValid: false,
      reason: 'Executable files are not allowed for security reasons',
      securityLevel: 'blocked',
      detectedMimeType,
      detectedExtension: extension
    };
  }

  // Validate declared MIME type against whitelist
  if (!ALLOWED_MIME_TYPES.has(declaredMimeType)) {
    logger.warn({
      filename,
      declaredMimeType,
      reason: 'mime_not_whitelisted'
    }, 'File blocked due to non-whitelisted MIME type');

    return {
      isValid: false,
      reason: `File type '${declaredMimeType}' is not supported`,
      securityLevel: 'blocked',
      detectedMimeType,
      detectedExtension: extension
    };
  }

  // Check MIME type consistency (if we could detect it)
  if (detectedMimeType && detectedMimeType !== declaredMimeType) {
    // Allow some common variations
    const isAcceptableVariation =
      (declaredMimeType === 'text/plain' && detectedMimeType.startsWith('text/')) ||
      (declaredMimeType === 'application/octet-stream' && ALLOWED_MIME_TYPES.has(detectedMimeType));

    if (!isAcceptableVariation) {
      logger.warn({
        filename,
        declaredMimeType,
        detectedMimeType,
        reason: 'mime_mismatch'
      }, 'MIME type mismatch detected');

      return {
        isValid: false,
        reason: `File content doesn't match declared type. Declared: ${declaredMimeType}, Detected: ${detectedMimeType}`,
        securityLevel: 'blocked',
        detectedMimeType,
        detectedExtension: extension
      };
    }
  }

  // Check file size
  const sizeLimit = maxSize || getFileSizeLimit(declaredMimeType);
  if (buffer.length > sizeLimit) {
    logger.warn({
      filename,
      size: buffer.length,
      limit: sizeLimit,
      reason: 'size_exceeded'
    }, 'File size exceeds limit');

    return {
      isValid: false,
      reason: `File size (${Math.round(buffer.length / 1024)}KB) exceeds limit (${Math.round(sizeLimit / 1024)}KB)`,
      securityLevel: 'blocked',
      detectedMimeType,
      detectedExtension: extension
    };
  }

  // Determine security level
  let securityLevel: 'safe' | 'caution' | 'blocked' = 'safe';

  if (CAUTION_EXTENSIONS.has(extension) ||
      declaredMimeType === 'application/zip' ||
      declaredMimeType === 'image/svg+xml' ||
      declaredMimeType === 'text/html') {
    securityLevel = 'caution';

    logger.info({
      filename,
      declaredMimeType,
      reason: 'requires_caution'
    }, 'File flagged for caution');
  }

  // Additional checks for specific file types
  if (declaredMimeType === 'image/svg+xml') {
    // Basic check for script content in SVG
    const content = buffer.toString('utf8');
    if (content.includes('<script') || content.includes('javascript:') || content.includes('onload=')) {
      logger.warn({
        filename,
        reason: 'svg_script_detected'
      }, 'SVG contains potentially malicious scripts');

      return {
        isValid: false,
        reason: 'SVG files with embedded scripts are not allowed',
        securityLevel: 'blocked',
        detectedMimeType,
        detectedExtension: extension
      };
    }
  }

  logger.info({
    filename,
    declaredMimeType,
    detectedMimeType,
    size: buffer.length,
    securityLevel
  }, 'File validation successful');

  return {
    isValid: true,
    securityLevel,
    detectedMimeType,
    detectedExtension: extension
  };
}

/**
 * Placeholder for future virus scanning integration
 * This would integrate with services like ClamAV, VirusTotal, etc.
 */
export async function scanFileForViruses(
  filename: string,
  buffer: Buffer
): Promise<{ isClean: boolean; scanResult?: string }> {
  logger.debug({ filename, size: buffer.length }, 'Virus scanning placeholder called');

  // TODO: Integrate with actual virus scanning service
  // For now, just log the attempt and return clean
  return { isClean: true, scanResult: 'No scanner configured' };
}

/**
 * Comprehensive file security validation
 */
export async function validateFileSecurely(
  filename: string,
  declaredMimeType: string,
  buffer: Buffer,
  options: {
    maxSize?: number;
    enableVirusScanning?: boolean;
    strictMode?: boolean;
  } = {}
): Promise<FileValidationResult & { virusScanResult?: { isClean: boolean; scanResult?: string } }> {

  const validation = validateFile(filename, declaredMimeType, buffer, options.maxSize);

  if (!validation.isValid) {
    return validation;
  }

  // Perform virus scanning if enabled
  let virusScanResult;
  if (options.enableVirusScanning) {
    try {
      virusScanResult = await scanFileForViruses(filename, buffer);
      if (!virusScanResult.isClean) {
        logger.error({
          filename,
          scanResult: virusScanResult.scanResult
        }, 'File failed virus scan');

        return {
          isValid: false,
          reason: 'File failed security scan',
          securityLevel: 'blocked',
          detectedMimeType: validation.detectedMimeType,
          detectedExtension: validation.detectedExtension,
          virusScanResult
        };
      }
    } catch (error) {
      logger.error({
        filename,
        error: error instanceof Error ? error.message : String(error)
      }, 'Virus scanning failed');

      if (options.strictMode) {
        return {
          isValid: false,
          reason: 'Security scan failed',
          securityLevel: 'blocked',
          detectedMimeType: validation.detectedMimeType,
          detectedExtension: validation.detectedExtension
        };
      }
    }
  }

  return { ...validation, virusScanResult };
}

/**
 * Log suspicious file upload attempts for security monitoring
 */
export function logSuspiciousFile(
  filename: string,
  declaredMimeType: string,
  detectedMimeType: string | undefined,
  userContext: { userId?: string; channel?: string; timestamp?: string },
  reason: string
): void {
  logger.error({
    filename,
    declaredMimeType,
    detectedMimeType,
    userContext,
    reason,
    timestamp: new Date().toISOString(),
    severity: 'security_alert'
  }, 'SECURITY ALERT: Suspicious file upload attempt');
}