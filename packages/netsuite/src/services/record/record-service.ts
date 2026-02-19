import type { NetSuiteClient } from '../../core/client/netsuite-client.js';
import type { RecordType, NetSuiteRequestOptions } from '../../types/common.js';
import { NetSuiteValidationError } from '../../errors/netsuite-error.js';

export interface RecordServiceConfig {
  /** RESTlet endpoint URL for record operations */
  restletUrl: string;
}

/**
 * Generic service for NetSuite record operations
 */
export class RecordService {
  constructor(
    private readonly client: NetSuiteClient,
    private readonly config: RecordServiceConfig,
  ) {}

  /**
   * Get record by ID
   */
  async getRecord<T = any>(
    recordType: RecordType,
    recordId: string,
    options?: NetSuiteRequestOptions,
  ): Promise<T> {
    if (!recordId) {
      throw new NetSuiteValidationError('Record ID is required');
    }

    const response = await this.client.restlet.get<T>(
      this.config.restletUrl,
      {
        action: 'get',
        recordType,
        recordId,
      },
      options,
    );

    return response.data;
  }

  /**
   * Create record
   */
  async createRecord<T = any>(
    recordType: RecordType,
    data: Record<string, any>,
    options?: NetSuiteRequestOptions,
  ): Promise<T> {
    const response = await this.client.restlet.post<T>(
      this.config.restletUrl,
      {
        action: 'create',
        recordType,
        data,
      },
      options,
    );

    return response.data;
  }

  /**
   * Update record
   */
  async updateRecord<T = any>(
    recordType: RecordType,
    recordId: string,
    data: Record<string, any>,
    options?: NetSuiteRequestOptions,
  ): Promise<T> {
    if (!recordId) {
      throw new NetSuiteValidationError('Record ID is required');
    }

    const response = await this.client.restlet.put<T>(
      this.config.restletUrl,
      {
        action: 'update',
        recordType,
        recordId,
        data,
      },
      options,
    );

    return response.data;
  }

  /**
   * Delete record
   */
  async deleteRecord(
    recordType: RecordType,
    recordId: string,
    options?: NetSuiteRequestOptions,
  ): Promise<void> {
    if (!recordId) {
      throw new NetSuiteValidationError('Record ID is required');
    }

    await this.client.restlet.delete(
      this.config.restletUrl,
      {
        ...options,
        headers: {
          ...options?.headers,
        },
      },
    );
  }

  /**
   * Search records
   */
  async searchRecords<T = any>(
    recordType: RecordType,
    filters?: Array<{ field: string; operator: string; value: any }>,
    columns?: string[],
    options?: NetSuiteRequestOptions,
  ): Promise<T[]> {
    const response = await this.client.restlet.post<T[]>(
      this.config.restletUrl,
      {
        action: 'search',
        recordType,
        filters,
        columns,
      },
      options,
    );

    return response.data;
  }
}
