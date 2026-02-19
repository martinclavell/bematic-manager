import { createLogger } from '@bematic/common';
import { NetSuiteConfigRepository } from '@bematic/db';
import crypto from 'node:crypto';

const logger = createLogger('NetSuiteService');

interface NetSuiteConfig {
  accountNumber: string;
  productionUrl: string;
  sandboxUrl?: string;
  restletUrl: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}

interface OAuth1Params {
  oauth_consumer_key: string;
  oauth_token: string;
  oauth_signature_method: string;
  oauth_timestamp: string;
  oauth_nonce: string;
  oauth_version: string;
  oauth_signature?: string;
}

export class NetSuiteService {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly netsuiteConfigRepo: NetSuiteConfigRepository,
    encryptionKeyHex?: string,
  ) {
    const key = encryptionKeyHex || process.env.NETSUITE_ENCRYPTION_KEY;
    if (!key) {
      throw new Error('NETSUITE_ENCRYPTION_KEY environment variable is required');
    }

    // Ensure key is 32 bytes (256 bits) for AES-256
    if (key.length !== 64) {
      throw new Error('NETSUITE_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }

    this.encryptionKey = Buffer.from(key, 'hex');
  }

  /**
   * Encrypt sensitive credential using AES-256-GCM
   */
  private encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt sensitive credential using AES-256-GCM
   */
  private decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex!, 'hex');
    const authTag = Buffer.from(authTagHex!, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted!, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Save NetSuite configuration with encrypted credentials
   */
  async saveConfig(projectId: string, config: NetSuiteConfig): Promise<void> {
    try {
      const encryptedConfig = {
        accountNumber: config.accountNumber,
        productionUrl: config.productionUrl,
        sandboxUrl: config.sandboxUrl || null,
        restletUrl: config.restletUrl,
        consumerKey: this.encrypt(config.consumerKey),
        consumerSecret: this.encrypt(config.consumerSecret),
        tokenId: this.encrypt(config.tokenId),
        tokenSecret: this.encrypt(config.tokenSecret),
      };

      this.netsuiteConfigRepo.upsertByProjectId(projectId, encryptedConfig);

      logger.info({ projectId, accountNumber: config.accountNumber }, 'NetSuite config saved');
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to save NetSuite config');
      throw new Error('Failed to save NetSuite configuration');
    }
  }

  /**
   * Get NetSuite configuration with decrypted credentials
   */
  async getConfig(projectId: string): Promise<NetSuiteConfig | null> {
    try {
      const row = this.netsuiteConfigRepo.findByProjectId(projectId);
      if (!row) {
        return null;
      }

      return {
        accountNumber: row.accountNumber,
        productionUrl: row.productionUrl,
        sandboxUrl: row.sandboxUrl || undefined,
        restletUrl: row.restletUrl,
        consumerKey: this.decrypt(row.consumerKey),
        consumerSecret: this.decrypt(row.consumerSecret),
        tokenId: this.decrypt(row.tokenId),
        tokenSecret: this.decrypt(row.tokenSecret),
      };
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to get NetSuite config');
      throw new Error('Failed to retrieve NetSuite configuration');
    }
  }

  /**
   * Generate OAuth 1.0 signature for NetSuite RESTlet request
   */
  private generateOAuthSignature(
    method: 'GET' | 'POST',
    url: string,
    oauthParams: OAuth1Params,
    consumerSecret: string,
    tokenSecret: string,
  ): string {
    // Create signature base string
    const params = new URLSearchParams();

    // Add OAuth parameters (excluding signature)
    for (const [key, value] of Object.entries(oauthParams)) {
      if (key !== 'oauth_signature') {
        params.append(key, value);
      }
    }

    // Parse URL and add query parameters
    const urlObj = new URL(url);
    for (const [key, value] of urlObj.searchParams.entries()) {
      params.append(key, value);
    }

    // Sort parameters alphabetically
    params.sort();

    // Build base URL (without query string)
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;

    // Build signature base string
    const paramString = params.toString();
    const signatureBase = [
      method.toUpperCase(),
      encodeURIComponent(baseUrl),
      encodeURIComponent(paramString),
    ].join('&');

    // Create signing key
    const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

    // Generate HMAC-SHA256 signature
    const hmac = crypto.createHmac('sha256', signingKey);
    hmac.update(signatureBase);
    const signature = hmac.digest('base64');

    return signature;
  }

  /**
   * Generate OAuth 1.0 Authorization header
   */
  private generateOAuthHeader(
    method: 'GET' | 'POST',
    url: string,
    config: NetSuiteConfig,
  ): string {
    const oauthParams: OAuth1Params = {
      oauth_consumer_key: config.consumerKey,
      oauth_token: config.tokenId,
      oauth_signature_method: 'HMAC-SHA256',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_version: '1.0',
    };

    const signature = this.generateOAuthSignature(
      method,
      url,
      oauthParams,
      config.consumerSecret,
      config.tokenSecret,
    );

    oauthParams.oauth_signature = signature;

    // Build Authorization header
    const headerParts = Object.entries(oauthParams).map(
      ([key, value]) => `${key}="${encodeURIComponent(value)}"`,
    );

    return `OAuth realm="${config.accountNumber}",${headerParts.join(',')}`;
  }

  /**
   * Fetch record from NetSuite via RESTlet
   */
  async fetchRecord(
    projectId: string,
    recordType: string,
    recordId: string,
  ): Promise<any> {
    const config = await this.getConfig(projectId);
    if (!config) {
      throw new Error('NetSuite configuration not found for this project');
    }

    try {
      // Build RESTlet URL with query parameters
      const url = new URL(config.restletUrl);
      url.searchParams.append('recordType', recordType);
      url.searchParams.append('recordId', recordId);

      const finalUrl = url.toString();
      const authHeader = this.generateOAuthHeader('GET', finalUrl, config);

      logger.debug({ projectId, recordType, recordId, url: finalUrl }, 'Fetching NetSuite record');

      const response = await fetch(finalUrl, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ projectId, recordType, recordId, status: response.status, error: errorText }, 'NetSuite request failed');
        throw new Error(`NetSuite request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      logger.info({ projectId, recordType, recordId }, 'NetSuite record fetched successfully');

      return data;
    } catch (error) {
      logger.error({ error, projectId, recordType, recordId }, 'Failed to fetch NetSuite record');
      throw error;
    }
  }

  /**
   * Build SEO debug URL for NetSuite SuiteCommerce page
   */
  buildSEODebugUrl(baseUrl: string): string {
    // Remove protocol and www if present
    let cleanUrl = baseUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');

    // Remove trailing slash
    cleanUrl = cleanUrl.replace(/\/$/, '');

    const timestamp = Date.now();
    const url = `https://${cleanUrl}?seodebug=T&preview=${timestamp}&seonojscache=T`;

    logger.debug({ baseUrl, url }, 'Generated SEO debug URL');

    return url;
  }

  /**
   * Test NetSuite connection by fetching account info
   */
  async testConnection(projectId: string): Promise<{ success: boolean; message: string }> {
    const config = await this.getConfig(projectId);
    if (!config) {
      return { success: false, message: 'NetSuite configuration not found for this project' };
    }

    try {
      const authHeader = this.generateOAuthHeader('GET', config.restletUrl, config);

      logger.debug({ projectId, url: config.restletUrl }, 'Testing NetSuite connection');

      const response = await fetch(config.restletUrl, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        logger.info({ projectId }, 'NetSuite connection test successful');
        return { success: true, message: 'Connection successful' };
      } else {
        const errorText = await response.text();
        logger.warn({ projectId, status: response.status, error: errorText }, 'NetSuite connection test failed');
        return {
          success: false,
          message: `Connection failed: ${response.status} ${response.statusText}`
        };
      }
    } catch (error) {
      logger.error({ error, projectId }, 'NetSuite connection test error');
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Delete NetSuite configuration
   */
  async deleteConfig(projectId: string): Promise<void> {
    try {
      this.netsuiteConfigRepo.deleteByProjectId(projectId);
      logger.info({ projectId }, 'NetSuite config deleted');
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to delete NetSuite config');
      throw new Error('Failed to delete NetSuite configuration');
    }
  }
}
