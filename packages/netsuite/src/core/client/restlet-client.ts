import type { NetSuiteConfig, NetSuiteRequestOptions, NetSuiteResponse } from '../../types/common.js';
import { OAuth1SignatureGenerator } from '../auth/oauth1.js';
import { NetSuiteAPIError, NetSuiteAuthError, NetSuiteTimeoutError } from '../../errors/netsuite-error.js';
import { createLogger } from '@bematic/common';

const logger = createLogger('NetSuiteRESTletClient');

export interface RESTletRequest {
  /** Request method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** RESTlet endpoint URL */
  url: string;
  /** Request body (for POST/PUT) */
  body?: any;
  /** Query parameters */
  params?: Record<string, string>;
}

/**
 * Client for NetSuite RESTlet API calls
 */
export class NetSuiteRESTletClient {
  private readonly oauth1: OAuth1SignatureGenerator;
  private readonly config: NetSuiteConfig;

  constructor(config: NetSuiteConfig) {
    this.config = config;

    if ('consumerKey' in config.credentials) {
      this.oauth1 = new OAuth1SignatureGenerator(config.credentials);
    } else {
      throw new NetSuiteAuthError('RESTlet client requires OAuth 1.0 credentials');
    }
  }

  /**
   * Execute RESTlet request
   */
  async request<T = any>(
    req: RESTletRequest,
    options?: NetSuiteRequestOptions,
  ): Promise<NetSuiteResponse<T>> {
    const startTime = Date.now();

    // Build URL with query params
    const url = this.buildUrl(req.url, req.params);

    // Generate OAuth header
    const authHeader = this.oauth1.generateAuthHeader(
      req.method,
      url,
      this.config.account.accountId,
    );

    // Build headers
    const headers: Record<string, string> = {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options?.headers,
    };

    // Timeout configuration
    const timeout = options?.timeout ?? this.config.timeout ?? 30000;

    logger.debug({ method: req.method, url, timeout }, 'Executing RESTlet request');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
        signal: controller.signal,
      };

      if (req.body && (req.method === 'POST' || req.method === 'PUT')) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;

      // Handle non-OK responses
      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }

        logger.error({
          method: req.method,
          url,
          status: response.status,
          error: errorData,
          durationMs,
        }, 'RESTlet request failed');

        if (response.status === 401 || response.status === 403) {
          throw new NetSuiteAuthError(
            `Authentication failed: ${response.status} ${response.statusText}`,
            errorData,
          );
        }

        throw new NetSuiteAPIError(
          errorData.message || `RESTlet request failed: ${response.statusText}`,
          response.status,
          errorData.code || 'RESTLET_ERROR',
          errorData,
        );
      }

      // Parse response
      const data = await response.json();

      logger.info({ method: req.method, url, status: response.status, durationMs }, 'RESTlet request successful');

      return {
        data: data as T,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (error instanceof NetSuiteAPIError || error instanceof NetSuiteAuthError) {
        throw error;
      }

      if ((error as any).name === 'AbortError') {
        logger.error({ method: req.method, url, timeout, durationMs }, 'RESTlet request timeout');
        throw new NetSuiteTimeoutError(`Request timeout after ${timeout}ms`, timeout);
      }

      logger.error({ error, method: req.method, url, durationMs }, 'RESTlet request error');
      throw new NetSuiteAPIError(
        error instanceof Error ? error.message : 'Unknown error',
        500,
        'NETWORK_ERROR',
        { originalError: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * GET request
   */
  async get<T = any>(
    url: string,
    params?: Record<string, string>,
    options?: NetSuiteRequestOptions,
  ): Promise<NetSuiteResponse<T>> {
    return this.request<T>({ method: 'GET', url, params }, options);
  }

  /**
   * POST request
   */
  async post<T = any>(
    url: string,
    body?: any,
    options?: NetSuiteRequestOptions,
  ): Promise<NetSuiteResponse<T>> {
    return this.request<T>({ method: 'POST', url, body }, options);
  }

  /**
   * PUT request
   */
  async put<T = any>(
    url: string,
    body?: any,
    options?: NetSuiteRequestOptions,
  ): Promise<NetSuiteResponse<T>> {
    return this.request<T>({ method: 'PUT', url, body }, options);
  }

  /**
   * DELETE request
   */
  async delete<T = any>(
    url: string,
    options?: NetSuiteRequestOptions,
  ): Promise<NetSuiteResponse<T>> {
    return this.request<T>({ method: 'DELETE', url }, options);
  }

  /**
   * Build full URL with query parameters
   */
  private buildUrl(baseUrl: string, params?: Record<string, string>): string {
    if (!params || Object.keys(params).length === 0) {
      return baseUrl;
    }

    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, value);
    }

    return url.toString();
  }
}
