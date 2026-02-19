/**
 * Common types for NetSuite integration
 */

export interface NetSuiteAccountConfig {
  /** NetSuite account ID (e.g., "1234567") */
  accountId: string;
  /** Production account URL */
  productionUrl: string;
  /** Sandbox account URL (optional) */
  sandboxUrl?: string;
  /** Current environment */
  environment: 'production' | 'sandbox';
}

export interface NetSuiteOAuth1Credentials {
  /** Consumer key (from Integration record) */
  consumerKey: string;
  /** Consumer secret (from Integration record) */
  consumerSecret: string;
  /** Token ID (from Access Token) */
  tokenId: string;
  /** Token secret (from Access Token) */
  tokenSecret: string;
}

export interface NetSuiteOAuth2Credentials {
  /** Client ID */
  clientId: string;
  /** Client secret */
  clientSecret: string;
  /** Refresh token */
  refreshToken?: string;
  /** Access token */
  accessToken?: string;
  /** Token expiry */
  expiresAt?: number;
}

export type NetSuiteCredentials = NetSuiteOAuth1Credentials | NetSuiteOAuth2Credentials;

export interface NetSuiteConfig {
  /** Account configuration */
  account: NetSuiteAccountConfig;
  /** Authentication credentials */
  credentials: NetSuiteCredentials;
  /** Optional RESTlet endpoint URL */
  restletUrl?: string;
  /** Optional SuiteQL endpoint URL */
  suiteqlUrl?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Retry configuration */
  retry?: {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };
}

export interface NetSuiteRequestOptions {
  /** Custom headers */
  headers?: Record<string, string>;
  /** Request timeout override */
  timeout?: number;
  /** Disable automatic retry */
  noRetry?: boolean;
  /** Custom retry config */
  retry?: {
    maxAttempts: number;
    initialDelayMs: number;
  };
}

export interface NetSuiteResponse<T = any> {
  /** Response data */
  data: T;
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Request duration in ms */
  durationMs: number;
}

export interface NetSuiteErrorResponse {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Additional error details */
  details?: Record<string, any>;
}

export type RecordType =
  | 'customer'
  | 'salesorder'
  | 'invoice'
  | 'item'
  | 'transaction'
  | 'employee'
  | 'vendor'
  | string;

export interface RecordRef {
  /** Record internal ID */
  id: string;
  /** Record type */
  type: RecordType;
}

export interface SearchOptions {
  /** Search filters */
  filters?: Array<{
    field: string;
    operator: string;
    value: any;
  }>;
  /** Columns to return */
  columns?: string[];
  /** Result limit */
  limit?: number;
  /** Result offset */
  offset?: number;
  /** Sort order */
  sort?: Array<{
    field: string;
    order: 'asc' | 'desc';
  }>;
}
