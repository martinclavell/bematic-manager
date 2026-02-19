import crypto from 'node:crypto';
import type { NetSuiteOAuth1Credentials } from '../../types/common.js';

export interface OAuth1Params {
  oauth_consumer_key: string;
  oauth_token: string;
  oauth_signature_method: string;
  oauth_timestamp: string;
  oauth_nonce: string;
  oauth_version: string;
  oauth_signature?: string;
}

export class OAuth1SignatureGenerator {
  constructor(private readonly credentials: NetSuiteOAuth1Credentials) {}

  /**
   * Generate OAuth 1.0 signature for NetSuite request
   */
  generateSignature(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    oauthParams: OAuth1Params,
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
      this.percentEncode(baseUrl),
      this.percentEncode(paramString),
    ].join('&');

    // Create signing key
    const signingKey = `${this.percentEncode(this.credentials.consumerSecret)}&${this.percentEncode(this.credentials.tokenSecret)}`;

    // Generate HMAC-SHA256 signature
    const hmac = crypto.createHmac('sha256', signingKey);
    hmac.update(signatureBase);
    const signature = hmac.digest('base64');

    return signature;
  }

  /**
   * Generate complete OAuth 1.0 Authorization header
   */
  generateAuthHeader(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    realm: string,
  ): string {
    const oauthParams: OAuth1Params = {
      oauth_consumer_key: this.credentials.consumerKey,
      oauth_token: this.credentials.tokenId,
      oauth_signature_method: 'HMAC-SHA256',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_version: '1.0',
    };

    const signature = this.generateSignature(method, url, oauthParams);
    oauthParams.oauth_signature = signature;

    // Build Authorization header
    const headerParts = Object.entries(oauthParams).map(
      ([key, value]) => `${key}="${this.percentEncode(value)}"`,
    );

    return `OAuth realm="${realm}",${headerParts.join(',')}`;
  }

  /**
   * Percent-encode according to OAuth spec (RFC 3986)
   */
  private percentEncode(str: string): string {
    return encodeURIComponent(str)
      .replace(/!/g, '%21')
      .replace(/\*/g, '%2A')
      .replace(/'/g, '%27')
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29');
  }
}
