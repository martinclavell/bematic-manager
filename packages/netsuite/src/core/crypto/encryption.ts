import crypto from 'node:crypto';
import { NetSuiteConfigError } from '../../errors/netsuite-error.js';

export interface EncryptionOptions {
  /** Encryption key (32 bytes for AES-256) */
  key: Buffer;
  /** Algorithm (default: aes-256-gcm) */
  algorithm?: string;
}

/**
 * AES-256-GCM encryption/decryption for NetSuite credentials
 */
export class CredentialEncryption {
  private readonly key: Buffer;
  private readonly algorithm: string;

  constructor(options: EncryptionOptions) {
    this.key = options.key;
    this.algorithm = options.algorithm || 'aes-256-gcm';

    if (this.key.length !== 32) {
      throw new NetSuiteConfigError('Encryption key must be 32 bytes (256 bits)');
    }
  }

  /**
   * Create from hex-encoded key string
   */
  static fromHexKey(hexKey: string): CredentialEncryption {
    if (hexKey.length !== 64) {
      throw new NetSuiteConfigError('Hex encryption key must be 64 characters (32 bytes)');
    }

    const key = Buffer.from(hexKey, 'hex');
    return new CredentialEncryption({ key });
  }

  /**
   * Encrypt plaintext credential
   * @returns Encrypted string in format: iv:authTag:ciphertext (all hex-encoded)
   */
  encrypt(plaintext: string): string {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv) as crypto.CipherGCM;

      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      // Format: iv:authTag:encrypted
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      throw new NetSuiteConfigError('Failed to encrypt credential', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Decrypt encrypted credential
   * @param ciphertext Encrypted string in format: iv:authTag:ciphertext
   * @returns Decrypted plaintext
   */
  decrypt(ciphertext: string): string {
    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format (expected iv:authTag:ciphertext)');
      }

      const [ivHex, authTagHex, encrypted] = parts;
      const iv = Buffer.from(ivHex!, 'hex');
      const authTag = Buffer.from(authTagHex!, 'hex');

      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv) as crypto.DecipherGCM;
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted!, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new NetSuiteConfigError('Failed to decrypt credential', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Encrypt OAuth 1.0 credentials
   */
  encryptOAuth1(credentials: {
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
  }): {
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
  } {
    return {
      consumerKey: this.encrypt(credentials.consumerKey),
      consumerSecret: this.encrypt(credentials.consumerSecret),
      tokenId: this.encrypt(credentials.tokenId),
      tokenSecret: this.encrypt(credentials.tokenSecret),
    };
  }

  /**
   * Decrypt OAuth 1.0 credentials
   */
  decryptOAuth1(encrypted: {
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
  }): {
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
  } {
    return {
      consumerKey: this.decrypt(encrypted.consumerKey),
      consumerSecret: this.decrypt(encrypted.consumerSecret),
      tokenId: this.decrypt(encrypted.tokenId),
      tokenSecret: this.decrypt(encrypted.tokenSecret),
    };
  }
}
