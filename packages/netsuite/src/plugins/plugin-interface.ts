import type { NetSuiteClient } from '../core/client/netsuite-client.js';
import type { NetSuiteRequestOptions, NetSuiteResponse } from '../types/common.js';

export interface NetSuitePlugin {
  /** Plugin name */
  name: string;
  /** Plugin version */
  version: string;
  /** Initialize plugin */
  initialize(client: NetSuiteClient): Promise<void> | void;
  /** Cleanup resources */
  destroy(): Promise<void> | void;
  /** Hook: before request */
  beforeRequest?(options: NetSuiteRequestOptions): Promise<NetSuiteRequestOptions> | NetSuiteRequestOptions;
  /** Hook: after response */
  afterResponse?<T>(response: NetSuiteResponse<T>): Promise<NetSuiteResponse<T>> | NetSuiteResponse<T>;
  /** Hook: on error */
  onError?(error: Error): Promise<void> | void;
}

export abstract class BaseNetSuitePlugin implements NetSuitePlugin {
  abstract name: string;
  abstract version: string;

  initialize(client: NetSuiteClient): void {
    // Default: no-op
  }

  destroy(): void {
    // Default: no-op
  }
}
